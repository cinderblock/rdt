#!/usr/bin/env node

import { fork } from 'child_process';
import { Target } from './config';
import logger, { logFiles } from './log';
import { Client } from 'ssh2';
import { glob } from 'glob';
import { FileChangeInfo, watch } from 'fs/promises';
import { FileChangeResult } from './BuildAndDeployHandler';
import { findPrivateKey } from './util/findPrivateKey';
import { cli } from './cli';
import { addToArrayUnique } from './util/addToArrayUnique';
import { Remote } from './remote';
import { handleError } from './Errors';
import { doDevServer } from './devServer';
import { sleep } from './util/sleep';

export { BuildAndDeploy, BuildResult } from './BuildAndDeployHandler';
export { Config, Target, Targets } from './config';
export { userLogger as logger } from './log';
export { SerialPortMode } from './remote';

export async function rdt(targetName: string, targetConfig: Target) {
  logger.info(`RDT Target: ${targetName}`);

  /**
   * Start in parallel:
   *  - Watch for changes in sources
   *  - Start connection to remote
   *
   * On Change:
   *  - Run `onFileChanged` hook from `rdt.ts`
   *
   * After all `onFileChanged` hooks have run:
   * - Run `onDeployed` hook from `rdt.ts`
   *
   * On Connection:
   * - Run `onConnected` hook from `rdt.ts`
   *
   * On Disconnect:
   * - Run `onDisconnected` hook from `rdt.ts`
   */

  if (typeof targetConfig.devServer === 'string') {
    targetConfig.devServer = { entry: targetConfig.devServer };
  }

  if (!targetConfig.remote) {
    targetConfig.remote = {};
  }
  if (!targetConfig.remote.host) {
    targetConfig.remote.host = targetName;
  }

  const m = targetConfig.remote.host.match(
    /^(?:(?<user>[a-z_](?:[a-z0-9_-]{0,31}|[a-z0-9_-]{0,30}\$))@)(?<hostname>[a-zA-Z0-9-.]+)(?::(?<port>[1-9]\d*))$/,
  );
  if (m) {
    if (m.groups?.user) {
      if (targetConfig.remote.username) {
        throw new Error(`Username specified in hostname and username option`);
      }
      targetConfig.remote.username = m.groups?.user;
    }
    if (m.groups?.port) {
      if (targetConfig.remote.port) {
        throw new Error(`Port specified in hostname and port option`);
      }
      const i = parseInt(m.groups?.port);
      if (!(i > 0 && i < 65536)) throw new Error(`Invalid port: ${m.groups?.port}`);
      targetConfig.remote.port = i;
    }
    targetConfig.remote.host = m.groups?.hostname;
  }

  if (!targetConfig.remote.username) {
    targetConfig.remote.username = 'pi';
  }

  // No authentication method specified. Try to find one.
  if (
    targetConfig.remote.password === undefined &&
    targetConfig.remote.privateKey === undefined &&
    targetConfig.remote.agent === undefined
  ) {
    logger.debug('No authentication method specified. Trying to find one...');
    // 1. If SSH_AUTH_SOCK is set, use the agent
    // 2. Try finding a private key in the usual directories

    if (process.env.SSH_AUTH_SOCK) {
      targetConfig.remote.agent = process.env.SSH_AUTH_SOCK;
    } else if (process.platform === 'win32') {
      logger.debug('Windows detected. Trying to use OpenSSH agent');
      targetConfig.remote.agent = '\\\\.\\pipe\\openssh-ssh-agent';
      // TODO: PuTTY?
    } else {
      const key = await findPrivateKey();
      if (key) {
        logger.debug(`Trying private key`);
        targetConfig.remote.privateKey = key;
      }
    }
  }

  if (!targetConfig.watch) {
    targetConfig.watch = {};
  }

  if (!targetConfig.watch.glob) {
    targetConfig.watch.glob = '**/*';
  }

  if (!targetConfig.watch.options) {
    targetConfig.watch.options = { ignore: [] };
  }

  if (targetConfig.watch.options.ignore) {
    if (typeof targetConfig.watch.options.ignore === 'string') {
      targetConfig.watch.options.ignore = [targetConfig.watch.options.ignore];
    }

    if (Array.isArray(targetConfig.watch.options.ignore)) {
      const builtInIgnore = ['**/node_modules/**', '**/package-lock.json', '**/yarn.lock', ...logFiles, 'rdt.ts'];

      addToArrayUnique(targetConfig.watch.options.ignore, ...builtInIgnore);
    }
  }

  ///////////////////////////////////////////////////////////////
  ////// Config is parsed and checked. Start doing things. //////
  ///////////////////////////////////////////////////////////////

  const { devServer } = targetConfig;

  const ds = doDevServer(devServer).then(() => logger.debug('Local UI Development Server ended normally'));

  const { remote } = targetConfig;

  const port = remote.port ? `:${remote.port}` : '';

  logger.info(`Connecting to remote: ${remote.host}${port} as ${remote.username}`);

  const connection = new Client();

  const rdt = new Remote(targetName, targetConfig, connection);

  // Find all files in target.watchGlob
  const items = glob(targetConfig.watch.glob, targetConfig.watch.options);

  const ready = new Promise<void>((resolve, reject) => {
    connection.on('ready', resolve);
    connection.on('error', reject);
    connection.connect(remote);
  }).then(async () => {
    logger.debug('Connected');

    if (!targetConfig.handler.onConnected) {
      logger.debug('No onConnected hook');
      return;
    }

    await targetConfig.handler.onConnected({ rdt }).catch(handleError('onConnected'));
  });

  // TODO: Is this right?
  connection.on('close', () => {
    logger.debug('Disconnected');

    if (!targetConfig.handler.onDisconnected) {
      logger.debug('No onDisconnected hook');
      return;
    }

    targetConfig.handler.onDisconnected({ rdt });
  });

  const changedFilesOnRemote: string[] = [];

  let changeTimeout: NodeJS.Timeout | undefined;
  function change(r: FileChangeResult) {
    if (!r) return;

    // This debounce is not perfect but gets the job done.
    // It should start the timer when the last file is changed instead of when the last build is finished
    clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      // Make a copy of changes and empty it
      const changedFiles = changedFilesOnRemote.slice();
      changedFilesOnRemote.length = 0;

      logger.debug('Deployed');

      if (!targetConfig.handler.onDeployed) {
        logger.debug(`No onDeployed hook. Changed files: ${changedFiles.join(', ')}`);
        return;
      }

      targetConfig.handler.onDeployed({ changedFiles, rdt });
    }, targetConfig.debounceTime ?? 200);

    if (typeof r == 'string') {
      changedFilesOnRemote.push(r);
      return;
    }
    changedFilesOnRemote.push(...r.changedFiles);
  }

  const files = await items;

  logger.debug(`Found ${files.length} files`);

  const remoteOps = ready.then(() =>
    Promise.all(
      files.map(async function (filePath) {
        const localPath = typeof filePath == 'string' ? filePath : filePath.relative();

        logger.debug(`Watching ${localPath}`);

        // TODO: debounce file changes
        let fileChangeTimeout: NodeJS.Timeout | undefined;

        function trigger(info?: FileChangeInfo<string>) {
          clearTimeout(changeTimeout);
          clearTimeout(fileChangeTimeout);

          fileChangeTimeout = setTimeout(() => {
            if (!targetConfig.handler.onFileChanged) {
              logger.debug(`No onFileChanged hook. Changed file: ${localPath}`);
              return;
            }

            targetConfig.handler
              .onFileChanged({ localPath, changeType: 'change', rdt, info })
              .then(change)
              .catch(handleError('while deploying'));
          }, targetConfig.debounceTime ?? 200);
        }

        trigger();

        for await (const event of watch(localPath)) trigger(event);

        // TODO: Handle new files / deleted files
      }),
    ),
  );

  await remoteOps.catch(handleError('Remote Operations'));
  await ds.catch(handleError('Local UI Development Server'));

  logger.warn('Sleeping');
  await sleep(100000000);
}

if (require.main === module) {
  if (!process.execArgv.includes('--experimental-loader')) {
    logger.silly('Re-running with esbuild-register loader');
    const [nodeBin, module, ...args] = process.argv;
    fork(module, args, {
      // Ensure we're using the node binary that we installed
      execPath: 'node_modules/node/bin/node',
      execArgv: [
        ...process.execArgv,

        // TODO: Do we need to use a different option (--loader) for older versions of node?
        '--experimental-loader',
        'esbuild-register/loader',

        '--require',
        'esbuild-register',

        // Might as well enable source maps while we're here
        '--enable-source-maps',

        // Watch for changes and re-run
        '--watch',

        // Prevent warnings: "(node:29160) ExperimentalWarning: Custom ESM Loaders is an experimental feature. This feature could change at any time"
        // Note, this also prevents other warnings that may be useful... Run without this flag periodically to check for other warnings
        '--no-warnings',
      ],
    }).once('close', process.exit);

    // Tested up to node 19.0.0
    if (parseInt(process.version.slice(1)) > 19) {
      logger.warn('Node version > 19 detected. Has the --experimental-loader flag been removed?');
    }
  } else {
    process.on('unhandledRejection', (reason, p) => {
      logger.error(`Unhandled Rejection: ${reason}`);
      p.catch(e => handleErrorFatal(e, 4));
    });

    logger.silly('Running with esbuild-register loader');
    cli(...process.argv.slice(2))
      .then(() => logger.debug('Normal exit'))
      .catch(handleErrorFatal)
      .then(() => logger.debug('Done running...'))
      .then(forceExit());
  }
}

const eh = handleError('fatal');
export async function handleErrorFatal(e: any, exitCode = 2) {
  process.exitCode = exitCode;
  return eh(e);
}

function forceExit(timeout = 1000) {
  return () =>
    setTimeout(() => {
      logger.warn('Forcing exit');
      process.exit((process.exitCode ?? 0) + 1);
    }, timeout).unref();
}

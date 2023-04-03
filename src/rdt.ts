#!/usr/bin/env node

import { fork } from 'child_process';
import { config, Target } from './config';
import logger, { logFiles } from './log';
import SSH2Promise from 'ssh2-promise';
import { glob } from 'glob';
import { watch } from 'fs/promises';
import { BuildResult } from './BuildAndDeployHandler';
import { findPrivateKey } from './util/findPrivateKey';
import { cli } from './cli';
import { addToArrayUnique } from './util/addToArrayUnique';

export { BuildAndDeploy, BuildResult } from './BuildAndDeployHandler';
export { Config, Target, Targets } from './config';
export { userLogger as logger } from './log';

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
   * - Run `afterDeployed` hook from `rdt.ts`
   *
   * On Connection:
   * - Run `afterConnected` hook from `rdt.ts`
   *
   * On Disconnect:
   * - Run `afterDisconnected` hook from `rdt.ts`
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

  if (targetConfig.watch?.options?.ignore) {
    if (typeof targetConfig.watch.options.ignore === 'string') {
      targetConfig.watch.options.ignore = [targetConfig.watch.options.ignore];
    }

    if (Array.isArray(targetConfig.watch.options.ignore)) {
      const builtInIgnore = ['node_modules/**', 'package-lock.json', 'yarn.lock', ...logFiles, 'rdt.ts'];

      addToArrayUnique(targetConfig.watch.options.ignore, ...builtInIgnore);
    }
  }

  logger.info(
    `Connecting to remote: ${targetConfig.remote.host}:${targetConfig.remote.port} as ${targetConfig.remote.username}`,
  );

  const connection = new SSH2Promise(targetConfig.remote);

  // Find all files in target.watchGlob
  const items = glob(targetConfig.watch.glob, targetConfig.watch.options);

  const ready = connection.connect().then(() => {
    logger.debug('Connected');
    targetConfig.handler.afterConnected({ connection, targetName, targetConfig });
  });

  // TODO: Is this right?
  connection.on('close', () => {
    logger.debug('Disconnected');
    targetConfig.handler.afterDisconnected({ targetName, targetConfig });
  });

  const changedFilesOnRemote: string[] = [];

  // This debounce is not perfect but gets the job done.
  // It should start the timer when the last file is changed instead of when the last build is finished
  let changeTimeout: NodeJS.Timeout | undefined;
  function change(r: BuildResult) {
    clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      // Make a copy of changes and empty it
      const changedFiles = changedFilesOnRemote.slice();
      changedFilesOnRemote.length = 0;

      logger.debug('Deployed');

      targetConfig.handler.afterDeployed({ connection, targetName, targetConfig, changedFiles });
    }, targetConfig.debounceTime ?? 200);

    changedFilesOnRemote.push(...r.changedFiles);
  }

  const files = await items;

  logger.debug(`Found ${files.length} files`);

  await ready;

  await Promise.all(
    files.map(async function (filePath) {
      const localPath = typeof filePath == 'string' ? filePath : filePath.relative();

      logger.debug(`Watching ${localPath}`);

      function trigger() {
        clearTimeout(changeTimeout);

        targetConfig.handler
          .onFileChanged({ connection, targetName, targetConfig, localPath, changeType: 'change' })
          .then(change);
      }

      trigger();

      for await (const event of watch(localPath)) trigger();

      // TODO: Handle new files / deleted files
    }),
  );

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  logger.warn('Sleeping');
  await sleep(100000000);
}

if (require.main === module) {
  if (!process.execArgv.includes('--experimental-loader')) {
    logger.debug('Re-running with esbuild-register loader');
    const [nodeBin, module, ...args] = process.argv;
    fork(module, args, {
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
    logger.debug('Running with esbuild-register loader');
    cli(...process.argv.slice(2))
      .then(() => logger.debug('Normal exit'))
      .catch(e => {
        logger.error('Uncaught error:');
        logger.error(e);
        process.exitCode = 2;
      })
      .then(() => logger.debug('Done running...'))
      .then(() =>
        setTimeout(() => {
          logger.warn('Forcing exit');
          process.exit((process.exitCode ?? 0) + 1);
        }, 1000).unref(),
      );
  }
}

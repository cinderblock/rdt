#!/usr/bin/env node

import { fork } from 'child_process';
import { Target } from './config';
import logger, { logFiles } from './log';
import { Client as SSHClient } from 'ssh2';
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
  logger.info(`RDT Target ${targetName} starting`);

  /**
   * Pseudo-code:
   * - Parse config
   * - Start in parallel:
   *   - Watch for changes in sources
   *   - Start connection to remote
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

  ///////////////////////////////////////////////////////////
  ////// First, set up the config in a consistent way. //////
  ///////////////////////////////////////////////////////////

  if (typeof targetConfig.devServer === 'string') {
    targetConfig.devServer = { entry: targetConfig.devServer };
  }

  if (!targetConfig.remote) {
    targetConfig.remote = {};
  }
  if (!targetConfig.remote.host) {
    targetConfig.remote.host = targetName;
  }

  // Extract username, hostname, and port from host
  const remoteConfig = targetConfig.remote.host.match(
    /^(?:(?<user>[a-z_](?:[a-z0-9_-]{0,31}|[a-z0-9_-]{0,30}\$))@)?(?<hostname>[a-zA-Z0-9-.]+)(?::(?<port>[1-9]\d*))?$/,
  )?.groups;

  if (remoteConfig) {
    const { user, hostname, port } = remoteConfig;

    if (user) {
      if (targetConfig.remote.username) {
        throw new Error(`Username specified in hostname and username option`);
      }
      targetConfig.remote.username = user;
    }

    if (port) {
      if (targetConfig.remote.port) {
        throw new Error(`Port specified twice. In hostname and port option. Use only one.`);
      }
      const i = parseInt(port);
      if (i <= 0 || i > 0xffff) throw new Error(`Invalid port: ${port}`);
      targetConfig.remote.port = i;
    }

    targetConfig.remote.host = hostname;
  }

  // Default username
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
      // TODO: PuTTY\Pageant?
      // targetConfig.remote.agent = 'pageant';
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

  const { remote } = targetConfig;

  const port = remote.port ? `:${remote.port}` : '';

  ///////////////////////////////////////////////////////////////
  ////// Config is parsed and checked. Start doing things. //////
  ///////////////////////////////////////////////////////////////

  logger.info(`Connecting to remote: ${remote.host}${port} as ${remote.username}`);

  // TODO: I forget why I made connection local to this context instead of inside Remote...
  const connection = new SSHClient();

  const rdt = new Remote(targetName, targetConfig, connection);

  const ds = doDevServer(targetConfig.devServer, rdt).then(() =>
    logger.debug('Local UI Development Server ended normally'),
  );

  // Find all files in target.watchGlob
  const items = glob(targetConfig.watch.glob, targetConfig.watch.options);

  const connected = new Promise<void>((resolve, reject) => {
    function tryConnection() {
      logger.debug('Trying to connect...');
      connection.connect(remote);
    }
    connection.on('error', () => {
      logger.debug('Connection failed. Retrying in 1 second...');
      setTimeout(tryConnection, 1000);
    });
    connection.on('ready', resolve);
    tryConnection();
  });

  const ready = connected.then(async () => {
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

  await Promise.all([
    remoteOps.catch(handleError('Remote Operations')),
    ds.catch(handleError('Local UI Development Server')),
  ]);

  logger.warn('Sleeping');
  await sleep(100000000);
}

// Check if being run as a script. If so, run the cli function with the arguments passed to the script.
if (require.main === module) boot();

export async function boot() {
  if (!process.execArgv.includes('--experimental-loader')) {
    // Missing necessary flag. Instead of failing, re-run with the flag set.
    relaunchWithLoader();
  } else {
    main();
  }
}

export async function main() {
  // Normal execution
  logger.silly('Running with esbuild-register loader');

  // Handle uncaught exceptions and rejections gracefully
  process.on('unhandledRejection', (reason, p) => {
    logger.error(`Unhandled Rejection: ${reason}`);
    if (isError(reason)) logger.error(reason?.stack);
    // Print errors consistently
    p.catch(e => handleErrorFatal(e, 4));
  });

  // Call the cli function with the arguments passed to the script
  await cli(...process.argv.slice(2))
    .then(() => logger.debug('Normal exit'))
    // Print errors consistently
    .catch(handleErrorFatal);

  logger.debug('Done running...');

  // In case something is still running, force exit after a timeout
  forceExit();
}

async function relaunchWithLoader() {
  logger.silly('Re-running with esbuild-register loader');

  // Tested up to node 19.0.0
  if (parseInt(process.version.slice(1)) > 19) {
    logger.warn('Node version > 19 detected. Has the --experimental-loader flag been removed?');
  }

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
}

// Helper Functions

function isError(e: any): e is Error {
  return e instanceof Error;
}

// Cache the handleError('fatal') function
const eh = handleError('fatal');

// Handle errors and exit with a specified exit code (default 2)
export async function handleErrorFatal(e: any, exitCode = 2) {
  process.exitCode = exitCode;
  return eh(e);
}

/**
 * Force the process to exit after a specified timeout
 * @param timeout
 * @returns
 */
function forceExit(timeout = 1000) {
  return () =>
    setTimeout(() => {
      logger.warn('Forcing exit');
      process.exit((process.exitCode ?? 0) + 1);
    }, timeout).unref();
}

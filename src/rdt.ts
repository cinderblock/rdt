import { config, Target } from './config';
import logger from './log';
import SSH2Promise from 'ssh2-promise';
import { glob } from 'glob';
import { watch } from 'fs/promises';
import { BuildResult } from './BuildAndDeployHandler';
import { findPrivateKey } from './util/findPrivateKey';

export { BuildAndDeploy, BuildResult } from './BuildAndDeployHandler';
export { Config, Target, Targets } from './config';
export { userLogger as logger } from './log';

export async function help(...args: string[]) {
  console.log('Usage: rdt dev [target-name]');
  console.log('  target-name: The name of the target to build for');
  console.log('               If omitted, the first target is used');
  console.log("               Creates a temporary target if it doesn't match any existing targets");
  console.log('Example:');
  console.log('  $ rdt dev');
  console.log('  $ rdt dev my-target # Connects to my-target as hostname unless it matches an existing target');
}

/**
 * Convert a list of cli arguments into a target name and target config
 *
 * Loads the config file and picks the appropriate target
 *
 * @param args
 * @returns [name, target] The name of the selected target and the target's config
 */
export async function args(...args: string[]): Promise<[string, Target]> {
  logger.debug('Loading config');
  const conf = await config();

  logger.debug('Config loaded in args');

  if (!conf) {
    logger.error('No config loaded');
    throw new Error('No config loaded');
  }

  const { targets } = conf;

  if (!targets) throw new Error('No targets defined');

  logger.debug('Targets defined!');

  // Select the first target if none is specified in the cli arguments
  const selected = args[0] || Object.keys(targets)[0];

  if (!selected) {
    throw new Error('No targets defined or selected');
  }
  return [selected, targets[selected]];
}
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
    targetConfig.watch.options = { ignore: ['node_modules/**', 'combined.log', 'error.log'] };
  }

  if (!targetConfig.remote.port) {
    targetConfig.remote.port = 22;
  }

  logger.info(
    `Connecting to remote: ${targetConfig.remote.host}:${targetConfig.remote.port ?? 22} as ${
      targetConfig.remote.username
    }`,
  );

  const connection = new SSH2Promise(targetConfig.remote);

  // Find all files in target.watchGlob
  const items = glob(targetConfig.watch.glob, targetConfig.watch.options);

  connection.connect().then(() => {
    logger.debug('Connected');
    targetConfig.handler.afterConnected({ connection, targetName, targetConfig });
  });

  // TODO: Is this right?
  connection.on('close', () => {
    logger.debug('Disconnected');
    targetConfig.handler.afterDisconnected({ targetName, targetConfig });
  });

  const changes: BuildResult[] = [];

  // This debounce is not perfect but gets the job done.
  // It should start the timer when the last file is changed instead of when the last build is finished
  let changeTimeout: NodeJS.Timeout | undefined;
  function change(r: BuildResult) {
    clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      // Make a copy of changes and empty it
      const changedFiles = changes.slice();
      changes.length = 0;

      logger.debug('Deployed');

      targetConfig.handler.afterDeployed({ connection, targetName, targetConfig, changedFiles });
    }, targetConfig.debounceTime ?? 200);
    changes.push(r);
  }

  const files = await items;

  logger.debug(`Found ${files.length} files`);

  await Promise.all(
    files.map(async function (filePath) {
      const localPath = typeof filePath == 'string' ? filePath : filePath.relative();

      logger.debug(`Watching ${localPath}`);

      function trigger() {
        clearTimeout(changeTimeout);

        targetConfig.handler.onFileChanged({ connection, targetName, targetConfig, localPath }).then(change);
      }

      trigger();

      for await (const event of watch(localPath)) trigger();

      // TODO: Handle new files / deleted files
    }),
  );

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  await sleep(100000000);
}

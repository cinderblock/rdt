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
      if (!targetConfig.watch.options.ignore.includes('node_modules/**'))
        targetConfig.watch.options.ignore.push('node_modules/**');
      if (!targetConfig.watch.options.ignore.includes('package-lock.json'))
        targetConfig.watch.options.ignore.push('package-lock.json');
      if (!targetConfig.watch.options.ignore.includes('yarn.lock')) targetConfig.watch.options.ignore.push('yarn.lock');
      if (!targetConfig.watch.options.ignore.includes('combined.log'))
        targetConfig.watch.options.ignore.push('combined.log');
      if (!targetConfig.watch.options.ignore.includes('error.log')) targetConfig.watch.options.ignore.push('error.log');
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

  await ready;

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

  logger.warn('Sleeping');
  await sleep(100000000);
}

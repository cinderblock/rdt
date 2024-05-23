/**
 * @file config.ts
 * Load the rdt config file
 */

import { BuildAndDeploy } from './BuildAndDeployHandler.js';
import logger from './log.js';
import { GlobOptions } from 'glob';
import { ConnectConfig } from 'ssh2';

type DevServerOptions = {
  /**
   * The path to the entry file(s) for the browser.
   */
  entry: string | string[];

  /**
   * Should we serve other browser files locally?
   *
   * If so, what directory should we serve from?
   *
   * @default src/ui/public (true or undefined)
   */
  serveLocal?: boolean | string | undefined;
};

// TODO: Support Array<ConnectConfig>
type RemoteOptions = ConnectConfig & {
  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * @default .rdt/${name}
   */
  path?: string;
};

/**
 * The config type of a single target
 */
export type Target = {
  /**
   * File that exports a "BuildAndDeploy" object, created by "createBuildAndDeployHandler".
   *
   * Events are:
   *  - onConnected
   *  - onDisconnected
   *  - onFileChanged (also called on startup for all files)
   *  - onDeployed
   */
  handler: BuildAndDeploy;

  /**
   * Should a browser bundle be built, served, and deployed
   */
  devServer?: string | DevServerOptions | undefined;

  /**
   * Details for connecting to the remote server
   */
  remote?: RemoteOptions;

  /**
   * The ports to forward
   */
  ports?: number[] | Map<number, number | true> | undefined;

  watch?: {
    /**
     * The glob to use for watching files
     * @default `**\/*, !node_modules`
     */
    glob?: string | undefined;

    /**
     * The options to pass to `glob`
     * @default ignores `node_modules`
     */
    options?: GlobOptions;
  };

  /**
   * Time to wait for subsequent file changes before deploying
   */
  debounceTime?: number;
};

export type Targets = { [name: string]: Target };

/**
 * The config type
 */
export type Config = {
  /**
   * The version of RDT this config is for
   * @current v0.0
   */
  version?: string | undefined;

  /**
   * The default target to build
   */
  defaultTarget?: string | undefined;

  /**
   * The targets to build
   */
  targets: Targets;
};

export async function config(): Promise<Config> {
  logger.silly('Loading config rdt.ts...');

  // Open `rdt.ts` in the current directory
  const path = `file://${process.cwd()}/rdt.ts`;

  logger.silly(`Loading config from ${path}...`);

  const {
    default: { version, defaultTarget, targets },
  } = await import(path);
  // TODO: Check more directories?

  logger.debug('Config loaded');

  logger.debug(`Config version: ${version}`);
  logger.debug(`Default target: ${defaultTarget}`);
  logger.debug(`Targets: ${Object.keys(targets).join(', ')}`);

  // TODO: Validate the config

  return { version, defaultTarget, targets };
}

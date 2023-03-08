/**
 * @file config.ts
 * Load the thind config file
 */

import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';

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
   * @default src/www (true or undefined)
   */
  serveLocal?: boolean | string | undefined;
};

/**
 * Configuration for Systemd
 */
type SystemdOptions = {
  /**
   * The name of the service.
   *
   * Should not end in `.service`
   *
   * @default thind-${name}
   */
  serviceName?: string | undefined;

  /**
   * The description of the service
   *
   * @default "Daemon deployed by thind to ${name}"
   */
  description?: string | undefined;

  /**
   * The user to run the server as
   *
   * @default connection.user
   */
  user?: string | number | undefined;
  /**
   * The group to run the server as
   *
   * @default connection.user primary group
   */
  group?: string | number | undefined;

  /**
   * Should the daemon be started on boot
   *
   * @default true
   */
  enable?: boolean | undefined;

  /**
   * The environment variables to set
   */
  env?: Record<string, string> | undefined;

  /**
   * Run as a user service
   *
   * @default false
   */
  userService?: boolean | undefined;
};

type RemoteOptions = {
  /**
   * The host to connect to.
   *
   * May include a port after a colon (`:`) which will override `port`
   *
   * @default ${name}
   */
  host?: string | undefined;
  /**
   * The port to connect to
   *
   * @default 22
   */
  port?: number | undefined;
  /**
   * The username to connect with
   *
   * @default pi
   */
  user?: string;
  /**
   * The password to connect with
   */
  password?: string | undefined;
  /**
   * The private key to connect with
   *
   * @default ~/.ssh/id_rsa
   */
  privateKey?: string | undefined;

  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * @default .thind/${name}
   */
  path?: string;
};

/**
 * The config type of a single target
 */
export type Target = null | {
  /**
   * File that default exports a class that extends the `EventHandler` class
   *
   * Events are:
   *  - afterConnected
   *  - afterDisconnected
   *  - onFile
   *  - afterDeployed
   */
  eventHandler?: string;

  /**
   * Should a browser bundle be built, served, and deployed
   */
  devServer?: boolean | DevServerOptions | undefined;

  /**
   * Details for connecting to the remote server
   */
  remote?: RemoteOptions;

  /**
   * The ports to forward
   */
  ports?: number[] | Map<number, number | true> | undefined;

  /**
   * esbuild settings for files
   */
  esbuild?: {
    /**
     * Should the built files be minified
     *
     * @default false
     */
    minify?: boolean | undefined;
    /**
     * Should we generate source maps
     *
     * @default true
     */
    sourceMaps?: boolean | undefined;
  };
};

/**
 * The config type
 */
export type Config = {
  /**
   * The version of the config file
   * @current v0.0
   */
  version?: string | undefined;

  /**
   * The targets to build
   */
  targets?: { [name: string]: Target };

  /**
   * Shared settings for all targets
   */
  shared?: Target;
};

export async function config(): Promise<Config> {
  // Open `thind.yaml` in the current directory
  const file = await readFile('thind.yaml');
  // TODO: Check more directories?

  // Parse the file as YAML
  const config = parseYaml(file.toString(), {
    // Why not...
    prettyErrors: true,

    // Strict mode. Throw on duplicate keys.
    strict: true,

    // Convert all keys to strings to test for equality
    uniqueKeys: (a, b) => '' + a == '' + b,

    // Be verbose
    logLevel: 'warn',

    // Force the YAML version to 1.2
    version: '1.2',

    // Custom schema processing?
    // schema: ...,
    // customTags: [],
  });

  // TODO: Validate the config

  return config;
}

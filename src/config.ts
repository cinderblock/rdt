/**
 * @file config.ts
 * Load the thind config file
 */

import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';

type BrowserOptions = {
  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * @default ${daemon.path}/www
   */
  path?: string;

  /**
   * The path to the sources directory
   *
   * @default src/www
   */
  sources?: string;

  /**
   * Should we serve the browser bundle locally when developing
   *
   * @default true
   */
  serveLocal?: boolean;
};

type DaemonOptions = {
  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * @default .thind/${name}
   */
  path?: string;

  /**
   * The path to the sources directory
   *
   * @default src
   */
  sources?: string;

  /**
   * Configuration for Systemd
   */
  systemd?:
    | boolean
    | {
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
      }
    | undefined;

  /**
   * Build settings for the daemon
   */
  build?: {
    /**
     * Should the daemon be minified
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
    /**
     * Should dependencies be bundled into the daemon or a list of dependencies to include
     */
    bundle?: boolean | string[] | undefined;
    /**
     * Dependencies to exclude from the bundle
     */
    bundleExclude?: string[] | undefined;
  };
};

type ConnectionOptions = {
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
  user: string;
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
};

/**
 * The config type of a single target
 */
export type Target = {
  /**
   * Should a browser bundle be built
   */
  browser?: boolean | BrowserOptions | undefined;

  /**
   * Settings for building the daemon
   */
  daemon?: DaemonOptions | undefined;

  /**
   * Details for connecting to the remote server
   */
  connection: ConnectionOptions;

  /**
   * The ports to forward
   */
  ports?: number[] | Map<number, number | true> | undefined;
};

/**
 * The config type
 */
export type Config = {
  /**
   * The targets to build
   */
  targets: { [name: string]: Target };
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

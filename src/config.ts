/**
 * @file config.ts
 * Load the thind config file
 */

import { readFile } from 'fs/promises';
import { parse as yaml } from 'yaml';

type BrowserOptions = {
  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * Defaults to `.thind/${name}/www`
   */
  path?: string;

  /**
   * The path to the assets directory
   */
  assets?: string;

  /**
   * Should the browser bundle be served
   */
  serve:
    | boolean
    | {
        /**
         * Should we serve the browser bundle locally when developing
         */
        local: boolean;
        /**
         * Should we serve the browser bundle remotely
         */
        remote: boolean;
      };
};

type DaemonOptions = {
  /**
   * The path on the server to deploy to.
   *
   * Can be absolute or relative to `connection.user`'s home directory.
   *
   * Defaults to `.thind/${name}`
   */
  path?: string;

  runtime?: {
    /**
     * The user to run the server as
     *
     * Defaults to `connection.user`
     */
    user?: string;
    /**
     * The group to run the server as
     *
     * Defaults to `connection.user`'s primary group
     */
    group?: string;
  };

  /**
   * Build settings for the daemon
   */
  build?: {
    /**
     * Should the daemon be minified
     *
     * Defaults to `true`
     */
    minify?: boolean;
    /**
     * Should we generate source maps
     *
     * Defaults to `true`
     */
    sourcemap?: boolean;
    /**
     * Should dependencies be bundled into the daemon or a list of dependencies to include
     */
    bundle?: boolean | string[];
    /**
     * Dependencies to exclude from the bundle
     */
    bundleExclude?: string[];
  };

  /**
   * Should the daemon be started on boot
   *
   * Defaults to `true`
   */
  startOnBoot?: boolean;
};

type ConnectionOptions = {
  /**
   * The host to connect to
   *
   * Defaults to `raspberrypi.local`
   */
  host: string;
  /**
   * The port to connect to
   *
   * Defaults to `22`
   */
  port?: number;
  /**
   * The username to connect with
   *
   * Defaults to `pi`
   */
  user: string;
  /**
   * The password to connect with
   */
  password?: string;
  /**
   * The private key to connect with
   *
   * Defaults to `~/.ssh/id_rsa`
   */
  privateKey?: string;
};

/**
 * The config type of a single target
 */
export type Target = {
  /**
   * Should a browser bundle be built
   */
  browser?: boolean | BrowserOptions;

  /**
   * Settings for building the daemon
   */
  daemon?: DaemonOptions;

  /**
   * Details for connecting to the remote server
   */
  connection: ConnectionOptions;

  /**
   * The ports to forward
   */
  ports?: number[] | Map<number, number | true>;
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
  const config = yaml(file.toString(), {
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

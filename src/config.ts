/**
 * @file config.ts
 * Load the thind config file
 */

import { readFile } from 'fs/promises';
import { parse as yaml } from 'yaml';

/**
 * The config type of a single target
 */
export type Target = {
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
   * Should a browser bundle be built
   */
  browser?:
    | {
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
      }
    | boolean;

  /**
   * Details for connecting to the remote server
   */
  connection: {
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
  // Parse the file as YAML
  const config = yaml(file.toString());

  // TODO: Validate the config

  return config;
}

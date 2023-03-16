import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import logger from './log';

export type HandledInternallyResult = true;
export type BlobResult = Buffer;
export type SkippedResult = false;
export type BuildResult = HandledInternallyResult | BlobResult | SkippedResult;

export function isHandledInternally(result: BuildResult): result is HandledInternallyResult {
  return result === true;
}

export function isBlob(result: BuildResult): result is BlobResult {
  return Buffer.isBuffer(result);
}

export function isSkipped(result: BuildResult): result is SkippedResult {
  return result === false;
}

type SharedInfo = {
  targetName: string;
  targetConfig: Target;
};
type ConnectionInfo = {
  /**
   * The remote connection
   */
  connection: SSH2Promise;
};

export interface BuildAndDeploy {
  /**
   * Called after the remote system is connected to
   *
   * @param options
   * @return Promise thind will wait for before continuing remote dependent tasks
   */
  afterConnected(options: SharedInfo & ConnectionInfo & {}): Promise<void>;

  /**
   * Called after the remote system is disconnected from
   *
   * @param options
   * @return Promise that we will wait for before reconnecting automatically
   */
  afterDisconnected(options: SharedInfo & {}): Promise<void>;

  /**
   * Called to for each source file being deployed
   * @param options
   */
  onFile(options: SharedInfo & ConnectionInfo & { localPath: string }): Promise<BuildResult>;

  afterDeployed(
    options: SharedInfo &
      ConnectionInfo & {
        /**
         * List of files changed since the last deploy
         */
        changedFiles: string[];
      },
  ): Promise<void>;

  /**
   * Time to wait for subsequent file changes before deploying
   */
  debounceTime?: number;
}

export async function createBuildAndDeployHandler(bd: BuildAndDeploy): Promise<BuildAndDeploy> {
  bd.debounceTime ??= 50; // ms
  if (typeof bd.debounceTime !== 'number') throw new Error('debounceTime must be a number');
  if (bd.debounceTime < 0) throw new Error('debounceTime must be greater than or equal to 0');

  // TODO: Implement
  logger.debug('Made Build And Deploy handler!');

  return bd;
}

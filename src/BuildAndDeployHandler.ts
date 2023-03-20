import SSH2Promise from 'ssh2-promise';
import { Target } from './config';

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
   * @return Promise rdt will wait for before continuing remote dependent tasks
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
  onFileChange(options: SharedInfo & ConnectionInfo & { localPath: string }): Promise<BuildResult>;

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

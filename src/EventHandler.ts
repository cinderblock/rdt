import { Target } from './config';
import SSH2Promise from 'ssh2-promise';

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

export default abstract class EventHandler {
  /**
   * Time to wait for subsequent file changes before deploying
   */
  public debounceTime = 50; // ms

  constructor(
    protected configName: string,
    protected targetConfig: Target,
    options?: {
      debounceTime?: number;
    },
  ) {
    if (options?.debounceTime !== undefined) {
      if (typeof options.debounceTime !== 'number') {
        throw new Error('debounceTime must be a number');
      }
      if (options.debounceTime < 0) {
        throw new Error('debounceTime must be greater than or equal to 0');
      }
      this.debounceTime = options.debounceTime;
    }
  }

  /**
   * Called after the remote system is connected to
   *
   * @param options
   * @return Promise thind will wait for before continuing remote dependent tasks
   */
  abstract afterConnected(options: {
    /**
     * The remote connection
     */
    connection: SSH2Promise;
  }): Promise<void>;

  /**
   * Called after the remote system is disconnected from
   *
   * @param options
   * @return Promise that we will wait for before reconnecting automatically
   */
  abstract afterDisconnected(options: {}): Promise<void>;

  /**
   * Called to for each source file being deployed
   * @param options
   */
  abstract onFile(options: { localPath: string; remotePath: string }): Promise<BuildResult>;

  abstract afterDeployed(options: {
    /**
     * List of files changed since the last deploy
     */
    changedFiles: string[];
  }): Promise<void>;
}

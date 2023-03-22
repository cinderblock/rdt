import SSH2Promise from 'ssh2-promise';
import { Target } from './config';

export type BuildResult = {
  changedFiles: string[];
};

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
  onFileChanged(options: SharedInfo & ConnectionInfo & { localPath: string }): Promise<BuildResult>;

  afterDeployed(
    options: SharedInfo &
      ConnectionInfo & {
        /**
         * List of files changed since the last deploy
         */
        changedFiles: BuildResult[];
      },
  ): Promise<void>;
}

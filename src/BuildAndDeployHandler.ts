import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import { Remote } from './remote';
import { FileChangeInfo as FileChangeInfoNode } from 'fs/promises';

export type BuildResult = {
  changedFiles: string[];

  // TODO: deleted files?
};

type SharedInfo = {
  rdt: Remote;
};

type FileChangeInfo = {
  localPath: string;

  /**
   * The type of change that occurred.
   * - add: A new file was added
   * - empty: A file's contents were emptied
   * - change: A file's contents were changed
   * - remove: A file was removed
   */
  changeType: 'add' | 'empty' | 'change' | 'remove';

  info: FileChangeInfoNode<string> | undefined;
};

export interface BuildAndDeploy {
  /**
   * Called after the remote system is connected to
   *
   * @param options
   * @return Promise rdt will wait for before continuing remote dependent tasks
   */
  onConnected(options: SharedInfo & {}): Promise<void>;

  /**
   * Called after the remote system is disconnected from
   *
   * @param options
   * @return Promise that we will wait for before reconnecting automatically
   */
  onDisconnected(options: SharedInfo & {}): Promise<void>;

  /**
   * Called to for each source file being deployed
   * @param options
   */
  onFileChanged(options: SharedInfo & FileChangeInfo): Promise<BuildResult>;

  onDeployed(options: SharedInfo & BuildResult): Promise<void>;
}

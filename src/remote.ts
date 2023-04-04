/**
 * Tools that do useful things on remote in RDT
 */

import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import { BuildResult } from './BuildAndDeployHandler';
import log from './log';

log.debug(`Hello from remote.ts!`);

function dirOf(path: string) {
  return path.replace(/\/[^\/]+$/, '');
}

export class Remote {
  constructor(public targetName: string, public targetConfig: Target, public connection: SSH2Promise) {
    log.debug(`Hello from Remote constructor!`);
  }

  public async run(
    command: string,
    args: string[] = [],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const socket = await this.connection.spawn(command, args);

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>(resolve => {
      socket.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      socket.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      socket.on('close', resolve);
    });

    return { exitCode, stdout, stderr };
  }

  public async runSudo(command: string, args: string[] = []) {
    return this.run(`sudo ${command}`, args);
  }

  public async runLogging(command: string, args: string[] = []) {
    const socket = await this.connection.spawn(command, args);

    const exitCode = await new Promise<number>(resolve => {
      socket.stdout.on('data', (data: Buffer) => {
        log.info(data.toString().trimEnd());
      });
      socket.stderr.on('data', (data: Buffer) => {
        log.error(data.toString().trimEnd());
      });
      socket.on('close', resolve);
    });

    return exitCode;
  }

  public async runLoggingSudo(command: string, args: string[] = []) {
    return this.runLogging(`sudo ${command}`, args);
  }

  public async aptUpdate() {
    return this.runLoggingSudo('apt-get update');
  }

  public async aptInstall(packages: string[]) {
    return this.runLoggingSudo(`sudo apt-get install -y ${packages.join(' ')}`);
  }

  public async aptUpgrade() {
    return this.runLoggingSudo(`sudo apt-get upgrade`);
  }

  public async aptAutoremove() {
    return this.runLoggingSudo(`sudo apt-get autoremove`);
  }

  public async aptAutoclean() {
    return this.runLoggingSudo(`sudo apt-get autoclean`);
  }

  public async aptFullUpgrade() {
    return this.runLoggingSudo(`sudo apt-get full-upgrade`);
  }

  public async aptDistUpgrade() {
    return this.runLoggingSudo(`sudo apt-get dist-upgrade`);
  }

  public async aptPurge(packages: string[]) {
    return this.runLoggingSudo(`sudo apt-get purge ${packages.join(' ')}`);
  }

  public async aptRemove(packages: string[]) {
    return this.runLoggingSudo(`sudo apt-get remove ${packages.join(' ')}`);
  }

  public async npmInstall() {
    return this.runLogging(`npm install`);
  }

  public async ensureFileIs(path: string, content: string) {
    // Check if file exists and has the correct content. If not, create it (and create the directory if needed).
    log.debug(`ensureFileIs: ${path}`);

    return;

    const current = await this.connection
      .sftp()
      .readFile(path)
      .catch(() => null);

    if (current === content) return;

    await this.connection.sftp().mkdir(dirOf(path));
  }
}

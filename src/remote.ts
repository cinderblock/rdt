/**
 * Tools that do useful things on remote in RDT
 */

import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import logger from './log';
import { dirOf } from './util/dirOf';

export class Remote {
  public sftp;

  constructor(public targetName: string, public targetConfig: Target, public connection: SSH2Promise) {
    logger.debug(`Hello from Remote constructor!`);

    this.sftp = connection.sftp();
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
    const log = logger.child({ command });
    const socket = await this.connection.spawn(command, args);

    const exitCode = await new Promise<number>(resolve => {
      let stdout = '';
      socket.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        while (true) {
          const i = stdout.indexOf('\n');
          if (i === -1) break;
          const line = stdout.slice(0, i).trimEnd();
          stdout = stdout.slice(i + 1);
          log.info(line);
        }
      });

      let stderr = '';
      socket.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        while (true) {
          const i = stderr.indexOf('\n');
          if (i === -1) break;
          const line = stderr.slice(0, i).trimEnd();
          stderr = stderr.slice(i + 1);
          log.error(line);
        }
      });

      socket.on('close', resolve);
    });

    return exitCode;
  }

  public async runLoggingSudo(command: string, args: string[] = []) {
    return this.runLogging(`sudo ${command}`, args);
  }

  public async aptUpdate() {
    if (await this.runLoggingSudo('apt-get update')) {
      throw new Error('Failed to update apt');
    }
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

  public async mkdirFor(path: string) {
    logger.debug(`mkdirFor: ${path}`);
    const dir = dirOf(path);
    if (!dir) return;

    const stat = await this.sftp.stat(dir).catch(() => null);

    if (stat) {
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${dir}`);
      }

      logger.debug(`Directory already exists: ${dir}`);

      return;
    }

    await this.mkdirFor(dir);

    logger.debug(`creating directory: ${dir}`);

    await this.sftp.mkdir(dir);
  }

  public async ensureFileIs(path: string, content: string) {
    // Check if file exists and has the correct content. If not, create it (and create the directory if needed).
    logger.debug(`ensureFileIs: ${path}`);

    const current = await this.sftp.readFile(path).catch(() => null);

    if (current === content) return;

    if (content === null) {
      return this.sftp.unlink(path);
    }

    await this.mkdirFor(path);

    logger.debug(`writing file: ${path}`);

    await this.sftp.writeFile(path, content, {});
  }
}

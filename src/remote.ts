/**
 * Tools that do useful things on remote in RDT
 */

import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import logger from './log';
import { SystemdService, generateServiceFileContents } from './Systemd';
import { dirOf } from './util/dirOf';

export class Remote {
  public sftp;
  public apt;
  public npm;
  public fs;
  public systemd;

  constructor(public targetName: string, public targetConfig: Target, public connection: SSH2Promise) {
    logger.debug(`Hello from Remote constructor!`);

    this.sftp = connection.sftp();
    this.apt = {
      update: async () => {
        if (await this.run('apt-get update', [], { logging: true, sudo: true })) {
          throw new Error('Failed to update apt');
        }
      },

      install: async (packages: string[]) => {
        return this.run(`sudo apt-get install -y ${packages.join(' ')}`, [], { logging: true, sudo: true });
      },

      upgrade: async () => {
        return this.run(`sudo apt-get upgrade`, [], { logging: true, sudo: true });
      },

      autoremove: async () => {
        return this.run(`sudo apt-get autoremove`, [], { logging: true, sudo: true });
      },

      autoclean: async () => {
        return this.run(`sudo apt-get autoclean`, [], { logging: true, sudo: true });
      },

      fullUpgrade: async () => {
        return this.run(`sudo apt-get full-upgrade`, [], { logging: true, sudo: true });
      },

      distUpgrade: async () => {
        return this.run(`sudo apt-get dist-upgrade`, [], { logging: true, sudo: true });
      },

      purge: async (packages: string[]) => {
        return this.run(`sudo apt-get purge ${packages.join(' ')}`, [], { logging: true, sudo: true });
      },

      remove: async (packages: string[]) => {
        return this.run(`sudo apt-get remove ${packages.join(' ')}`, [], { logging: true, sudo: true });
      },
    };

    this.npm = {
      install: async () => {
        return this.run(`npm install`, [], { logging: true });
      },
    };

    this.fs = {
      mkdirFor: async (path: string) => {
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

        await this.fs.mkdirFor(dir);

        logger.debug(`creating directory: ${dir}`);

        await this.sftp.mkdir(dir);
      },

      ensureFileIs: async (path: string, content: string) => {
        // Check if file exists and has the correct content. If not, create it (and create the directory if needed).
        logger.debug(`ensureFileIs: ${path}`);

        const current = await this.sftp.readFile(path).catch(() => null);

        if (current === content) return;

        if (content === null) {
          return this.sftp.unlink(path);
        }

        await this.fs.mkdirFor(path);

        logger.debug(`writing file: ${path}`);

        await this.sftp.writeFile(path, content, {});
      },
    };

    this.systemd = {
      service: {
        setup: async (serviceName: string, serviceConfig: SystemdService, opts: { userService?: boolean } = {}) => {
          logger.debug(`setupSystemdService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.fs.ensureFileIs(
            `${sudo ? '/etc/systemd/system' : '.config/systemd/user'}/${serviceName}.service`,
            generateServiceFileContents(serviceConfig),
          );

          await this.run(`systemctl daemon-reload`, [], { sudo, logging: true });

          await this.run(`systemctl${user} enable ${serviceName}`, [], { sudo, logging: true });
        },

        start: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`startService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.run(`systemctl${user} start ${serviceName}`, [], { sudo, logging: true });
        },

        stop: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`stopService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.run(`systemctl${user} stop ${serviceName}`, [], { sudo, logging: true });
        },

        enable: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`enableService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.run(`systemctl${user} enable ${serviceName}`, [], { sudo, logging: true });
        },

        disable: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`disableService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.run(`systemctl${user} disable ${serviceName}`, [], { sudo, logging: true });
        },
      },

      journal: {
        service: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`journalService: ${serviceName}`);
          const user = opts.userService ? ' --user' : '';

          return this.run(`journalctl${user} --unit ${serviceName}`, [], { logging: true });
        },

        follow: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`journalFollow: ${serviceName}`);
          const user = opts.userService ? ' --user' : '';

          // TODO: return something so that we can control this process...
          return this.run(`journalctl${user} --follow --unit ${serviceName}`, [], { logging: true });
        },
      },
    };
  }

  public async run(
    command: string,
    args: string[] = [],
    opts: {
      sudo?: boolean;
      logging?: boolean;
      suppressError?: boolean;
    } = {},
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (opts.sudo) {
      command = `sudo ${command}`;
    }

    const socket = await this.connection.spawn(command, args);
    const log = opts.logging ? logger.child({ command }) : undefined;

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>((resolve, reject) => {
      let stdoutBuffer = '';
      socket.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (log) {
          stdoutBuffer += data.toString();
          while (true) {
            const i = stdoutBuffer.indexOf('\n');
            if (i === -1) break;
            const line = stdoutBuffer.slice(0, i).trimEnd();
            stdoutBuffer = stdoutBuffer.slice(i + 1);
            log.info(line);
          }
        }
      });

      let stderrBuffer = '';
      socket.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (log) {
          stderrBuffer += data.toString();
          while (true) {
            const i = stderrBuffer.indexOf('\n');
            if (i === -1) break;
            const line = stderrBuffer.slice(0, i).trimEnd();
            stderrBuffer = stderrBuffer.slice(i + 1);
            log.error(line);
          }
        }
      });

      socket.on('close', resolve);
      socket.on('error', reject);
    });

    if (!opts.suppressError && exitCode !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n\n${stderr}`);
    }

    return { exitCode, stdout, stderr };
  }
}

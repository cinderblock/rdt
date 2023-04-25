/**
 * Tools that do useful things on remote in RDT
 */

import SSH2Promise from 'ssh2-promise';
import { Target } from './config';
import logger from './log';
import { SystemdService, generateServiceFileContents } from './Systemd';
import { dirOf } from './util/dirOf';
import { getUnofficialBuilds } from './util/getUnofficialNodeBuilds';

export class Remote {
  public sftp;
  public apt;
  public node;
  public npm;
  public fs;
  public systemd;
  public raspberryPi;
  public platform;
  public reduceWork;

  constructor(public targetName: string, public targetConfig: Target, public connection: SSH2Promise) {
    logger.silly(`Hello from Remote constructor!`);

    this.reduceWork = {
      /**
       * A function that checks if a lock is available, and if so, returns a function that releases the lock.
       *
       * Use to reduce replicating work that shouldn't change often, such as installing packages.
       *
       * @param lockName Name of the lock to check
       * @param expiration Hours until the lock expires
       * @returns a function that releases the lock, or null to indicate that the previous lock has not expired yet
       */
      checkAndGetLock: async (lockName: string, expiration = 20): Promise<null | (() => Promise<void>)> => {
        const lockFile = `rdt-locks/${lockName}.lock`;

        let content = await this.fs.readFile(lockFile);

        if (content) content = content.trim();

        logger.silly(`Lock content: ${content ?? 'empty'}`);

        if (content) {
          // if content + expiration hours < now, return null
          const expirationDate = new Date(parseInt(content));
          expirationDate.setHours(expirationDate.getHours() + expiration);

          logger.debug(`Lock expires at: ${expirationDate}`);

          if (expirationDate > new Date()) {
            return null;
          }
        }

        this.fs.unlink(lockFile).catch(() => {});
        return async () => {
          await this.fs.ensureFileIs(lockFile, Date.now() + '\n');
        };
      },
    };

    this.sftp = connection.sftp();

    this.apt = {
      update: async () => {
        if ((await this.run('apt-get update', [], { logging: true, sudo: true })).exitCode) {
          throw new Error('Failed to update apt');
        }
      },

      install: async (packages: string[]) => {
        return this.run(`apt-get install -y`, packages, { logging: true, sudo: true });
      },

      upgrade: async () => {
        return this.run(`apt-get upgrade -y`, [], { logging: true, sudo: true });
      },

      autoremove: async () => {
        return this.run(`apt-get autoremove -y`, [], { logging: true, sudo: true });
      },

      autoclean: async () => {
        return this.run(`apt-get autoclean`, [], { logging: true, sudo: true });
      },

      fullUpgrade: async () => {
        return this.run(`apt-get full-upgrade`, [], { logging: true, sudo: true });
      },

      distUpgrade: async () => {
        return this.run(`apt-get dist-upgrade`, [], { logging: true, sudo: true });
      },

      purge: async (packages: string[]) => {
        return this.run(`apt-get purge`, packages, { logging: true, sudo: true });
      },

      remove: async (packages: string[]) => {
        return this.run(`apt-get remove`, packages, { logging: true, sudo: true });
      },
    };

    this.node = {
      getVersion: async (): Promise<void | {
        major: number;
        minor: number;
        patch: number;
        versionString: string;
        semanticVersion: string;
        prerelease?: string;
        buildMeta?: string;
      }> => {
        const exec = await this.run('node -v', [], { logging: false }).catch(() => {});
        if (!exec) {
          logger.debug(`Node.js not installed`);
          return;
        }
        if (exec.exitCode) {
          logger.debug(`Node.js not installed??`);
          return;
        }

        const versionString = exec.stdout.trim();

        // regex match with names groups and optional release & build flags
        const match = versionString.match(
          /^v(?<semanticVersion>(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<buildMeta>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/,
        );

        if (!match?.groups) {
          logger.debug(`Node.js version string not recognized: ${versionString}`);
          return;
        }

        const { semanticVersion, major, minor, patch, prerelease, buildMeta } = match.groups;

        return {
          major: parseInt(major),
          minor: parseInt(minor),
          patch: parseInt(patch),
          versionString,
          semanticVersion,
          prerelease,
          buildMeta,
        };
      },
      install: async () => {
        const version = await this.node.getVersion();

        if (version) {
          logger.debug(`Node.js already installed: ${version.versionString}`);
          return;
        }

        if (await this.platform.isARM6()) {
          logger.silly('ARM6 detected, installing Node.js from unofficial builds');
          await this.node.installUnofficial();
        } else {
          // TODO: setup node apt repo
          logger.silly('Installing Node.js from apt');
          await this.apt.install(['nodejs']);
        }
      },
      installUnofficial: async () => {
        const versions = await getUnofficialBuilds();

        const latest = versions.find(ver => ver.lts);

        if (!latest) throw new Error('No LTS version found');

        logger.debug(`Latest LTS version: ${latest.version} from ${latest.date}`);

        const downloadUrl = `https://unofficial-builds.nodejs.org/download/release/${latest.version}/node-${latest.version}-linux-armv6l.tar.xz`;

        logger.info(`Downloading Node.js ${latest.version} from ${downloadUrl}`);

        await this.run(`curl -sL ${downloadUrl} | sudo tar xJ -C /usr/local --strip-components=1`, []);
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

        const current = await this.fs.readFile(path);

        if (current === content) return;

        if (content === null) {
          return this.sftp.unlink(path);
        }

        await this.fs.mkdirFor(path);

        logger.debug(`writing file: ${path}`);

        await this.sftp.writeFile(path, content, {});
      },

      readFile: async (path: string) => {
        logger.silly(`readFile: ${path}`);
        return this.sftp.readFile(path, 'utf8').catch(() => null);
      },

      unlink: async (path: string) => {
        logger.debug(`unlink: ${path}`);
        return this.sftp.unlink(path);
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

    this.raspberryPi = {
      config: {
        run: async (command: string, ...args: string[]) => {
          logger.debug(`raspberryPi Config: ${command}`);
          return this.run(`raspi-config nonint ${command}`, args, { logging: false, sudo: true });
        },
        setHostname: async (hostname: string) => {
          logger.debug(`setHostname: ${hostname}`);
          return this.raspberryPi.config.run('do_hostname', hostname);
        },
        setWifiCountry: async (country: string) => {
          logger.debug(`setWifiCountry: ${country}`);
          return this.raspberryPi.config.run('do_wifi_country', country);
        },
      },
    };

    this.platform = {
      isARM6: async () => {
        const { stdout } = await this.run('uname -m', [], { logging: false });
        return stdout.trim().match(/^armv6(\D|$)/);
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

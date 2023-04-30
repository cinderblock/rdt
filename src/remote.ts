/**
 * Tools that do useful things on remote in RDT
 */

import { Client } from 'ssh2';
import { Target } from './config';
import logger from './log';
import { SystemdService, generateServiceFileContents } from './Systemd';
import { dirOf } from './util/dirOf';
import { getUnofficialBuilds } from './util/getUnofficialNodeBuilds';
import { ClientChannel } from 'ssh2';
import { promisify } from 'util';

enum SerialPortMode {
  'console' = 0,
  'disabled' = 1,
  'serial' = 2,
}

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

  constructor(public targetName: string, public targetConfig: Target, public connection: Client) {
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

        if (content) {
          logger.silly(`Lock content: ${content ?? 'empty'}`);

          // if content + expiration hours < now, return null
          const expirationDate = new Date(parseInt(content.toString().trim()));
          expirationDate.setHours(expirationDate.getHours() + expiration);

          logger.debug(`Lock expires at: ${expirationDate}`);

          if (expirationDate > new Date()) {
            return null;
          }
        } else {
          logger.silly(`No lock file found`);
        }

        this.fs.unlink(lockFile).catch(() => {});
        return async () => {
          await this.fs.ensureFileIs(lockFile, Date.now() + '\n');
        };
      },
    };

    this.sftp = promisify(connection.sftp.bind(connection));

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

        const sftp = await this.sftp();

        const stat = await promisify(sftp.stat.bind(sftp))(dir).catch(() => null);

        if (stat) {
          if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${dir}`);
          }

          logger.debug(`Directory already exists: ${dir}`);

          return;
        }

        await this.fs.mkdirFor(dir);

        logger.debug(`creating directory: ${dir}`);

        await promisify(sftp.mkdir.bind(sftp))(dir);
      },

      ensureFileIs: async (path: string, content: string | null, opts: { sudo?: boolean } = {}) => {
        // Check if file exists and has the correct content. If not, create it (and create the directory if needed).
        logger.debug(`ensureFileIs: ${path}`);

        const sftp = await this.sftp();

        const current = await this.fs.readFile(path).then(b => b?.toString() ?? null);

        if (current === content) return;

        if (content === null) {
          return this.fs.unlink(path);
        }

        await this.fs.mkdirFor(path);

        logger.debug(`writing file: ${path}`);

        const randomTempPath = `/tmp/${Math.random().toString(36).substring(7)}`;

        await this.fs.writeFile(path, content).catch(async e => {
          if (!opts.sudo || e?.code !== 3) throw e;

          await this.fs.writeFile(randomTempPath, content);
          await this.run(`mv`, [randomTempPath, path], { sudo: true, logging: true });
        });
      },

      readFile: async (path: string) => {
        logger.silly(`readFile: ${path}`);
        return new Promise<Buffer | null>(async resolve => {
          const sftp = await this.sftp();
          sftp.readFile(path, (err, data) => {
            resolve(err ? null : data);
          });
        });
      },

      writeFile: async (path: string, content: string | Buffer) => {
        logger.debug(`writeFile: ${path}`);
        const sftp = await this.sftp();
        return promisify(sftp.writeFile.bind(sftp))(path, content);
      },

      unlink: async (path: string) => {
        logger.debug(`unlink: ${path}`);
        const sftp = await this.sftp();
        return promisify(sftp.unlink.bind(sftp))(path);
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

        systemctl: async (command: string, serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`systemctl: ${command}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          await this.run(`systemctl${user} ${command} ${serviceName}`, [], { sudo, logging: true });
        },

        start: async (serviceName: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service.systemctl('start', serviceName, opts),
        stop: async (serviceName: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service.systemctl('stop', serviceName, opts),
        restart: async (serviceName: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service.systemctl('restart', serviceName, opts),
        enable: async (serviceName: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service.systemctl('enable', serviceName, opts),
        disable: async (serviceName: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service.systemctl('disable', serviceName, opts),
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
        setWifiCountry: async (country: 'US' | 'GB') => {
          logger.debug(`setWifiCountry: ${country}`);
          return this.raspberryPi.config.run('do_wifi_country', country);
        },
        setWifiSSID: async ({
          ssid,
          passphrase,
          hidden,
          plain,
        }: {
          ssid: string;
          passphrase: string;
          hidden?: boolean;
          plain?: boolean;
        }) => {
          logger.debug(`Setup WiFi: ${ssid}${hidden ? ' hidden' : ''} ${passphrase ? 'with' : 'without'} passphrase`);
          const args = [ssid];
          args.push(passphrase);
          if (hidden !== undefined || plain !== undefined) args.push(hidden ? '1' : '0');
          if (plain !== undefined) args.push(plain ? '1' : '0');

          return this.raspberryPi.config.run('do_wifi_ssid_passphrase', ...args);
        },
        setSerialPortMode: async (mode: SerialPortMode) => {
          logger.debug(`setSerialPortMode: ${SerialPortMode[mode]}`);
          return this.raspberryPi.config.run('do_serial', '' + mode);
        },
        setTimezone: async (timezone: string) => {
          logger.debug(`setTimezone: ${timezone}`);
          return this.raspberryPi.config.run('do_change_timezone', timezone);
        },
      },
    };

    this.platform = {
      isARM6: async () => {
        const { stdout } = await this.run('uname -m', [], { logging: false });
        logger.debug(`Detected platform: ${stdout.trim()}`);
        return stdout.trim().match(/^armv6(\D|$)/);
      },
    };
  }

  public async run(
    command: string,
    args: string[] = [],
    opts: {
      sudo?: boolean;
      discardOutput?: boolean;
      logging?: boolean;
      suppressError?: boolean;
      workingDirectory?: string;
    } = {},
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (opts.sudo) {
      command = `sudo ${command}`;
    }

    // We need to start a shell so that we can change directories before execution
    const shell = await promisify<false, ClientChannel>(this.connection.shell.bind(this.connection))(false);

    logger.debug(`Running command: ${command} ${args.join(' ')}`);

    if (opts.workingDirectory) {
      logger.debug(`Changing working directory to: ${opts.workingDirectory}`);
      shell.write(`cd ${opts.workingDirectory}\n`);
    }

    // TODO: escape command and args
    shell.write(`${command} ${args.join(' ')}\n`);

    // We need to exit so that we can "detect" the shell has finished executing the command
    shell.write(`exit\n`);

    const socket = shell;

    const log = opts.logging ? logger.child({ command }) : undefined;

    // Discard output by default if we're logging
    opts.discardOutput ??= !!log;

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>((resolve, reject) => {
      let stdoutBuffer = '';
      socket.stdout.on('data', (data: Buffer) => {
        if (!opts.discardOutput) stdout += data.toString();
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
        if (!opts.discardOutput) stderr += data.toString();
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

    logger.debug(`Command finished. Exit code: ${exitCode}`);

    if (!opts.suppressError && exitCode !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n\n${stderr}`);
    }

    return { exitCode, stdout, stderr };
  }
}

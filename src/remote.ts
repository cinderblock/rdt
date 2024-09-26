/**
 * Tools that do useful things on remote in RDT
 */

import { Client, SFTPWrapper, ShellOptions } from 'ssh2';
import { Target } from './config.js';
import logger from './log.js';
import { SystemdService, generateServiceFileContents, handleJournalJson } from './Systemd.js';
import { dirOf } from './util/dirOf.js';
import { getUnofficialBuilds } from './util/getUnofficialNodeBuilds.js';
import { ClientChannel } from 'ssh2';
import { promisify } from 'util';
import { Server } from 'net';

export enum SerialPortMode {
  'console' = 0,
  'disabled' = 1,
  'serial' = 2,
}

/**
 * Tools that do useful things on remotes
 */
export class Remote {
  public forward;
  public sftp;
  public apt;
  public node;
  public npm;
  public fs;
  public systemd;
  public raspberryPi;
  public platform;
  public reduceWork;

  constructor(
    public targetName: string,
    public targetConfig: Target,
    public connection: Client,
  ) {
    logger.silly(`Hello from Remote constructor!`);

    this.forward = {
      /**
       * ssh -L bindIP:localPort:target:port
       *
       * RDT's computer   --ssh2-> remote interface    -> remote target
       * bindIP:localPort --ssh2-> sourceIP:sourcePort -> target:port
       *
       * @param port
       * @param target
       * @param localPort
       * @param bindIP
       * @param sourceIP IP on remote to connect out from
       * @param sourcePort Port on remote to connect out from
       */
      async toRemoteTarget(
        port: number,
        target = 'localhost',
        localPort = port,
        bindIP?: string,
        sourceIP = 'localhost',
        sourcePort = 0,
      ) {
        const fwd = promisify(connection.forwardOut.bind(connection));

        {
          const l = `${bindIP ?? '*'}:${localPort}`;
          const t = `${target}:${port}`;
          const s = `${sourceIP}:${sourcePort}`;
          logger.debug(`Creating local server at ${l} to forward connections to target at ${t} from source ${s}`);
        }

        new Server(async incoming => {
          // Wait for the SSH connection to be ready
          await new Promise<void>(resolve => connection.once('ready', resolve));

          logger.info(`Forwarding port ${localPort} to ${target}:${port} for ${incoming.remoteAddress}`);

          const outgoing = await fwd(sourceIP, sourcePort, target, port);

          incoming.on('error', (e: Error & { code: string }) => {
            switch (e.code) {
              case 'ECONNRESET':
                break;
              default:
                logger.error(`Error incoming forwarding port ${localPort} to ${target}:${port}`);
                logger.error(e.message);
                logger.error(e.code);
                logger.error(e.stack);
            }

            outgoing.end();
          });

          await new Promise((resolve, reject) => {
            outgoing.on('close', resolve);
            outgoing.on('error', reject);
            incoming.pipe(outgoing);
            outgoing.pipe(incoming);
          }).catch(e => {
            logger.error(`Error outgoing forwarding port ${localPort} to ${target}:${port}`);
            logger.error(e.message);
            logger.error(e.code);
            logger.error(e.stack);
          });

          logger.info(`Forwarded port ${localPort} to ${target}:${port} closed`);
        }).listen(localPort, bindIP);
      },
    };

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

    // this.sftp = promisify(connection.sftp.bind(connection))();
    this.sftp = new Promise<SFTPWrapper>((resolve, reject) => {
      connection.on('ready', () => {
        connection.sftp((err, sftp) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(sftp);
        });
      });
    });

    const aptOpts = {
      logging: true,
      sudo: true,
      env: {
        DEBIAN_FRONTEND: 'noninteractive',
        TERM: 'linux',
      },
    };

    this.apt = {
      update: async () => {
        await this.run('apt-get update', [], aptOpts);
      },

      install: async (packages: string[]) => {
        return this.run(`apt-get install -y`, packages, aptOpts);
      },

      upgrade: async () => {
        return this.run(`apt-get upgrade -y`, [], aptOpts);
      },

      autoremove: async () => {
        return this.run(`apt-get autoremove -y`, [], aptOpts);
      },

      autoclean: async () => {
        return this.run(`apt-get autoclean`, [], aptOpts);
      },

      fullUpgrade: async () => {
        return this.run(`apt-get full-upgrade`, [], aptOpts);
      },

      distUpgrade: async () => {
        return this.run(`apt-get dist-upgrade`, [], aptOpts);
      },

      purge: async (packages: string[]) => {
        return this.run(`apt-get purge`, packages, aptOpts);
      },

      remove: async (packages: string[]) => {
        return this.run(`apt-get remove -y`, packages, aptOpts);
      },
    };

    this.node = {
      getPath: async (): Promise<string | undefined> => {
        const exec = await this.run('which node', [], { logging: false, resolveError: true });

        if (exec.exitCode) {
          logger.debug(`Node.js not installed??`);
          return;
        }

        return exec.stdout.trim();
      },
      getVersion: async (): Promise<
        | undefined
        | {
            major: number;
            minor: number;
            patch: number;
            versionString: string;
            semanticVersion: string;
            prerelease?: string;
            buildMeta?: string;
          }
      > => {
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
      install: async (major = 22) => {
        if (await this.platform.isARM6()) {
          logger.silly('ARM6 detected, installing Node.js from unofficial builds');
          return this.node.installUnofficial();
        }

        // const key = await fetch('https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key').then(r => r.text());
        // const gpg = spawn('gpg --dearmor', { input: key });
        const gpg = Buffer.from(
          [
            'mQENBFdDN1ABCADaNd/I3j3tn40deQNgz7hB2NvT+syXe6k4ZmdiEcOfBvFrkS8BhNS67t93etHs',
            'xEy7E0qwsZH32bKazMqe9zDwoa3aVImryjh6SHC9lMtW27JPHFeMSrkt9YmH1WMwWcRO6eSY9B3P',
            'pazquhnvbammLuUojXRIxkDroy6Fw4UKmUNSRr329Ej87jRoR1B2/57Kfp2Y4+vFGGzSvh3AFQpB',
            'Hq51qsNHALU6+8PjLfIt+5TPvaWRTB+kAZnQZkaIQM2nr1n3oj6ak2RATY/+kjLizgFWzgEfbCrb',
            'syq68UoY5FPBnu4ZE3iDZpaIqwKr0seUC7iA1xM5eHi5kty1oB7HABEBAAG0Ik5Tb2xpZCA8bnNv',
            'bGlkLWdwZ0Bub2Rlc291cmNlLmNvbT6JATgEEwECACIFAldDN1ACGwMGCwkIBwMCBhUIAgkKCwQW',
            'AgMBAh4BAheAAAoJEC9ZtfmbG+C0y7wH/i4xnab36dtrYW7RZwL8i6ScNjMx4j9+U1kr/F6YtqWd',
            '+JwCbBdar5zRghxPcYEq/qf7MbgAYcs1eSOuTOb7n7+oxUwdH2iCtHhKh3Jr2mRw1ks7BbFZPB5K',
            'mkxHaEBfLT4d+I91ZuUdPXJ+0SXs9gzkDbz65Uhoz3W03aiF8HeL5JNARZFMbHHNVL05U1sTGTCO',
            'tu+1c/33f3TulQ/XZ3Y4hwGCpLe0Tv7g7Lp3iLMZMWYPEa0a7S4u8he5IEJQLd8bE8jltcQvrdr3',
            'Fm8kI2JgBJmUmX4PSfhuTCFaR/yeCt3UoW883bs9LfbTzIx9DJGpRIu8Y0IL3b4sj/GoZVq5AQ0E',
            'V0M3UAEIAKrTaC62ayzqOIPa7nS90BHHck4Z33a2tZF/uof38xNOiyWGhT8uJeFoTTHn5SQq5Fty',
            'u4K3K2fbbpuu/APQF05AaljzVkDGNMW4pSkgOasdysj831cussrHX2RYS22wg80k6C/Hwmh5F45f',
            'aEuNxsV+bPx7oPUrt5n6GMx84vEP3i1+FDBi0pt/B/QnDFBXki1BGvJ35f5NwDefK8VaInxXP3ZN',
            '/WIbtn5dqxppkV/YkO7GiJlpJlju9rf3kKUIQzKQWxFsbCAPIHoWv7rH9RSxgDithXtG6Yg5R1ae',
            'BbJaPNXL9wpJYBJbiMjkAFaz4B95FOqZm3r7oHugiCGsHX0AEQEAAYkBHwQYAQIACQUCV0M3UAIb',
            'DAAKCRAvWbX5mxvgtE/OB/0VN88DR3Y3fuqy7lq/dthkn7Dqm9YXdorZl3L152eEIF882aG8FE3q',
            'ZdaLGjQO4oShAyNWmRfSGuoH0XERXAI9n0r8m4mDMxE6rtP7tHety/5M8x3CTyuMgx5GLDaEUvBu',
            'snTD+/v/fBMwRK/cZ9du5PSG4R50rtst+oYyC2aox4I2SgjtF/cY7bECsZDplzatN3gv34PkcdIg',
            '8SLHAVlL4N5tzumDeizRspcSyoy2K2+hwKU4C4+dekLLTg8rjnRROvplV2KtaEk6rxKtIRFDCoQn',
            'g8wfJuIMrDNKvqZwFRGt7cbvW5MCnuH8MhItOl9Uxp1wHp6gtav/h8Gp6MBa',
          ].join(''),
          'base64',
        );

        const keyFile = '/usr/share/keyrings/nodesource.gpg';
        const sourcesList = '/etc/apt/sources.list.d/nodesource.list';
        await this.fs.ensureFileIs(keyFile, gpg, { sudo: true });

        const arch = 'amd64'; // TODO: detect arch

        await this.fs.ensureFileIs(
          sourcesList,
          `deb [arch=${arch} signed-by=${keyFile}] https://deb.nodesource.com/node_${major}.x nodistro main`,
          { sudo: true },
        );

        await this.fs.ensureFileIs(
          '/etc/apt/preferences.d/nodejs',
          'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n',
          { sudo: true },
        );

        await this.apt.update();

        logger.silly('Installing Node.js from apt');
        await this.apt.install(['nodejs', 'npm']);
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

        const sftp = await this.sftp;

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

      /**
       * @return true if the file was changed
       */
      ensureFileIs: async (path: string, content: Buffer | string | null, opts: { sudo?: boolean } = {}) => {
        // Check if file exists and has the correct content. If not, create it (and create the directory if needed).
        logger.debug(`ensureFileIs: ${path}`);

        if (content === null) {
          await this.fs.unlink(path);
          return true;
        }

        const currentBuff = await this.fs.readFile(path);

        if (currentBuff) {
          if (typeof content === 'string') {
            const current = currentBuff?.toString() ?? null;

            if (current === content) return false;
          } else {
            if (currentBuff?.equals(content)) return false;
          }
        } else {
          await this.fs.mkdirFor(path);
        }

        logger.debug(`writing file: ${path}`);

        const randomTempPath = `/tmp/${Math.random().toString(36).substring(7)}`;

        await this.fs.writeFile(path, content).catch(async e => {
          if (!opts.sudo || e?.code !== 3) throw e;

          await this.fs.writeFile(randomTempPath, content);
          await this.run(`mv`, [randomTempPath, path], { sudo: true, logging: true });
        });

        return true;
      },

      ensureFileIsLink: async (path: string, target: string) => {
        logger.debug(`ensureFileIsLink: ${path} -> ${target}`);
        if (!path) throw new Error(`No path specified`);
        if (!target) throw new Error(`No target specified`);

        const sftp = await this.sftp;

        const current = await promisify(sftp.readlink.bind(sftp))(path).catch(() => null);

        if (current === target) return false;

        await this.fs.mkdirFor(path);

        logger.debug(`creating link: ${path} -> ${target}`);

        await promisify(sftp.symlink.bind(sftp))(target, path);

        return true;
      },

      readFile: async (path: string) => {
        logger.silly(`readFile: ${path}`);
        return new Promise<Buffer | null>(async resolve => {
          const sftp = await this.sftp;
          sftp.readFile(path, (err, data) => {
            resolve(err ? null : data);
          });
        });
      },

      writeFile: async (path: string, content: string | Buffer) => {
        logger.debug(`writeFile: ${path}`);
        const sftp = await this.sftp;
        return promisify(sftp.writeFile.bind(sftp))(path, content);
      },

      unlink: async (path: string) => {
        logger.debug(`unlink: ${path}`);
        const sftp = await this.sftp;
        return promisify(sftp.unlink.bind(sftp))(path);
      },
    };

    this.systemd = {
      service: {
        setup: async (serviceName: string, serviceConfig: SystemdService, opts: { userService?: boolean } = {}) => {
          logger.debug(`setupSystemdService: ${serviceName}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          const changed = await this.fs.ensureFileIs(
            `${sudo ? '/etc/systemd/system' : '.config/systemd/user'}/${serviceName}.service`,
            generateServiceFileContents(serviceConfig),
            { sudo },
          );

          if (!changed) return;

          await this.run(`systemctl daemon-reload`, [], { sudo, logging: true });

          await this.run(`systemctl${user} enable ${serviceName}`, [], { sudo, logging: true });
        },

        systemctl: async (
          command: string,
          serviceName: string,
          opts: { args?: string[]; userService?: boolean; logging?: boolean } = {},
        ) => {
          logger.debug(`systemctl: ${command}`);
          const sudo = !opts.userService;
          const user = opts.userService ? ' --user' : '';

          return this.run(`systemctl${user} ${command} ${serviceName}`, opts.args ?? [], {
            sudo,
            logging: opts.logging ?? true,
          });
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

        show: async (serviceName: string, property: string, opts: { userService?: boolean } = {}) =>
          this.systemd.service
            .systemctl('show', serviceName, {
              ...opts,
              logging: false,
              // Read the value of the property
              args: ['--property', property, '--value'],
            })
            .then(({ stdout }) => stdout.trimEnd()),
      },

      journal: {
        service: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`journalService: ${serviceName}`);

          const args = [];

          if (opts.userService) {
            args.unshift('--user');
          }

          return this.run(`journalctl --unit ${serviceName}`, args, { logging: true });
        },

        follow: async (serviceName: string, opts: { userService?: boolean } = {}) => {
          logger.debug(`journalFollow: ${serviceName}`);

          const args = [];

          // Follow the logs
          args.push('--follow');

          // Don't show any old logs
          args.push('--lines', '0');

          if (opts.userService) {
            args.unshift('--user');
          }

          args.push('--output', 'json');
          const lineHandler = (line: string) => handleJournalJson(line);

          return this.run(`journalctl --unit ${serviceName}`, args, {
            lineHandler,
          });
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

  /**
   * Run a command on the remote system.
   *
   * @note Not passed through a shell, so no shell features are available.
   * @param command Path to the command to run
   * @param args Arguments to pass to the command
   * @param opts
   * @returns A promise that resolves with the exit code and outputs of the command
   */
  public async run(
    command: string,
    args: string[] = [],
    opts: Partial<{
      sudo: boolean;
      discardOutput: boolean;
      logging: boolean | 'errRedirect';
      lineHandler: (line: string, err: boolean) => void;
      resolveError: boolean;
      workingDirectory: string;
      env: { [key: string]: string };
    }> = {},
  ): RemoteExec {
    if (opts.sudo) {
      command = `sudo ${command}`;
    }

    // TODO: don't use shell. We're only using it to change directories.
    // Long Term plan: Have agent running on remote that can run all desired commands

    // We need to start a shell so that we can change directories before execution
    const shell = await promisify<false, ShellOptions, ClientChannel>(this.connection.shell.bind(this.connection))(
      false,
      { env: opts.env },
    );

    logger.debug(`Running command: ${command} ${args.join(' ')}`);

    if (opts.workingDirectory) {
      logger.debug(`Changing working directory to: ${opts.workingDirectory}`);
      shell.write(`cd ${opts.workingDirectory}\n`);
    }

    // TODO: escape command and args or not actually use shell!
    shell.write(`${command} ${args.join(' ')}\n`);

    // We need to exit so that we can "detect" the shell has finished executing the command
    shell.write(`exit\n`);

    const socket = shell;

    const log = opts.logging ? logger.child({ command }) : undefined;

    // Discard output by default if we're logging or have a line handler
    opts.discardOutput ??= !!(log || opts.lineHandler);

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>((resolve, reject) => {
      let stdoutBuffer = '';
      socket.stdout.on('data', (data: Buffer) => {
        if (!opts.discardOutput) stdout += data.toString();
        if (log || opts.lineHandler) {
          stdoutBuffer += data.toString();
          while (true) {
            const i = stdoutBuffer.indexOf('\n');
            if (i === -1) break;
            const line = stdoutBuffer.slice(0, i).trimEnd();
            stdoutBuffer = stdoutBuffer.slice(i + 1);
            opts.lineHandler?.(line, false);
            log?.info(line);
          }
        }
      });

      let stderrBuffer = '';
      socket.stderr.on('data', (data: Buffer) => {
        if (!opts.discardOutput) stderr += data.toString();
        if (log || opts.lineHandler) {
          stderrBuffer += data.toString();
          while (true) {
            const i = stderrBuffer.indexOf('\n');
            if (i === -1) break;
            const line = stderrBuffer.slice(0, i).trimEnd();
            stderrBuffer = stderrBuffer.slice(i + 1);
            opts.lineHandler?.(line, true);
            if (log) (opts.logging === 'errRedirect' ? log.info : log.error)(line);
          }
        }
      });

      socket.on('close', resolve);
      socket.on('error', reject);
    });

    logger.debug(`Command finished. Exit code: ${exitCode}`);

    if (!opts.resolveError && exitCode !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n\n${stderr}`);
    }

    socket.close();

    return { exitCode, stdout, stderr };
  }
}

// TODO: return something so that we can control this process...
export type RemoteExec = Promise<{ exitCode: number; stdout: string; stderr: string }>;

import { logger } from './rdt';

export type SystemdService = {
  Unit: {
    Description: string;
  };
  Service: {
    ExecStart: string;

    WorkingDirectory?: string;

    User?: string;
    Group?: string;

    /**
     * @default 'no'
     */
    Restart?: 'always' | 'on-failure' | 'on-abnormal' | 'on-watchdog' | 'on-abort' | 'no';

    Environment?: string[];
    EnvironmentFile?: string[];

    /**
     * @default 'simple'
     */
    Type?: 'simple' | 'forking' | 'oneshot' | 'dbus' | 'notify' | 'idle';

    ExecStartPre?: string[];
    ExecStartPost?: string[];
    ExecReload?: string;
    ExecStop?: string;
  };
  Install: {
    WantedBy: string;
  };
};

type Section = { [key: string]: string | string[] };
type Sections = { [key: string]: Section };

function generateServiceSection(section: Section) {
  return Object.entries(section)
    .map(([k, v]) => {
      if (!Array.isArray(v)) v = [v];
      return v.map(v => `${k}=${v}\n`).join('');
    })
    .join('');
}

export function generateServiceFileContents(service: SystemdService) {
  return Object.entries(service)
    .map(([k, v]) => `[${k}]\n${generateServiceSection(v)}`)
    .join('\n');
}

const systemLogger = logger.child({ label: 'systemd' });
const applicationLogger = logger.child({ label: 'application' });

export function handleJournalJson(line: string) {
  try {
    const obj = JSON.parse(line);

    type SystemdMessage = {
      CODE_FILE: string; // src/core/unit.c
      CODE_FUNC: string; // unit_log_resources
      CODE_LINE: string; // 2476
      CPU_USAGE_NSEC: string; // 2447589000
      INVOCATION_ID: string; // 43fdcb00c32c45119a7866ac83514c98
      MESSAGE: string; // toaster.service: Consumed 2.447s CPU time.
      MESSAGE_ID: string; // ae8f7b866b0347b9af31fe1c80b127c0
      PRIORITY: string; // 5
      SYSLOG_FACILITY: string; // 3
      SYSLOG_IDENTIFIER: string; // systemd
      TID: string; // 1
      UNIT: string; // toaster.service
      _BOOT_ID: string; // 3d06230e516241048eca936ae23d35a5
      _CAP_EFFECTIVE: string; // 1ffffffffff
      _CMDLINE: string; // /sbin/init
      _COMM: string; // systemd
      _EXE: string; // /usr/lib/systemd/systemd
      _GID: string; // 0
      _HOSTNAME: string; // hotpi
      _MACHINE_ID: string; // e90a9a2845b441c8ada291e1f254e45d
      _PID: string; // 1
      _SOURCE_REALTIME_TIMESTAMP: string; // 1682890795078397
      _SYSTEMD_CGROUP: string; // /init.scope
      _SYSTEMD_SLICE: string; // -.slice
      _SYSTEMD_UNIT: string; // init.scope
      _TRANSPORT: string; // journal
      _UID: string; // 0
      __CURSOR: string; // s=9aca398ae360401b8a6a5bd95859048f;i=1f51;b=3d06230e516241048eca936ae23d35a5;m=da5a35d7d2;t=5fa948c095377;x=39848186d892997a
      __MONOTONIC_TIMESTAMP: string; // 937816348626
      __REALTIME_TIMESTAMP: string; // 1682890795078519
    };

    type ServiceMessage = {
      MESSAGE: string; // Dashboard main
      PRIORITY: string; // 6
      SYSLOG_FACILITY: string; // 3
      SYSLOG_IDENTIFIER: string; // node
      _BOOT_ID: string; // 3d06230e516241048eca936ae23d35a5
      _CAP_EFFECTIVE: string; // 1ffffffffff
      _CMDLINE: string; // /usr/local/bin/node /home/pi/toaster
      _COMM: string; // node
      _EXE: string; // /usr/local/bin/node
      _HOSTNAME: string; // hotpi
      _MACHINE_ID: string; // e90a9a2845b441c8ada291e1f254e45d
      _PID: string; // 25742
      _STREAM_ID: string; // ed31dd4541a942879bfa7fa445c4781c
      _SYSTEMD_CGROUP: string; // /system.slice/toaster.service
      _SYSTEMD_INVOCATION_ID: string; // d46cd9f74bed4b6b84375fd6f92708ed
      _SYSTEMD_SLICE: string; // system.slice
      _SYSTEMD_UNIT: string; // toaster.service
      _TRANSPORT: string; // stdout
      _UID: string; // 0
      __CURSOR: string; // s=9aca398ae360401b8a6a5bd95859048f;i=1fc6;b=3d06230e516241048eca936ae23d35a5;m=da8f96f8c7;t=5fa94c16a746c;x=3452f23a668bcec5
      __MONOTONIC_TIMESTAMP: string; // 938711906503
      __REALTIME_TIMESTAMP: string; // 1682891690636396
    };

    if (obj.SYSLOG_IDENTIFIER === 'node') {
      return applicationLogger.info(obj.MESSAGE);
    }

    if (obj.SYSLOG_IDENTIFIER === 'systemd') {
      return systemLogger.info(obj.MESSAGE);
    }

    logger.info('Unknown message type');

    logger.info(
      Object.keys(obj)
        .sort()
        .map(k => `${k}: ${obj[k]}`)
        .join('\n'),
    );
  } catch (e) {
    logger.error('Failed to parse JSON from journalctl???');
    logger.error(line);
  }
}

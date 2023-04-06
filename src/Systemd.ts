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

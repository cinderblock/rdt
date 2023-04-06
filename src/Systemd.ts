export type SystemdService = {
  Unit: {
    Description: string;
  };
  Service: {
    ExecStart: string;
    WorkingDirectory?: string;
    Restart?: 'always' | 'on-failure' | 'on-abnormal' | 'on-watchdog' | 'on-abort' | 'no';
    Environment?: string[];
    EnvironmentFile?: string[];
  };
  Install: {
    WantedBy: string;
  };
};

function generateServiceSection(section: { [key: string]: string | string[] }) {
  return Object.entries(section)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return v.map(v => `${k}=${v}\n`).join('');
      }
      return `${k}=${v}\n`;
    })
    .join('');
}

export function generateServiceFileContents(service: SystemdService) {
  return Object.entries(service)
    .map(([k, v]) => `[${k}]\n${generateServiceSection(v)}`)
    .join('\n');
}

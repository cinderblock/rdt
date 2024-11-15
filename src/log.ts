import winston from 'winston';

export const logFiles = ['error.log', 'combined.log'];

const logger = winston.createLogger({
  level: 'silly',
  format: winston.format.json(),
  // transports: [
  //   // Write all logs with importance level of `error` or less to `error.log`
  //   new winston.transports.File({ filename: 'error.log', level: 'error' }),
  //   // Write all logs with importance level of `info` or less to `combined.log`
  //   new winston.transports.File({ filename: 'combined.log' }),
  // ],
});

export const labels: { [name: string]: string } = {
  build: '📦',
  // Not sure why `🖥️` needs an extra whitespace to align with others...
  rdt: '🖥️ ',
  user: '👤',
  systemd: '🔧',
  application: '🏃',
};

export function setLabelShorthand(name: string, label: string) {
  labels[name] = label;
}

export function rdtLogFormat() {
  return winston.format(info => {
    // Windows gets an extra space in the console

    if (info.label) {
      const sep = process.platform === 'win32' ? ' ' : '';

      const label = labels[info.label as keyof typeof labels] ?? '❔';

      info.message = label + sep + info.message;

      delete info.label;
    }

    // Account for varying width of log level name and align other log messages
    info.message = '\t' + info.message;
    return info;
  })();
}

// Not sure if we'll use `NODE_ENV` long term but for now...
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(rdtLogFormat(), winston.format.colorize(), winston.format.simple()),
    }),
  );
}

export default logger.child({ label: 'rdt' });

export const userLogger = logger.child({ label: 'user' });

export const buildLogger = logger.child({ label: 'build' });

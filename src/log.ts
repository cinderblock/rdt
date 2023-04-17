import winston from 'winston';

export const logFiles = ['error.log', 'combined.log'];

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  // transports: [
  //   // Write all logs with importance level of `error` or less to `error.log`
  //   new winston.transports.File({ filename: 'error.log', level: 'error' }),
  //   // Write all logs with importance level of `info` or less to `combined.log`
  //   new winston.transports.File({ filename: 'combined.log' }),
  // ],
});

export function rdtLogFormat() {
  return winston.format(info => {
    // Windows gets an extra space in the console
    const sep = process.platform === 'win32' ? ' ' : '';
    switch (info.label) {
      case 'rdt-build':
        info.message = '📦' + sep + info.message;
        delete info.label;
        break;
      case 'rdt':
        // Not sure why `🖥️` needs an extra whitespace to align with others...
        info.message = '🖥️ ' + sep + info.message;
        delete info.label;
        break;
      case 'user':
        info.message = '👤' + sep + info.message;
        delete info.label;
        break;
      default:
        info.message = '❔' + sep + info.message;
        break;
    }
    // Account for varying width of label
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

export const buildLogger = logger.child({ label: 'rdt-build' });

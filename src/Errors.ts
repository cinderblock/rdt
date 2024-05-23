import logger from './log.js';

export function handleError(type: string) {
  return async (e: any) => {
    logger.debug(`Error handler for '${type}'`);
    if (e?.message && e?.stack) {
      logger.error(`Message: ${e.message}`);
      logger.error(`Error code: ${e.code}`);
      `${e.stack}`.split('\n').forEach(line => logger.debug(line));
    } else {
      logger.error('Unknown error format:');
      logger.error(e);
    }
  };
}
// Helper Functions
export function isError(e: any): e is Error {
  return e instanceof Error;
}

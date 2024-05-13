import logger from './log.js';

export function handleError(type: string) {
  return async (e: any) => {
    logger.debug(`Error handler for '${type}'`);
    if (e?.message && e?.stack) {
      logger.error(e.message);
      logger.error(`Error code: ${e.code}`);
      logger.debug(e.stack);
    } else {
      logger.error('Unknown error format:');
      logger.error(e);
    }
  };
}

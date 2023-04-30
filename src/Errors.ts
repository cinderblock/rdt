import logger from './log';

export function handleError(type: string) {
  return async (e: any) => {
    logger.error(`Error ${type}:`);
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

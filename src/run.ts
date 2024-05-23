import { fork } from 'child_process';
import logger from './log.js';
import { handleError } from './Errors.js';
import { cli } from './cli.js';
import { isError } from './Errors.js';

logger.debug(`Import.meta: ${import.meta.url}`);

export async function boot() {
  logger.silly('Booting...');

  if (relaunchWithLoader()) return;

  await startup();

  // In case something is still running, force exit after a timeout
  forceExit();
}

export async function startup(catchRejections = true) {
  // Normal execution
  logger.debug('Running main!');

  // Handle uncaught exceptions and rejections gracefully

  if (catchRejections) {
    process.on('unhandledRejection', (reason, p) => {
      logger.error(`Unhandled Rejection: ${reason}`);
      if (isError(reason)) logger.error(reason?.stack);
      // Print errors consistently
      p.catch(e => handleErrorFatal(e, 4));
    });
  }

  // Call the cli function with the arguments passed to the script
  await cli(...process.argv.slice(2))
    .then(() => logger.debug('Normal exit'))
    // Print errors consistently
    .catch(handleErrorFatal);

  logger.debug('Done running...');
}

/**
 * Relaunch the process with the esbuild-register loader, if required, and a known version of Node
 * @returns true if the process was relaunched with the loader
 */
function relaunchWithLoader() {
  logger.silly('Checking if we are a subprocess');

  if (process.send) return false;

  logger.debug('Re-running with subprocess and needed flags');

  process.argv.forEach(arg => logger.silly(`Arg: ${arg}`));
  process.execArgv.forEach(arg => logger.silly(`execArgv: ${arg}`));

  // Extract this module to run, with its args.
  const [nodeBin, module, ...args] = process.argv;

  // Use Node's fork() to run this module with the loader and our node args
  fork(module, args, {
    // Ensure we're using the node binary that we installed
    execPath: 'node_modules/node/bin/node',
    execArgv: [
      ...process.execArgv,

      '--import',
      'tsx',

      // Might as well enable source maps while we're here
      '--enable-source-maps',

      // Watch for changes and re-run
      '--watch',
    ],
    // stdio: 'inherit' not needed because silent is false by default
  }).once('close', process.exit);

  return true;
}

// Cache the handleError('fatal') function
const eh = handleError('fatal');

// Handle errors and exit with a specified exit code (default 2)
export async function handleErrorFatal(e: any, exitCode = 2) {
  process.exitCode = exitCode;
  return eh(e);
}

/**
 * Force the process to exit after a specified timeout
 * @param timeout
 * @returns
 */
function forceExit(timeout = 1000) {
  logger.debug(`Forcing exit in ${timeout}ms`);
  setTimeout(() => {
    logger.warn('Forcing exit');
    process.exitCode ??= 0;
    if (typeof process.exitCode == 'number') process.exitCode |= 0x1000_0000;
    process.exit();
  }, timeout).unref();
}

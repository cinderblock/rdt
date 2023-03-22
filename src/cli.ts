#!/usr/bin/env node

import { fork } from 'child_process';
import logger from './log';
import { rdt, help as rdtHelp, args as rdtArgs } from './rdt';

// Since this is also the main import, export the important stuff
export { rdt, BuildAndDeploy, BuildResult, Config, Target, Targets } from './rdt';
export { userLogger as logger } from './log';

if (require.main === module) {
  if (!process.execArgv.includes('--experimental-loader')) {
    logger.debug('Re-running with esbuild-register loader');
    const [nodeBin, module, ...args] = process.argv;
    fork(module, args, {
      execArgv: [
        ...process.execArgv,

        // TODO: Do we need to use a different option (--loader) for older versions of node?
        '--experimental-loader',
        'esbuild-register/loader',

        '--require',
        'esbuild-register',

        // Might as well enable source maps while we're here
        '--enable-source-maps',

        // Prevent warnings: "(node:29160) ExperimentalWarning: Custom ESM Loaders is an experimental feature. This feature could change at any time"
        // Note, this also prevents other warnings that may be useful... Run without this flag periodically to check for other warnings
        '--no-warnings',
      ],
    }).once('close', process.exit);

    // Tested up to node 19.0.0
    if (parseInt(process.version.slice(1)) > 19) {
      logger.warn('Node version > 19 detected. Has the --experimental-loader flag been removed?');
    }
  } else {
    logger.debug('Running with esbuild-register loader');
    cli(...process.argv.slice(2))
      .then(() => logger.debug('Normal exit'))
      .catch(e => {
        logger.error('Uncaught error:');
        logger.error(e);
        process.exitCode = 2;
      })
      .then(() => logger.debug('Done running...'))
      .then(() =>
        setTimeout(() => {
          logger.warn('Forcing exit');
          process.exit((process.exitCode ?? 0) + 1);
        }, 1000).unref(),
      );
  }
}

export async function cli(...args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    // case "build":
    // return build();
    case undefined:
    case 'dev':
      const args = await rdtArgs(...rest);
      logger.debug('Selected target:', args[0]);
      return rdt(...args);
    case 'help':
      return help(...rest);
  }
}

export async function help(...args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case undefined:
      console.log('Usage: <command> [options]');
      console.log('Commands:');
      console.log('  dev');
      // console.log("  build");
      console.log('  help [command]');
      console.log('Example:');
      console.log('  $ rdt dev');
      console.log('  $ rdt help dev');
      break;
    case 'dev':
      return rdtHelp(...rest);
  }
}

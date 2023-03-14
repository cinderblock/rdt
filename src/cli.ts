#!/usr/bin/env node

import logger from './log';
import { thind, help as thindHelp, args as thindArgs } from './thind';

// Since this is also the main import, export the important stuff
export { thind, makeEventHandler, BuildResult } from './thind';

function getArgs() {
  const args = process.argv.slice(2);

  const loader = args.indexOf('--loader');

  if (loader !== -1) {
    logger.error('loader arg included!');
    throw new Error('loader arg included');
  }

  return args;
}

if (require.main === module) {
  cli(...getArgs())
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

export async function cli(...args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    // case "build":
    // return build();
    case undefined:
    case 'dev':
      return thind(...(await thindArgs(...rest)));
    case 'dev2':
      return thind('dev2', {
        remote: {
          host: 'raspberrypi.local',
          user: 'pi',
          privateKey: 'C:\\Users\\camer\\.ssh\\id_rsa',
        },
        devServer: true,
        ports: [3000],
        // ports: new Map([[3000, true]]),
      });
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
      console.log('  $ thind dev');
      console.log('  $ thind help dev');
      break;
    case 'dev':
      return thindHelp(...rest);
  }
}

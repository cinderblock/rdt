#!/usr/bin/env node

import logger from './log';
import { thind, help as thindHelp, args as thindArgs } from './thind';

export { thind } from './thind';
export { default as EventHandler } from './EventHandler';

if (require.main === module) {
  cli(...process.argv.slice(2))
    .then(() => logger.log('debug', 'Normal exit'))
    .catch(e => {
      console.error('Uncaught error:');
      console.error(e);
      process.exitCode = 2;
    })
    .then(() => logger.log('debug', 'Done running...'))
    .then(() =>
      setTimeout(() => {
        logger.log('warn', 'Forcing exit');
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

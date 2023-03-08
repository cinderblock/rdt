#!/usr/bin/env node

import { thind, help as thindHelp, args as thindArgs } from './thind';

export { thind } from './thind';
export { default as EventHandler } from './EventHandler';

if (require.main === module) {
  cli(...process.argv.slice(2)).then(
    () => {
      console.log('Normal exit');
      setTimeout(() => {
        console.log('Forcing exit');
        process.exit(2);
      }, 1000).unref();
    },
    e => {
      console.error('Uncaught error:');
      console.error(e);
      process.exitCode = 1;
    },
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

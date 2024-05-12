import { config, Target } from './config';
import logger from './log';
import { rdt } from './rdt';

export async function cli(...args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    // case "build":
    // return build();
    case undefined:
    case 'dev':
      const args = await rdtArgs(...rest);
      logger.debug(`Selected target: ${args[0]}`);
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

export async function rdtHelp(...args: string[]) {
  console.log('Usage: rdt dev [target-name]');
  console.log('  target-name: The name of the target to build for');
  console.log('               If omitted, the first target is used');
  console.log("               Creates a temporary target if it doesn't match any existing targets");
  console.log('Example:');
  console.log('  $ rdt dev');
  console.log('  $ rdt dev my-target # Connects to my-target as hostname unless it matches an existing target');
}

/**
 * Convert a list of cli arguments into a target name and target config
 *
 * Loads the config file and picks the appropriate target
 *
 * @param args
 * @returns [name, target] The name of the selected target and the target's config
 */
export async function rdtArgs(...args: string[]): Promise<[string, Target]> {
  logger.debug('Loading config');
  const conf = await config();

  logger.debug('Config loaded in args');

  if (!conf) {
    logger.error('No config loaded');
    throw new Error('No config loaded');
  }

  const { targets } = conf;

  if (!targets) throw new Error('No targets defined');

  logger.debug('Targets defined!');

  // Select the first target if none is specified in the cli arguments
  const selected = args[0] || Object.keys(targets)[0];

  if (!selected) {
    throw new Error('No targets defined or selected');
  }
  return [selected, targets[selected]];
}

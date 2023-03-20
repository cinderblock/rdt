import { config, Target } from './config';
import { register } from 'esbuild-register/dist/node';
import logger from './log';
import { relativeToProjectRoot } from './util/relativeToProjectRoot';
import { BuildStep } from './BuildStep';

export { BuildAndDeploy, BuildResult } from './BuildAndDeployHandler';
export { Config, Target } from './config';
export { childLogger as logger } from './log';

export async function help(...args: string[]) {
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
export async function args(...args: string[]): Promise<[string, Target]> {
  logger.debug('Loading config');
  const conf = await config();

  logger.debug('Config loaded in args');

  if (!conf) {
    logger.error('No config loaded');
    throw new Error('No config loaded');
  }

  logger.debug('???' + conf);

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

function watchForServerChanges(triggers: BuildStep) {
  triggers.run();
}

function watchForUIChanges(triggers: BuildStep) {
  triggers.run();
}

function watchForPackageChanges(triggers: BuildStep) {
  triggers.run();
}

export async function rdt(name: string, target: Target) {
  logger.info(`RDT Target: ${name}`);

  if (typeof target.devServer === 'string') {
    target.devServer = { entry: target.devServer };
  }

  const server = new BuildStep('Build Server Locally', buildServer);

  const remote = new BuildStep('Connect to Remote', connectToRemote);

  const transferServerStep = new BuildStep('Transfer Server', transferServer, {
    dependencies: [remote],
    triggersFrom: [server],
  });

  const portForwards = new BuildStep('Forward Ports', forwardPorts, { triggersFrom: [remote] });

  let uiStep: BuildStep | undefined;

  if (target.devServer) {
    uiStep = new BuildStep('Build UI Locally', buildUI);
    const transferUIStep = new BuildStep('Transfer UI', transferUI, { dependencies: [remote], triggersFrom: [uiStep] });

    if (target.devServer.serveLocal ?? true) {
      const serveUIStep = new BuildStep('Serve UI Locally', serveUI, {
        dependencies: [portForwards],
        triggersFrom: [uiStep],
      });
    }
  }

  const setup = new BuildStep('Setup Systemd on Remote', setupSystemd, { triggersFrom: [remote] });

  const outputMonitorStep = new BuildStep('Output Monitor', outputMonitor, {
    dependencies: [setup],
    triggersFrom: [remote],
  });

  const transferPackageJsonStep = new BuildStep('Transfer package.json', transferPackageJson, {
    dependencies: [remote],
  });

  const installStep = new BuildStep('Install on Remote', install, {
    dependencies: [remote],
    triggersFrom: [transferPackageJsonStep],
  });

  const startStep = new BuildStep('Start on Remote', start, {
    dependencies: [remote, setup, outputMonitorStep],
    triggersFrom: [installStep, transferServerStep],
  });

  async function buildServer(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function buildUI(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function connectToRemote(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 3000));
    logger.warn(this.name);
  }

  async function transferUI(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function serveUI(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function transferServer(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function forwardPorts(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function setupSystemd(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function outputMonitor(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function transferPackageJson(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function install(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  async function start(this: BuildStep) {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    logger.warn(this.name);
  }

  remote.run();

  watchForServerChanges(server);
  watchForPackageChanges(transferPackageJsonStep);
  uiStep && watchForUIChanges(uiStep);

  await startStep.result;
  logger.debug('Done');

  await new Promise(r => setTimeout(r, 3000));

  watchForServerChanges(server);
  await startStep.result;
  logger.debug('Done2');
}

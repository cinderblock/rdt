import { config, Target } from './config';
import merge from 'ts-deepmerge';
import { register } from 'esbuild-register/dist/node';
import logger from './log';
import { relativeToProjectRoot } from './util/relativeToProjectRoot';

export { makeEventHandler, BuildResult } from './EventHandler';

export async function help(...args: string[]) {
  console.log('Usage: thind dev [target-name]');
  console.log('  target-name: The name of the target to build for');
  console.log('               If omitted, the first target is used');
  console.log("               Creates a temporary target if it doesn't match any existing targets");
  console.log('Example:');
  console.log('  $ thind dev');
  console.log('  $ thind dev my-target # Connects to my-target as hostname unless it matches an existing target');
}

export async function args(...args: string[]): Promise<[string, Target]> {
  const conf = await config();

  const targets = conf?.targets || {};
  const selected = args[0] || Object.keys(targets)[0];

  if (!selected) {
    throw new Error('No targets defined or selected');
  }
  return [selected, merge(conf?.shared ?? {}, targets[selected] ?? {})];
}

class BuildStep<Result = unknown> {
  /**
   * The function that is the atomic unit of work.
   *
   * Updates the result property.
   */
  readonly run: () => void;

  /**
   * The steps that must be notified when this step completes.
   */
  private dependents: BuildStep[] = [];
  /**
   * The steps that must be completed before this step can run.
   */
  private dependencies: BuildStep[] = [];
  /**
   * The steps that get started when this step completes.
   */
  private triggers: BuildStep[] = [];

  /**
   * A longer description of the step.
   */
  public description: string = '';

  public result: Promise<Result> | undefined;

  constructor(
    /**
     * The name of the step.
     */
    readonly name: string,

    /**
     * The function that is the atomic unit of work.
     */
    unitOfWork: () => Promise<Result>,

    {
      dependencies,
      triggersFrom,
    }: {
      /**
       * The steps that must be completed before this step can run.
       */
      dependencies?: BuildStep[];
      /**
       * The steps that trigger this step when they complete.
       */
      triggersFrom?: BuildStep[];
    } = {},
  ) {
    dependencies?.forEach(this.addDependency.bind(this));
    triggersFrom?.forEach(this.triggerFrom.bind(this));
    // TODO: Check for duplicate dependencies. Maybe use a Set?

    this.run = () => {
      const oldResult = this.result;
      // TODO: if oldResult is pending, somehow:
      // - cancel it, maybe
      // - make the old promise resolve to the new result

      const r: Promise<Result> = (this.result = Promise.all(
        this.dependencies.map(dependency => dependency.result),
      ).then(() => {
        if (this.result !== r) {
          // Step has been re-triggered before being run. Return the new result.
          logger.debug(`Skipping: ${this.name}`);
          return this.result!;
        }
        logger.info(`Running: ${this.name}`);
        return unitOfWork.bind(this)();
      }));
      this.triggers.forEach(subsequentStep => subsequentStep.run());
    };
  }

  private addDependency(dependency: BuildStep) {
    // Might as well check for this now...
    if (dependency === this) {
      throw new Error('A step cannot depend on itself.');
    }

    // This test should not be needed because of how steps are initialized, but just in case...
    if (dependency.dependencies.includes(this)) {
      throw new Error('A step cannot depend on a step that depends on it.');
      // Note: doesn't check for deeper cycles...
    }

    if (this.dependencies.includes(dependency)) {
      // This step already depends on the dependency. No need to add it again if everything is working correctly.
      if (dependency.dependents.includes(this)) {
        logger.debug(`Removing duplicate dependency: ${this.name}->${dependency.name}`);
        return;
      }

      throw new Error('Dependency chain is broken. Something is very wrong.');
    }

    dependency.dependents.push(this as BuildStep);
    this.dependencies.push(dependency);
  }

  private triggerFrom(parent: BuildStep) {
    parent.triggers.push(this as BuildStep);
    this.addDependency(parent);
  }
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

export async function thind(name: string, target: Target) {
  logger.info(`Thind Target: ${name}`);

  // See docs/diagram.drawio.svg for a diagram of the build DAG
  if (!target) target = {};

  if (target.devServer === undefined) target.devServer = true;
  if (target.devServer === true)
    target.devServer = {
      entry: 'src/www/index.ts',
    };

  if (target.eventHandler) {
    const { unregister } = register({
      // TODO: Options?
    });

    const path = relativeToProjectRoot(target.eventHandler);
    logger.debug(`Event Handler Path: ${path}`);

    const eh = await import(path);
    logger.info('Using event handler!!!');
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

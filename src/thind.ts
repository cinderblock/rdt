import { config, Target } from './config';
import { context as esbuild } from 'esbuild';

export async function help(...args: string[]) {}

export async function args(...args: string[]): Promise<[string, Target]> {
  const { targets } = await config();
  const selected = args[0] || Object.keys(targets)[0];
  return [selected, targets[selected]];
}

class BuildStep<Result = unknown> {
  /**
   * The function that is the atomic unit of work.
   *
   * Updates the result property.
   */
  readonly run: () => Promise<Result>;

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

  public description: string = '';

  public result: Promise<Result>;

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
      const r = (this.result = Promise.all(this.dependencies.map(step => step.result)).then(() => {
        if (this.result !== r) {
          // Step has been re-triggered before being run. Return the new result.
          console.log('Skipping:', this.name);
          return this.result;
        }
        console.log('Running:', this.name);
        return unitOfWork.bind(this)();
      }));
      this.triggers.forEach(subsequentStep => subsequentStep.run());
      return this.result;
    };
  }

  public addDependency(dependency: BuildStep) {
    dependency.dependents.push(this as BuildStep);
    this.dependencies.push(dependency);
    return this;
  }

  public triggerFrom(parent: BuildStep) {
    parent.triggers.push(this as BuildStep);
    this.addDependency(parent);
    return this;
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
  // See docs/diagram.drawio.svg for a diagram of the build DAG

  const server = new BuildStep('Build Server Locally', buildServer);

  const remote = new BuildStep('Connect to Remote', connectToRemote);

  const transferServerStep = new BuildStep('Transfer Server', transferServer, {
    dependencies: [remote],
    triggersFrom: [server],
  });

  const portForwards = new BuildStep('Forward Ports', forwardPorts).triggerFrom(remote);

  let uiStep: BuildStep | undefined;

  if (target.browser) {
    uiStep = new BuildStep('Build UI Locally', buildUI);
    const transferUIStep = new BuildStep('Transfer UI', transferUI, { dependencies: [remote], triggersFrom: [uiStep] });

    let serveLocal = false;
    let serveRemote = false;
    if (target.browser === true) {
      serveLocal = true;
      serveRemote = true;
    } else if (target.browser.serve === true) {
      serveLocal = true;
      serveRemote = true;
    } else if (target.browser.serve) {
      if (target.browser.serve.local) serveLocal = true;
      if (target.browser.serve.remote) serveRemote = true;
    }

    if (serveLocal) {
      const serveUIStep = new BuildStep('Serve UI Locally', serveUI, {
        dependencies: [portForwards],
        triggersFrom: [uiStep],
      });
    }

    if (serveRemote) {
      // TODO: Add a step to setup systemd on the remote??
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

  async function buildServer() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function buildUI() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function connectToRemote() {
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 3000));
    console.log(this.name);
  }

  async function transferUI() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function serveUI() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function transferServer() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function forwardPorts() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function setupSystemd() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function outputMonitor() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function transferPackageJson() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function install() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  async function start() {
    await new Promise(r => setTimeout(r, Math.random() * 1000));
    console.log(this.name);
  }

  remote.run();

  watchForServerChanges(server);
  watchForPackageChanges(transferPackageJsonStep);
  uiStep && watchForUIChanges(uiStep);

  await startStep.result;
  console.log('Done');

  await new Promise(r => setTimeout(r, 3000));

  watchForServerChanges(server);
  await startStep.result;
  console.log('Done2');
}

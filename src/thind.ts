import { config, Target } from './config';
import { context as esbuild } from 'esbuild';

export async function help(...args: string[]) {}

export async function args(...args: string[]): Promise<[string, Target]> {
  const conf = await config();

  if (!conf) throw new Error('Config empty!');

  const { targets } = conf;
  const selected = args[0] || Object.keys(targets)[0];
  return [selected, targets[selected]];
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
      const oldResult = this.result;
      // TODO: if oldResult is pending, somehow:
      // - cancel it, maybe
      // - make the old promise resolve to the new result

      const r = (this.result = Promise.all(this.dependencies.map(dependency => dependency.result)).then(() => {
        if (this.result !== r) {
          // Step has been re-triggered before being run. Return the new result.
          console.log('Skipping:', this.name);
          return this.result;
        }
        console.log('Running:', this.name);
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
  // See docs/diagram.drawio.svg for a diagram of the build DAG
  if (!target) target = {};

  if (target.browser === undefined) target.browser = true;
  if (target.browser === true) target.browser = {};

  const server = new BuildStep('Build Server Locally', buildServer);

  const remote = new BuildStep('Connect to Remote', connectToRemote);

  const transferServerStep = new BuildStep('Transfer Server', transferServer, {
    dependencies: [remote],
    triggersFrom: [server],
  });

  const portForwards = new BuildStep('Forward Ports', forwardPorts, { triggersFrom: [remote] });

  let uiStep: BuildStep | undefined;

  if (target.browser) {
    uiStep = new BuildStep('Build UI Locally', buildUI);
    const transferUIStep = new BuildStep('Transfer UI', transferUI, { dependencies: [remote], triggersFrom: [uiStep] });

    if (target.browser.serveLocal ?? true) {
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

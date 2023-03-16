import logger from './log';

export class BuildStep<Result = unknown> {
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

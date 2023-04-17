import { writeFile, mkdir, copyFile, rm, readdir } from 'fs/promises';
import winston from 'winston';
import esbuild from 'esbuild';
import { join } from 'path';
import { dtsPlugin } from 'esbuild-plugin-d.ts';
import { buildLogger as logger } from '../src/log';

function forceExit() {
  setTimeout(() => {
    logger.warn('Something is still running. Forcing exit.');
    process.exit(2);
  }, 1).unref();
}

function handleError(e: any) {
  logger.error(e);
  process.exitCode = 1;
}

if (require.main === module) {
  logger.debug('Running main build');
  parseArgs(...process.argv.slice(2))
    .then(main)
    .then(() => logger.debug('Build exited normally'))
    .then(forceExit)
    .catch(handleError);
}

process.on('unhandledRejection', e => {
  logger.error('Unhandled rejection:');
  logger.error(e);
  process.exitCode = 2;
  forceExit();
});
process.on('uncaughtException', e => {
  logger.error('Uncaught exception:');
  logger.error(e);
  process.exitCode = 2;
  forceExit();
});

export type Options = {
  distDir: string;
  bundleName: string;
  skipDts?: boolean;
  watch?: boolean;
};

async function extractNamedFlag(args: string[], name: string): Promise<boolean> {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

export async function parseArgs(...args: string[]): Promise<Options> {
  const skipDts = await extractNamedFlag(args, '--skip-dts');
  const watch = await extractNamedFlag(args, '--watch');

  const [distDir = '.dist', bundleName = 'rdt.js'] = args;
  return {
    distDir,
    bundleName,
    skipDts,
    watch,
  };
}

export async function main(options: Options) {
  const { distDir } = options;
  // TODO: check before removing??
  await rm(distDir, { recursive: true }).catch(() => {});
  await mkdir(distDir, { recursive: true });

  await Promise.all([
    // Filter package.json
    packageJson(options),

    readme(options),

    // TODO: License
    // TODO: Changelog
    // TODO: package-lock.json

    build(options),
  ]);
}

async function readme({ distDir, watch }: Options) {
  await copyFile('README.md', join(distDir, 'README.md'));

  if (watch) logger.warn('Watching README.md for changes is not (yet) implemented');
}

// Not really tested
const outputESM = false;

async function build({ distDir: outDir, bundleName, skipDts, watch }: Options) {
  const plugins: esbuild.Plugin[] = [];
  const watchPlugin: esbuild.Plugin = {
    name: 'end Event Plugin',
    setup(build) {
      build.onEnd(() => {
        logger.info('Build finished');
      });
    },
  };

  if (watch) plugins.push(watchPlugin);
  if (!skipDts) plugins.push(dtsPlugin({ outDir }));

  const buildOpts: esbuild.BuildOptions = {
    platform: 'node',
    target: 'node14',
    format: outputESM ? 'esm' : 'cjs',
    sourcemap: true,
    plugins,
    outdir: outDir,
    bundle: true,
    entryPoints: [join('src', 'rdt.ts')],
    external: [
      // TODO: Load this list from package.json#dependencies
      'esbuild',
      'esbuild-register',
      'glob',
      'ssh2-promise',
      'winston',
    ],
  };

  const buildAllOpts: esbuild.BuildOptions = {
    platform: 'node',
    target: 'node14',
    format: outputESM ? 'esm' : 'cjs',
    sourcemap: true,
    plugins,
    outdir: outDir,
    entryPoints: await readdir('src').then(files => files.filter(f => f.endsWith('.ts')).map(f => join('src', f))),
  };

  if (!watch) return await esbuild.build(buildOpts);

  const ctx = await esbuild.context(buildOpts);
  await ctx.watch({});
  logger.info('Watching for changes... (Press Ctrl-C to exit)');

  // CTRL-C
  await new Promise<void>(resolve => process.once('SIGINT', resolve));
  // Unfortunately no good solution for Windows with: "Terminate batch job (Y/N)?"

  logger.info('Stopping watch...');

  await ctx.dispose().catch(() => {
    logger.warn('Failed to dispose esbuild context');
  });
}

async function packageJson({ distDir, bundleName, watch }: Options) {
  // Load local `package.json` with `import()`
  // import path is relative to current source file. Other paths are relative to `cwd` (normally project root)
  const packageJson = await import('../package.json');

  // Filter scripts and other unwanted parts
  const distPackageJson = {
    ...packageJson.default,
    bin: {
      rdt: bundleName,
    },
    main: bundleName,
    types: 'rdt.d.ts',
    private: undefined,
    type: outputESM ? 'module' : undefined,
    files: undefined,
    scripts: { start: 'node .' },
    devDependencies: undefined,
    // peerDependencies: undefined,
  };

  // Write to `dist/package.json`
  await writeFile(join(distDir, 'package.json'), JSON.stringify(distPackageJson, null, 2));

  if (watch) logger.warn('Watching package.json for changes is not (yet) implemented');
}

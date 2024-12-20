// Fix bugs about deprecated punycode module
// import overrideRequire from 'override-require';
// overrideRequire((request, parent) => {
//   if (request === 'punycode') {
//     console.log('punycode is deprecated. Replacing with punycode/');
//     request += '/';
//   }
//   return require(request); // Default behavior
// });

import { writeFile, mkdir, copyFile, rm, readdir } from 'fs/promises';
import esbuild from 'esbuild';
import esMain from 'es-main';
import { join } from 'path';
import { dtsPlugin } from 'esbuild-plugin-d.ts';
import { buildLogger as logger } from '../src/log.js';
import { htmlPlugin } from '@craftamap/esbuild-plugin-html';
import { commonjs } from '@hyrious/esbuild-plugin-commonjs';

function forceExit() {
  // TODO: why does setting this to 1 make it trigger?
  const timeout = 100;
  setTimeout(() => {
    logger.warn('Something is still running. Forcing exit.');

    process.exitCode ??= 0;

    if (typeof process.exitCode == 'number') process.exitCode |= 0b1000_0000;

    process.exit();
  }, timeout).unref();
}

function handleError(e: any) {
  logger.debug('Handling error...');
  logger.error(e);
  process.exitCode = 1;
}

if (esMain(import.meta)) {
  logger.debug('Running main build');
  parseArgs(...process.argv.slice(2))
    .then(main)
    .then(() => logger.debug('Build exited normally'))
    .catch(handleError)
    .then(forceExit);

  process.on('unhandledRejection', e => {
    logger.error('Unhandled rejection:');
    logger.error(e);
    process.exitCode = 2;
    forceExit();
  });
  process.on('uncaughtException', e => {
    logger.error('Uncaught exception:');
    logger.error(e);
    process.exitCode = 3;
    forceExit();
  });
}

export type Options = {
  distDir: string;
  bundleName: string;
  skipDts?: boolean;
  watch?: boolean;
};

type Awaitable<T> = T | Promise<T>;
type Pkg = {
  pkg: Awaitable<Record<string, any>>;
};
type MainOptions = Options & Partial<Pkg>;
type FullOptions = Options & Pkg;

function isFullOptions(options: MainOptions): options is FullOptions {
  return 'pkg' in options;
}

async function extractNamedFlag(args: string[], name: string): Promise<boolean> {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

export async function parseArgs(...args: string[]): Promise<MainOptions> {
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

export async function main(options: MainOptions) {
  const { distDir } = options;

  // Load local `package.json` with `import()`
  // import path is relative to current source file. Other paths are relative to `cwd` (normally project root)
  options.pkg ??= import('../package.json').then(p => p.default);

  // Should never happen. Make TypeScript happy.
  if (!isFullOptions(options)) throw new Error('Invalid options');

  logger.debug(`Building to ${distDir}`);

  // TODO: check before removing??
  await rm(distDir, { recursive: true }).catch(() => {});
  await mkdir(distDir, { recursive: true });

  await Promise.all([
    // Filter package.json
    packageJson(options),

    readme(options),

    // TODO: License
    // TODO: Changelog

    buildNode(options),
    buildBrowser(options),
  ]);
}

async function readme({ distDir, watch }: FullOptions) {
  await copyFile('README.md', join(distDir, 'README.md'));

  logger.silly('Copied README.md');

  if (watch) logger.warn('Watching README.md for changes is not (yet) implemented');
}

// Not really tested
const outputESM = true;

async function buildNode({ distDir: outDir, skipDts, watch, pkg }: FullOptions) {
  const plugins: esbuild.Plugin[] = [commonjs()];
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

  const external = Object.keys((await pkg).dependencies).filter(d => !(d.startsWith('@types/') || d === 'node'));

  logger.debug(`External dependencies: ${external.join(', ')}`);

  const buildOpts: esbuild.BuildOptions = {
    platform: 'node',
    target: 'node20',
    format: outputESM ? 'esm' : 'cjs',
    sourcemap: true,
    sourcesContent: false,
    plugins,
    outdir: outDir,
    bundle: true,
    entryPoints: [join('src', 'rdt.ts')],
    external,
  };

  const buildAllOpts: esbuild.BuildOptions = {
    ...buildOpts,
    bundle: undefined,
    external: undefined,
    entryPoints: await readdir('src').then(files => files.filter(f => f.endsWith('.ts')).map(f => join('src', f))),
  };

  if (!watch) {
    const b = esbuild.build(buildOpts);
    b.then(() => logger.silly('Build finished'));
    return b;
  }

  const ctx = await esbuild.context(buildOpts);
  await ctx.watch();
  logger.info('Watching for changes... (Press Ctrl-C to exit)');

  // CTRL-C
  await new Promise<void>(resolve => {
    process.once('SIGINT', resolve);
    process.stdin.once('end', resolve);
  });
  // Unfortunately no good solution for Windows with: "Terminate batch job (Y/N)?"

  logger.info('Stopping watch...');

  await ctx.dispose().catch(() => {
    logger.warn('Failed to dispose esbuild context');
  });
}

async function buildBrowser({ distDir: outdir, watch }: FullOptions) {
  const uiSrcDir = join('src', 'UI');

  const inline = false;

  const entryPoint = join(uiSrcDir, 'index.tsx');
  const favicon = join(uiSrcDir, 'favicon.ico');

  outdir = join(outdir, 'UI');

  const entryPoints = [entryPoint];

  logger.debug(`Building browser for ${entryPoints[0]}`);

  const plugins: esbuild.Plugin[] = [
    htmlPlugin({
      files: [
        {
          filename: 'index.html',

          title: 'RDT Status',
          // favicon,
          scriptLoading: 'module',
          inline,

          // https://github.com/craftamap/esbuild-plugin-html/issues/63
          entryPoints: process.platform == 'win32' ? entryPoints.map(e => e.replaceAll('\\', '/')) : entryPoints,
        },
      ],
    }),

    {
      // https://github.com/craftamap/esbuild-plugin-html/issues/64
      name: 'Cleanup Plugin',
      setup(build) {
        if (!inline) return;
        build.onEnd(async res => {
          logger.debug('Cleaning up...');
          // await Promise.all(
          //   Object.entries(res.metafile?.outputs ?? {}).map(([file, info]) =>
          //     unlink(file).catch(e => logger.warn(`Failed to clean up ${file}: ${e.message}`)),
          //   ),
          // );
          await rm(outdir, { recursive: true }).catch(e => logger.warn(`Failed to clean up: ${e.message}`));
        });
      },
    },
  ];

  const buildOpts: esbuild.BuildOptions = {
    sourcemap: 'inline',
    sourcesContent: false,
    bundle: true,
    entryPoints,

    // Hack missing env for Tamagui
    // define: {
    //   process: '{env:{}}',
    // },

    plugins,
    metafile: true,
    outdir,

    // outfile: join(outdir, 'statusUI.js'),
  };

  if (!watch) {
    const b = esbuild.build(buildOpts);
    b.then(() => logger.silly('Browser build finished'));
    return b;
  }

  const ctx = await esbuild.context(buildOpts);
  await ctx.watch();
  logger.info('Watching for browser changes... (Press Ctrl-C to exit)');

  // CTRL-C
  await new Promise<void>(resolve => {
    process.once('SIGINT', resolve);
    process.stdin.once('end', resolve);
  });
  // Unfortunately no good solution for Windows with: "Terminate batch job (Y/N)?"

  logger.info('Stopping watch...');

  await ctx.dispose().catch(() => {
    logger.warn('Failed to dispose esbuild context');
  });
}

async function packageJson({ distDir, bundleName, watch, pkg }: FullOptions) {
  // Filter scripts and other unwanted parts
  const distPackageJson = {
    ...(await pkg),
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

  logger.silly('Copied filtered package.json');

  if (watch) logger.warn('Watching package.json for changes is not (yet) implemented');
}

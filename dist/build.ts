import { writeFile, mkdir, copyFile, rm } from 'fs/promises';
import { build as esbuild } from 'esbuild';
import { join } from 'path';

function forceExit() {
  setTimeout(() => {
    console.log('Something is still running. Forcing exit.');
    process.exit(2);
  }, 1).unref();
}

function handleError(e: any) {
  console.error('Error:');
  console.error(e);
  process.exitCode = 1;
}

if (require.main === module) {
  parseArgs(...process.argv.slice(2))
    .then(main)
    .then(() => console.log('Build exited normally'))
    .then(forceExit)
    .catch(handleError);
}

process.on('unhandledRejection', e => {
  console.error('Unhandled rejection:');
  console.error(e);
  process.exitCode = 2;
  forceExit();
});
process.on('uncaughtException', e => {
  console.error('Uncaught exception:');
  console.error(e);
  process.exitCode = 2;
  forceExit();
});

export type Options = { distDir: string; bundleName: string };

export async function parseArgs(...args: string[]): Promise<Options> {
  const [distDir = '.dist', bundleName = 'bundle.js'] = args;
  return {
    distDir,
    bundleName,
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

async function readme({ distDir }: Options) {
  await copyFile('README.md', join(distDir, 'README.md'));
}

const outputESM = false;

async function build({ distDir, bundleName }: Options) {
  const res = await esbuild({
    bundle: true,
    platform: 'node',
    target: 'node14',
    format: outputESM ? 'esm' : 'cjs',
    sourcemap: true,
    outfile: join(distDir, bundleName),
    entryPoints: [join('src', 'cli.ts')],
  });
}

async function packageJson({ distDir, bundleName }: Options) {
  // Load local `package.json` with `import()`
  // import path is relative to current source file. Other paths are relative to `cwd` (normally project root)
  const packageJson = await import('../package.json');

  // Filter scripts and other unwanted parts
  const distPackageJson = {
    ...packageJson.default,
    main: bundleName,
    bin: bundleName,
    private: undefined,
    type: outputESM ? 'module' : undefined,
    scripts: {
      start: 'node .',
    },
    devDependencies: undefined,
    // peerDependencies: undefined,
  };

  // Write to `dist/package.json`
  await writeFile(join(distDir, 'package.json'), JSON.stringify(distPackageJson, null, 2));
}

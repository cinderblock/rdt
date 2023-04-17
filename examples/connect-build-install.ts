import { logger, BuildAndDeploy, Target, Targets } from '@cinderblock/rdt';
import { transform, TransformOptions } from 'esbuild';
import { readFile } from 'fs/promises';

function posixPath(path: string) {
  return path.replace(/\\/g, '/');
}

const handler: BuildAndDeploy = {
  async onConnected({ rdt }) {
    const { targetName, targetConfig, connection } = rdt;
    logger.info(`connected to: ${targetName} [${targetConfig.remote?.host}]`);

    // Setup dependencies on remote that are required to run the app
    await rdt.apt.update();
    await rdt.apt.install(['nodejs']);

    logger.info(`Done with onConnected`);
  },

  async onFileChanged({ rdt, localPath, info }) {
    logger.debug(`file changed: ${localPath}`);

    const localPathSanitized = posixPath(localPath);

    if (localPathSanitized.match(/\.tsx?$/)) {
      const remotePath = 'rdt/' + localPathSanitized.replace(/\.tsx?$/, '.js');

      const opts: TransformOptions = {
        loader: 'ts',
        target: 'es2019',
        sourcemap: true,
      };

      const { code } = await transform(await readFile(localPath), opts);

      await rdt.fs.ensureFileIs(remotePath, code);

      logger.info(`deployed: ${localPathSanitized} -> ${remotePath} bytes: ${code.length}`);

      return { changedFiles: [remotePath] };
    }

    // No changes
  },

  async onDeployed({ rdt, changedFiles }) {
    const { targetName, targetConfig, connection } = rdt;

    logger.info(`deployed to: ${targetName}`);

    if (changedFiles.length > 10) {
      logger.info(`  ${changedFiles.length} files changed`);
    } else {
      logger.info(`  ${changedFiles.join(', ')}`);
    }

    if (changedFiles.includes('package.json')) await connection.exec('npm install');

    // TODO: Restart app
  },
};

export const defaultTarget = 'raspberrypi';

const raspberrypi: Target = {
  handler,
  devServer: 'src/ui/index.ts',
  remote: {
    host: 'raspberrypi.tsl',
    username: 'pi',
  },
  watch: {
    options: {
      ignore: ['CSpell/**', 'cspell.yaml'],
    },
  },
};

export const targets: Targets = {
  raspberrypi,
};

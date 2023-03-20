# `rdt` - Remote Development Tool

[![npm version](https://badge.fury.io/js/rdt.svg)](https://badge.fury.io/js/rdt)

A Node.js development tool for lightweight remote systems.
Use your high performance development machine to build and serve your project to a low performance remote device.

`rdt` is a daemon that runs on your development machine.
`rdt` watches your project directory for changes and gives APIs to build and deploy your project to a remote device.
`rdt` can run a local web server for a fast local UI experience with easy connection to the real backend through integrated port forwarding.

Remote Development Tool is still in early development.
The API and configuration format might change.

## Installation

```bash
npm install -D rdt                # Npm package
npm install -D cinderblock/rdt    # Github repository
```

## Usage

Create a file `rdt.ts` in the root of your project that exports a `targets` object and an optional default target name.

### Example `rdt.ts`

```ts
import { Targets, BuildAndDeploy, logger } from 'rdt';

const handler: BuildAndDeploy = {
  async afterConnected({ connection, targetName, targetConfig }) {
    logger.info('connected:', targetName);
    logger.info(targetConfig);
  },

  async afterDisconnected({ targetName, targetConfig }) {
    logger.info('disconnected:', targetName);
  },

  async onFileChange({ connection, targetName, targetConfig, localPath }) {
    return true;
  },

  async afterDeployed({ connection, targetName, targetConfig, changedFiles }) {
    logger.info('deployed:', targetName);
  },
};

export default 'hdpi';

export const targets: Targets = {
  hdpi: {
    handler,
    devServer: 'src/ui/index.ts',
  },
};
```

### `rdt dev [target]` - Start the development server

```
npx rdt dev         # Run first target in rdt.yaml
npx rdt dev myPi    # Run target: myPi
npx rdt dev otherPi # Run target: otherPi
```

Use `npx` or directly in `package.json` scripts without `npx`:

```json
{
  "name": "my-project",
  "scripts": {
    "dev": "rdt dev"
  },
  "devDependencies": {
    "rdt": "^0.0.1"
  }
}
```

```
npm run dev
npm run dev -- myPi
npm run dev -- otherPi
```

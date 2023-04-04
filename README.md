# `rdt` - Remote Development Tool

[![npm version](https://badge.fury.io/js/@cinderblock%2Frdt.svg)](https://badge.fury.io/js/@cinderblock%2Frdt)
[![Build](https://github.com/cinderblock/rdt/actions/workflows/build.yaml/badge.svg?branch=master)](https://github.com/cinderblock/rdt/actions/workflows/build.yaml)
[![Build & Publish](https://github.com/cinderblock/rdt/actions/workflows/build.yaml/badge.svg?event=push)](https://github.com/cinderblock/rdt/actions/workflows/build.yaml)

A Node.js development tool for lightweight remote systems.
Use your high performance development machine to build and serve your project to a low performance remote device.

`rdt` is a daemon that runs on your development machine.
`rdt` watches your project directory for changes and gives APIs to build and deploy your project to a remote device.
`rdt` can run a local web server for a fast local UI experience with easy connection to the real backend through integrated port forwarding.

Remote Development Tool is still in early development.
The API and configuration format might change.

## Installation

```bash
npm install -D @cinderblock/rdt  # Npm package
npm install -D cinderblock/rdt   # Github repository
```

## Usage

Create a file `rdt.ts` in the root of your project that exports a `targets` object and an optional default target name.

### Example `rdt.ts`

```ts
import { Targets, logger } from 'rdt';

export const defaultTarget = 'myPi';

export const targets: Targets = {
  myPi: {
    handler: {
      async onConnected({ connection, targetName, targetConfig }) {
        logger.info('connected:', targetName);
        logger.info(targetConfig);
      },

      async onDisconnected({ targetName, targetConfig }) {
        logger.info('disconnected:', targetName);
      },

      async onFileChanged({ connection, targetName, targetConfig, localPath }) {
        return true;
      },

      async onDeployed({ connection, targetName, targetConfig, changedFiles }) {
        logger.info('deployed:', targetName);
      },
    },
    devServer: 'src/ui/index.ts',
  },
};
```

### `rdt dev [target]` - Start the development server

```
npx rdt dev         # Run default target
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
    "rdt": "^0.1.1"
  }
}
```

```
npm run dev
npm run dev -- myPi
npm run dev -- otherPi
```

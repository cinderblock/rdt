# `thind` - Thin client development daemon

A Node.js development environment for lightweight remote systems.
Use your high performance development machine to build and serve your project to a low performance remote device.

`thind` is a daemon that runs on your development machine.
`thind` watches your project directory for changes and, on change, builds your project and sends the build output to your remote host for execution.
`thind` also runs a web server on your development machine for a fast local UI experience with easy connection to the real backend through integrated port forwarding.

Thind is still in early development.
The API and configuration format might change.

## Installation

```bash
npm install -D thind                # Npm package
npm install -D cinderblock/thind    # Github repository
```

## Usage

Create a file `thind.yaml` in the root of your project.

### Example `thind.yaml`

```yaml
targets:
  myPi:
    # !!! NOT UP TO DATE !!!
    browser:
      path: .thind/myPi/www
      sources: src/www
      serveLocal: true
    daemon:
      path: .thind/myPi
      sources: src
      systemd:
        serviceName: thind-myPi
        description: My Raspberry Pi Appliance
        user: pi
        group: pi
        enable: true
        env:
          NODE_ENV: production
          PORT: 3000
        userService: false
      build:
        minify: false
        sourceMaps: true
        bundle: false
        bundleExclude: []
    connection:
      host: thing-1.local # Can include port directly with `:` separator. Takes precedence over `port` property.
      port: 22
      user: pi
      password: raspberry
    ports:
      3000: true # Forward port 3000 on the local machine to port 3000 on the remote machine.
      8080: 80 # Forward port 8080 on the local machine to port 80 on the remote machine.
  otherPi:
    ports:
      - 9001
```

### `thind dev [target]` - Start the development server

```
npx thind dev         # Run first target in thind.yaml
npx thind dev myPi    # Run target: myPi
npx thind dev otherPi # Run target: otherPi
```

Use `npx` or directly in `package.json` scripts without `npx`:

```json
{
  // ...
  "scripts": {
    "dev": "thind dev"
  }
  // ...
}
```

```
npm run dev
npm run dev -- myPi
npm run dev -- otherPi
```

# `thind` - Thin client development daemon

A Node.js development environment for lightweight remote systems.
Use your high performance development machine to build and serve your project to a low performance remote device.

`thind` is a daemon that runs on your development machine.
`thind` watches your project directory for changes and, on change, builds your project and sends the build output to your remote host for execution.
`thind` also runs a web server on your development machine for a fast local UI experience with easy connection to the real backend through integrated port forwarding.

## Installation

`npm install -D thind`

## Usage

Create a file `thind.yaml` in the root of your project.
Each target object should have the following properties:

- `name` - The pretty name of the target. _(Optional)_
- `connection` - An object describing how to connect to the target device. _(Required)_
  - `host` - The hostname or IP address of the target device. _(Default: the `name` of the target)_
  - `port` - The port to use when connecting to the target device. _(Default: `22`)_
  - `user` - The username to use when connecting to the target device. _(Default: `pi`)_
  - `password` - The password to use when connecting to the target device or `sudo` during setup. _(Default: None)_
  - `key` - The path to the private key to use when connecting to the target device. _(Default: `~/.ssh/id_rsa`)_
- `ports` - An array or Map of ports to forward from the your local development machine to the remote. _(Default: None)_
  - If an array is provided, the ports will be forwarded from the same port on the local machine to the remote machine.
  - If a Map is provided, the keys will be the ports on the local machine, and the values will be the ports on the remote machine or `true` to forward to the same port on the remote machine.
- `path` - The path on the target device to deploy the build output to. _(Default: `/home/pi/`)_
- `runtime` - An object of key-value pairs describing the runtime environment of the target device. _(Default: None)_
  - `user` - The username of the user that the server will run as. _(Default: Connection user)_
  - `group` - The group of the user that the server will run as. _(Default: Connection group)_

### Example `thind.yaml`

```yaml
targets:
  myPi:
    name: My Raspberry Pi Appliance
    connection:
      host: thing-1.local # Can include port directly with `:` separator. Takes precedence over `port` property.
      port: 22
      user: pi
      password: raspberry
    ports:
      3000: true # Forward port 3000 on the local machine to port 3000 on the remote machine.
      8080: 80 # Forward port 8080 on the local machine to port 80 on the remote machine.
    path: /opt/myDaemon
    runtime:
      user: daemon
      group: pi
  otherPi:
    connection:
      password: foobar
    ports:
      9001: true # Forward port 3000 on the local machine to port 3000 on the remote machine.
```

### `thind dev [target]` - Start the development server

```
thind dev         # Run first target in `thind.yaml`
thind dev myPi    # Run target named `myPi`
thind dev otherPi # Run target named `otherPi`
```

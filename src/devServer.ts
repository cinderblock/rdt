import { Target } from './config.js';
import esbuild from 'esbuild';
import logger from './log.js';
import { createServer } from 'http';
import httpProxy from 'http-proxy';
import { Remote } from './remote.js';

const { createProxyServer } = httpProxy;

export async function doDevServer(ds: Target['devServer'], rdt: Remote) {
  if (!ds) return;

  if (typeof ds === 'string') {
    ds = { entry: ds };
  }

  if (ds.serveLocal === false) return;

  if (ds.serveLocal === true || ds.serveLocal === undefined) {
    ds.serveLocal = 'src/ui/public';
  }

  const { entry, serveLocal } = ds;

  const entryPoints = Array.isArray(entry) ? entry : [entry];

  logger.info(`Serving ${entryPoints.join(', ')}`);

  const ctx = await esbuild.context({
    entryPoints,
    bundle: true,
    outfile: `${ds.serveLocal}/app.js`,
    // outdir: ds.serveLocal,
    sourcemap: 'inline',
    sourcesContent: false,
    loader: {
      '.png': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
      '.eot': 'dataurl',
      '.ttf': 'dataurl',
      '.svg': 'dataurl',
    },
  });

  try {
    await ctx.watch();

    // Start esbuild server on a random port
    const { host, port: devServerPort } = await ctx.serve({
      servedir: ds.serveLocal,
    });

    // esbuild defaults to only listen on IPv4 so we can't use "localhost" here
    const devServerHost = host === '0.0.0.0' ? '127.0.0.1' : host;

    logger.info(`Serving esbuild devServer on http://${devServerHost}:${devServerPort}`);

    // Pick some open port to listen on
    const proxyServerPort = 9001;

    // TODO: skip the port forward and just use the tunnel server directly
    const tunnelServerPort = 9080;

    // TODO: Configurable
    const remoteTargetPort = 80;

    rdt.forward
      .toRemoteTarget(remoteTargetPort, 'localhost', tunnelServerPort)
      .catch(e =>
        logger.error(`Failed to forward port ${tunnelServerPort} to remote's port ${remoteTargetPort}: ${e.message}`),
      )
      .then(() => logger.info(`Done forwarding port ${tunnelServerPort} to remote's port ${remoteTargetPort}`));

    // ssh2 tunnels listen on IPv6 by default
    // TODO: make this configurable
    const tunnelServerHost = '::1';

    const proxy = createProxyServer({});

    const proxyServer = createServer({}, (req, res) => {
      if (req.url === '/ws') {
        // Forward websocket connections to remote proxy port
        proxy.web(req, res, {
          target: {
            host: tunnelServerHost,
            port: tunnelServerPort,
          },
        });
      }

      proxy.web(req, res, {
        target: {
          host: devServerHost,
          port: devServerPort,
        },
      });
    });

    proxyServer.on('upgrade', (req, socket, head) => {
      proxy.ws(req, socket, head, {
        target: {
          host: tunnelServerHost,
          port: tunnelServerPort,
        },
      });
    });

    proxyServer.listen(proxyServerPort);

    logger.info(`Serving UI proxy on http://localhost:${proxyServerPort}. Connect to this port to access the UI.`);
  } catch (err) {
    logger.error("Error in devServer's esbuild context");
    logger.error(err);
  }
}

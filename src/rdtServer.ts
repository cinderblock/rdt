import winston from 'winston';
import logger, { addLogTransport, disableTerminalLogger, enableTerminalLogger, removeLogTransport } from './log.js';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import finalhandler from 'finalhandler';
import serveStatic from 'serve-static';
import { join } from 'path';
import { promisify } from 'util';

// cSpell:ignore finalhandler

// Serve up public/ftp folder
var serve = serveStatic(join(import.meta.dirname, 'UI'));

const defaultPort = 9009;

export type RDTServerOptions = {
  port: number;
  host?: string;
};

type Options = Partial<RDTServerOptions> | string | number | undefined;

function parseOpts(opts: Options): RDTServerOptions {
  if (!opts) opts = {};

  if (typeof opts === 'number') {
    opts = { port: opts };
  }

  if (typeof opts !== 'string') {
    if (opts.port === undefined) {
      opts.port = defaultPort;
    }
    return opts as RDTServerOptions;
  }

  // TODO: unix sockets?

  const [host, port] = opts.split(':');

  if (port !== undefined) {
    return {
      host,
      port: parseInt(port),
    };
  }

  const i = parseInt(host);

  if (isNaN(i)) {
    return {
      host,
      port: defaultPort,
    };
  } else {
    return {
      port: i,
    };
  }
}

type EncodedType = string;

export async function doRDTServer(opts?: Options) {
  const parsed = parseOpts(opts);

  logger.info(`Serving RDT Server. Disabling terminal logger.`);
  disableTerminalLogger();

  const clients: WebSocket[] = [];
  let history = [] as EncodedType[];

  function sendLogDataToClient(client: WebSocket, data: EncodedType) {
    function handleError(error: any) {
      // Don't log to logger. Prevents infinite loop if client is disconnected.
      console.error(`Failed to send log to client (${client.url}): ${error}`);

      // TODO: Log to logger and catch infinite loop
    }

    return promisify(client.send).bind(client)(data).catch(handleError);
  }

  async function sendLogHistoryToClient(client: WebSocket) {
    for (const log of history) {
      await sendLogDataToClient(client, log);
    }
  }

  addLogTransport(
    // Hijack the terminal logger to send logs to clients
    // TODO: There is probably a better way to do this...
    new winston.transports.Console({
      log(data: { [x: string]: any }, callback: () => void) {
        data.time = Date.now();
        const json = JSON.stringify({ type: 'log', data });

        history.push(json);

        if (history.length > 100) {
          history.shift();
        }

        for (const client of clients) sendLogDataToClient(client, json);

        // Don't wait for sending to clients to finish
        callback();
      },
    }),
  );

  const server = createServer((req, res) => {
    serve(req, res, finalhandler(req, res));
  });

  // create websocket server for clients to connect to and receive updates
  const wss = new WebSocketServer({ server });

  wss.on('connection', ws => {
    clients.push(ws);

    ws.on('close', () => {
      const i = clients.indexOf(ws);
      if (i !== -1) {
        clients.splice(i, 1);
      }
    });

    ws.on('error', error => {
      logger.error(`Websocket Connection Error: ${error}`);
    });

    ws.on('message', data => {
      logger.log('received: %s', data);
    });

    sendLogHistoryToClient(ws).then(() => {
      logger.info(`Sent log history to client (${ws.url})`);
    });
  });

  wss.on('error', error => {
    logger.error(`Websocket Server Error: ${error}`);
  });

  server.on('error', error => {
    logger.error(`RDT Server Error: ${error}`);
  });

  server.on('listening', () => {
    enableTerminalLogger();
    logger.info(`RDT Server Listening on http://${parsed.host ?? 'localhost'}:${parsed.port}`);
    disableTerminalLogger();
  });

  // TODO: handle port in use (and increment?)
  server.listen(parsed.port, parsed.host);
}

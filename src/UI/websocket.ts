import { createContext } from 'react';
import { handleLogUpdate, isLogUpdate } from './log';

// function isUpdate(message: any): message is { update: StatusUpdate } {
//   if (!isObject(message)) return false;
//   if (!('update' in message)) return false;

//   // TODO: actually validate the data
//   return true;
// }

/**
 * EventTarget for client events
 *
 * Set the mode of the oven
 *  setMode: BAKE | IDLE
 *
 * Start reflow profile
 *  startProfile: 0 | 1 | 2 | 3 | 4 | 5 | 6
 */
export const clientEvents = new EventTarget();

export async function setupWebSocket() {
  while (true) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${location.host}/ws`);

      ws.onopen = () => console.log('Connected to /ws WebSocket endpoint');

      ws.onmessage = (message: MessageEvent<string>) => {
        // console.log('Received message from /ws WebSocket endpoint', message);

        const { data: json } = message;

        const payload = JSON.parse(json);

        if (isLogUpdate(payload)) {
          handleLogUpdate(payload);
          return;
        }

        // if (isUpdate(payload)) {
        //   // handleUpdate(payload);
        //   return;
        // }

        console.error('Unknown message type', payload);
      };

      ws.onerror = reject;
      ws.onclose = resolve;

      function sendMessage<T extends Object>(message: T) {
        (message as any).timestamp = Date.now();
        ws.send(JSON.stringify(message));
      }

      clientEvents.addEventListener('hello', name => sendMessage({ hello: name }));
      clientEvents.addEventListener('setMode', mode => sendMessage({ setMode: mode }));
      clientEvents.addEventListener('startProfile', profile => sendMessage({ startProfile: profile }));
    }).catch(e => {
      console.error('WebSocket error', e);
    });
    // TODO: cleanup clientEvents listeners?

    // TODO: exponential backoff
  }
}

import { createRoot } from 'react-dom/client';

import App from './App.js';
import { setupWebSocket } from './websocket.js';

// import '@fontsource/roboto/300.css';
// import '@fontsource/roboto/400.css';
// import '@fontsource/roboto/500.css';
// import '@fontsource/roboto/700.css';

// esbuild HMR
new EventSource('/esbuild').addEventListener('change', () => location.reload());

setupWebSocket().catch((e: any) => {
  console.error('Failed to connect to WebSocket, reload page...');
  console.error(e);
});

const root = createRoot(document.body.appendChild(document.createElement('div')));
root.render(<App />);

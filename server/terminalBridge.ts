import { WebSocket, WebSocketServer } from 'ws';

const CLI_PORT = process.env.CLI_SERVICE_PORT || '5557';

// Bridges browser terminal sessions (xterm.js) to the internal CLI service.
// The browser connects to ws://host/terminal; each connection is piped 1:1 to
// the cliService (127.0.0.1:5557/stream), which speaks the same protocol
// (startSession / input / resize / closeSession -> cliStream chunks).
export function createTerminalWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (clientWs: WebSocket) => {
    const cliWs = new WebSocket(`ws://127.0.0.1:${CLI_PORT}/stream`);
    let cliReady = false;

    cliWs.on('open', () => {
      cliReady = true;
      clientWs.send(JSON.stringify({ type: 'status', service: 'terminal', status: 'connected' }));
    });

    cliWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
    });

    cliWs.on('close', () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    cliWs.on('error', () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    clientWs.on('message', (data) => {
      if (cliReady && cliWs.readyState === WebSocket.OPEN) cliWs.send(data.toString());
    });

    clientWs.on('close', () => {
      if (cliWs.readyState === WebSocket.OPEN) cliWs.close();
    });
  });

  return wss;
}

import { WebSocket, WebSocketServer } from 'ws';
import { mkdirSync } from 'fs';

const CLI_PORT = process.env.CLI_SERVICE_PORT || '5557';
const TERMINAL_ROOT = process.env.TERMINAL_ROOT || '/beatrice-workstation';

// Ensure the terminal root exists so pty.spawn never fails on a missing cwd.
mkdirSync(TERMINAL_ROOT, { recursive: true });

// Bridges browser terminal sessions (xterm.js) to the internal CLI service.
// The browser connects to ws://host/terminal; each connection is piped 1:1 to
// the cliService (127.0.0.1:5557/stream), which speaks the same protocol
// (startSession / input / resize / closeSession -> cliStream chunks).
// startSession messages without an explicit cwd are pinned to TERMINAL_ROOT.
export function createTerminalWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (clientWs: WebSocket) => {
    const cliWs = new WebSocket(`ws://127.0.0.1:${CLI_PORT}/stream`);
    let cliReady = false;
    const pending: string[] = [];

    cliWs.on('open', () => {
      cliReady = true;
      clientWs.send(JSON.stringify({ type: 'status', service: 'terminal', status: 'connected' }));
      for (const msg of pending) cliWs.send(msg);
      pending.length = 0;
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
      let out = data.toString();
      try {
        const msg = JSON.parse(out);
        if (msg.type === 'startSession' && !msg.cwd) {
          msg.cwd = TERMINAL_ROOT;
          out = JSON.stringify(msg);
        }
      } catch {
        // not JSON — pass through unchanged
      }
      if (!cliReady || cliWs.readyState !== WebSocket.OPEN) {
        pending.push(out);
        return;
      }
      cliWs.send(out);
    });

    clientWs.on('close', () => {
      if (cliWs.readyState === WebSocket.OPEN) cliWs.close();
    });
  });

  return wss;
}

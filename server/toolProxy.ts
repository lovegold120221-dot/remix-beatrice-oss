import { WebSocket } from 'ws';

const SANDBOX_PORT = process.env.SANDBOX_SERVICE_PORT || '5556';
const CLI_PORT = process.env.CLI_SERVICE_PORT || '5557';
const BROWSER_PORT = process.env.BROWSER_SERVICE_PORT || '5558';
const COMPUTER_PORT = process.env.COMPUTER_SERVICE_PORT || '5559';
const CODING_AGENT_PORT = process.env.CODING_AGENT_PORT || '5560';

const serviceSockets = new Map<string, WebSocket>();

function ensureServiceConnection(
  service: 'sandbox' | 'cli' | 'browser' | 'computer' | 'codingAgent',
  broadcast: (msg: unknown) => void
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const existing = serviceSockets.get(service);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return resolve(existing);
    }

    const port =
      service === 'sandbox'
        ? SANDBOX_PORT
        : service === 'cli'
        ? CLI_PORT
        : service === 'browser'
        ? BROWSER_PORT
        : service === 'codingAgent'
        ? CODING_AGENT_PORT
        : COMPUTER_PORT;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stream`);
    serviceSockets.set(service, ws);

    ws.on('open', () => {
      console.log(`[ToolProxy] connected to ${service} service on ${port}`);
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        broadcast(msg);
      } catch (err) {
        console.error(`[ToolProxy] ${service} message parse error:`, err);
      }
    });

    ws.on('error', (err) => {
      console.error(`[ToolProxy] ${service} service error:`, err);
      reject(err);
    });

    ws.on('close', () => {
      if (serviceSockets.get(service) === ws) {
        serviceSockets.delete(service);
      }
    });
  });
}

export async function sendToService(
  service: 'sandbox' | 'cli' | 'browser' | 'computer' | 'codingAgent',
  msg: unknown,
  broadcast: (msg: unknown) => void
): Promise<WebSocket> {
  const ws = await ensureServiceConnection(service, broadcast);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    throw new Error(`${service} service socket not open`);
  }
  return ws;
}

export function closeAllServiceConnections() {
  for (const [service, ws] of serviceSockets) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  serviceSockets.clear();
}

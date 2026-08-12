import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const PORT = parseInt(process.env.COMPUTER_SERVICE_PORT || '5559', 10);

interface ComputerSession {
  id: string;
  log: string[];
  cwd?: string;
}

const sessions = new Map<string, ComputerSession>();
const clients = new Set<WebSocket>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendEvent(sessionId: string, event: string, data: Record<string, unknown>, done = false) {
  broadcast({
    type: 'computerUpdate',
    sessionId,
    event,
    done,
    timestamp: Date.now(),
    ...data,
  });
}

function getSession(id: string): ComputerSession {
  let session = sessions.get(id);
  if (!session) {
    session = { id, log: [], cwd: process.cwd() };
    sessions.set(id, session);
  }
  return session;
}

async function runShell(command: string, session: ComputerSession) {
  sendEvent(session.id, 'shellStart', { command });
  try {
    const { stdout, stderr } = await execPromise(command, { timeout: 15000, cwd: session.cwd });
    const out = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
    session.log.push(`$ ${command}\n${out}`);
    sendEvent(session.id, 'shellOutput', { command, output: out }, true);
  } catch (err: any) {
    const out = (err.stdout || '') + '\n' + (err.stderr || err.message || 'Execution error');
    session.log.push(`$ ${command}\n${out}`);
    sendEvent(session.id, 'shellError', { command, output: out, error: err.message }, true);
  }
}

async function listApplications(): Promise<string[]> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execPromise("ps -eo comm= | sort -u | head -50");
      return stdout.split('\n').filter(Boolean);
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execPromise("ps -ceo comm= | sort -u | head -50");
      return stdout.split('\n').filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

async function xdotool(command: string) {
  try {
    const { stdout } = await execPromise(`xdotool ${command}`, { timeout: 5000 });
    return stdout;
  } catch (err: any) {
    throw new Error(err.stderr || err.message || 'xdotool failed');
  }
}

export function startComputerService() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', service: 'computer', status: 'connected' }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const sessionId = msg.sessionId || `comp_${Date.now()}`;
        const session = getSession(sessionId);

        if (msg.type === 'startSession') {
          if (msg.cwd) session.cwd = msg.cwd;
          sendEvent(sessionId, 'sessionStarted', { cwd: session.cwd });
        } else if (msg.type === 'shell') {
          await runShell(msg.command, session);
        } else if (msg.type === 'listApps') {
          const apps = await listApplications();
          session.log.push(`Listed ${apps.length} running applications.`);
          sendEvent(sessionId, 'appList', { apps });
        } else if (msg.type === 'mouseMove') {
          await xdotool(`mousemove ${msg.x} ${msg.y}`);
          sendEvent(sessionId, 'mouseMove', { x: msg.x, y: msg.y });
        } else if (msg.type === 'mouseClick') {
          const button = msg.button || '1';
          await xdotool(`click ${button}`);
          sendEvent(sessionId, 'mouseClick', { button });
        } else if (msg.type === 'key') {
          await xdotool(`key ${msg.key}`);
          sendEvent(sessionId, 'keyPress', { key: msg.key });
        } else if (msg.type === 'type') {
          const text = String(msg.text).replace(/'/g, "'\\''");
          await xdotool(`type --delay 1 '${text}'`);
          sendEvent(sessionId, 'typeText', { text: msg.text });
        } else if (msg.type === 'openApp') {
          const appName = msg.app;
          spawn(appName, { stdio: 'ignore', detached: true });
          sendEvent(sessionId, 'appOpened', { app: appName });
        } else if (msg.type === 'closeSession') {
          sessions.delete(sessionId);
          sendEvent(sessionId, 'sessionClosed', {}, true);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err: any) {
        console.error('[ComputerService] message error:', err);
        broadcast({ type: 'computerUpdate', sessionId: 'unknown', event: 'error', error: err.message, done: false, timestamp: Date.now() });
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  app.post('/run', async (req, res) => {
    const { sessionId, action } = req.body;
    const id = sessionId || `comp_${Date.now()}`;
    const ws = Array.from(clients)[0];
    if (ws) ws.send(JSON.stringify({ type: action.type, sessionId: id, ...action }));
    res.json({ sessionId: id, status: 'started' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[ComputerService] listening on 127.0.0.1:${PORT}`);
  });

  return server;
}

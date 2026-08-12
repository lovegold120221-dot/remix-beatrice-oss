import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { spawn } from 'child_process';

const PORT = parseInt(process.env.CLI_SERVICE_PORT || '5557', 10);

interface Session {
  id: string;
  shell: pty.IPty;
  output: string;
  cwd?: string;
}

const sessions = new Map<string, Session>();
const clients = new Set<WebSocket>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendChunk(sessionId: string, chunk: string, done: boolean, exitCode?: number, error?: string) {
  broadcast({
    type: 'cliStream',
    sessionId,
    chunk,
    done,
    exitCode,
    error,
    timestamp: Date.now(),
  });
}

function createSession(sessionId: string, cwd?: string): Session {
  const shellName = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const shell = pty.spawn(shellName, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: cwd || process.cwd(),
    env: process.env as { [key: string]: string },
  });

  const session: Session = { id: sessionId, shell, output: '', cwd: cwd || process.cwd() };

  shell.onData((data: string) => {
    session.output += data;
    sendChunk(sessionId, data, false);
  });

  shell.onExit(({ exitCode }) => {
    sendChunk(sessionId, `\n[Session exited with code ${exitCode}]\n`, true, exitCode);
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, session);
  return session;
}

export function startCliService() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', service: 'cli', status: 'connected' }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'startSession') {
          const sessionId = msg.sessionId || `cli_${Date.now()}`;
          createSession(sessionId, msg.cwd);
          sendChunk(sessionId, `[Beatrice CLI session ${sessionId} started]\n`, false);
        } else if (msg.type === 'runCommand') {
          const sessionId = msg.sessionId || `cli_${Date.now()}`;
          let session = sessions.get(sessionId);
          if (!session) {
            session = createSession(sessionId, msg.cwd);
          }
          session.shell.write(msg.command + '\r');
        } else if (msg.type === 'input') {
          const session = sessions.get(msg.sessionId);
          if (session) session.shell.write(msg.data);
        } else if (msg.type === 'resize') {
          const session = sessions.get(msg.sessionId);
          if (session && msg.cols && msg.rows) {
            session.shell.resize(msg.cols, msg.rows);
          }
        } else if (msg.type === 'closeSession') {
          const session = sessions.get(msg.sessionId);
          if (session) {
            session.shell.kill();
            sessions.delete(msg.sessionId);
          }
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('[CliService] message error:', err);
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  // REST fallback for one-shot commands with streaming over WS
  app.post('/run', (req, res) => {
    const { command, cwd, sessionId } = req.body;
    const id = sessionId || `cli_${Date.now()}`;
    const session = createSession(id, cwd);
    session.shell.write(command + '\r');
    res.json({ sessionId: id, status: 'started' });
  });

  app.post('/input', (req, res) => {
    const { sessionId, data } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });
    session.shell.write(data);
    res.json({ ok: true });
  });

  app.get('/sessions/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json({ id: session.id, cwd: session.cwd, outputLength: session.output.length });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CliService] listening on 127.0.0.1:${PORT}`);
  });

  return server;
}

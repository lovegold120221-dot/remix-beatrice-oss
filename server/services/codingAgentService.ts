import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = parseInt(process.env.CODING_AGENT_PORT || '5560', 10);
const OPENCODE_BIN = process.env.OPENCODE_BIN || '/root/.opencode/bin/opencode';
const WORKSPACE_DIR = process.env.CODING_AGENT_WORKSPACE || process.cwd();
const LOG_DIR = path.join(process.cwd(), 'data', 'coding-agent-logs');

interface AgentSession {
  id: string;
  task: string;
  cwd: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  log: string[];
  output: string;
  error?: string;
  process?: ChildProcess;
  startTime: number;
  endTime?: number;
}

const sessions = new Map<string, AgentSession>();
const clients = new Set<WebSocket>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendChunk(sessionId: string, chunk: string, done: boolean, error?: string) {
  broadcast({
    type: 'codingAgentStream',
    sessionId,
    chunk,
    done,
    error,
    timestamp: Date.now(),
  });
}

function appendLog(session: AgentSession, line: string) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${line}`;
  session.log.push(entry);
  session.output += line + '\n';
  sendChunk(session.id, line + '\n', false);
}

async function startCodingAgent(sessionId: string, task: string, cwd?: string) {
  const workDir = cwd ? path.resolve(cwd) : WORKSPACE_DIR;

  if (!fs.existsSync(OPENCODE_BIN)) {
    const session: AgentSession = {
      id: sessionId,
      task,
      cwd: workDir,
      status: 'failed',
      log: [],
      output: '',
      error: `OpenCode CLI not found at ${OPENCODE_BIN}. Install with: npm install -g @anthropic-ai/opencode`,
      startTime: Date.now(),
      endTime: Date.now(),
    };
    sessions.set(sessionId, session);
    sendChunk(sessionId, `❌ ${session.error}\n`, true, session.error);
    return;
  }

  const session: AgentSession = {
    id: sessionId,
    task,
    cwd: workDir,
    status: 'starting',
    log: [],
    output: '',
    startTime: Date.now(),
  };
  sessions.set(sessionId, session);

  appendLog(session, `▶ Coding Agent starting in ${workDir}`);
  appendLog(session, `▶ Task: ${task}`);

  try {
    const env = { ...process.env, HOME: process.env.HOME || '/root', PATH: process.env.PATH || '' };

    const proc = spawn(OPENCODE_BIN, [task], {
      cwd: workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    session.process = proc;
    session.status = 'running';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) appendLog(session, line);
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) appendLog(session, `[stderr] ${line}`);
      }
    });

    proc.on('close', (code) => {
      session.endTime = Date.now();
      if (code === 0) {
        session.status = 'completed';
        appendLog(session, `✓ Coding Agent completed successfully (exit ${code})`);
      } else {
        session.status = 'failed';
        session.error = `Process exited with code ${code}`;
        appendLog(session, `❌ Coding Agent failed (exit ${code})`);
      }
      session.process = undefined;
      sendChunk(sessionId, '', true, session.error);
      persistSession(session);
    });

    proc.on('error', (err) => {
      session.status = 'failed';
      session.error = err.message;
      session.endTime = Date.now();
      session.process = undefined;
      appendLog(session, `❌ Process error: ${err.message}`);
      sendChunk(sessionId, '', true, session.error);
      persistSession(session);
    });

  } catch (err: any) {
    session.status = 'failed';
    session.error = err.message;
    session.endTime = Date.now();
    appendLog(session, `❌ Failed to start: ${err.message}`);
    sendChunk(sessionId, '', true, session.error);
    persistSession(session);
  }
}

function cancelCodingAgent(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.process) {
    session.process.kill('SIGTERM');
    session.process = undefined;
  }
  session.status = 'cancelled';
  session.endTime = Date.now();
  appendLog(session, '⏹ Coding Agent cancelled by user');
  sendChunk(sessionId, '', true);
  persistSession(session);
  return true;
}

async function persistSession(session: AgentSession) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `${session.id}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
      id: session.id,
      task: session.task,
      cwd: session.cwd,
      status: session.status,
      log: session.log,
      output: session.output,
      error: session.error,
      startTime: session.startTime,
      endTime: session.endTime,
    }, null, 2));
  } catch {
    // best effort
  }
}

export function startCodingAgentService() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  fs.mkdirSync(LOG_DIR, { recursive: true });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', service: 'codingAgent', status: 'connected' }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'runCodingAgent') {
          const sessionId = msg.sessionId || `ca_${Date.now()}`;
          startCodingAgent(sessionId, msg.task, msg.cwd);
        } else if (msg.type === 'cancelCodingAgent') {
          cancelCodingAgent(msg.sessionId);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('[CodingAgentService] message error:', err);
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  app.post('/run', async (req, res) => {
    const { task, cwd } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    const sessionId = `ca_${Date.now()}`;
    startCodingAgent(sessionId, task, cwd);
    res.json({ sessionId, status: 'started' });
  });

  app.post('/cancel', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const ok = cancelCodingAgent(sessionId);
    res.json({ ok, sessionId });
  });

  app.get('/sessions/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    const { process: _, ...safe } = session;
    res.json(safe);
  });

  app.get('/sessions', (_req, res) => {
    const list = [...sessions.values()].map(({ process: _, ...s }) => s);
    res.json(list);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CodingAgentService] listening on 127.0.0.1:${PORT}`);
  });

  return server;
}

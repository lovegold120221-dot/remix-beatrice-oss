import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import vm from 'vm';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = promisify(exec);
const PORT = parseInt(process.env.SANDBOX_SERVICE_PORT || '5556', 10);
const PREVIEW_DIR = path.join(process.cwd(), 'data', 'sandbox-previews');

interface Run {
  id: string;
  language: string;
  code: string;
  output: string;
  error?: string;
  status: 'running' | 'done' | 'error';
  previewUrl?: string;
}

const runs = new Map<string, Run>();
const clients = new Set<WebSocket>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendChunk(runId: string, chunk: string, done: boolean, error?: string, previewUrl?: string) {
  broadcast({
    type: 'sandboxStream',
    runId,
    chunk,
    done,
    error,
    previewUrl,
    timestamp: Date.now(),
  });
}

async function executeSandbox(runId: string, language: string, code: string) {
  const run: Run = {
    id: runId,
    language,
    code,
    output: '',
    status: 'running',
  };
  runs.set(runId, run);
  sendChunk(runId, `▶ Starting ${language} sandbox run ${runId}\n`, false);

  if (language === 'javascript' || language === 'typescript' || language === 'js' || language === 'ts') {
    const logs: string[] = [];
    const customConsole = {
      log: (...msgs: unknown[]) => logs.push(msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      error: (...msgs: unknown[]) => logs.push('[ERROR] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      warn: (...msgs: unknown[]) => logs.push('[WARN] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      info: (...msgs: unknown[]) => logs.push('[INFO] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
    };

    try {
      const runnableCode = code.replace(/:\s*[A-Za-z0-9_<>,\[\]]+(?=[,=;\)\n])/g, '');
      const context = vm.createContext({
        console: customConsole,
        Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise,
        setTimeout, clearTimeout,
        fetch: undefined,
        require: undefined,
        process: undefined,
        global: undefined,
      });
      const script = new vm.Script(runnableCode);
      const result = script.runInContext(context, { timeout: 5000 });
      run.output = logs.join('\n');
      if (result !== undefined) {
        run.output += (run.output ? '\n' : '') + `▶ Return value: ${typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}`;
      }
      if (!run.output) run.output = '✓ Code executed successfully with no console output.';
      sendChunk(runId, run.output + '\n', true);
    } catch (err: any) {
      run.error = err.message || String(err);
      run.output = logs.join('\n') + (logs.length ? '\n' : '') + `❌ Execution Error: ${run.error}`;
      run.status = 'error';
      sendChunk(runId, run.output + '\n', true, run.error);
    }
  } else if (language === 'python' || language === 'py') {
    try {
      const { stdout, stderr } = await execPromise(`python3 -c ${JSON.stringify(code)}`, { timeout: 10000 });
      run.output = stdout || stderr || '✓ Python script finished with no output.';
      if (stderr) run.error = stderr;
      sendChunk(runId, run.output + '\n', true, run.error);
    } catch (err: any) {
      run.output = err.stdout ? err.stdout + '\n' + err.stderr : err.message;
      run.error = err.message;
      run.status = 'error';
      sendChunk(runId, run.output + '\n', true, run.error);
    }
  } else if (language === 'html') {
    try {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const fileName = `preview_${runId}.html`;
      const filePath = path.join(PREVIEW_DIR, fileName);
      const wrappedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sandbox Preview - ${runId}</title>
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#0a0a0c;color:#e4e4e7;}</style>
</head>
<body>
${code}
</body>
</html>`;
      fs.writeFileSync(filePath, wrappedHtml);
      const previewUrl = `/api/sandbox/preview/${fileName}`;
      run.previewUrl = previewUrl;
      run.output = `✓ HTML preview ready at ${previewUrl}\n\nCode (${code.length} chars)`;
      sendChunk(runId, run.output + '\n', true, undefined, previewUrl);
    } catch (err: any) {
      run.output = `✓ HTML component ready (${code.length} chars) — preview server unavailable`;
      run.error = err.message;
      sendChunk(runId, run.output + '\n', true, run.error);
    }
  } else {
    run.output = `Code received for language [${language}]`;
    sendChunk(runId, run.output + '\n', true);
  }

  run.status = run.error ? 'error' : 'done';
  runs.set(runId, run);
}

export function startSandboxService() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  app.use('/api/sandbox/preview', express.static(PREVIEW_DIR));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', service: 'sandbox', status: 'connected' }));
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'runSandbox') {
          const runId = msg.runId || `sb_${Date.now()}`;
          executeSandbox(runId, msg.language || 'javascript', msg.code);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('[SandboxService] message error:', err);
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  app.post('/run', async (req, res) => {
    const { code, language } = req.body;
    const runId = `sb_${Date.now()}`;
    executeSandbox(runId, language || 'javascript', code);
    res.json({ runId, status: 'started' });
  });

  app.get('/runs/:id', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'not found' });
    res.json(run);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[SandboxService] listening on 127.0.0.1:${PORT}`);
  });

  return server;
}

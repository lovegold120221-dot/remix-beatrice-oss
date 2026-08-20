import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BootedServer {
  baseUrl: string;
  child: ChildProcess;
  logs: () => string;
  kill: () => Promise<void>;
}

const ROOT = path.resolve(import.meta.dirname, '../..');

function randomPortBase(): number {
  return 15600 + Math.floor(Math.random() * 400);
}

/**
 * Boot the real Express + WS server as a child process with isolated ports and
 * a neutralized GEMINI_API_KEY. The child runs from a scratch cwd that contains
 * symlinks to the runtime assets but NO .env/.env.local, so dotenv loads
 * nothing and PORT/service-port overrides from the spawn env take effect.
 * NODE_ENV=production skips the Vite middleware (serves dist/ instead).
 */
export async function bootServer(extraEnv: Record<string, string> = {}): Promise<BootedServer> {
  const base = randomPortBase();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beatrice-boot-'));
  for (const name of [
    'dist', 'index.html', 'firebase-applet-config.json', 'google-web-credentials.json',
    'knowledge_base.md', 'system_prompt.md', 'privacy.html', 'terms.html', 'data',
  ]) {
    const src = path.join(ROOT, name);
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, path.join(scratch, name));
      } catch {
        // already present or race; ignore
      }
    }
  }
  try {
    fs.mkdirSync(path.join(scratch, 'data'), { recursive: true });
  } catch {
    // ignore
  }

  const env: Record<string, string> = {
    ...process.env,
    PORT: String(base),
    SANDBOX_SERVICE_PORT: String(base + 1),
    CLI_SERVICE_PORT: String(base + 2),
    BROWSER_SERVICE_PORT: String(base + 3),
    COMPUTER_SERVICE_PORT: String(base + 4),
    CODING_AGENT_PORT: String(base + 5),
    NODE_ENV: 'production',
    GEMINI_API_KEY: '',
    WHATSAPP_AUTO_INIT: '0',
    ...extraEnv,
  };
  if (!('AUTH_DISABLED' in extraEnv)) env.AUTH_DISABLED = '1';

  const entry = path.join(ROOT, 'test', 'helpers', 'server-entry.ts');
  const tsxLoader = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  const child = spawn('node', ['--import', tsxLoader, entry], {
    cwd: scratch,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout?.on('data', (d) => { logs += d.toString(); });
  child.stderr?.on('data', (d) => { logs += d.toString(); });

  const baseUrl = `http://127.0.0.1:${base}`;
  const deadline = Date.now() + 30000;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server child exited early (code ${child.exitCode}):\n${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json() as { status?: string };
        if (body.status === 'ok') {
          return {
            baseUrl,
            child,
            logs: () => logs,
            kill: async () => {
              if (child.exitCode !== null) return;
              child.kill('SIGTERM');
              await new Promise<void>((resolve) => {
                const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
                child.once('exit', () => { clearTimeout(t); resolve(); });
              });
            },
          };
        }
      }
    } catch (err: any) {
      lastErr = err?.message || String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGKILL');
  throw new Error(`server did not become healthy: ${lastErr}\n${logs}`);
}

export function wsUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/^http/, 'ws') + path;
}
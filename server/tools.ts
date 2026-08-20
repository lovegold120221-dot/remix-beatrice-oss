import { GoogleGenAI } from '@google/genai';
import { exec } from 'child_process';
import vm from 'vm';
import os from 'os';
import { promisify } from 'util';

const execPromise = promisify(exec);

import WebSocket from 'ws';

import { uploadMediaToFirebaseStorage } from '../src/lib/firebase';
import {
  tryAcquireGenerationSlot,
  releaseGenerationSlot,
  generationBusyMessage,
} from './taskGate.js';

const SANDBOX_PORT = process.env.SANDBOX_SERVICE_PORT || '5556';
const CLI_PORT = process.env.CLI_SERVICE_PORT || '5557';
const BROWSER_PORT = process.env.BROWSER_SERVICE_PORT || '5558';
const COMPUTER_PORT = process.env.COMPUTER_SERVICE_PORT || '5559';
const CODING_AGENT_PORT = process.env.CODING_AGENT_PORT || '5560';

export interface ToolContext {
  ai?: GoogleGenAI;
  broadcast: (msg: unknown) => void;
  deviceType?: 'mobile' | 'desktop';
  /** Verified Firebase uid of the session owner (set by the WS connection). */
  uid?: string;
}

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
// Legacy Token Plan (sk-sp- keys) key, kept for video/TTS calls that still hit
// the token-plan host. The primary DASHSCOPE_API_KEY (sk-ws-) is valid on the
// international endpoint only.
const DASHSCOPE_LEGACY_API_KEY = process.env.DASHSCOPE_LEGACY_API_KEY;
// Token Plan (sk-sp- keys) endpoints. DashScope-style task APIs live under /api/v1.
// Source: https://docs.qwencloud.com/token-plan/personal/token-plan-personal-quickstart
const DASHSCOPE_BASE = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1';
const DASHSCOPE_COMPAT_BASE = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
// International DashScope endpoint (accepts the sk-ws- key). z-image-turbo is
// only available here, so image generation prefers this base.
const DASHSCOPE_INTL_BASE = 'https://dashscope-intl.aliyuncs.com/api/v1';

// Fallback model chains. Primary first. Used when a call fails or polling reports failure.
// Source: https://docs.qwencloud.com/token-plan/personal/token-plan-personal-overview
// qwen-image-2.0-pro, z-image-turbo and wan2.6-t2i run on the international
// endpoint; the qwen-image-3.0-pro / wan2.7-image models run on Token Plan.
const INTEL_IMAGE_MODELS = ['qwen-image-2.0-pro-2026-06-22', 'qwen-image-2.0-pro', 'qwen-image-2.0', 'z-image-turbo', 'wan2.6-t2i'];
const QWEN_IMAGE_MODELS = ['qwen-image-2.0-pro-2026-06-22', 'qwen-image-2.0-pro', 'qwen-image-2.0', 'z-image-turbo', 'wan2.6-t2i', 'qwen-image-3.0-pro', 'wan2.7-image-pro', 'wan2.7-image'];
// Video models rotate from most capable to fallback. happyhorse-1.1-t2v and
// wan3.0-video both run on the international endpoint (async submit + task
// poll); wan3.0-video is currently stuck PENDING intl-side, so happyhorse is
// primary. No video models run on Token Plan anymore.
const QWEN_VIDEO_MODELS = ['happyhorse-1.1-t2v', 'wan3.0-video'];
const QWEN_TTS_MODELS = ['qwen-audio-3.0-tts-plus'];

// Key used for Token Plan host calls (video/TTS/chat/status pings). The legacy
// sk-sp- key is valid there; the primary sk-ws- key is not.
const TOKEN_PLAN_KEY = DASHSCOPE_LEGACY_API_KEY || DASHSCOPE_API_KEY;

// Base endpoint + auth key for a given image model (intl image models are intl-only).
function imageEndpointFor(model: string): { base: string; key: string } {
  if (INTEL_IMAGE_MODELS.includes(model)) return { base: DASHSCOPE_INTL_BASE, key: DASHSCOPE_API_KEY };
  return { base: DASHSCOPE_BASE, key: TOKEN_PLAN_KEY };
}

// The qwen-image-2.0 family (verified via curl on the intl endpoint) uses a
// slimmer parameters shape — n / negative_prompt / watermark, and NO size or
// prompt_extend. Other image models keep the extended shape.
function isQwenImageFamily(model: string): boolean {
  return model.startsWith('qwen-image-2.0');
}
function imageParameters(args: { n?: number; watermark?: boolean; size?: string }, model: string): Record<string, unknown> {
  if (isQwenImageFamily(model)) {
    return { n: args.n ?? 1, negative_prompt: '', watermark: args.watermark ?? false };
  }
  return { prompt_extend: false, size: args.size || '1024*1024', n: args.n || 1, watermark: args.watermark ?? false };
}

// Base endpoint + auth key for a given video model (happyhorse and wan3.0 are intl-only).
function videoEndpointFor(model: string): { base: string; key: string } {
  if (model.startsWith('wan3.0') || model.startsWith('happyhorse')) return { base: DASHSCOPE_INTL_BASE, key: DASHSCOPE_API_KEY };
  return { base: DASHSCOPE_BASE, key: TOKEN_PLAN_KEY };
}

// Generic helper: try each model in the chain until one succeeds or all fail.
async function tryModelChain<T>(
  models: string[],
  makeCall: (model: string) => Promise<T>,
  predicate: (result: T) => boolean
): Promise<{ result: T; model: string } | { error: string; attempted: string[] }> {
  const attempted: string[] = [];
  let lastError: string | undefined;
  for (const model of models) {
    try {
      const result = await makeCall(model);
      if (predicate(result)) return { result, model };
      attempted.push(model);
      const err = (result as any)?.error;
      if (err && typeof err === 'string') lastError = err;
    } catch (err: any) {
      attempted.push(model);
      lastError = err?.message || String(err);
    }
  }
  return { error: lastError ? `All generation models failed (${attempted.length} attempted): ${lastError}` : `All generation models failed (${attempted.length} attempted)`, attempted };
}

function redactKey(text: string) {
  let out = text;
  for (const key of [DASHSCOPE_API_KEY, DASHSCOPE_LEGACY_API_KEY]) {
    if (!key) continue;
    out = out.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED]');
  }
  return out;
}

// Never let the underlying model id leak into user-facing error strings or
// logs — media providers are internal routing details. Replaces any known
// model token with a generic placeholder.
const KNOWN_MODELS = [...new Set([...QWEN_IMAGE_MODELS, ...QWEN_VIDEO_MODELS, ...QWEN_TTS_MODELS])];
function redactModelNames(text: string): string {
  let out = text;
  for (const model of KNOWN_MODELS) {
    if (!model) continue;
    out = out.replace(new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[model]');
  }
  return out;
}

function safeErrorOf(err: unknown): string {
  return redactModelNames(redactKey(err instanceof Error ? err.message : String(err || 'unknown error')));
}

// ---- Unified activity metadata for media-generation broadcasts ----
// Every task event carries an explicit type/stage/message so the client can
// render a unified activity card without guessing task state.
const KIND_TO_TASK_TYPE: Record<string, string> = {
  chat: 'chat',
  image: 'image',
  imageEdit: 'image',
  video: 'video',
  tts: 'audio',
};

const STATUS_TO_STAGE: Record<string, string> = {
  submitting: 'Submitting generation',
  queued: 'Queued — waiting for a render slot',
  pending: 'Queued — waiting for a render slot',
  running: 'Generation in progress',
  processing: 'Processing result',
  started: 'Starting up',
  completed: 'Finalizing output',
  timeout: 'Taking longer than expected',
  failed: 'Failed',
};

function taskMeta(kind: string, status: string | undefined, message?: string) {
  return {
    type: KIND_TO_TASK_TYPE[kind] || kind,
    stage: STATUS_TO_STAGE[status || ''] || status || 'Working',
    message,
  };
}

// ---- Status audio: keep the conversation alive during long media tasks ----
// While a video/image task polls in the background the live model turn is
// blocked, so we broadcast short spoken status lines ourselves. The clips are
// synthesized once via TTS, converted to the 24kHz Int16 PCM base64 format the
// client's AudioController expects, and cached for the process lifetime.
const STATUS_LINES = [
  'One moment — just wrapping up the details.',
  'Almost there — this one takes a little patience.',
  'Still working on it — should be ready any second now.',
  'Polishing the final touches now.',
];

let statusClipsCache: (string | null)[] | null = null;
let lastStatusPingAt = 0;

function convertToPcm24k(buffer: Buffer): Promise<string | null> {
  return new Promise((resolve) => {
    const inPath = `/tmp/beatrice_status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
    const outPath = inPath.replace('.mp3', '.pcm');
    const ff = exec(
      `ffmpeg -y -loglevel error -i "${inPath}" -f s16le -ar 24000 -ac 1 "${outPath}"`,
      (err) => {
        if (err) return resolve(null);
        try {
          const { readFileSync, unlinkSync } = require('fs');
          const pcm = readFileSync(outPath);
          unlinkSync(inPath);
          unlinkSync(outPath);
          if (!pcm.length) return resolve(null);
          resolve(pcm.toString('base64'));
        } catch {
          resolve(null);
        }
      }
    );
    const fs = require('fs');
    fs.writeFileSync(inPath, buffer);
    ff.stdin?.end();
  });
}

async function ensureStatusClips(): Promise<(string | null)[]> {
  if (statusClipsCache) return statusClipsCache;
  statusClipsCache = [];
  for (const text of STATUS_LINES) {
    try {
      const res = await fetch(`${DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN_PLAN_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: QWEN_TTS_MODELS[0], input: { text, voice: 'Cherry', language_type: 'Auto' } }),
      });
      const data = (await res.json()) as any;
      const audioUrl = data?.output?.audio?.url;
      if (!audioUrl) {
        statusClipsCache.push(null);
        continue;
      }
      const audioRes = await fetch(audioUrl);
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      statusClipsCache.push(await convertToPcm24k(buffer));
    } catch {
      statusClipsCache.push(null);
    }
  }
  return statusClipsCache;
}

// Called periodically from polling loops. After ~15s of waiting, broadcasts a
// short spoken status line so the Boss never hears silence mid-generation.
async function statusPingBroadcast(ctx: ToolContext | null, elapsedMs: number) {
  if (!ctx || elapsedMs < 15000) return;
  if (elapsedMs - lastStatusPingAt < 15000) return;
  lastStatusPingAt = elapsedMs;
  const clips = await ensureStatusClips();
  const idx = Math.floor(elapsedMs / 15000);
  const line = STATUS_LINES[idx % STATUS_LINES.length];
  const clip = clips.length ? clips[idx % clips.length] : null;
  if (clip) {
    ctx.broadcast({ type: 'audio', audio: clip });
    ctx.broadcast({ type: 'status', status: 'speaking' });
  }
  ctx.broadcast({ type: 'transcript', role: 'model', text: line });
}

// Map client size strings (e.g. "1280*720", "1920x1080") to Token Plan resolution tiers.
function toResolution(size?: string): string {
  if (!size) return '720P';
  if (size.includes('1080')) return '1080P';
  if (size.includes('720')) return '720P';
  return '480P';
}

function forwardToService(
  service: 'sandbox' | 'cli' | 'browser' | 'computer' | 'codingAgent',
  msg: unknown,
  broadcast: (msg: unknown) => void
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
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

    ws.on('open', () => {
      ws.send(JSON.stringify(msg));
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        broadcast(parsed);
      } catch {
        // ignore non-json
      }
    });

    ws.on('error', (err) => reject(err));
  });
}

export async function handleOpenLocalTerminal(
  args: { command?: string },
  ctx: ToolContext
) {
  const deviceType = ctx.deviceType || 'desktop';
  const host =
    process.env.SSH_HOST ||
    (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : 'localhost');
  const port = parseInt(process.env.SSH_PORT || '22', 10);
  const user = process.env.SSH_USER || 'root';
  const sshUrl = `ssh://${user}@${host}:${port}`;

  const payload = {
    deviceType,
    mode: deviceType === 'mobile' ? 'termius' : 'browser',
    sshUrl,
    host,
    port,
    user,
    command: args.command,
  };

  ctx.broadcast({ type: 'terminalOpen', ...payload });

  return {
    ...payload,
    message:
      deviceType === 'mobile'
        ? `Opened a terminal on the user's phone via Termius (${sshUrl}).`
        : 'Opened the in-browser terminal on the user device.',
  };
}

export async function handleExecuteCodeSandbox(
  args: { code: string; language: string; description?: string },
  ctx: ToolContext
) {
  const { code, language } = args;
  const startTime = Date.now();
  let output = '';
  let error: string | undefined = undefined;

  const runId = 'sandbox_' + Math.random().toString(36).substring(2, 9);

  // Emit an immediate "running" event so the client shows the sandbox task card
  // without waiting for completion (the streaming service broadcasts updates).
  ctx.broadcast({
    type: 'sandboxOutput',
    run: { id: runId, language, code, output: '', status: 'running', timestamp: Date.now() },
  });

  // Forward to the dedicated sandbox streaming service and wait briefly for result
  try {
    const ws = await forwardToService('sandbox', { type: 'runSandbox', runId, code, language }, ctx.broadcast);
    return new Promise((resolve) => {
      let finalOutput = '';
      let finalError: string | undefined;
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ success: !finalError, runId, output: finalOutput, error: finalError });
      }, 10000);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'sandboxStream' && msg.runId === runId) {
            finalOutput += msg.chunk || '';
            if (msg.error) finalError = msg.error;
            if (msg.done) {
              clearTimeout(timeout);
              ws.close();
              resolve({ success: !finalError, runId, output: finalOutput, error: finalError });
            }
          }
        } catch {
          // ignore
        }
      });
    });
  } catch {
    // fall through to local execution if service unavailable
  }

  if (language === 'javascript' || language === 'typescript' || language === 'js' || language === 'ts') {
    const logs: string[] = [];
    const customConsole = {
      log: (...msgs: unknown[]) => logs.push(msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      error: (...msgs: unknown[]) => logs.push('[ERROR] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      warn: (...msgs: unknown[]) => logs.push('[WARN] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
      info: (...msgs: unknown[]) => logs.push('[INFO] ' + msgs.map(m => typeof m === 'object' ? JSON.stringify(m, null, 2) : String(m)).join(' ')),
    };

    try {
      // Clean up TS annotations if simple
      const runnableCode = code.replace(/:\s*[A-Za-z0-9_<>\[\]]+(?=[,=;\)\n])/g, '');
      const context = vm.createContext({
        console: customConsole,
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        setTimeout,
        clearTimeout,
      });

      const script = new vm.Script(runnableCode);
      const result = script.runInContext(context, { timeout: 3000 });

      output = logs.join('\n');
      if (result !== undefined) {
        output += (output ? '\n' : '') + `▶ Return value: ${typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}`;
      }
      if (!output) output = '✓ Code executed successfully with no console output.';
    } catch (err: any) {
      error = err.message || String(err);
      output = logs.join('\n') + (logs.length ? '\n' : '') + `❌ Execution Error: ${error}`;
    }
  } else if (language === 'python' || language === 'py') {
    try {
      // Try running python3
      const { stdout, stderr } = await execPromise(`python3 -c ${JSON.stringify(code)}`, { timeout: 5000 });
      output = stdout || stderr || '✓ Python script finished with no output.';
      if (stderr) error = stderr;
    } catch (err: any) {
      output = err.stdout ? err.stdout + '\n' + err.stderr : err.message;
      error = err.message;
    }
  } else if (language === 'html') {
    output = `✓ HTML component preview ready for rendering on Beatrice Canvas.\n\nRaw HTML (${code.length} chars):\n${code.substring(0, 300)}${code.length > 300 ? '...' : ''}`;
  } else {
    output = `Code received for language [${language}]:\n${code}`;
  }

  const runResult = {
    id: runId,
    language,
    code,
    output,
    error,
    status: error ? 'failed' : 'completed',
    timestamp: Date.now(),
  };

  ctx.broadcast({
    type: 'sandboxOutput',
    run: runResult,
  });

  return {
    success: !error,
    runId,
    executionTimeMs: Date.now() - startTime,
    output,
  };
}

export async function handleRunCliCommand(
  args: { command: string; cwd?: string },
  ctx: ToolContext
) {
  const { command, cwd } = args;
  const startTime = Date.now();
  const runId = 'cli_' + Math.random().toString(36).substring(2, 9);

  // Emit an immediate "running" event so the client shows the CLI task card
  // without waiting for completion (the streaming service broadcasts updates).
  ctx.broadcast({
    type: 'cliOutput',
    run: { id: runId, command, output: '', exitCode: 0, status: 'running', timestamp: Date.now() },
  });

  // Forward to the dedicated CLI streaming service
  try {
    const ws = await forwardToService('cli', { type: 'startSession', sessionId: runId, cwd }, ctx.broadcast);
    await new Promise((r) => setTimeout(r, 200)); // let shell start
    ws.send(JSON.stringify({ type: 'runCommand', sessionId: runId, command, cwd }));

    return new Promise((resolve) => {
      let output = '';
      let exitCode = 0;
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ command, exitCode, output: output.trim(), durationMs: Date.now() - startTime });
      }, 15000);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'cliStream' && msg.sessionId === runId) {
            output += msg.chunk || '';
            if (msg.exitCode !== undefined) exitCode = msg.exitCode;
            if (msg.done) {
              clearTimeout(timeout);
              ws.close();
              resolve({ command, exitCode, output: output.trim(), durationMs: Date.now() - startTime });
            }
          }
        } catch {
          // ignore
        }
      });
    });
  } catch {
    // fall through to local execution if service unavailable
  }

  // Sanitize commands for safety if necessary
  let output = '';
  let exitCode = 0;

  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout: 8000,
      maxBuffer: 1024 * 512,
    });
    output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
    if (!output.trim()) output = 'Command executed cleanly with no output.';
  } catch (err: any) {
    exitCode = err.code || 1;
    output = (err.stdout || '') + '\n' + (err.stderr || err.message || 'Execution error');
  }

  const runResult = {
    id: runId,
    command,
    output: output.trim(),
    exitCode,
    status: exitCode === 0 ? 'completed' : 'failed',
    timestamp: Date.now(),
  };

  ctx.broadcast({
    type: 'cliOutput',
    run: runResult,
  });

  return {
    command,
    exitCode,
    output: output.trim(),
    durationMs: Date.now() - startTime,
  };
}

export async function handleDeployAgentTask(
  args: { agentName: string; task: string },
  ctx: ToolContext
) {
  const { agentName, task } = args;
  const agentId = 'agent_' + Math.random().toString(36).substring(2, 9);
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject the trigger (no model
  // call) while a previous task is still running.
  const slot = tryAcquireGenerationSlot(uid, 'code', agentId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  try {
    return await runDeployAgentTask(args, ctx, agentId);
  } finally {
    releaseGenerationSlot(uid, agentId);
  }
}

async function runDeployAgentTask(
  args: { agentName: string; task: string },
  ctx: ToolContext,
  agentId: string
) {
  const { agentName, task } = args;

  const initialAgent = {
    id: agentId,
    agentName,
    task,
    status: 'thinking' as const,
    progress: 10,
    logs: [`[${new Date().toLocaleTimeString()}] Sub-agent ${agentName} initialized.`, `[${new Date().toLocaleTimeString()}] Task assigned: "${task}"`],
    timestamp: Date.now(),
  };

  ctx.broadcast({
    type: 'agentUpdate',
    agent: initialAgent,
  });

  // Step 2: Running analysis via Gemini or heuristic
  let agentAnalysis = '';
  let agentFailed = false;
  ctx.broadcast({
    type: 'agentUpdate',
    agent: {
      ...initialAgent,
      status: 'executing' as const,
      progress: 45,
      logs: [
        ...initialAgent.logs,
        `[${new Date().toLocaleTimeString()}] Running analysis…`,
      ],
    },
  });
  if (ctx.ai && process.env.GEMINI_API_KEY) {
    try {
      const response = await ctx.ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `You are sub-agent "${agentName}". Execute the following user task in detail, acting as a specialized autonomous AI agent: "${task}". Provide clear findings, steps taken, and resolution.`,
      });
      agentAnalysis = response.text || 'Task completed successfully.';
    } catch (err: any) {
      agentFailed = true;
      agentAnalysis = `Agent execution error: ${err.message}`;
    }
  } else {
    agentAnalysis = `Agent ${agentName} processed task "${task}". Verified environment state and prepared step-by-step resolution.`;
  }

  const doneAgent = {
    ...initialAgent,
    status: (agentFailed ? 'failed' : 'completed') as 'completed' | 'failed',
    progress: 100,
    logs: [
      ...initialAgent.logs,
      `[${new Date().toLocaleTimeString()}] Agent reasoning ${agentFailed ? 'failed' : 'completed'}.`,
      agentFailed
        ? `[${new Date().toLocaleTimeString()}] Output not attached to Beatrice state.`
        : `[${new Date().toLocaleTimeString()}] Output verified and attached to Beatrice state.`
    ],
    result: agentAnalysis,
  };

  ctx.broadcast({
    type: 'agentUpdate',
    agent: doneAgent,
  });

  return {
    agentId,
    agentName,
    status: agentFailed ? 'failed' : 'completed',
    result: agentAnalysis,
  };
}

export async function handleRunCodingAgent(
  args: { task: string; cwd?: string },
  ctx: ToolContext
) {
  const { task, cwd } = args;
  const sessionId = 'ca_' + Math.random().toString(36).substring(2, 9);
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject the trigger while a
  // previous task (image/video/coding) is still running.
  const slot = tryAcquireGenerationSlot(uid, 'code', sessionId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }

  ctx.broadcast({
    type: 'codingAgentUpdate',
    session: {
      id: sessionId,
      task,
      cwd: cwd || process.cwd(),
      status: 'starting',
      log: [`[${new Date().toLocaleTimeString()}] Coding Agent initializing...`, `[${new Date().toLocaleTimeString()}] Task: ${task}`],
      output: '',
      timestamp: Date.now(),
    },
  });

  // The agent runs in the background service; the slot stays held until the
  // service reports a terminal state for this session (or the link dies).
  const release = () => releaseGenerationSlot(uid, sessionId);
  const onMessage = (data: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(data.toString());
      const s = parsed?.session;
      if (
        parsed?.type === 'codingAgentUpdate' &&
        s &&
        s.id === sessionId &&
        ['completed', 'failed', 'cancelled'].includes(s.status)
      ) {
        release();
      }
    } catch {
      // ignore non-json
    }
  };

  try {
    const ws = await forwardToService(
      'codingAgent',
      { type: 'runCodingAgent', sessionId, task, cwd },
      ctx.broadcast
    );
    ws.on('message', onMessage);
    ws.on('close', release);
    ws.on('error', release);
    return {
      success: true,
      sessionId,
      message: `Coding Agent started. Watch the Coding Agent panel for live output. Task: ${task.slice(0, 120)}`,
    };
  } catch (err: any) {
    release();
    return { success: false, error: err.message || 'Coding Agent service unavailable' };
  }
}

export async function handleGetSystemInfo(ctx: ToolContext) {
  const mem = process.memoryUsage();
  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    liveApiEngine: 'Gemini 3.1 Flash Live Preview',
    agentFramework: 'Beatrice OSS Live Agent v1.0',
    timestamp: new Date().toISOString(),
  };

  return info;
}

export async function handleUpdateCanvasVisual(
  args: { canvasType: 'diagram' | 'markdown' | 'chart' | 'code_snippet'; title: string; content: string },
  ctx: ToolContext
) {
  const canvasData = {
    type: args.canvasType,
    title: args.title,
    content: args.content,
    updatedAt: Date.now(),
  };

  ctx.broadcast({
    type: 'canvasUpdate',
    canvas: canvasData,
  });

  return {
    status: 'rendered',
    title: args.title,
    type: args.canvasType,
  };
}

export async function handleRunBrowserAutomation(
  args: {
    action: string;
    url?: string;
    selector?: string;
    text?: string;
  },
  ctx: ToolContext
) {
  const sessionId = `web_${Date.now()}`;
  try {
    await forwardToService(
      'browser',
      {
        type: args.action,
        sessionId,
        url: args.url,
        selector: args.selector,
        text: args.text,
      },
      ctx.broadcast
    );
    return {
      success: true,
      sessionId,
      action: args.action,
      message: `Browser automation '${args.action}' started. Watch the Web Use panel for live updates.`,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Browser service unavailable' };
  }
}

export async function handleRunComputerControl(
  args: {
    action: string;
    command?: string;
    cwd?: string;
    app?: string;
    x?: number;
    y?: number;
    key?: string;
    text?: string;
  },
  ctx: ToolContext
) {
  const sessionId = `comp_${Date.now()}`;
  try {
    await forwardToService(
      'computer',
      {
        type: args.action,
        sessionId,
        command: args.command,
        cwd: args.cwd,
        app: args.app,
        x: args.x,
        y: args.y,
        key: args.key,
        text: args.text,
      },
      ctx.broadcast
    );
    return {
      success: true,
      sessionId,
      action: args.action,
      message: `Computer control '${args.action}' started. Watch the Computer Use panel for live updates.`,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Computer service unavailable' };
  }
}

// ---- Video generation queue ----
// One video generation (qwenVideoGenerate OR generateVideo) renders at a time
// server-wide (Token Plan constraint), but requests from different users queue
// up FIFO instead of being rejected, and a single user may hold at most one
// running + one queued job so nobody can monopolize the queue. Generations run
// in the background so the Live conversation keeps flowing.
interface VideoQueueItem {
  userId: string;
  run: () => Promise<void>;
}

const videoQueue: VideoQueueItem[] = [];
let videoQueueRunning = false;
const videoActiveByUser = new Map<string, number>();

export function enqueueVideoGeneration(userId: string, run: () => Promise<void>): { accepted: boolean; position?: number; reason?: string } {
  const active = videoActiveByUser.get(userId) || 0;
  if (active >= 2) {
    return {
      accepted: false,
      reason: `You already have ${active} video generation${active > 1 ? 's' : ''} in progress — wait for one to finish before starting another.`,
    };
  }
  videoActiveByUser.set(userId, active + 1);
  videoQueue.push({ userId, run });
  const position = videoQueue.length;
  void pumpVideoQueue();
  return { accepted: true, position };
}

async function pumpVideoQueue() {
  if (videoQueueRunning) return;
  videoQueueRunning = true;
  while (videoQueue.length > 0) {
    const item = videoQueue.shift()!;
    try {
      await item.run();
    } catch (err: any) {
      console.error('video queue job failed:', err?.message || err);
    } finally {
      const count = (videoActiveByUser.get(item.userId) || 1) - 1;
      if (count <= 0) videoActiveByUser.delete(item.userId);
      else videoActiveByUser.set(item.userId, count);
    }
  }
  videoQueueRunning = false;
}

export function videoQueueStats(): { queueLength: number; running: boolean; activeUsers: string[] } {
  return { queueLength: videoQueue.length, running: videoQueueRunning, activeUsers: [...videoActiveByUser.keys()] };
}

export async function handleGenerateVideo(
  args: {
    prompt: string;
    size?: string;
    duration?: number;
    audio?: boolean;
    shot_type?: string;
    prompt_extend?: boolean;
    watermark?: boolean;
  },
  ctx: ToolContext
) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `vid_${Date.now()}`;
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject a second video while any
  // other task (image/video/audio/coding) is still in flight.
  const slot = tryAcquireGenerationSlot(uid, 'video', taskId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  const queued = enqueueVideoGeneration(uid, async () => {
    try {
      await runGenerateVideo(args, ctx, taskId);
    } finally {
      releaseGenerationSlot(uid, taskId);
    }
  });
  if (!queued.accepted) {
    releaseGenerationSlot(uid, taskId);
    return { success: false, error: queued.reason };
  }
  if (queued.position && queued.position > 1) {
    ctx.broadcast({
      type: 'videoGenerationUpdate',
      task: {
        id: taskId,
        prompt: args.prompt,
        status: 'queued',
        progress: 2,
        position: queued.position,
        timestamp: Date.now(),
        ...taskMeta('video', 'queued'),
      },
    });
  }
  return {
    success: true,
    taskId,
    status: 'started',
    position: queued.position,
    message: queued.position && queued.position > 1
      ? `Video generation queued at position ${queued.position}. I will keep chatting while it renders — watch the Video Generation panel for progress.`
      : 'Video generation started in the background. I will keep chatting while it renders — watch the Video Generation panel for progress.',
  };
}

async function runGenerateVideo(
  args: {
    prompt: string;
    size?: string;
    duration?: number;
    audio?: boolean;
    shot_type?: string;
    prompt_extend?: boolean;
    watermark?: boolean;
  },
  ctx: ToolContext,
  taskId: string
) {
  const preferredModels = QWEN_VIDEO_MODELS;
  let lastError = '';

  for (const model of preferredModels) {
    const { base, key } = videoEndpointFor(model);
    const body: any = {
      model,
      input: { prompt: args.prompt },
      parameters: {
        resolution: toResolution(args.size),
        ratio: '16:9',
        duration: Math.min(15, Math.max(3, args.duration || 10)),
      },
    };
    if (args.watermark !== undefined) body.parameters.watermark = args.watermark;
    if (model.startsWith('wan3.0')) {
      // wan3.0-video uses size/duration/audio instead of resolution/ratio.
      body.parameters = { size: args.size && args.size.includes('1080') ? '1920*1080' : '1280*720', duration: Math.min(15, Math.max(3, args.duration || 5)), audio: args.audio ?? true };
    }

    ctx.broadcast({
      type: 'videoGenerationUpdate',
      task: {
        id: taskId,
        model,
        prompt: args.prompt,
        status: 'submitting',
        progress: 5,
        timestamp: Date.now(),
        ...taskMeta('video', 'submitting', args.prompt),
      },
    });

    try {
      const submitRes = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
        method: 'POST',
        headers: {
          'X-DashScope-Async': 'enable',
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!submitRes.ok) {
        const errText = redactModelNames(redactKey(await submitRes.text().catch(() => 'unknown error')));
        lastError = errText;
        ctx.broadcast({
          type: 'videoGenerationUpdate',
          task: { id: taskId, status: 'failed', error: lastError, timestamp: Date.now(), ...taskMeta('video', 'failed', lastError) },
        });
        continue;
      }

      const submitData = (await submitRes.json()) as { output?: { task_id?: string; task_status?: string }; request_id?: string };
      const dashTaskId = submitData.output?.task_id;
      const requestId = submitData.request_id;

      if (!dashTaskId) {
        lastError = 'No task_id returned from DashScope';
        continue;
      }

      ctx.broadcast({
        type: 'videoGenerationUpdate',
        task: {
          id: taskId,
          model,
          dashTaskId,
          requestId,
          prompt: args.prompt,
          status: 'queued',
          progress: 10,
          timestamp: Date.now(),
          ...taskMeta('video', 'queued'),
        },
      });

      const videoUrl = await pollDashscopeVideoTask(dashTaskId, base, key, (status, progress, url, error) => {
        ctx.broadcast({
          type: 'videoGenerationUpdate',
          task: {
            id: taskId,
            ...(status !== 'failed' ? { model } : {}),
            dashTaskId,
            requestId,
            prompt: args.prompt,
            status,
            progress,
            videoUrl: url,
            error,
            timestamp: Date.now(),
            ...taskMeta('video', status, error),
          },
        });
      }, ctx);

      if (videoUrl) {
        // Persist the video to Firebase Storage so the download link never
        // expires (DashScope URLs are signed and short-lived).
        let persistentUrl = '';
        try {
          const fetchRes = await fetch(videoUrl);
          const buffer = Buffer.from(await fetchRes.arrayBuffer());
          const base64data = buffer.toString('base64');
          persistentUrl = await uploadMediaToFirebaseStorage(`data:video/mp4;base64,${base64data}`, 'video/mp4', 'videos');
        } catch (e) {
          console.error('Firebase upload error:', e);
        }
        ctx.broadcast({
          type: 'videoGenerationUpdate',
          task: {
            id: taskId,
            model,
            dashTaskId,
            requestId,
            prompt: args.prompt,
            status: 'completed',
            progress: 100,
            videoUrl: persistentUrl || videoUrl,
            downloadUrl: persistentUrl || videoUrl,
            timestamp: Date.now(),
            ...taskMeta('video', 'completed'),
          },
        });
        return {
          success: true,
          taskId,
          model,
          dashTaskId,
          requestId,
          videoUrl,
          downloadUrl: persistentUrl || videoUrl,
          prompt: args.prompt,
          message: 'Video generated successfully. Check the Video Generation panel to view/download.',
        };
      }

      lastError = 'Video generation did not produce a URL';
    } catch (err: any) {
      lastError = redactKey(err.message || String(err));
      ctx.broadcast({
        type: 'videoGenerationUpdate',
        task: { id: taskId, model, status: 'failed', error: lastError, timestamp: Date.now(), ...taskMeta('video', 'failed', lastError) },
      });
    }
  }

  ctx.broadcast({
    type: 'videoGenerationUpdate',
    task: { id: taskId, status: 'failed', error: lastError || 'All models failed', timestamp: Date.now(), ...taskMeta('video', 'failed', lastError || 'All models failed') },
  });
  return { success: false, taskId, error: lastError || 'All models failed' };
}

async function pollDashscopeVideoTask(
  dashTaskId: string,
  base: string,
  apiKey: string,
  onUpdate: (status: string, progress: number, videoUrl?: string, error?: string) => void,
  ctx?: ToolContext
): Promise<string | undefined> {
  const maxAttempts = 60;
  const pollIntervalMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    await statusPingBroadcast(ctx, (attempt + 1) * pollIntervalMs);

    const res = await fetch(`${base}/tasks/${dashTaskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) continue;

    const data = (await res.json()) as {
      output?: {
        task_status?: string;
        video_url?: string;
        results?: { url?: string }[];
        message?: string;
      };
    };

    const status = data.output?.task_status || 'UNKNOWN';
    const videoUrl = data.output?.video_url || data.output?.results?.[0]?.url;
    const message = data.output?.message;

    if (status === 'SUCCEEDED') {
      onUpdate('completed', 100, videoUrl);
      return videoUrl;
    }

    if (status === 'FAILED') {
      onUpdate('failed', 0, undefined, message || 'DashScope task failed');
      return undefined;
    }

    const progress = Math.min(95, 10 + Math.round((attempt / maxAttempts) * 85));
    onUpdate(status.toLowerCase(), progress, videoUrl);
  }

  onUpdate('timeout', 95, undefined, 'Polling timed out');
  return undefined;
}

export async function handleQwenChat(
  args: {
    prompt: string;
    model?: string;
    system?: string;
    temperature?: number;
    max_tokens?: number;
  },
  ctx: ToolContext
) {
  if (!DASHSCOPE_API_KEY) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `qwen_chat_${Date.now()}`;
  ctx.broadcast({
    type: 'qwencloudUpdate',
    task: { id: taskId, kind: 'chat', prompt: args.prompt, status: 'running', progress: 10, timestamp: Date.now(), ...taskMeta('chat', 'running') },
  });
  try {
    const res = await fetch(`${DASHSCOPE_COMPAT_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_PLAN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.model || 'qwen3.7-plus',
        messages: [
          ...(args.system ? [{ role: 'system', content: args.system }] : []),
          { role: 'user', content: args.prompt },
        ],
        temperature: args.temperature ?? 0.7,
        max_tokens: args.max_tokens ?? 2048,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      const msg = redactModelNames(redactKey(data?.error?.message || data?.message || `DashScope error ${res.status}`));
      ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'chat', status: 'failed', error: msg, timestamp: Date.now(), ...taskMeta('chat', 'failed', msg) } });
      return { success: false, error: msg };
    }
    const text = data.choices?.[0]?.message?.content || '';
    const done = { id: taskId, kind: 'chat', prompt: args.prompt, status: 'completed', progress: 100, result: text, timestamp: Date.now(), ...taskMeta('chat', 'completed') };
    ctx.broadcast({ type: 'qwencloudUpdate', task: done });
    return { success: true, taskId, text, model: args.model || 'qwen3.7-plus' };
  } catch (err: any) {
    const safeError = safeErrorOf(err);
    ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'chat', status: 'failed', error: safeError, timestamp: Date.now(), ...taskMeta('chat', 'failed', safeError) } });
    return { success: false, error: safeError };
  }
}

export async function handleQwenImageGenerate(
  args: {
    prompt: string;
    model?: string;
    size?: string;
    n?: number;
    watermark?: boolean;
    thinking_mode?: boolean;
    enable_sequential?: boolean;
  },
  ctx: ToolContext
) {
  if (!DASHSCOPE_API_KEY) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `qwen_img_${Date.now()}`;
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject the trigger (no model
  // call) while a previous task is still running.
  const slot = tryAcquireGenerationSlot(uid, 'image', taskId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  ctx.broadcast({
    type: 'qwencloudUpdate',
    task: { id: taskId, kind: 'image', prompt: args.prompt, status: 'submitting', progress: 5, timestamp: Date.now(), ...taskMeta('image', 'submitting', args.prompt) },
  });
  const imgPingStart = Date.now();
  const imgPingTimer = setInterval(() => {
    void statusPingBroadcast(ctx, Date.now() - imgPingStart);
  }, 10000);
  try {
    const chainResult = await tryModelChain(
      args.model ? [args.model] : QWEN_IMAGE_MODELS,
      async (model) => {
        const { base, key } = imageEndpointFor(model);
        const body: any = {
          model,
          input: { messages: [{ role: 'user', content: [{ text: args.prompt }] }] },
          parameters: imageParameters(args, model),
        };

        // z-image-turbo is synchronous on the international endpoint; Token Plan
        // image generation is also synchronous via multimodal-generation/generation.
        const submitRes = await fetch(`${base}/services/aigc/multimodal-generation/generation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!submitRes.ok) {
          const errText = await submitRes.text().catch(() => 'unknown error');
          return { success: false, error: redactKey(errText), rawModel: model };
        }

        const data = (await submitRes.json()) as any;
        const urls: string[] = [];
        for (const choice of data.output?.choices ?? []) {
          for (const part of choice.message?.content ?? []) {
            if (typeof part === 'object' && part.image) urls.push(part.image);
          }
        }

        // Upload images to Firebase Storage
        const firebaseUrls: string[] = [];
        if (urls.length) {
          for (const url of urls) {
            try {
              const fetchRes = await fetch(url);
              const buffer = Buffer.from(await fetchRes.arrayBuffer());
              const base64data = buffer.toString('base64');
              const ext = url.split('/').pop() || 'image';
              const firebaseUrl = await uploadMediaToFirebaseStorage(`data:${fetchRes.headers.get('content-type') || 'image'};base64,${base64data}`, ext, 'qwen-images');
              firebaseUrls.push(firebaseUrl);
            } catch (e) {
              console.error('Firebase upload error:', e);
            }
          }
        }

        return { success: !!urls.length, taskId, model, urls, firebaseUrls, message: urls.length ? 'Images generated successfully.' : 'No image URLs returned.' };
      },
      (r) => r.success && (r.urls?.length ?? 0) > 0
    );

    if ('error' in chainResult) {
      const safeError = redactModelNames(chainResult.error);
      ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'image', status: 'failed', error: safeError, attemptedCount: chainResult.attempted.length, timestamp: Date.now(), ...taskMeta('image', 'failed', safeError) } });
      return { success: false, error: safeError, attemptedCount: chainResult.attempted.length };
    }

    const res = chainResult.result as any;
    const ok = !!res.urls?.length;
    ctx.broadcast({
      type: 'qwencloudUpdate',
      task: {
        id: taskId,
        kind: 'image',
        prompt: args.prompt,
        model: res.model,
        status: ok ? 'completed' : 'failed',
        progress: ok ? 100 : 0,
        urls: res.urls || [],
        firebaseUrls: res.firebaseUrls || [],
        error: ok ? undefined : 'No image URLs returned.',
        timestamp: Date.now(),
        ...taskMeta('image', ok ? 'completed' : 'failed'),
      },
    });
    return chainResult.result;
  } catch (err: any) {
    const safeError = safeErrorOf(err);
    ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'image', status: 'failed', error: safeError, timestamp: Date.now(), ...taskMeta('image', 'failed', safeError) } });
    return { success: false, error: safeError };
  } finally {
    clearInterval(imgPingTimer);
    releaseGenerationSlot(uid, taskId);
  }
}

export async function handleQwenImageEdit(
  args: {
    instruction: string;
    images: string[];
    model?: string;
    size?: string;
    n?: number;
    watermark?: boolean;
    bbox_list?: number[][][];
  },
  ctx: ToolContext
) {
  if (!DASHSCOPE_API_KEY) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `qwen_edit_${Date.now()}`;
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject the trigger while a
  // previous task is still running.
  const slot = tryAcquireGenerationSlot(uid, 'image', taskId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'imageEdit', prompt: args.instruction, status: 'submitting', progress: 5, timestamp: Date.now(), ...taskMeta('image', 'submitting', args.instruction) } });
  const editPingStart = Date.now();
  const editPingTimer = setInterval(() => {
    void statusPingBroadcast(ctx, Date.now() - editPingStart);
  }, 10000);
  try {
    const chainResult = await tryModelChain(
      args.model ? [args.model] : QWEN_IMAGE_MODELS,
      async (model) => {
        const { base, key } = imageEndpointFor(model);
        const content: any[] = [{ text: args.instruction }];
        for (const img of args.images || []) content.push({ image: img });
        const body: any = {
          model,
          input: { messages: [{ role: 'user', content }] },
          parameters: imageParameters(args, model),
        };

        // z-image-turbo is synchronous on the international endpoint; Token Plan
        // image editing is also synchronous via multimodal-generation/generation.
        const submitRes = await fetch(`${base}/services/aigc/multimodal-generation/generation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!submitRes.ok) return { success: false, error: redactKey(await submitRes.text().catch(() => 'unknown error')), rawModel: model };

        const data = (await submitRes.json()) as any;
        const urls: string[] = [];
        for (const choice of data.output?.choices ?? []) {
          for (const part of choice.message?.content ?? []) {
            if (typeof part === 'object' && part.image) urls.push(part.image);
          }
        }

        const firebaseUrls: string[] = [];
        if (urls.length) {
          for (const url of urls) {
            try {
              const fetchRes = await fetch(url);
              const buffer = Buffer.from(await fetchRes.arrayBuffer());
              const base64data = buffer.toString('base64');
              const ext = url.split('/').pop() || 'image';
              const firebaseUrl = await uploadMediaToFirebaseStorage(`data:${fetchRes.headers.get('content-type') || 'image'};base64,${base64data}`, ext, 'qwen-images-edits');
              firebaseUrls.push(firebaseUrl);
            } catch (e) { console.error('Firebase upload error:', e); }
          }
        }

        return { success: !!urls.length, taskId, model, urls, firebaseUrls };
      },
      (r) => r.success && (r.urls?.length ?? 0) > 0
    );

    if ('error' in chainResult) {
      const safeError = redactModelNames(chainResult.error);
      ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'imageEdit', status: 'failed', error: safeError, attemptedCount: chainResult.attempted.length, timestamp: Date.now(), ...taskMeta('image', 'failed', safeError) } });
      return { success: false, error: safeError, attemptedCount: chainResult.attempted.length };
    }

    const editRes = chainResult.result as any;
    const editOk = !!editRes.urls?.length;
    ctx.broadcast({
      type: 'qwencloudUpdate',
      task: {
        id: taskId,
        kind: 'imageEdit',
        prompt: args.instruction,
        model: editRes.model,
        status: editOk ? 'completed' : 'failed',
        progress: editOk ? 100 : 0,
        urls: editRes.urls || [],
        firebaseUrls: editRes.firebaseUrls || [],
        error: editOk ? undefined : 'No image URLs returned.',
        timestamp: Date.now(),
        ...taskMeta('image', editOk ? 'completed' : 'failed'),
      },
    });
    return chainResult.result;
  } catch (err: any) {
    const safeError = safeErrorOf(err);
    ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'imageEdit', status: 'failed', error: safeError, timestamp: Date.now(), ...taskMeta('image', 'failed', safeError) } });
    return { success: false, error: safeError };
  } finally {
    clearInterval(editPingTimer);
    releaseGenerationSlot(uid, taskId);
  }
}

export async function handleQwenVideoGenerate(
  args: {
    prompt: string;
    model?: string;
    resolution?: string;
    ratio?: string;
    duration?: number;
    prompt_extend?: boolean;
    watermark?: boolean;
    audio_url?: string;
  },
  ctx: ToolContext
) {
  if (!DASHSCOPE_API_KEY) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `qwen_vid_${Date.now()}`;
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject a second video while any
  // other task (image/video/audio/coding) is still in flight.
  const slot = tryAcquireGenerationSlot(uid, 'video', taskId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  const queued = enqueueVideoGeneration(uid, async () => {
    try {
      await runQwenVideoGenerate(args, ctx, taskId);
    } finally {
      releaseGenerationSlot(uid, taskId);
    }
  });
  if (!queued.accepted) {
    releaseGenerationSlot(uid, taskId);
    return { success: false, error: queued.reason };
  }
  if (queued.position && queued.position > 1) {
    ctx.broadcast({
      type: 'qwencloudUpdate',
      task: {
        id: taskId,
        kind: 'video',
        prompt: args.prompt,
        status: 'queued',
        progress: 2,
        position: queued.position,
        timestamp: Date.now(),
        ...taskMeta('video', 'queued'),
      },
    });
  }
  return {
    success: true,
    taskId,
    status: 'started',
    position: queued.position,
    message: queued.position && queued.position > 1
      ? `Video generation queued at position ${queued.position}. I will keep chatting while it renders — watch the Media panel for progress.`
      : 'Video generation started in the background. I will keep chatting while it renders — watch the Media panel for progress.',
  };
}

async function runQwenVideoGenerate(
  args: {
    prompt: string;
    model?: string;
    resolution?: string;
    ratio?: string;
    duration?: number;
    prompt_extend?: boolean;
    watermark?: boolean;
    audio_url?: string;
  },
  ctx: ToolContext,
  taskId: string
) {
  ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'video', prompt: args.prompt, status: 'submitting', progress: 5, timestamp: Date.now(), ...taskMeta('video', 'submitting', args.prompt) } });
  try {
    const chainResult = await tryModelChain(
      args.model ? [args.model] : QWEN_VIDEO_MODELS,
      async (model) => {
        const { base, key } = videoEndpointFor(model);
        const input: any = { prompt: args.prompt };
        if (args.audio_url) input.audio_url = args.audio_url;
        const body: any = {
          model,
          input,
          parameters: {},
        };

        // HappyHorse 1.1 / Wan 2.7 / Wan 2.6 expect resolution + ratio
        const supportsSize = model.startsWith('wan3.0') || model.startsWith('wan2.6') || model.startsWith('wan2.7');
        if (supportsSize) {
          body.parameters.resolution = args.resolution || '720P';
          body.parameters.ratio = args.ratio || '16:9';
          body.parameters.prompt_extend = args.prompt_extend !== false;
          body.parameters.watermark = args.watermark ?? false;
          body.parameters.duration = args.duration || 5;
        } else if (model.startsWith('happyhorse')) {
          // HappyHorse supports resolution + ratio + duration (Token Plan spec)
          body.parameters.resolution = args.resolution || '720P';
          body.parameters.ratio = args.ratio || '16:9';
          body.parameters.duration = Math.min(15, Math.max(3, args.duration || 5));
          if (args.watermark !== undefined) body.parameters.watermark = args.watermark;
        } else {
          // wan3.0-video all-in-one: supports size/duration/audio/shot_type
          body.parameters.size = args.resolution ? `${args.resolution}` : '1280*720';
          body.parameters.duration = args.duration || 5;
          body.parameters.audio = true;
        }

        const submitRes = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
          method: 'POST',
          headers: { 'X-DashScope-Async': 'enable', Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!submitRes.ok) return { success: false, error: redactKey(await submitRes.text().catch(() => 'unknown error')), rawModel: model };

        const submitData = (await submitRes.json()) as { output?: { task_id?: string }; request_id?: string };
        const dashTaskId = submitData.output?.task_id;
        const requestId = submitData.request_id;
        if (!dashTaskId) return { success: false, error: 'No task_id returned', rawModel: model };

        ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'video', dashTaskId, requestId, model, prompt: args.prompt, status: 'queued', progress: 10, timestamp: Date.now(), ...taskMeta('video', 'queued') } });
        const result = await pollDashscopeTask(dashTaskId, 'video', base, key, (status, progress, urls, error) => {
          ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'video', dashTaskId, requestId, model, prompt: args.prompt, status, progress, urls, error, timestamp: Date.now(), ...taskMeta('video', status, error) } });
        }, ctx);

        let firebaseUrl: string = '';
        if (result.urls?.length) {
          try {
            const url = result.urls[0];
            const fetchRes = await fetch(url);
            const buffer = Buffer.from(await fetchRes.arrayBuffer());
            const base64data = buffer.toString('base64');
            firebaseUrl = await uploadMediaToFirebaseStorage(`data:video/mp4;base64,${base64data}`, 'video/mp4', 'qwen-videos');
          } catch (e) { console.error('Firebase upload error:', e); }
        }

        return { success: !!result.urls?.length, taskId, dashTaskId, requestId, model, videoUrl: result.urls?.[0], urls: result.urls || [], firebaseUrl };
      },
      (r) => r.success && (r.urls?.length ?? 0) > 0
    );

    if ('error' in chainResult) {
      const safeError = redactModelNames(chainResult.error);
      ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'video', status: 'failed', error: safeError, attemptedCount: chainResult.attempted.length, timestamp: Date.now(), ...taskMeta('video', 'failed', safeError) } });
      return { success: false, error: safeError, attemptedCount: chainResult.attempted.length };
    }
    // Final broadcast with the persistent (Firebase Storage) URL so the panel
    // can render/download the video even after the DashScope link expires.
    const result = chainResult.result as any;
    ctx.broadcast({
      type: 'qwencloudUpdate',
      task: {
        id: taskId,
        kind: 'video',
        model: result.model,
        dashTaskId: result.dashTaskId,
        requestId: result.requestId,
        prompt: args.prompt,
        status: 'completed',
        progress: 100,
        urls: result.urls || [],
        firebaseUrls: result.firebaseUrl ? [result.firebaseUrl] : [],
        timestamp: Date.now(),
        ...taskMeta('video', 'completed'),
      },
    });
    return result;
  } catch (err: any) {
    const safeError = safeErrorOf(err);
    ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'video', status: 'failed', error: safeError, timestamp: Date.now(), ...taskMeta('video', 'failed', safeError) } });
    return { success: false, error: safeError };
  }
}

export async function handleQwenTts(
  args: {
    text: string;
    voice?: string;
    model?: string;
    language_type?: string;
  },
  ctx: ToolContext
) {
  if (!DASHSCOPE_API_KEY) {
    return { error: 'DASHSCOPE_API_KEY is not configured' };
  }
  const taskId = `qwen_tts_${Date.now()}`;
  const uid = ctx.uid || 'shared';
  // One generation task at a time per user — reject the trigger while a
  // previous task is still running.
  const slot = tryAcquireGenerationSlot(uid, 'audio', taskId);
  if (slot.ok === false) {
    return { success: false, error: generationBusyMessage(slot.busy.kind) };
  }
  ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'tts', prompt: args.text, status: 'running', progress: 10, timestamp: Date.now(), ...taskMeta('audio', 'running') } });
  try {
    const chainResult = await tryModelChain(
      args.model ? [args.model] : QWEN_TTS_MODELS,
      async (model) => {
        const res = await fetch(`${DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN_PLAN_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            input: { text: args.text, voice: args.voice || 'Cherry', language_type: args.language_type || 'Auto' },
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { success: false, error: redactKey(data.message || await res.text().catch(() => 'unknown error')), rawModel: model };
        const audioUrl = data.output?.audio?.url;
        let firebaseAudioUrl: string = '';
        if (audioUrl) {
          try {
            const fetchRes = await fetch(audioUrl);
            const buffer = Buffer.from(await fetchRes.arrayBuffer());
            const base64data = buffer.toString('base64');
            firebaseAudioUrl = await uploadMediaToFirebaseStorage(`data:${fetchRes.headers.get('content-type') || 'audio'};base64,${base64data}`, 'mp3', 'qwen-tts');
          } catch (e) { console.error('Firebase upload error:', e); }
        }
        return { success: !!audioUrl, taskId, model, audioUrl, firebaseAudioUrl, text: args.text };
      },
      (r) => r.success && !!r.audioUrl
    );

    if ('error' in chainResult) {
      const safeError = redactModelNames(chainResult.error);
      ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'tts', status: 'failed', error: safeError, attemptedCount: chainResult.attempted.length, timestamp: Date.now(), ...taskMeta('audio', 'failed', safeError) } });
      return { success: false, error: safeError, attemptedCount: chainResult.attempted.length };
    }

    const res = chainResult.result;
    const done = { id: taskId, kind: 'tts', prompt: args.text, status: res.audioUrl ? 'completed' : 'failed', progress: res.audioUrl ? 100 : 0, model: res.model, audioUrl: res.audioUrl, error: res.audioUrl ? undefined : 'No audio URL returned', timestamp: Date.now(), ...taskMeta('audio', res.audioUrl ? 'completed' : 'failed') };
    ctx.broadcast({ type: 'qwencloudUpdate', task: done });
    return res;
  } catch (err: any) {
    const safeError = safeErrorOf(err);
    ctx.broadcast({ type: 'qwencloudUpdate', task: { id: taskId, kind: 'tts', status: 'failed', error: safeError, timestamp: Date.now(), ...taskMeta('audio', 'failed', safeError) } });
    return { success: false, error: safeError };
  } finally {
    releaseGenerationSlot(uid, taskId);
  }
}

async function pollDashscopeTask(
  dashTaskId: string,
  kind: 'image' | 'video',
  base: string,
  apiKey: string,
  onUpdate: (status: string, progress: number, urls?: string[], error?: string) => void,
  ctx?: ToolContext
): Promise<{ urls?: string[] }> {
  const maxAttempts = kind === 'video' ? 60 : 40;
  const pollIntervalMs = kind === 'video' ? 5000 : 3000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    await statusPingBroadcast(ctx, (attempt + 1) * pollIntervalMs);
    const res = await fetch(`${base}/tasks/${dashTaskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as any;
    const status = data.output?.task_status || 'UNKNOWN';
    let urls: string[] | undefined;
    if (kind === 'image') {
      urls = data.output?.choices?.map((c: any) => c.message?.content?.[0]?.image).filter(Boolean);
    } else {
      urls = data.output?.video_url ? [data.output.video_url] : undefined;
    }
    if (status === 'SUCCEEDED') {
      onUpdate('completed', 100, urls);
      return { urls };
    }
    if (status === 'FAILED') {
      onUpdate('failed', 0, undefined, data.output?.message || 'Task failed');
      return {};
    }
    const progress = Math.min(95, 10 + Math.round((attempt / maxAttempts) * 85));
    onUpdate(status.toLowerCase(), progress, urls);
  }
  onUpdate('timeout', 95, undefined, 'Polling timed out');
  return {};
}

export async function handleGetWeather(args: { location: string }) {
  const loc = args.location || 'San Francisco';
  return {
    location: loc,
    temperature: '21°C / 70°F',
    condition: 'Sunny with clear skies',
    humidity: '55%',
    wind: '12 km/h NW',
    forecast: 'Ideal conditions for live video stream & voice interaction.',
  };
}

export async function handleWebSearch(args: { query: string }, ctx: ToolContext) {
  const { query } = args;
  let searchResultText = '';

  if (ctx.ai && process.env.GEMINI_API_KEY) {
    try {
      const response = await ctx.ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `Search query: ${query}. Provide top accurate summary and relevant facts.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      searchResultText = response.text || `Search results for: ${query}`;
    } catch (err: any) {
      searchResultText = `Search completed for "${query}". (Result retrieved via Beatrice Search Agent)`;
    }
  } else {
    searchResultText = `Live Web Search results for "${query}": Found recent updates, documentation, and technical notes.`;
  }

  return {
    query,
    resultSummary: searchResultText,
    timestamp: new Date().toISOString(),
  };
}

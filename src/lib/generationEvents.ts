// Normalizes every server WS event that reports long-running work into a
// uniform TaskPatch the generation-task store can apply. One source of truth
// for backend -> frontend status mapping.

import type { GenerationTaskStatus, GenerationTaskType } from '../types/generation';

export interface TaskPatch {
  id: string;
  type: GenerationTaskType;
  status: GenerationTaskStatus;
  title?: string;
  stage?: string;
  message?: string;
  progress?: number;
  provider?: string;
  model?: string;
  previewUrl?: string;
  outputUrl?: string;
  audioUrl?: string;
  error?: string;
  /** Appended to the task's rolling log (capped by the store). */
  logLine?: string;
  /** Full rolling log for code/sandbox/cli tasks (set by the store, not the patch). */
  logs?: string[];
  relatedSessionId?: string;
  raw?: Record<string, unknown>;
}

// Backend status -> normalized lifecycle. Unknown backend statuses degrade to
// 'running' rather than disappearing (frontend never guesses fake progress).
const STATUS_MAP: Record<string, GenerationTaskStatus> = {
  submitting: 'initializing',
  starting: 'initializing',
  started: 'initializing',
  queued: 'queued',
  pending: 'queued',
  running: 'running',
  thinking: 'running',
  executing: 'running',
  processing: 'processing',
  rendering: 'processing',
  generating: 'processing',
  uploading: 'finalizing',
  finalizing: 'finalizing',
  completed: 'completed',
  done: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
  timeout: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  idle: 'running',
};

const FALLBACK_ACTIVE_STATUS: GenerationTaskStatus = 'running';

export function mapStatus(status?: string, hasError?: boolean): GenerationTaskStatus {
  if (!status) return hasError ? 'failed' : FALLBACK_ACTIVE_STATUS;
  return STATUS_MAP[status] ?? (hasError ? 'failed' : FALLBACK_ACTIVE_STATUS);
}

const VIDEO_STAGE_FALLBACK: Record<string, string> = {
  queued: 'Waiting in queue',
  running: 'Generating video…',
  processing: 'Rendering frames…',
  finalizing: 'Uploading…',
  completed: 'Video ready',
  failed: 'Video generation failed',
  cancelled: 'Video generation cancelled',
};

const IMAGE_STAGE_FALLBACK: Record<string, string> = {
  queued: 'Waiting in queue',
  running: 'Drawing image…',
  processing: 'Refining image…',
  finalizing: 'Uploading…',
  completed: 'Image ready',
  failed: 'Image generation failed',
  cancelled: 'Image generation cancelled',
};

function stageFallback(status: GenerationTaskStatus, kind: 'video' | 'image'): string | undefined {
  if (kind === 'video') return VIDEO_STAGE_FALLBACK[status];
  return IMAGE_STAGE_FALLBACK[status];
}

function normalizeVideoUpdate(msg: any): TaskPatch {
  const t = msg.task || {};
  const status = mapStatus(t.status, t.error);
  return {
    id: String(t.id ?? `video_${t.timestamp ?? Date.now()}`),
    type: 'video',
    status,
    title: 'Generating Video',
    stage: t.stage || stageFallback(status, 'video'),
    message: t.message || (t.error ? t.error : undefined) || (typeof t.prompt === 'string' && t.prompt.length <= 200 ? t.prompt : undefined),
    progress: typeof t.progress === 'number' ? t.progress : undefined,
    provider: t.dashTaskId ? 'DashScope' : 'QwenCloud',
    model: t.model,
    previewUrl: t.videoUrl || t.downloadUrl || undefined,
    outputUrl: t.downloadUrl || t.videoUrl || undefined,
    error: t.error,
    raw: { ...t },
  };
}

const QWEN_KIND_META: Record<string, { type: GenerationTaskType; title: string }> = {
  image: { type: 'image', title: 'Generating Image' },
  imageEdit: { type: 'image', title: 'Editing Image' },
  video: { type: 'video', title: 'Generating Video' },
  tts: { type: 'audio', title: 'Generating Speech' },
  chat: { type: 'other', title: 'Qwen Chat' },
};

function normalizeQwenUpdate(msg: any): TaskPatch {
  const t = msg.task || {};
  const status = mapStatus(t.status, t.error);
  const kind = t.kind === 'imageEdit' ? 'image' : (QWEN_KIND_META[t.kind]?.type ?? 'other');
  const meta = QWEN_KIND_META[t.kind] ?? QWEN_KIND_META.image;
  const imageLike = kind === 'image';
  const url = t.firebaseUrls?.[0] || t.urls?.[0];
  return {
    id: String(t.id ?? `qwen_${t.timestamp ?? Date.now()}`),
    type: kind,
    status,
    title: meta.title,
    stage: t.stage || stageFallback(status, kind === 'video' ? 'video' : 'image'),
    message: t.message || (t.error ? t.error : undefined) || (typeof t.prompt === 'string' && t.prompt.length <= 200 ? t.prompt : undefined),
    progress: typeof t.progress === 'number' ? t.progress : undefined,
    provider: 'QwenCloud',
    model: t.model,
    previewUrl: imageLike ? url : t.videoUrl || url,
    outputUrl: imageLike ? url : t.videoUrl || url,
    audioUrl: t.audioUrl,
    error: t.error,
    raw: { ...t },
  };
}

const AGENT_STAGE_FALLBACK: Record<string, string> = {
  starting: 'Initializing agent',
  running: 'Working on the task',
  processing: 'Working on the task',
  completed: 'Agent finished',
  failed: 'Agent failed',
  cancelled: 'Agent cancelled',
};

function normalizeCodingAgentUpdate(msg: any): TaskPatch {
  const s = msg.session || {};
  const status = mapStatus(s.status, s.error);
  return {
    id: String(s.id ?? `agent_${s.timestamp ?? Date.now()}`),
    type: 'code',
    status,
    title: 'Coding Agent',
    stage: s.stage || AGENT_STAGE_FALLBACK[s.status] || s.status,
    message: s.message || (s.error ? s.error : undefined) || (typeof s.task === 'string' && s.task.length <= 200 ? s.task : undefined),
    provider: 'OpenCode CLI',
    model: s.model,
    error: s.error,
    logs: Array.isArray(s.log) ? s.log.slice(-80) : undefined,
    relatedSessionId: s.id,
    raw: { ...s },
  };
}

function normalizeCodingAgentStream(msg: any): TaskPatch {
  const status = mapStatus(msg.status || (msg.done ? (msg.error ? 'failed' : 'completed') : 'running'), msg.error);
  return {
    id: String(msg.sessionId ?? `agent_${msg.timestamp ?? Date.now()}`),
    type: 'code',
    status,
    title: 'Coding Agent',
    stage: msg.stage || AGENT_STAGE_FALLBACK[msg.status] || (msg.done ? 'Agent finished' : 'Working on the task'),
    message: msg.message || (msg.error ? msg.error : undefined),
    provider: 'OpenCode CLI',
    error: msg.error,
    logLine: typeof msg.chunk === 'string' ? msg.chunk : undefined,
    relatedSessionId: msg.sessionId,
    raw: { ...msg },
  };
}

function normalizeSandboxRun(r: any, kind: 'sandbox' | 'cli'): TaskPatch {
  const status = mapStatus(r.status, r.error || (kind === 'cli' ? r.exitCode > 0 : false));
  const running = status === 'running';
  return {
    id: String(r.id),
    type: kind,
    status,
    title: kind === 'sandbox' ? 'Sandbox Execution' : 'CLI Command',
    stage: running ? (kind === 'sandbox' ? 'Executing code…' : 'Running command…') : status === 'completed' ? 'Finished' : 'Failed',
    message: running ? (kind === 'sandbox' ? r.language : r.command) : (r.error || (typeof r.output === 'string' && r.output.trim().slice(0, 200))),
    provider: 'Isolated Sandbox',
    model: kind === 'sandbox' ? r.language : undefined,
    error: r.error,
    previewUrl: r.previewUrl,
    relatedSessionId: String(r.id),
    raw: { ...r },
  };
}

function normalizeSandboxOutput(msg: any): TaskPatch | null {
  if (!msg.run) return null;
  return normalizeSandboxRun(msg.run, 'sandbox');
}

function normalizeCliOutput(msg: any): TaskPatch | null {
  if (!msg.run) return null;
  return normalizeSandboxRun(msg.run, 'cli');
}

function normalizeSandboxStream(msg: any): TaskPatch {
  const status = mapStatus(msg.done ? (msg.error ? 'failed' : 'completed') : 'running', msg.error);
  return {
    id: String(msg.runId ?? `sandbox_${msg.timestamp ?? Date.now()}`),
    type: 'sandbox',
    status,
    title: 'Sandbox Execution',
    stage: status === 'completed' ? 'Finished' : status === 'failed' ? 'Failed' : 'Executing code…',
    error: msg.error,
    logLine: typeof msg.chunk === 'string' ? msg.chunk : undefined,
    previewUrl: msg.previewUrl,
    relatedSessionId: msg.runId,
    raw: { ...msg },
  };
}

function normalizeCliStream(msg: any): TaskPatch {
  const status = mapStatus(msg.done ? (msg.error || msg.exitCode > 0 ? 'failed' : 'completed') : 'running', msg.error || msg.exitCode > 0);
  return {
    id: String(msg.sessionId ?? `cli_${msg.timestamp ?? Date.now()}`),
    type: 'cli',
    status,
    title: 'CLI Command',
    stage: status === 'completed' ? 'Finished' : status === 'failed' ? 'Failed' : 'Running command…',
    error: msg.error,
    logLine: typeof msg.chunk === 'string' ? msg.chunk : undefined,
    relatedSessionId: msg.sessionId,
    raw: { ...msg },
  };
}

const BROWSER_EVENT_LABELS: Record<string, string> = {
  sessionStarted: 'Starting browser…',
  navigated: 'Navigating to page',
  clicked: 'Clicking element',
  typed: 'Typing text',
  scrolled: 'Scrolling',
  pageText: 'Reading page content',
  console: 'Console output',
  error: 'Browser error',
  sessionClosed: 'Browser session closed',
};

const COMPUTER_EVENT_LABELS: Record<string, string> = {
  sessionStarted: 'Starting computer control…',
  shellStart: 'Opening shell',
  shellOutput: 'Running command',
  shellError: 'Command failed',
  appList: 'Reading applications',
  mouseMove: 'Moving mouse',
  mouseClick: 'Clicking',
  keyPress: 'Pressing key',
  typeText: 'Typing text',
  appOpened: 'Opening app',
  error: 'Computer control error',
  sessionClosed: 'Session closed',
};

function normalizeAutoSession(msg: any, kind: 'browser' | 'computer'): TaskPatch | null {
  const s = msg.sessionId;
  if (!s) return null;
  const event = typeof msg.event === 'string' ? msg.event : 'running';
  const labels = kind === 'browser' ? BROWSER_EVENT_LABELS : COMPUTER_EVENT_LABELS;
  const status: GenerationTaskStatus =
    event === 'error' ? 'failed' : msg.done ? 'completed' : event === 'sessionClosed' ? 'completed' : 'running';
  const detail =
    msg.url || msg.text || msg.title || msg.cwd || msg.command || msg.app || msg.selector || msg.key || undefined;
  return {
    id: String(s),
    type: kind,
    status,
    title: kind === 'browser' ? 'Browser Automation' : 'Computer Control',
    stage: labels[event] || event,
    message: status === 'running' ? (detail ? String(detail).slice(0, 160) : undefined) : msg.error,
    error: msg.error,
    previewUrl: msg.screenshot ? undefined : undefined, // screenshots are base64 blobs; never persisted/displayed here
    relatedSessionId: String(s),
    raw: { ...msg },
  };
}

const AGENT_EVENTS: Record<string, { status: GenerationTaskStatus; stage: string }> = {
  thinking: { status: 'running', stage: 'Thinking…' },
  executing: { status: 'running', stage: 'Executing steps…' },
  completed: { status: 'completed', stage: 'Sub-agent finished' },
  failed: { status: 'failed', stage: 'Sub-agent failed' },
  error: { status: 'failed', stage: 'Sub-agent failed' },
};

function normalizeAgentUpdate(msg: any): TaskPatch | null {
  const a = msg.agent || {};
  const ev = a.status || a.event;
  const meta = AGENT_EVENTS[ev];
  if (!meta) return null;
  return {
    id: String(a.id ?? `agent_${a.timestamp ?? Date.now()}`),
    type: 'code',
    status: meta.status,
    title: `Sub-Agent · ${a.agentName || a.agent || 'Task'}`,
    stage: meta.stage,
    message: typeof a.task === 'string' && a.task.length <= 200 ? a.task : undefined,
    progress: typeof a.progress === 'number' ? a.progress : undefined,
    error: a.error,
    logs: Array.isArray(a.logs) ? a.logs.slice(-80) : undefined,
    raw: { ...a },
  };
}

function normalizeSkillExecutionUpdate(msg: any): TaskPatch {
  const status = mapStatus(msg.status, !!msg.error);
  return {
    id: String(msg.executionId || `skill_${msg.startedAt ?? Date.now()}`),
    type: 'skill', // Skill execution tasks
    status,
    title: msg.skillName || msg.skillId || 'Skill Execution',
    stage: msg.currentStepTool
      ? `Running ${msg.currentStepTool}…`
      : msg.status === 'completed'
        ? 'Skill completed'
        : msg.status === 'failed'
          ? 'Skill failed'
          : undefined,
    message: msg.error || undefined,
    progress: typeof msg.progress === 'number' ? msg.progress : undefined,
    error: msg.error,
    raw: {
      skillId: msg.skillId,
      domain: msg.domain,
      currentStep: msg.currentStep,
      currentStepTool: msg.currentStepTool,
    },
  };
}

export function normalizeWsMessage(msg: any): TaskPatch | null {
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.type) {
    case 'videoGenerationUpdate':
      return normalizeVideoUpdate(msg);
    case 'qwencloudUpdate':
      return normalizeQwenUpdate(msg);
    case 'codingAgentUpdate':
      return normalizeCodingAgentUpdate(msg);
    case 'codingAgentStream':
      return normalizeCodingAgentStream(msg);
    case 'sandboxOutput':
      return normalizeSandboxOutput(msg);
    case 'cliOutput':
      return normalizeCliOutput(msg);
    case 'sandboxStream':
      return normalizeSandboxStream(msg);
    case 'cliStream':
      return normalizeCliStream(msg);
    case 'browserUpdate':
      return normalizeAutoSession(msg, 'browser');
    case 'computerUpdate':
      return normalizeAutoSession(msg, 'computer');
    case 'agentUpdate':
      return normalizeAgentUpdate(msg);
    case 'skillExecutionUpdate':
      return normalizeSkillExecutionUpdate(msg);
    default:
      return null;
  }
}

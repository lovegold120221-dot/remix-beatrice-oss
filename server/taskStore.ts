/**
 * Per-user generation task store.
 *
 * Every long-running generation (video/image/audio/code/sandbox/cli/…) is
 * persisted here as a task keyed by the authenticated user's uid — the uid
 * ALWAYS comes from the verified Firebase session server-side, never from the
 * client. Tasks survive client refresh/close and are restored via REST.
 *
 * Persistence is dual-path: an in-memory Map (fast, always works) plus
 * Firebase RTDB at `tasks/{uidKey}/{taskId}` (server-only path in
 * database.rules.json; firebase-admin bypasses rules). RTDB writes are
 * debounced per task so log-heavy streams don't hammer the database.
 */

import fs from 'fs';

export type TaskType =
  | 'video'
  | 'image'
  | 'audio'
  | 'code'
  | 'sandbox'
  | 'cli'
  | 'browser'
  | 'computer'
  | 'skill'
  | 'other';

/** Stored statuses are normalized to this canonical set. */
export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  userId: string;
  type: TaskType;
  /** Provider (e.g. "DashScope", "QwenCloud", "OpenCode CLI"). */
  provider?: string;
  /** Model id (e.g. "happyhorse-1.1-t2v"). */
  model?: string;
  prompt?: string;
  status: TaskStatus;
  /** Machine-readable stage label (e.g. "Rendering frames…"). */
  stage?: string;
  progress?: number;
  /** Final artifact URL when completed (Firebase Storage download link). */
  output?: string;
  /** Preview URL while running (may be transient). */
  previewUrl?: string;
  error?: string;
  /** Capped activity log for code/sandbox/cli tasks. */
  logs?: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type TaskInput = Partial<Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'completedAt'>> & {
  /** Optional explicit task id (defaults to `task_<ts>_<rand>`). */
  id?: string;
};

// Backend status -> canonical stored status. Unknown statuses degrade to
// 'processing' (never drop a running task) or 'failed' when an error is set.
const STATUS_MAP: Record<string, TaskStatus> = {
  queued: 'queued',
  pending: 'queued',
  submitting: 'queued',
  starting: 'queued',
  started: 'queued',
  initializing: 'queued',
  idle: 'queued',
  running: 'processing',
  thinking: 'processing',
  executing: 'processing',
  processing: 'processing',
  rendering: 'processing',
  generating: 'processing',
  uploading: 'processing',
  finalizing: 'processing',
  completed: 'completed',
  done: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
  timeout: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function normalizeStatus(status?: string, hasError?: boolean): TaskStatus {
  if (!status) return hasError ? 'failed' : 'processing';
  return STATUS_MAP[status] ?? (hasError ? 'failed' : 'processing');
}

export function sanitizeUid(uid: string | null | undefined): string {
  return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const memory = new Map<string, Map<string, Task>>();
const persistTimers = new Map<string, NodeJS.Timeout>();

let fbDb: any = null;
let rtdbInitFailed = false;

const RTDB_URL =
  process.env.FIREBASE_RTDB_URL ||
  'https://beatrice-os-default-rtdb.europe-west1.firebasedatabase.app';

export async function initTaskStore(): Promise<void> {
  if (fbDb || rtdbInitFailed) return;
  const saPath =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '/opt/beatrice-services/beatrice-os-service-account.json';
  if (!fs.existsSync(saPath)) {
    rtdbInitFailed = true;
    return;
  }
  try {
    const appMod: any = await import('firebase-admin/app');
    const dbMod: any = await import('firebase-admin/database');
    if (!appMod.getApps?.().length) {
      appMod.initializeApp({ credential: appMod.cert(saPath), databaseURL: RTDB_URL });
    }
    fbDb = dbMod.getDatabase();
  } catch (err: any) {
    rtdbInitFailed = true;
    console.error('[TaskStore] RTDB init failed (in-memory only):', err?.message || err);
  }
}

function userMap(uidKey: string): Map<string, Task> {
  let m = memory.get(uidKey);
  if (!m) {
    m = new Map();
    memory.set(uidKey, m);
  }
  return m;
}

async function readFromRtdb(uidKey: string): Promise<Map<string, Task> | null> {
  if (!fbDb) return null;
  try {
    const snap = await fbDb.ref(`tasks/${uidKey}`).orderByChild('createdAt').limitToLast(100).once('value');
    const val = snap.val();
    if (!val || typeof val !== 'object') return null;
    const m = new Map<string, Task>();
    for (const [id, t] of Object.entries(val)) {
      if (t && typeof t === 'object') m.set(id, t as Task);
    }
    return m;
  } catch (err: any) {
    console.error('[TaskStore] RTDB read failed:', err?.message || err);
    return null;
  }
}

async function writeToRtdb(uidKey: string, task: Task): Promise<void> {
  if (!fbDb) return;
  try {
    await fbDb.ref(`tasks/${uidKey}/${task.id}`).set(JSON.parse(JSON.stringify(task)));
  } catch (err: any) {
    console.error('[TaskStore] RTDB write failed:', err?.message || err);
  }
}

/** Debounce RTDB writes per task (status/url changes matter; log lines don't). */
function schedulePersist(uidKey: string, task: Task, force = false): void {
  const key = `${uidKey}/${task.id}`;
  if (force && persistTimers.has(key)) {
    clearTimeout(persistTimers.get(key)!);
    persistTimers.delete(key);
    void writeToRtdb(uidKey, task);
    return;
  }
  if (persistTimers.has(key)) return;
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      void writeToRtdb(uidKey, task);
    }, force ? 0 : 1200)
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a task for a user. uid must come from the verified session. */
export async function createTask(uid: string | null | undefined, input: TaskInput): Promise<Task | null> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey) return null;
  const now = Date.now();
  const task: Task = {
    id: input.id || `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    userId: uidKey,
    type: input.type || 'other',
    provider: input.provider,
    model: input.model,
    prompt: typeof input.prompt === 'string' ? input.prompt.slice(0, 4000) : undefined,
    status: normalizeStatus(input.status),
    stage: input.stage,
    progress: typeof input.progress === 'number' ? Math.min(100, Math.max(0, input.progress)) : undefined,
    output: input.output,
    previewUrl: input.previewUrl,
    error: input.error,
    logs: input.logs,
    createdAt: now,
    updatedAt: now,
  };
  userMap(uidKey).set(task.id, task);
  schedulePersist(uidKey, task, true);
  return task;
}

/** Update a task for a user. Returns the updated task or null when missing. */
export async function updateTask(
  uid: string | null | undefined,
  taskId: string,
  patch: TaskInput
): Promise<Task | null> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey || !taskId) return null;
  const map = userMap(uidKey);
  const existing = map.get(taskId) || (await readFromRtdb(uidKey))?.get(taskId);
  if (!existing) return null;
  const now = Date.now();
  const next: Task = {
    ...existing,
    ...patch,
    id: existing.id,
    userId: existing.userId,
    type: patch.type || existing.type,
    status: normalizeStatus(patch.status, !!patch.error || !!existing.error),
    progress: typeof patch.progress === 'number' ? Math.min(100, Math.max(0, patch.progress)) : existing.progress,
    prompt: typeof patch.prompt === 'string' ? patch.prompt.slice(0, 4000) : existing.prompt,
    updatedAt: now,
  };
  const status = next.status;
  const wasTerminal = ['completed', 'failed', 'cancelled'].includes(existing.status);
  if (!wasTerminal && (status === 'completed' || status === 'failed' || status === 'cancelled')) {
    next.completedAt = now;
  }
  map.set(next.id, next);
  const force = status !== 'processing' || !!patch.output || !!patch.error;
  schedulePersist(uidKey, next, force);
  return next;
}

export async function getTask(uid: string | null | undefined, taskId: string): Promise<Task | null> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey || !taskId) return null;
  const fromMemory = userMap(uidKey).get(taskId);
  if (fromMemory) return fromMemory;
  return (await readFromRtdb(uidKey))?.get(taskId) || null;
}

/** List a user's tasks, newest first. */
export async function listTasks(uid: string | null | undefined, limit = 100): Promise<Task[]> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey) return [];
  const merged = new Map(userMap(uidKey));
  const fromRtdb = await readFromRtdb(uidKey);
  if (fromRtdb) {
    for (const [id, t] of fromRtdb) {
      if (!merged.has(id)) merged.set(id, t);
    }
  }
  return [...merged.values()]
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, limit);
}

export async function deleteTask(uid: string | null | undefined, taskId: string): Promise<boolean> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey || !taskId) return false;
  userMap(uidKey).delete(taskId);
  if (fbDb) {
    try {
      await fbDb.ref(`tasks/${uidKey}/${taskId}`).remove();
    } catch (err: any) {
      console.error('[TaskStore] RTDB delete failed:', err?.message || err);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Broadcast → task upsert (single choke point)
// ---------------------------------------------------------------------------

const QWEN_KIND_TYPE: Record<string, TaskType> = {
  image: 'image',
  imageEdit: 'image',
  video: 'video',
  tts: 'audio',
  chat: 'other',
};

interface BroadcastTaskShape {
  id?: string;
  status?: string;
  type?: string;
  kind?: string;
  model?: string;
  prompt?: string;
  text?: string;
  error?: string;
  progress?: number;
  stage?: string;
  dashTaskId?: string;
  videoUrl?: string;
  downloadUrl?: string;
  url?: string;
  urls?: string[];
  firebaseUrls?: string[];
  audioUrl?: string;
  timestamp?: number;
}

/** Extract a canonical task from any WS generation broadcast. */
export function taskFromBroadcast(msg: any): { id: string; patch: TaskInput } | null {
  if (!msg || typeof msg !== 'object') return null;

  switch (msg.type) {
    case 'videoGenerationUpdate': {
      const t: BroadcastTaskShape = msg.task || {};
      if (!t.id) return null;
      const output = t.downloadUrl || t.videoUrl || undefined;
      return {
        id: String(t.id),
        patch: {
          type: 'video',
          provider: t.dashTaskId ? 'DashScope' : 'QwenCloud',
          model: t.model,
          prompt: t.prompt,
          status: normalizeStatus(t.status),
          stage: t.stage,
          progress: t.progress,
          output,
          previewUrl: output,
          error: t.error,
        },
      };
    }
    case 'qwencloudUpdate': {
      const t: BroadcastTaskShape = msg.task || {};
      if (!t.id) return null;
      const kind = t.kind || 'chat';
      const url = t.firebaseUrls?.[0] || t.urls?.[0] || t.videoUrl || t.downloadUrl || undefined;
      const type = QWEN_KIND_TYPE[kind] || 'other';
      return {
        id: String(t.id),
        patch: {
          type,
          provider: 'QwenCloud',
          model: t.model,
          prompt: t.prompt || t.text,
          status: normalizeStatus(t.status),
          stage: t.stage,
          progress: t.progress,
          output: type === 'audio' ? t.audioUrl || url : url,
          previewUrl: type === 'audio' ? undefined : url,
          error: t.error,
        },
      };
    }
    case 'codingAgentUpdate': {
      const s: any = msg.session || {};
      if (!s.id) return null;
      return {
        id: String(s.id),
        patch: {
          type: 'code',
          provider: 'OpenCode CLI',
          model: s.model,
          prompt: typeof s.task === 'string' ? s.task : undefined,
          status: s.status,
          stage: s.stage,
          error: s.error,
          logs: Array.isArray(s.log) ? s.log.slice(-80) : undefined,
        },
      };
    }
    case 'codingAgentStream': {
      if (!msg.sessionId) return null;
      const status = msg.done ? (msg.error ? 'failed' : 'completed') : msg.status || 'running';
      return {
        id: String(msg.sessionId),
        patch: {
          type: 'code',
          provider: 'OpenCode CLI',
          status,
          stage: msg.stage,
          error: msg.error,
        },
      };
    }
    case 'sandboxOutput': {
      const r: any = msg.run || {};
      if (!r.id) return null;
      return {
        id: String(r.id),
        patch: {
          type: 'sandbox',
          provider: 'Isolated Sandbox',
          model: r.language,
          prompt: typeof r.code === 'string' ? r.code.slice(0, 4000) : undefined,
          status: r.status,
          error: r.error,
          previewUrl: r.previewUrl,
          output: typeof r.output === 'string' ? r.output.slice(-2000) : undefined,
        },
      };
    }
    case 'cliOutput': {
      const r: any = msg.run || {};
      if (!r.id) return null;
      return {
        id: String(r.id),
        patch: {
          type: 'cli',
          provider: 'CLI Service',
          prompt: typeof r.command === 'string' ? r.command.slice(0, 1000) : undefined,
          status: r.status || (r.error ? 'failed' : r.exitCode > 0 ? 'failed' : 'completed'),
          error: r.error,
          output: typeof r.output === 'string' ? r.output.slice(-2000) : undefined,
        },
      };
    }
    case 'sandboxStream': {
      if (!msg.runId) return null;
      const status = msg.done ? (msg.error ? 'failed' : 'completed') : 'running';
      return {
        id: String(msg.runId),
        patch: {
          type: 'sandbox',
          provider: 'Isolated Sandbox',
          status: normalizeStatus(status),
          error: msg.error,
          previewUrl: msg.previewUrl,
        },
      };
    }
    case 'cliStream': {
      if (!msg.sessionId) return null;
      const status = msg.done ? (msg.error || msg.exitCode > 0 ? 'failed' : 'completed') : 'running';
      return {
        id: String(msg.sessionId),
        patch: {
          type: 'cli',
          provider: 'CLI Service',
          status: normalizeStatus(status),
          error: msg.error,
        },
      };
    }
    case 'skillExecutionUpdate': {
      if (!msg.executionId) return null;
      return {
        id: String(msg.executionId),
        patch: {
          type: 'skill',
          provider: 'Skill Router',
          prompt: typeof msg.skillName === 'string' ? msg.skillName : msg.skillId,
          status: msg.status,
          stage: msg.currentStepTool ? `Running ${msg.currentStepTool}…` : undefined,
          progress: msg.progress,
          error: msg.error,
        },
      };
    }
    default:
      return null;
  }
}

/** Upsert a task from a WS broadcast for the given (server-verified) uid. */
export async function upsertTaskFromBroadcast(
  uid: string | null | undefined,
  msg: unknown
): Promise<void> {
  const uidKey = sanitizeUid(uid);
  if (!uidKey) return;
  const parsed = taskFromBroadcast(msg);
  if (!parsed) return;
  const { id, patch } = parsed;
  const existing = userMap(uidKey).get(id) || (await getTask(uidKey, id));
  if (existing) {
    await updateTask(uidKey, id, patch);
  } else {
    await createTask(uidKey, { id, ...patch });
  }
}
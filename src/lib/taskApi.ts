// REST client for the server-side task history API (/api/tasks).
// The userId is NEVER sent by the client — the server keys tasks by the
// verified Firebase session, so users can only ever see their own tasks.

import { auth } from './firebase';
import type { GenerationTask, GenerationTaskStatus, GenerationTaskType } from '../types/generation';

export interface ServerTask {
  id: string;
  userId: string;
  type: string;
  provider?: string;
  model?: string;
  prompt?: string;
  status: string;
  stage?: string;
  progress?: number;
  output?: string;
  previewUrl?: string;
  error?: string;
  logs?: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ServerTaskPatch {
  type?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  status?: string;
  stage?: string;
  progress?: number;
  output?: string;
  previewUrl?: string;
  error?: string;
}

// Server stored statuses are normalized to queued/processing/completed/
// failed/cancelled; widen to the frontend task status set for display.
const FRONTEND_STATUS: Record<string, GenerationTaskStatus> = {
  queued: 'queued',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const FRONTEND_TYPE: Record<string, GenerationTaskType> = {
  video: 'video',
  image: 'image',
  audio: 'audio',
  code: 'code',
  sandbox: 'sandbox',
  cli: 'cli',
  browser: 'browser',
  computer: 'computer',
  skill: 'skill',
  other: 'other',
};

export function serverTaskToGenerationTask(t: ServerTask): GenerationTask {
  const terminal = t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled';
  return {
    id: t.id,
    type: FRONTEND_TYPE[t.type] || 'other',
    title: TASK_TITLE[t.type] || 'Task',
    status: FRONTEND_STATUS[t.status] || (t.status ? 'processing' : 'queued'),
    stage: t.stage,
    message: t.error || t.prompt,
    progress: typeof t.progress === 'number' ? t.progress : undefined,
    provider: t.provider,
    model: t.model,
    prompt: t.prompt,
    startedAt: t.createdAt,
    completedAt: t.completedAt,
    lastUpdatedAt: t.updatedAt,
    previewUrl: t.previewUrl,
    outputUrl: t.output || t.previewUrl,
    error: t.error,
    logs: t.logs,
    stale: false,
  } as GenerationTask;
}

const TASK_TITLE: Record<string, string> = {
  video: 'Generating Video',
  image: 'Generating Image',
  audio: 'Generating Speech',
  code: 'Coding Agent',
  sandbox: 'Sandbox Execution',
  cli: 'CLI Command',
  browser: 'Browser Automation',
  computer: 'Computer Control',
  skill: 'Skill Execution',
  other: 'Task',
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch (err) {
    console.warn('Failed to fetch Firebase ID token for task API:', err);
  }
  return headers;
}

export async function fetchTasks(limit = 100): Promise<ServerTask[]> {
  try {
    const res = await fetch(`/api/tasks?limit=${limit}`, { headers: await authHeaders() });
    if (!res.ok) {
      console.warn('Task history fetch failed:', res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.tasks) ? (data.tasks as ServerTask[]) : [];
  } catch (err) {
    console.warn('Task history fetch error:', err);
    return [];
  }
}

export async function createTaskServer(patch: ServerTaskPatch): Promise<ServerTask | null> {
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.task || null;
  } catch (err) {
    console.warn('Task create error:', err);
    return null;
  }
}

export async function updateTaskServer(
  id: string,
  patch: ServerTaskPatch
): Promise<ServerTask | null> {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.task || null;
  } catch (err) {
    console.warn('Task update error:', err);
    return null;
  }
}

export async function deleteTaskServer(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.warn('Task delete error:', err);
    return false;
  }
}
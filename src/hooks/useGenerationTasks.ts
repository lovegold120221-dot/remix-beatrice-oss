import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GenerationTask,
  isTaskTerminal,
  isTaskActive,
} from '../types/generation';
import { normalizeWsMessage, TaskPatch } from '../lib/generationEvents';
import { fetchTasks, serverTaskToGenerationTask, deleteTaskServer } from '../lib/taskApi';
import type { ServerTask } from '../lib/taskApi';

const STORAGE_KEY = 'beatrice_generation_tasks_v1';
const STORAGE_MAX = 40;
const LOG_MAX = 80;
const LOG_THROTTLE_MS = 300;
const STALE_AFTER_MS = 60_000;

interface PersistedTask {
  id: string;
  type: GenerationTask['type'];
  title: string;
  status: GenerationTask['status'];
  stage?: string;
  message?: string;
  error?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  progress?: number;
  previewUrl?: string;
  outputUrl?: string;
  audioUrl?: string;
  startedAt: number;
  completedAt?: number;
  relatedSessionId?: string;
}

function toPersisted(t: GenerationTask): PersistedTask {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    status: t.status,
    stage: t.stage,
    message: t.message,
    error: t.error,
    provider: t.provider,
    model: t.model,
    prompt: t.prompt,
    progress: t.progress,
    previewUrl: t.previewUrl,
    outputUrl: t.outputUrl,
    audioUrl: t.audioUrl,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    relatedSessionId: t.relatedSessionId,
  };
}

function loadFromStorage(): GenerationTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: PersistedTask[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === 'string')
      .slice(0, STORAGE_MAX)
      .map((t) => ({
        ...t,
        lastUpdatedAt: t.completedAt || t.startedAt,
        // Tasks restored from disk have not received a live update since the
        // page was closed — mark active ones stale until the WS or the server
        // sync refreshes them.
        stale: isTaskActive(t as GenerationTask),
        logs: undefined,
        raw: undefined,
      }));
  } catch {
    return [];
  }
}

function saveToStorage(tasks: GenerationTask[]) {
  try {
    // Persist active tasks too so a refresh/restart keeps the running tasks
    // visible immediately (the server sync then refreshes their real status).
    const saved = tasks.slice(0, STORAGE_MAX).map(toPersisted);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage unavailable (private mode etc.) — persistence is best-effort
  }
}

export function useGenerationTasks() {
  const [tasks, setTasks] = useState<GenerationTask[]>(() =>
    typeof window === 'undefined' ? [] : loadFromStorage()
  );
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const lastLogAtRef = useRef<Record<string, number>>({});

  const applyPatch = useCallback((patch: TaskPatch) => {
    const now = Date.now();
    const isLogEvent = typeof patch.logLine === 'string' && patch.logLine.length > 0;
    const shouldThrottleLog =
      isLogEvent && now - (lastLogAtRef.current[patch.id] || 0) < LOG_THROTTLE_MS;

    if (isLogEvent && !shouldThrottleLog) {
      lastLogAtRef.current[patch.id] = now;
    }

    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === patch.id);
      const terminal = patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled';

      if (idx === -1) {
        // Throttled log-only events shouldn't create a task out of thin air
        // (e.g. stray chunks after a reconnect); only apply log lines when the
        // task already exists.
        if (shouldThrottleLog && !patch.title) {
          return prev;
        }
        const task: GenerationTask = {
          id: patch.id,
          type: patch.type,
          title: patch.title || patch.type,
          status: patch.status,
          stage: patch.stage,
          message: patch.message,
          progress: patch.progress,
          provider: patch.provider,
          model: patch.model,
          previewUrl: patch.previewUrl,
          outputUrl: patch.outputUrl,
          audioUrl: patch.audioUrl,
          error: patch.error,
          startedAt: now,
          completedAt: terminal ? now : undefined,
          lastUpdatedAt: now,
          logs: isLogEvent ? [patch.logLine!] : undefined,
          relatedSessionId: patch.relatedSessionId,
          raw: patch.raw,
        };
        const next = [task, ...prev];
        saveToStorage(next);
        return next;
      }

      const existing = prev[idx];
      const next: GenerationTask = { ...existing };

      // Never regress a terminal state (stale/out-of-order broadcasts).
      if (isTaskTerminal(existing) && !terminal) {
        // keep status/completedAt; still pick up URL/model/error refinements
      } else {
        next.status = patch.status;
        next.completedAt = terminal ? now : undefined;
      }
      if (patch.title) next.title = patch.title;
      if (patch.stage) next.stage = patch.stage;
      if (patch.message) next.message = patch.message;
      if (typeof patch.progress === 'number') next.progress = patch.progress;
      if (patch.provider) next.provider = patch.provider;
      if (patch.model) next.model = patch.model;
      if (patch.previewUrl) next.previewUrl = patch.previewUrl;
      if (patch.outputUrl) next.outputUrl = patch.outputUrl;
      if (patch.audioUrl) next.audioUrl = patch.audioUrl;
      if (patch.error) next.error = patch.error;
      if (patch.relatedSessionId) next.relatedSessionId = patch.relatedSessionId;
      if (patch.raw) next.raw = patch.raw;
      next.stale = false;
      next.lastUpdatedAt = now;

      if (isLogEvent) {
        const existingLogs = next.logs || [];
        if (!shouldThrottleLog) {
          const merged = existingLogs.concat(patch.logLine!).slice(-LOG_MAX);
          next.logs = merged;
        }
      }
      /* removed: patch.logs not in TaskPatch; log lines handled via logLine above */

      const nextArr = [...prev];
      nextArr[idx] = next;
      saveToStorage(nextArr);
      return nextArr;
    });
  }, []);

  const handleWsMessage = useCallback(
    (msg: unknown) => {
      const patch = normalizeWsMessage(msg);
      if (patch) applyPatch(patch);
    },
    [applyPatch]
  );

  /** Called on WS reconnect: mark active tasks stale if no update for 60s. */
  const handleSocketReconnected = useCallback(() => {
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) =>
        isTaskActive(t) && now - t.lastUpdatedAt > STALE_AFTER_MS ? { ...t, stale: true } : t
      )
    );
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveToStorage(next);
      return next;
    });
    // Also remove from the server-side task history (best-effort; the server
    // store is authoritative for the Task History page).
    void deleteTaskServer(id).catch(() => {
      // ignore — local dismissal stands even if the server delete fails
    });
  }, []);

  /**
   * Merge the server-side task history into the local store. Restores
   * unfinished (queued/processing) tasks after a refresh/restart and imports
   * tasks created by other sessions or the Gemini tool loop. Local entries
   * always win — realtime WS patches are fresher than persisted snapshots —
   * EXCEPT stale local tasks (no live update for a while, e.g. while the tab
   * was in the background), which are replaced by the authoritative server
   * snapshot so a generation that finished during the gap is not lost.
   */
  const syncFromServer = useCallback(async () => {
    let serverTasks: ServerTask[];
    try {
      serverTasks = await fetchTasks(200);
    } catch (err) {
      console.warn('Task server sync failed:', err);
      return;
    }
    if (!serverTasks.length) return;
    setTasks((prev) => {
      const byId = new Map<string, GenerationTask>(prev.map((t) => [t.id, t]));
      for (const st of serverTasks) {
        const existing = byId.get(st.id);
        if (existing && !existing.stale) continue;
        const gt = serverTaskToGenerationTask(st);
        byId.set(gt.id, gt);
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0)
      );
      saveToStorage(merged);
      return merged;
    });
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => {
      const next = prev.filter(isTaskActive);
      saveToStorage(next);
      return next;
    });
  }, []);

  const activeTasks = useMemo(() => tasks.filter(isTaskActive), [tasks]);
  const recentTasks = useMemo(() => tasks.filter(isTaskTerminal), [tasks]);
  const activeCount = activeTasks.length;

  return {
    tasks,
    activeTasks,
    recentTasks,
    activeCount,
    focusTaskId,
    setFocusTaskId,
    handleWsMessage,
    handleSocketReconnected,
    dismissTask,
    clearFinished,
    syncFromServer,
  };
}

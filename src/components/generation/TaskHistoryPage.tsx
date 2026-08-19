import { useEffect, useMemo, useState } from 'react';
import type { GenerationTask } from '../../types/generation';
import { GenerationTaskCard } from './GenerationTaskCard';
import { fetchTasks, ServerTask, serverTaskToGenerationTask } from '../../lib/taskApi';

interface TaskHistoryPageProps {
  onClose: () => void;
  onOpenViewport?: (task: GenerationTask) => void;
  onDismiss?: (id: string) => void;
  onCancel?: (task: GenerationTask) => void;
  download?: (url: string, filename: string) => void;
}

/**
 * Full task history for the signed-in user, served from the server-side task
 * store (persisted per-uid in RTDB). Unfinished tasks from previous sessions
 * are restored here — they reappear after refresh/restart.
 */
export function TaskHistoryPage({
  onClose,
  onOpenViewport,
  onDismiss,
  onCancel,
  download,
}: TaskHistoryPageProps) {
  const [serverTasks, setServerTasks] = useState<GenerationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'failed'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks: ServerTask[] = await fetchTasks(200);
        if (!cancelled) {
          setServerTasks(tasks.map(serverTaskToGenerationTask));
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load task history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const sorted = [...serverTasks].sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
    switch (filter) {
      case 'active':
        return sorted.filter((t) => t.status === 'queued' || t.status === 'processing');
      case 'done':
        return sorted.filter((t) => t.status === 'completed');
      case 'failed':
        return sorted.filter((t) => t.status === 'failed' || t.status === 'cancelled');
      default:
        return sorted;
    }
  }, [serverTasks, filter]);

  const counts = useMemo(
    () => ({
      all: serverTasks.length,
      active: serverTasks.filter((t) => t.status === 'queued' || t.status === 'processing').length,
      done: serverTasks.filter((t) => t.status === 'completed').length,
      failed: serverTasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length,
    }),
    [serverTasks]
  );

  const renderCard = (task: GenerationTask) => (
    <div key={task.id} className="rounded-2xl focus-within:outline-none">
      <GenerationTaskCard
        task={task}
        onOpenActivity={undefined}
        onOpenViewport={onOpenViewport}
        onDismiss={onDismiss}
        onCancel={onCancel}
        download={download}
        showTimestamps
      />
    </div>
  );

  const filterBtn = (key: typeof filter, label: string, count: number) => (
    <button
      type="button"
      key={key}
      onClick={() => setFilter(key)}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        filter === key
          ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30'
          : 'text-zinc-400 border border-white/10 hover:text-white hover:bg-white/5'
      }`}
    >
      {label} ({count})
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-6xl h-full max-h-[92vh] flex flex-col bg-[var(--beatrice-panel,#0a0a0c)] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-white">Task History</h2>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
              saved on server
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task history"
            className="w-9 h-9 rounded-xl grid place-items-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b border-white/10">
          {filterBtn('all', 'All', counts.all)}
          {filterBtn('active', 'Running', counts.active)}
          {filterBtn('done', 'Done', counts.done)}
          {filterBtn('failed', 'Failed', counts.failed)}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="h-full grid place-items-center">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="inline-block w-4 h-4 border-2 border-zinc-600 border-t-[#00f2fe] rounded-full animate-spin" />
                Loading task history…
              </div>
            </div>
          ) : error ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="text-2xl mb-2" aria-hidden="true">⚠️</div>
                <p className="text-sm text-zinc-400">{error}</p>
                <p className="text-xs text-zinc-600 mt-1">Try reloading the page.</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="text-3xl mb-3" aria-hidden="true">🗂️</div>
                <p className="text-sm text-zinc-400">
                  {serverTasks.length === 0 ? 'No tasks yet.' : 'Nothing matches this filter.'}
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  Every video, image, audio, coding-agent and shell task you run is saved here.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(renderCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
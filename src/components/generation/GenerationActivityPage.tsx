import { useEffect, useMemo, useRef } from 'react';
import type { GenerationTask } from '../../types/generation';
import { GenerationTaskCard } from './GenerationTaskCard';

interface GenerationActivityPageProps {
  tasks: GenerationTask[];
  activeTasks: GenerationTask[];
  recentTasks: GenerationTask[];
  focusTaskId: string | null;
  onClose: () => void;
  onOpenViewport?: (task: GenerationTask) => void;
  onDismiss?: (id: string) => void;
  onCancel?: (task: GenerationTask) => void;
  download?: (url: string, filename: string) => void;
}

export function GenerationActivityPage({
  tasks,
  activeTasks,
  recentTasks,
  focusTaskId,
  onClose,
  onOpenViewport,
  onDismiss,
  onCancel,
  download,
}: GenerationActivityPageProps) {
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const hasFocus = useMemo(
    () => !!focusTaskId && tasks.some((t) => t.id === focusTaskId),
    [focusTaskId, tasks]
  );

  useEffect(() => {
    if (!focusTaskId) return;
    const el = cardRefs.current.get(focusTaskId);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('focus-ring-pulse');
      const t = setTimeout(() => el.classList.remove('focus-ring-pulse'), 2000);
      return () => clearTimeout(t);
    }
  }, [focusTaskId, hasFocus]);

  const renderCard = (task: GenerationTask) => (
    <div
      key={task.id}
      ref={(el) => {
        cardRefs.current.set(task.id, el);
      }}
      className="rounded-2xl focus-within:outline-none"
    >
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-6xl h-full max-h-[92vh] flex flex-col bg-[var(--beatrice-panel,#0a0a0c)] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-white">Activity</h2>
            {activeTasks.length > 0 ? (
              <span
                role="status"
                aria-live="polite"
                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30"
              >
                {activeTasks.length} active
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity"
            className="w-9 h-9 rounded-xl grid place-items-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {tasks.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="text-3xl mb-3" aria-hidden="true">⚡</div>
                <p className="text-sm text-zinc-400">Nothing running right now.</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Video, image, coding-agent and shell tasks will show up here in real time.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activeTasks.map(renderCard)}
              {recentTasks.slice(0, 24).map(renderCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
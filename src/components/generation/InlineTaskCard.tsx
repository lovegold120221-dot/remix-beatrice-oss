import { GenerationTask, GenerationTaskStatus, isTaskActive } from '../../types/generation';
import { formatElapsed } from './GenerationProgress';

const TYPE_SMALL_ICONS: Record<GenerationTask['type'], string> = {
  video: '🎬',
  image: '🖼️',
  audio: '🔊',
  code: '🤖',
  sandbox: '💻',
  cli: '⌨️',
  browser: '🌐',
  computer: '🖥️',
  skill: '⚡',
  other: '⚙️',
};

export function InlineTaskCard({
  task,
  onOpenActivity,
  key,
}: { task: GenerationTask; onOpenActivity?: (id: string) => void; key?: string }) {
  const statusMeta = [
    { status: 'queued' as GenerationTaskStatus, dot: 'bg-amber-400', text: 'text-amber-300', label: 'Queued' },
    { status: 'initializing' as GenerationTaskStatus, dot: 'bg-sky-400', text: 'text-sky-300', label: 'Starting' },
    { status: 'running' as GenerationTaskStatus, dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Running' },
    { status: 'processing' as GenerationTaskStatus, dot: 'bg-cyan-400', text: 'text-cyan-300', label: 'Processing' },
    { status: 'finalizing' as GenerationTaskStatus, dot: 'bg-violet-400', text: 'text-violet-300', label: 'Finalizing' },
    { status: 'completed' as GenerationTaskStatus, dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Done' },
    { status: 'failed' as GenerationTaskStatus, dot: 'bg-rose-500', text: 'text-rose-300', label: 'Failed' },
    { status: 'cancelled' as GenerationTaskStatus, dot: 'bg-zinc-400', text: 'text-zinc-300', label: 'Cancelled' },
  ].find((s) => s.status === task.status) || { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Running' };

  const kindLabel = {
    video: 'Video',
    image: 'Image',
    audio: 'Speech',
    code: 'Code',
    sandbox: 'Sandbox',
    cli: 'CLI',
    browser: 'Browser',
    computer: 'Ctrl',
    other: 'Task',
  }[task.type] ?? 'Task';

  const elapsed = task.startedAt
    ? formatElapsed(task.startedAt)
    : undefined;

  const badge = statusMeta.dot
    ? `<span className="inline-block w-1.5 h-1.5 rounded-full ${statusMeta.dot} inline-block animate-pulse ${task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' ? '!animate-none' : ''}" aria-hidden="true"></span>`
    : '';

  return (
    <div
      className="flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1.5 text-xs transition-colors hover:bg-black/60 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => onOpenActivity?.(task.id)}
    >
      <span className="w-2.5 h-2.5 rounded-full {statusMeta.dot} shrink-0 flex-shrink-0" aria-hidden="true" />
      <span className="text-zinc-300 font-medium whitespace-nowrap">{kindLabel}</span>
      <span className="text-zinc-400 ml-2 line-clamp-1 flex-1 truncate max-w-xs">{task.title}</span>
      {task.startedAt && (
        <span className="text-zinc-500 tabular-nums ml-2">
          · {elapsed}
        </span>
      )}
    </div>
  );
}
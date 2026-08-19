import { useEffect, useState } from 'react';
import type { GenerationTask, GenerationTaskStatus } from '../../types/generation';
import { GenerationProgress, formatElapsed } from './GenerationProgress';

const STATUS_STYLES: Record<GenerationTaskStatus, { dot: string; text: string; label: string }> = {
  queued: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Queued' },
  initializing: { dot: 'bg-sky-400', text: 'text-sky-300', label: 'Starting' },
  running: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Running' },
  processing: { dot: 'bg-cyan-400', text: 'text-cyan-300', label: 'Processing' },
  finalizing: { dot: 'bg-violet-400', text: 'text-violet-300', label: 'Finalizing' },
  completed: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Completed' },
  failed: { dot: 'bg-rose-500', text: 'text-rose-300', label: 'Failed' },
  cancelled: { dot: 'bg-zinc-400', text: 'text-zinc-300', label: 'Cancelled' },
};

interface GenerationResultPreviewProps {
  task: GenerationTask;
  download?: (url: string, filename: string) => void;
}

/** Result preview for a finished task: image / video / audio / output text. */
export function GenerationResultPreview({ task, download }: GenerationResultPreviewProps) {
  const { previewUrl, outputUrl, audioUrl, type } = task;
  const [error, setError] = useState(false);

  useEffect(() => setError(false), [previewUrl, outputUrl, audioUrl]);

  const url = previewUrl || outputUrl || audioUrl;
  const ext = url ? (url.split('?')[0].split('.').pop() || '').toLowerCase() : '';

  if (type === 'audio' && audioUrl) {
    return (
      <div className="mt-3 animate-fade-in motion-reduce:animate-none">
        <audio controls src={audioUrl} className="w-full h-10" />
        {download ? (
          <button
            type="button"
            onClick={() => download(audioUrl, `beatrice-audio-${task.id}.${ext || 'm4a'}`)}
            className="mt-2 text-xs font-medium text-[#00f2fe] hover:text-white transition-colors"
          >
            Download audio
          </button>
        ) : null}
      </div>
    );
  }

  if ((type === 'video' || type === 'image') && url && !error) {
    if (type === 'video') {
      return (
        <div className="mt-3 animate-fade-in motion-reduce:animate-none">
          <video
            src={url}
            controls
            preload="metadata"
            className="w-full rounded-xl bg-black/40 aspect-video object-contain"
            onError={() => setError(true)}
          />
          {download ? (
            <button
              type="button"
              onClick={() => download(url, `beatrice-video-${task.id}.${ext || 'mp4'}`)}
              className="mt-2 text-xs font-medium text-[#00f2fe] hover:text-white transition-colors"
            >
              Download video
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="mt-3 animate-fade-in motion-reduce:animate-none">
        <img
          src={url}
          alt={task.title}
          loading="lazy"
          className="w-full rounded-xl bg-black/40 object-contain max-h-56"
          onError={() => setError(true)}
        />
        {download ? (
          <button
            type="button"
            onClick={() => download(url, `beatrice-image-${task.id}.${ext || 'png'}`)}
            className="mt-2 text-xs font-medium text-[#00f2fe] hover:text-white transition-colors"
          >
            Download image
          </button>
        ) : null}
      </div>
    );
  }

  const text = task.message || task.logs?.slice(-3).join('\n') || undefined;
  if (text) {
    return (
      <div className="mt-3 animate-fade-in motion-reduce:animate-none rounded-lg bg-black/30 border border-white/10 p-2.5">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300 max-h-36 overflow-y-auto">
          {text.length > 600 ? text.slice(-600) : text}
        </pre>
      </div>
    );
  }

  return null;
}

const TYPE_ICONS: Record<string, string> = {
  video: '🎬',
  image: '🖼️',
  audio: '🔊',
  code: '🤖',
  sandbox: '💻',
  cli: '⌨️',
  browser: '🌐',
  computer: '🖥️',
  other: '⚙️',
};

export interface GenerationTaskCardProps {
  task: GenerationTask;
  onOpenActivity?: (id: string) => void;
  onOpenViewport?: (task: GenerationTask) => void;
  onDismiss?: (id: string) => void;
  onCancel?: (task: GenerationTask) => void;
  download?: (url: string, filename: string) => void;
  showTimestamps?: boolean;
}

export function GenerationTaskCard({
  task,
  onOpenActivity,
  onOpenViewport,
  onDismiss,
  onCancel,
  download,
  showTimestamps,
}: GenerationTaskCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const statusMeta = STATUS_STYLES[task.status] || STATUS_STYLES.running;
  const canOpenViewport = onOpenViewport && ['sandbox', 'cli', 'browser', 'computer'].includes(task.type);
  const canCancel = onCancel && (task.type === 'code' || task.type === 'sandbox' || task.type === 'cli') && task.status !== 'cancelled';
  const details = task.raw ? JSON.stringify(task.raw, null, 2) : undefined;

  return (
    <article
      className={
        'rounded-2xl bg-[var(--beatrice-card,#121215)] border p-4 text-left flex flex-col gap-2.5 transition-colors ' +
        (task.status === 'failed'
          ? 'border-rose-500/40'
          : task.status === 'completed'
          ? 'border-emerald-500/25'
          : task.stale
          ? 'border-amber-500/40'
          : 'border-white/10 hover:border-[#00f2fe]/30')
      }
    >
      <header className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-white/5 border border-white/10 grid place-items-center text-base" aria-hidden="true">
          {TYPE_ICONS[task.type] || TYPE_ICONS.other}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{task.title}</h3>
            {task.stale ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                No updates
              </span>
            ) : null}
          </div>
          <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusMeta.dot} animate-pulse ${task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' ? '!animate-none' : ''}`} aria-hidden="true" />
            <span className={statusMeta.text}>{statusMeta.label}</span>
            {showTimestamps && task.startedAt ? (
              <span className="text-zinc-500 tabular-nums">
                · {new Date(task.startedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(task.id)}
              aria-label={`Dismiss ${task.title}`}
              className="w-7 h-7 rounded-lg grid place-items-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              ✕
            </button>
          ) : null}
        </div>
      </header>

      {task.model || task.provider ? (
        <p className="text-[11px] text-zinc-500 truncate">
          {task.provider}
          {task.model ? ` · ${task.model}` : ''}
        </p>
      ) : null}

      {task.stage || task.message ? (
        <div className="min-h-0">
          {task.stage ? (
            <p className="text-sm text-zinc-200 leading-snug">{task.stage}</p>
          ) : null}
          {task.message && task.stage !== task.message ? (
            <p className="text-xs text-zinc-400 leading-snug mt-0.5 line-clamp-2 break-words">{task.message}</p>
          ) : null}
        </div>
      ) : null}

      <GenerationProgress
        status={task.status}
        progress={task.progress}
        startedAt={task.startedAt}
        completedAt={task.completedAt}
        label={task.status === 'failed' ? 'Failed' : task.status === 'completed' ? `Done in ${formatElapsed(task.startedAt, task.completedAt)}` : undefined}
      />

      <GenerationResultPreview task={task} download={download} />

      {task.status === 'failed' && task.error ? (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 px-2.5 py-2">
          <p className="text-xs text-rose-200 leading-snug break-words">{task.error}</p>
          {details ? (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-1.5 text-[11px] font-medium text-rose-300 hover:text-white transition-colors"
            >
              {showDetails ? 'Hide details' : 'View details'}
            </button>
          ) : null}
          {showDetails && details ? (
            <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-rose-200/80">
              {details.length > 1200 ? details.slice(-1200) : details}
            </pre>
          ) : null}
        </div>
      ) : null}

      <footer className="flex items-center gap-2 flex-wrap mt-auto">
        {canCancel ? (
          <button
            type="button"
            onClick={() => onCancel?.(task)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            Cancel
          </button>
        ) : null}
        {canOpenViewport ? (
          <button
            type="button"
            onClick={() => onOpenViewport?.(task)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            Open activity view
          </button>
        ) : null}
        {onOpenActivity ? (
          <button
            type="button"
            onClick={() => onOpenActivity(task.id)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/10 border border-[#00f2fe]/25 text-[#00f2fe] hover:bg-[#00f2fe]/20 hover:text-white transition-colors"
          >
            View activity
          </button>
        ) : null}
      </footer>
    </article>
  );
}
import { useEffect, useState } from 'react';
import type { GenerationTaskStatus } from '../../types/generation';

export function formatElapsed(startedAt: number, completedAt?: number, now = Date.now()): string {
  const end = completedAt && completedAt >= startedAt ? completedAt : now;
  const s = Math.max(0, Math.floor((end - startedAt) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

interface GenerationProgressProps {
  status: GenerationTaskStatus;
  /** Real backend percentage when the provider reports it; absent = indeterminate. */
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  compact?: boolean;
  label?: string;
}

/**
 * Progress rendering for a task. Shows the real backend percentage when the
 * provider reports one; otherwise an indeterminate shimmer — never a faked
 * number. The elapsed timer lives inside this component so only it re-renders
 * once per second, not the whole card.
 */
export function GenerationProgress({
  status,
  progress,
  startedAt,
  completedAt,
  compact,
  label,
}: GenerationProgressProps) {
  const [, setTick] = useState(0);
  const active =
    status !== 'completed' && status !== 'failed' && status !== 'cancelled';
  const hasReal = typeof progress === 'number' && progress >= 0 && progress <= 100;

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);

  const pct = hasReal ? Math.min(100, Math.max(0, Math.round(progress as number))) : undefined;

  return (
    <div className="w-full" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs text-[var(--beatrice-muted,#8e8e93)] truncate">
          {label || (hasReal ? `Progress ${pct}%` : 'In progress')}
        </span>
        {startedAt ? (
          <span className="text-xs tabular-nums text-[var(--beatrice-muted,#8e8e93)] shrink-0">
            {formatElapsed(startedAt, completedAt)}
          </span>
        ) : null}
      </div>
      <div
        className={
          'relative overflow-hidden rounded-full bg-white/10 ' +
          (compact ? 'h-1' : 'h-1.5')
        }
      >
        {hasReal ? (
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#00f2fe,#4facfe)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        ) : active ? (
          <div className="indeterminate-track h-full w-full rounded-full overflow-hidden">
            <div className="indeterminate-slide h-full w-1/3 rounded-full bg-[linear-gradient(90deg,#00f2fe,#4facfe)]" />
          </div>
        ) : (
          <div className="h-full w-full rounded-full bg-white/5" />
        )}
      </div>
    </div>
  );
}

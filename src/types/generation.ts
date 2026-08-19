// Unified generation-task model. Every long-running Beatrice operation
// (video/image/code/audio generation, sandbox, CLI, browser, computer) is
// normalized into this shape so the whole UI renders from one store.

export type GenerationTaskType =
  | 'video'
  | 'image'
  | 'code'
  | 'audio'
  | 'sandbox'
  | 'cli'
  | 'browser'
  | 'computer'
  | 'skill'
  | 'other';

export type GenerationTaskStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'processing'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GenerationTask {
  id: string;
  type: GenerationTaskType;
  title: string;
  status: GenerationTaskStatus;

  /** Real backend-provided percentage (0-100). Absent = indeterminate. */
  progress?: number;
  /** Human-readable phase label, e.g. "Rendering video…". */
  stage?: string;
  /** Short status line shown under the stage. */
  message?: string;

  provider?: string;
  model?: string;
  /** The prompt/instruction that triggered this task. */
  prompt?: string;

  startedAt: number;
  completedAt?: number;
  /** Last time an event touched this task (used for stale detection). */
  lastUpdatedAt: number;

  /** Thumbnail/preview while running or result preview when done. */
  previewUrl?: string;
  outputUrl?: string;
  audioUrl?: string;

  /** Rolling (capped) activity log for code/sandbox/cli tasks. */
  logs?: string[];

  error?: string;
  /** True when a reconnect happened and no update has arrived since. */
  stale?: boolean;
  /** Backend session id for sandbox/cli/browser/computer (ExecutionViewport). */
  relatedSessionId?: string;
  /** Raw source payload, kept for the "View details" expander. */
  raw?: Record<string, unknown>;
}

export const ACTIVE_TASK_STATUSES: ReadonlySet<GenerationTaskStatus> = new Set<GenerationTaskStatus>([
  'queued',
  'initializing',
  'running',
  'processing',
  'finalizing',
]);

export const isTaskActive = (t: GenerationTask): boolean => ACTIVE_TASK_STATUSES.has(t.status);

export const isTaskTerminal = (t: GenerationTask): boolean =>
  t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled';

export const isTaskFailed = (t: GenerationTask): boolean => t.status === 'failed';

export const TASK_TYPE_LABELS: Record<GenerationTaskType, string> = {
  video: 'Generating Video',
  image: 'Generating Image',
  code: 'Coding Agent',
  audio: 'Generating Speech',
  sandbox: 'Sandbox Execution',
  cli: 'CLI Command',
  browser: 'Browser Automation',
  computer: 'Computer Control',
  skill: 'Skill Execution',
  other: 'Task',
};

export const TASK_STATUS_LABELS: Record<GenerationTaskStatus, string> = {
  queued: 'Queued',
  initializing: 'Starting',
  running: 'Running',
  processing: 'Processing',
  finalizing: 'Finalizing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

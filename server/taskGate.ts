/**
 * Per-user single-slot gate for generation tasks.
 *
 * Beatrice works on at most ONE generation task at a time (image / video /
 * audio / coding). A second trigger while one is in flight is REJECTED — the
 * model is told to wait — so a provider model is never asked to start a new
 * generation until the current one is done, and no two tasks can render in
 * parallel for the same user. Slot ownership is bound to a task id so a stale
 * release can never clear a newer task.
 */

export type GenerationKind = 'image' | 'video' | 'audio' | 'code';

interface Slot {
  kind: GenerationKind;
  taskId: string;
}

const slots = new Map<string, Slot>();

export type GenerationSlotResult =
  | { ok: true; kind: GenerationKind; taskId: string }
  | { ok: false; busy: { kind: GenerationKind; taskId: string } };

/**
 * Try to claim the single generation slot for a user. Fails (without
 * modifying state) when the user already has a generation in flight.
 */
export function tryAcquireGenerationSlot(
  userId: string,
  kind: GenerationKind,
  taskId: string,
): GenerationSlotResult {
  const existing = slots.get(userId);
  if (existing) {
    return { ok: false, busy: { kind: existing.kind, taskId: existing.taskId } };
  }
  slots.set(userId, { kind, taskId });
  return { ok: true, kind, taskId };
}

/** Release the slot — only frees it if it still belongs to `taskId`. */
export function releaseGenerationSlot(userId: string, taskId: string): void {
  const current = slots.get(userId);
  if (current && current.taskId === taskId) slots.delete(userId);
}

/** Current slot occupant for a user (used by tests / diagnostics). */
export function generationSlotStatus(userId: string): { kind?: GenerationKind; taskId?: string } {
  return slots.get(userId) || {};
}

const KIND_LABELS: Record<GenerationKind, string> = {
  image: 'image generation',
  video: 'video generation',
  audio: 'speech generation',
  code: 'coding task',
};

/** Human/model-facing rejection message for a busy slot. */
export function generationBusyMessage(kind: GenerationKind): string {
  const label = KIND_LABELS[kind] || kind;
  return `I'm still working on the previous ${label} — I can only run one generation task at a time. Wait for it to finish, then I'll start this one.`;
}

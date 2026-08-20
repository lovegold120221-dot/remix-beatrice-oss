import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryAcquireGenerationSlot,
  releaseGenerationSlot,
  generationSlotStatus,
  generationBusyMessage,
} from '../server/taskGate.js';

test('acquire succeeds for a free user and occupies the slot', () => {
  const r = tryAcquireGenerationSlot('user-a', 'image', 'task-1');
  assert.equal(r.ok, true);
  assert.deepEqual(generationSlotStatus('user-a'), { kind: 'image', taskId: 'task-1' });
  releaseGenerationSlot('user-a', 'task-1');
  assert.deepEqual(generationSlotStatus('user-a'), {});
});

test('a second task of a different kind is rejected while busy', () => {
  const first = tryAcquireGenerationSlot('user-b', 'video', 'vid-1');
  assert.equal(first.ok, true);
  const second = tryAcquireGenerationSlot('user-b', 'image', 'img-1');
  assert.equal(second.ok, false);
  if (second.ok === false) {
    assert.equal(second.busy.kind, 'video');
    assert.equal(second.busy.taskId, 'vid-1');
  }
  // A rejected acquire must not have modified the slot.
  assert.deepEqual(generationSlotStatus('user-b'), { kind: 'video', taskId: 'vid-1' });
  // Different users are independent — no global lock.
  const other = tryAcquireGenerationSlot('user-c', 'code', 'ca-1');
  assert.equal(other.ok, true);
  releaseGenerationSlot('user-c', 'ca-1');
  releaseGenerationSlot('user-b', 'vid-1');
});

test('release only frees the slot when the task id matches', () => {
  tryAcquireGenerationSlot('user-d', 'audio', 'tts-1');
  releaseGenerationSlot('user-d', 'wrong-id'); // stale release — must be a no-op
  assert.deepEqual(generationSlotStatus('user-d'), { kind: 'audio', taskId: 'tts-1' });
  releaseGenerationSlot('user-d', 'tts-1');
  assert.deepEqual(generationSlotStatus('user-d'), {});
});

test('the same kind cannot run twice until the first completes', () => {
  const a = tryAcquireGenerationSlot('user-e', 'image', 'img-1');
  assert.equal(a.ok, true);
  const b = tryAcquireGenerationSlot('user-e', 'image', 'img-2');
  assert.equal(b.ok, false);
  releaseGenerationSlot('user-e', 'img-1');
  const c = tryAcquireGenerationSlot('user-e', 'image', 'img-2');
  assert.equal(c.ok, true);
  releaseGenerationSlot('user-e', 'img-2');
});

test('busy message names the running kind', () => {
  assert.match(generationBusyMessage('video'), /video generation/);
  assert.match(generationBusyMessage('image'), /image generation/);
  assert.match(generationBusyMessage('audio'), /speech generation/);
  assert.match(generationBusyMessage('code'), /coding task/);
});

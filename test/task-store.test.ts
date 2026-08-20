import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  sanitizeUid,
  taskFromBroadcast,
  updateTask,
  upsertTaskFromBroadcast,
} from '../server/taskStore.js';

test('task store round-trips create/list/get/update/delete for a uid', async () => {
  const uid = 'integration-test-user';
  const task = await createTask(uid, { type: 'video', prompt: 'hello world', status: 'queued', progress: 0 });
  assert.ok(task);
  assert.equal(task.userId, sanitizeUid(uid));

  const listed = await listTasks(uid);
  assert.ok(listed.some((t) => t.id === task.id));

  const fetched = await getTask(uid, task.id);
  assert.equal(fetched?.id, task.id);
  assert.equal(fetched?.status, 'queued');

  const updated = await updateTask(uid, task.id, { status: 'completed', progress: 100 });
  assert.equal(updated?.status, 'completed');

  const deleted = await deleteTask(uid, task.id);
  assert.equal(deleted, true);
  assert.equal(await getTask(uid, task.id), null);
});

test('tasks are isolated per user', async () => {
  const a = await createTask('user-a', { type: 'code', prompt: 'for a', status: 'processing' });
  const b = await createTask('user-b', { type: 'code', prompt: 'for b', status: 'processing' });
  assert.ok(a && b);
  const aTasks = await listTasks('user-a');
  const bTasks = await listTasks('user-b');
  assert.ok(aTasks.some((t) => t.id === a.id));
  assert.ok(!aTasks.some((t) => t.id === b.id));
  assert.ok(bTasks.some((t) => t.id === b.id));
});

test('anonymous uid is rejected', async () => {
  const task = await createTask(null, { type: 'code', prompt: 'anon', status: 'processing' });
  assert.equal(task, null);
});

test('upsertTaskFromBroadcast maps broadcasts to tasks', () => {
  const parsed = taskFromBroadcast({
    type: 'videoGenerationUpdate',
    task: { id: 'vid_123', prompt: 'a cat video', status: 'completed', progress: 100 },
  });
  assert.ok(parsed);
  assert.equal(parsed.id, 'vid_123');
  assert.equal(parsed.patch.status, 'completed');
  assert.equal(parsed.patch.prompt, 'a cat video');
});
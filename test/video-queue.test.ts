import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueVideoGeneration, videoQueueStats } from '../server/tools.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForIdle() {
  for (let i = 0; i < 100; i++) {
    const s = videoQueueStats();
    if (!s.running && s.queueLength === 0 && s.activeUsers.length === 0) return;
    await sleep(10);
  }
  throw new Error('video queue never drained');
}

test('video queue drains FIFO across users', async () => {
  const order: string[] = [];
  const a = enqueueVideoGeneration('user-a', async () => {
    await sleep(30);
    order.push('A');
  });
  const b = enqueueVideoGeneration('user-b', async () => {
    order.push('B');
  });
  assert.equal(a.accepted, true);
  assert.equal(a.position, 1);
  assert.equal(b.accepted, true);
  assert.equal(b.position, 1);
  await waitForIdle();
  assert.deepEqual(order, ['A', 'B']);
});

test('a single user may hold at most one running + one queued job', async () => {
  const order: string[] = [];
  const first = enqueueVideoGeneration('user-x', async () => {
    await sleep(40);
    order.push('first');
  });
  const second = enqueueVideoGeneration('user-x', async () => {
    order.push('second');
  });
  const third = enqueueVideoGeneration('user-x', async () => {
    order.push('third');
  });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(third.accepted, false);
  assert.match(third.reason || '', /in progress/);
  await waitForIdle();
  assert.deepEqual(order, ['first', 'second']);
});

test('different users can queue while another user is rendering', async () => {
  const order: string[] = [];
  enqueueVideoGeneration('user-a', async () => {
    await sleep(30);
    order.push('a1');
  });
  const b = enqueueVideoGeneration('user-b', async () => {
    order.push('b1');
  });
  const a2 = enqueueVideoGeneration('user-a', async () => {
    order.push('a2');
  });
  assert.equal(b.accepted, true);
  assert.equal(a2.accepted, true);
  assert.equal(a2.position, 2);
  await waitForIdle();
  assert.deepEqual(order, ['a1', 'b1', 'a2']);
});

test('a failed queue job does not stall the pump', async () => {
  const order: string[] = [];
  enqueueVideoGeneration('user-bad', async () => {
    throw new Error('render exploded');
  });
  const ok = enqueueVideoGeneration('user-ok', async () => {
    order.push('ok');
  });
  assert.equal(ok.accepted, true);
  await waitForIdle();
  assert.deepEqual(order, ['ok']);
  assert.deepEqual(videoQueueStats().activeUsers, []);
});
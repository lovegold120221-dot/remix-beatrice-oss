import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cacheCoreMemory,
  fallbackCoreRead,
  fallbackRecall,
  fallbackRemember,
  memoryFallbackStats,
  resetMemoryFallbackCache,
} from '../server/memoryFallback.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-fallback-'));
process.env.MEMORY_FALLBACK_FILE = path.join(tmpDir, 'store.json');

test('remember then recall round-trips through the local store', () => {
  const id = fallbackRemember('sess-1', [
    { role: 'user', content: 'The Boss prefers Tagalog with English mixing' },
    { role: 'assistant', content: 'Noted, I will remember that.' },
  ]);
  assert.ok(id.startsWith('local_'));
  const results = fallbackRecall('Tagalog', 5, 'sess-1');
  assert.ok(results.length >= 1);
  assert.equal(results[0].id, id);
  assert.match(results[0].snippet, /Tagalog/);
});

test('recall respects session filter and limit', () => {
  fallbackRemember('sess-a', [{ role: 'user', content: 'quarterly sales target is one million' }]);
  fallbackRemember('sess-b', [{ role: 'user', content: 'quarterly sales target is one million' }]);
  const a = fallbackRecall('sales target', 10, 'sess-a');
  const b = fallbackRecall('sales target', 10, 'sess-b');
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].session_id, b[0].session_id);
  assert.ok(fallbackRecall('sales target', 1, 'sess-a').length <= 1);
});

test('recall with no matches returns empty and irrelevant query ranks lower', () => {
  fallbackRemember('sess-2', [{ role: 'user', content: 'shipping address is 42 Palm Street' }]);
  assert.deepEqual(fallbackRecall('quantum physics', 5, 'sess-2'), []);
});

test('core memory cache falls back to last known profile', () => {
  cacheCoreMemory({ profile: { version: 3, content: 'boss prefers brevity' } });
  const read = fallbackCoreRead();
  assert.ok(read.cached);
  assert.match(JSON.stringify(read.cached), /brevity/);
  assert.match(read.note, /local cache/);
});

test('stats report entry count and file path', () => {
  const stats = memoryFallbackStats();
  assert.ok(stats.entries >= 3);
  assert.ok(stats.file.endsWith('store.json'));
});

test('empty store core read returns null with note', () => {
  const fresh = path.join(tmpDir, 'empty.json');
  process.env.MEMORY_FALLBACK_FILE = fresh;
  resetMemoryFallbackCache();
  const read = fallbackCoreRead();
  assert.equal(read.cached, null);
  assert.match(read.note, /no cached/);
});
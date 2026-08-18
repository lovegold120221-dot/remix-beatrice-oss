import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIsolatedArgv } from '../server/isolate.js';

test('buildIsolatedArgv composes the isolation wrapper chain', () => {
  const argv = buildIsolatedArgv('python3', ['-c', 'print(1)']);
  // timeout -> unshare -> setpriv -> prlimit -> -- -> cmd args
  assert.equal(argv[0], 'timeout');
  assert.ok(argv.includes('unshare'));
  assert.ok(argv.includes('--user'));
  assert.ok(argv.includes('--net'));
  assert.ok(argv.includes('setpriv'));
  assert.ok(argv.includes('--no-new-privs'));
  assert.ok(argv.includes('prlimit'));
  const sep = argv.indexOf('--');
  assert.ok(sep > 0);
  assert.equal(argv[sep + 1], 'python3');
  assert.deepEqual(argv.slice(sep + 2), ['-c', 'print(1)']);
});

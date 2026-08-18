import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, authEnabled } from '../server/auth.js';

test('bearerToken extracts a Bearer token', () => {
  const req = { headers: { authorization: 'Bearer abc123' } } as any;
  assert.equal(bearerToken(req), 'abc123');
});

test('bearerToken returns null for missing or non-Bearer header', () => {
  assert.equal(bearerToken({ headers: {} } as any), null);
  assert.equal(bearerToken({ headers: { authorization: 'Basic xyz' } } as any), null);
  assert.equal(bearerToken({ headers: { authorization: 'Bearer ' } } as any), null);
});

test('authEnabled reflects AUTH_DISABLED env', () => {
  const prev = process.env.AUTH_DISABLED;
  delete process.env.AUTH_DISABLED;
  assert.equal(authEnabled(), true);
  process.env.AUTH_DISABLED = '1';
  assert.equal(authEnabled(), false);
  if (prev === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = prev;
});

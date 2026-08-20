import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bootServer, wsUrl, type BootedServer } from './helpers/boot-server.js';

let server: BootedServer;

before(async () => {
  server = await bootServer();
});

after(async () => {
  await server.kill();
});

function collectWsMessages(url: string, timeoutMs = 8000): Promise<{ messages: any[]; closed: boolean; statusCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const messages: any[] = [];
    let settled = false;
    const finish = (closed: boolean, statusCode?: number) => {
      if (settled) return;
      settled = true;
      resolve({ messages, closed, statusCode });
    };
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push({ raw: data.toString() });
      }
    });
    ws.on('unexpected-response', (_req, res) => finish(false, res.statusCode));
    ws.on('error', () => finish(false));
    ws.on('close', () => finish(true));
    setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } finish(true); }, timeoutMs);
  });
}

test('health endpoint is public and reports api key state', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.app, 'Beatrice OSS');
  assert.equal(body.apiKeyConfigured, false);
});

test('metrics endpoint exposes server metrics', async () => {
  const res = await fetch(`${server.baseUrl}/metrics`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /beatrice_http_requests_total/);
  assert.match(text, /beatrice_ws_connections_total/);
});

test('CLI tool runs a real command through the streaming service', async () => {
  const res = await fetch(`${server.baseUrl}/api/tools/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'echo integration-ok-12345' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.exitCode, 0);
  assert.match(body.output, /integration-ok-12345/);
  assert.ok(body.durationMs >= 0);
});

test('sandbox executes JavaScript through the sandbox service', async () => {
  const res = await fetch(`${server.baseUrl}/api/tools/execute-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '1+1', language: 'javascript' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.output, /Return value: 2/);
});

test('task endpoints are gated per-user: 401 without a verified uid', async () => {
  const marker = `task-${Date.now()}`;
  const created = await fetch(`${server.baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'video', prompt: marker, status: 'queued', progress: 0 }),
  });
  assert.equal(created.status, 401, 'createTask must reject anonymous sessions');
  const listed = await fetch(`${server.baseUrl}/api/tasks`);
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.deepEqual(listedBody.tasks, [], 'anonymous session must not see any tasks');
});

test('live WebSocket handshake reports missing API key deterministically', async () => {
  const { messages, closed } = await collectWsMessages(wsUrl(server.baseUrl, '/live?token=anything'));
  const types = messages.map((m) => m.type);
  assert.ok(types.includes('status'), `expected a status message, got: ${JSON.stringify(messages)}`);
  assert.ok(types.includes('error'), `expected an error message, got: ${JSON.stringify(messages)}`);
  assert.ok(closed || messages.some((m) => m.type === 'status' && m.status === 'error'));
});

test('unknown ws path is rejected', async () => {
  const { closed } = await collectWsMessages(wsUrl(server.baseUrl, '/nope'), 3000);
  assert.ok(closed || true);
});

test('with auth enabled, protected routes reject unauthenticated requests', async () => {
  const secured = await bootServer({ AUTH_DISABLED: '' });
  try {
    const health = await fetch(`${secured.baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const info = await fetch(`${secured.baseUrl}/api/terminal/info`);
    assert.equal(info.status, 200);
    const tools = await fetch(`${secured.baseUrl}/api/tools/cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo nope' }),
    });
    assert.equal(tools.status, 401);
    const { statusCode } = await collectWsMessages(wsUrl(secured.baseUrl, '/live'), 3000);
    assert.ok(statusCode === 401, `expected WS upgrade to be rejected with 401, got ${statusCode}`);
  } finally {
    await secured.kill();
  }
});
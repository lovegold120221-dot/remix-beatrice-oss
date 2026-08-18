import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, getTool, dispatchTool, toolNames } from '../server/toolRegistry.js';
import type { ToolContext } from '../server/tools.js';

const ctx: ToolContext = { broadcast: () => {} };

test('registerTool and getTool round-trip', () => {
  registerTool('test_tool', async (args: any) => ({ echo: args.x }));
  const handler = getTool('test_tool');
  assert.ok(handler);
  assert.ok(toolNames().includes('test_tool'));
});

test('dispatchTool returns unknown-tool error for unregistered names', async () => {
  const result = await dispatchTool('does_not_exist', {}, ctx);
  assert.deepEqual(result, { error: 'Unknown tool name: does_not_exist' });
});

test('dispatchTool invokes handler and returns result', async () => {
  registerTool('test_echo', async (args: any) => ({ got: args.value }));
  const result = await dispatchTool('test_echo', { value: 42 }, ctx);
  assert.deepEqual(result, { got: 42 });
});

test('dispatchTool catches handler errors into a uniform shape', async () => {
  registerTool('test_throws', async () => {
    throw new Error('boom');
  });
  const result = await dispatchTool('test_throws', {}, ctx);
  assert.deepEqual(result, { error: 'boom' });
});

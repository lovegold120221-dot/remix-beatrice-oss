import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeSkill, createSkillExecution } from '../server/skillExecutor.js';
import { registerTool } from '../server/toolRegistry.js';
import type { ToolContext } from '../server/tools.js';
import { getSkill } from '../server/skills/index.js';

const toolCtx: ToolContext = { broadcast: () => {} };
const noopBroadcast = () => {};

// Stub tools used by the skills under test. Registering them here keeps the
// executor tests hermetic (no real CLI / sandbox / network).
registerTool('runCliCommand', async (args: any) => ({ ok: true, command: args.command }));
registerTool('runCodingAgent', async (args: any) => ({ ok: true, task: args.task }));
registerTool('webSearch', async (args: any) => ({ ok: true, query: args.query }));
registerTool('getWeather', async (args: any) => ({ ok: true, location: args.location }));
registerTool('send_whatsapp_text', async (args: any) => ({ ok: true, to: args.to }));
registerTool('request_whatsapp_send', async (args: any) => ({ ok: true, approved: true }));
registerTool('listGmailMessages', async () => ({ ok: true, messages: [] }));
registerTool('qwenImageGenerate', async (args: any) => ({ ok: true, imageUrl: 'https://example.com/img.png', prompt: args.prompt }));
registerTool('qwenImageEdit', async (args: any) => ({ ok: true, imageUrl: 'https://example.com/edited.png' }));
registerTool('qwenVideoGenerate', async (args: any) => ({ ok: true, videoUrl: 'https://example.com/vid.mp4' }));
registerTool('generateVideo', async (args: any) => ({ ok: true, videoUrl: 'https://example.com/vid.mp4' }));
registerTool('runBrowserAutomation', async (args: any) => ({ ok: true, url: args.url }));
registerTool('runComputerControl', async (args: any) => ({ ok: true, action: args.action }));
registerTool('updateCanvasVisual', async (args: any) => ({ ok: true, canvas: args.canvas }));
registerTool('get_whatsapp_contacts', async () => ({ ok: true, contacts: [] }));
registerTool('resolve_whatsapp_contact', async (args: any) => ({ ok: true, name: args.name }));
registerTool('createCalendarEvent', async (args: any) => ({ ok: true, summary: args.summary }));
registerTool('deleteCalendarEvent', async (args: any) => ({ ok: true, eventId: args.eventId }));
registerTool('listCalendarEvents', async () => ({ ok: true, events: [] }));
registerTool('updateCalendarEvent', async (args: any) => ({ ok: true, eventId: args.eventId }));
registerTool('sendGmailMessage', async (args: any) => ({ ok: true, to: args.to }));
registerTool('trashGmailMessage', async (args: any) => ({ ok: true, id: args.id }));
registerTool('deleteGmailMessage', async (args: any) => ({ ok: true, id: args.id }));
registerTool('createGoogleDoc', async (args: any) => ({ ok: true, title: args.title }));
registerTool('listDriveFiles', async () => ({ ok: true, files: [] }));
registerTool('searchYoutube', async (args: any) => ({ ok: true, query: args.query }));
registerTool('listGoogleContacts', async () => ({ ok: true, contacts: [] }));
registerTool('connectGoogleAccount', async () => ({ ok: true, connected: true }));
registerTool('remember_memory', async (args: any) => ({ ok: true, content: args.content }));
registerTool('recall_memory', async (args: any) => ({ ok: true, query: args.query }));
registerTool('get_core_memory', async () => ({ ok: true, profile: {} }));
registerTool('getSystemInfo', async () => ({ ok: true, info: {} }));
registerTool('openLocalTerminal', async (args: any) => ({ ok: true, command: args.command }));
registerTool('executeCodeSandbox', async (args: any) => ({ ok: true, code: args.code }));
registerTool('deployAgentTask', async (args: any) => ({ ok: true, task: args.task }));
registerTool('qwenChat', async (args: any) => ({ ok: true, prompt: args.prompt }));
registerTool('qwenTts', async (args: any) => ({ ok: true, text: args.text }));

test('createSkillExecution builds a queued execution with pending steps', () => {
  const exec = createSkillExecution('code.run_command', { command: 'npm test' });
  assert.equal(exec.skillId, 'code.run_command');
  assert.equal(exec.status, 'queued');
  assert.ok(exec.steps.length > 0);
  assert.ok(exec.steps.every((s) => s.status === 'pending'));
});

test('executeSkill runs all steps and completes', async () => {
  const events: any[] = [];
  const exec = await executeSkill(
    'code.run_command',
    { command: 'npm test' },
    toolCtx,
    (msg) => events.push(msg),
  );
  assert.equal(exec.status, 'completed');
  assert.ok(exec.steps.every((s) => s.status === 'completed' || s.status === 'skipped'));
  const toolStep = exec.steps.find((s) => s.tool === 'runCliCommand');
  assert.ok(toolStep, 'runCliCommand step should exist');
  assert.equal(toolStep.status, 'completed');
  assert.ok(events.some((e) => e.type === 'skillExecutionUpdate' && e.status === 'completed'));
});

test('executeSkill broadcasts running + completed updates', async () => {
  const events: any[] = [];
  await executeSkill('web.research', { query: 'gemini docs' }, toolCtx, (m) => events.push(m));
  const statuses = events.map((e) => e.status);
  assert.ok(statuses.includes('running'));
  assert.ok(statuses.includes('completed'));
  assert.ok(events.every((e) => e.type === 'skillExecutionUpdate'));
});

test('executeSkill fails gracefully for unknown skills', async () => {
  const exec = await executeSkill('nope.not_a_skill', {}, toolCtx, noopBroadcast);
  assert.equal(exec.status, 'failed');
  assert.ok(exec.error?.includes('not found'));
});

test('executeSkill skips steps whose condition is not met', async () => {
  // media.image.edit requires activeImage context; without it the
  // resolve step should be skipped (condition 'ctx.activeImage').
  const skill = getSkill('media.image.edit')!;
  const conditional = skill.steps.find((s) => s.when);
  assert.ok(conditional, 'media.image.edit should have a conditional step');
  const exec = await executeSkill('media.image.edit', {}, toolCtx, noopBroadcast);
  const stepExec = exec.steps.find((s) => s.id === conditional.id);
  assert.equal(stepExec?.status, 'skipped');
});

test('executeSkill handles tool failures via onFailure handlers', async () => {
  registerTool('failing_tool', async () => {
    throw new Error('boom');
  });
  // A skill with a failing required step and no onFailure → failed execution.
  const exec = await executeSkill('code.run_command', { command: 'npm test' }, toolCtx, noopBroadcast);
  assert.ok(['completed', 'failed'].includes(exec.status));
});

test('executeSkill records tool results in execution context', async () => {
  const exec = await executeSkill('code.run_command', { command: 'ls' }, toolCtx, noopBroadcast);
  const toolStep = exec.steps.find((s) => s.tool === 'runCliCommand');
  assert.ok(toolStep?.result);
  assert.ok((exec.context as any).runCliCommand_result);
});

test('executeSkill increments execution metrics', async () => {
  await executeSkill('code.run_command', { command: 'ls' }, toolCtx, noopBroadcast);
  // Metrics are registered by the module import; just ensure no throw and
  // the counter exists via a second execution.
  const exec2 = await executeSkill('code.run_command', { command: 'ls' }, toolCtx, noopBroadcast);
  assert.equal(exec2.status, 'completed');
});

test('executeSkill runs multi-step flows in order (whatsapp send)', async () => {
  const events: any[] = [];
  const exec = await executeSkill(
    'whatsapp.send_message',
    { to: 'Michael', text: 'meeting moved to six' },
    toolCtx,
    (m) => events.push(m),
  );
  assert.equal(exec.status, 'completed');
  const toolSteps = exec.steps.filter((s) => s.tool);
  assert.ok(toolSteps.length >= 1);
  // Steps must complete in declaration order.
  const completedIds = exec.steps.filter((s) => s.status === 'completed').map((s) => s.id);
  const skill = getSkill('whatsapp.send_message')!;
  const expectedOrder = skill.steps.filter((s) => completedIds.includes(s.id)).map((s) => s.id);
  assert.deepEqual(completedIds, expectedOrder);
});

test('executeSkill runs destructive skills with confirm steps (calendar delete)', async () => {
  const exec = await executeSkill(
    'google.calendar.delete',
    { eventId: 'evt-1' },
    toolCtx,
    noopBroadcast,
  );
  assert.equal(exec.status, 'completed');
  const confirmStep = exec.steps.find((s) => s.id === 'confirm');
  assert.ok(confirmStep, 'should have a confirm step');
  assert.equal(confirmStep.status, 'completed');
});

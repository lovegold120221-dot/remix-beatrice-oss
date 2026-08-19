import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveToolCall,
  executeToolWithSkillRouting,
  handleFunctionCallWithSkills,
} from '../server/toolRoutingMiddleware.js';
import { createConversationContext } from '../server/conversationContext.js';
import { registerTool } from '../server/toolRegistry.js';
import type { ToolContext } from '../server/tools.js';
import { getToolCatalogEntry, getAllToolCatalogEntries, findUnassignedTools, findInvalidSkillRouteDeclarations } from '../server/toolCatalog.js';

const toolCtx: ToolContext = { broadcast: () => {} };
const noopBroadcast = () => {};

registerTool('runCliCommand', async (args: any) => ({ ok: true, command: args.command }));
registerTool('qwenImageGenerate', async (args: any) => ({ ok: true, imageUrl: 'https://example.com/img.png' }));
registerTool('qwenImageEdit', async (args: any) => ({ ok: true, imageUrl: 'https://example.com/edited.png' }));
registerTool('deleteCalendarEvent', async (args: any) => ({ ok: true, eventId: args.eventId }));
registerTool('listCalendarEvents', async () => ({ ok: true, events: [] }));
registerTool('send_whatsapp_text', async (args: any) => ({ ok: true, to: args.to }));
registerTool('request_whatsapp_send', async () => ({ ok: true, approved: true }));
registerTool('webSearch', async (args: any) => ({ ok: true, query: args.query }));
registerTool('runBrowserAutomation', async (args: any) => ({ ok: true, url: args.url }));
registerTool('runCodingAgent', async (args: any) => ({ ok: true, task: args.task }));
registerTool('executeCodeSandbox', async (args: any) => ({ ok: true, code: args.code }));
registerTool('deployAgentTask', async (args: any) => ({ ok: true, task: args.task }));
registerTool('generateVideo', async (args: any) => ({ ok: true, videoUrl: 'https://example.com/v.mp4' }));
registerTool('qwenVideoGenerate', async (args: any) => ({ ok: true, videoUrl: 'https://example.com/v.mp4' }));
registerTool('sendGmailMessage', async (args: any) => ({ ok: true, to: args.to }));
registerTool('listGmailMessages', async () => ({ ok: true, messages: [] }));
registerTool('listGoogleContacts', async () => ({ ok: true, contacts: [] }));
registerTool('get_whatsapp_contacts', async () => ({ ok: true, contacts: [] }));
registerTool('updateCanvasVisual', async (args: any) => ({ ok: true, canvas: args.canvas }));
registerTool('createGoogleDoc', async (args: any) => ({ ok: true, title: args.title }));
registerTool('send_whatsapp_message', async (args: any) => ({ ok: true, to: args.to }));

// ── resolveToolCall decisions ──────────────────────────────────────────────

test('unknown tools are blocked', () => {
  const ctx = createConversationContext();
  const d = resolveToolCall('totally_fake_tool', {}, undefined, ctx);
  assert.equal(d.decision, 'block');
  assert.equal(d.reasonCode, 'unknown_tool');
});

test('valid tools are allowed', () => {
  const ctx = createConversationContext();
  const d = resolveToolCall('runCliCommand', { command: 'ls' }, undefined, ctx);
  assert.equal(d.decision, 'allow');
  assert.equal(d.reasonCode, 'valid');
});

test('destructive tools require confirmation', () => {
  const ctx = createConversationContext();
  const d = resolveToolCall('deleteCalendarEvent', { eventId: 'x' }, undefined, ctx);
  assert.equal(d.decision, 'clarify');
  assert.equal(d.reasonCode, 'confirmation_required');
});

test('tools with missing requirements clarify', () => {
  const ctx = createConversationContext();
  // qwenImageEdit requires activeImage
  const d = resolveToolCall('qwenImageEdit', { prompt: 'make it blue' }, undefined, ctx);
  assert.equal(d.decision, 'clarify');
  assert.equal(d.reasonCode, 'missing_requirements');
});

test('tools with satisfied requirements are allowed', () => {
  const ctx = { ...createConversationContext(), activeImage: 'https://example.com/img.png' };
  const d = resolveToolCall('qwenImageEdit', { prompt: 'make it blue' }, undefined, ctx);
  assert.equal(d.decision, 'allow');
});

test('tools in the active skill context are allowed', () => {
  const ctx = createConversationContext();
  const d = resolveToolCall('runCliCommand', { command: 'ls' }, 'code.run_command', ctx);
  assert.equal(d.decision, 'allow');
});

test('cross-domain tools are rerouted with a suggestion', () => {
  const ctx = createConversationContext();
  const d = resolveToolCall('webSearch', { query: 'x' }, 'code.run_command', ctx);
  assert.equal(d.decision, 'reroute');
  assert.equal(d.reasonCode, 'cross_domain_suggestion');
});

// ── executeToolWithSkillRouting ────────────────────────────────────────────

test('executeToolWithSkillRouting executes allowed tools through skills', async () => {
  const ctx = createConversationContext();
  const result = await executeToolWithSkillRouting(
    'runCliCommand',
    { command: 'ls' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.equal(result.decision.decision, 'allow');
  assert.ok(result.execution);
  assert.equal(result.execution!.skillId, 'code.run_command');
  assert.equal(result.execution!.status, 'completed');
});

test('executeToolWithSkillRouting returns block without executing', async () => {
  const ctx = createConversationContext();
  const result = await executeToolWithSkillRouting(
    'totally_fake_tool',
    {},
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.equal(result.decision.decision, 'block');
  assert.equal(result.execution, undefined);
});

test('executeToolWithSkillRouting returns clarify for destructive tools', async () => {
  const ctx = createConversationContext();
  const result = await executeToolWithSkillRouting(
    'deleteCalendarEvent',
    { eventId: 'x' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.equal(result.decision.decision, 'clarify');
  assert.equal(result.execution, undefined);
});

test('executeToolWithSkillRouting sets activeSkill for follow-ups', async () => {
  const ctx = createConversationContext();
  await executeToolWithSkillRouting(
    'qwenImageGenerate',
    { prompt: 'a robot' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.equal(ctx.activeSkill, 'media.image.generate');
});

test('executeToolWithSkillRouting reroutes legacy aliases into canonical skills', async () => {
  const ctx = createConversationContext();
  // generateVideo is a legacy alias — its catalog skillRoutes point to
  // media.video.generate, whose steps run the canonical qwenVideoGenerate.
  const result = await executeToolWithSkillRouting(
    'generateVideo',
    { prompt: 'waves' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.equal(result.decision.decision, 'allow');
  assert.equal(result.execution!.skillId, 'media.video.generate');
});

// ── handleFunctionCallWithSkills ───────────────────────────────────────────

test('handleFunctionCallWithSkills returns tool result strings', async () => {
  const ctx = createConversationContext();
  const response = await handleFunctionCallWithSkills(
    'runCliCommand',
    { command: 'ls' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.ok(response.length > 0);
});

test('handleFunctionCallWithSkills returns block messages', async () => {
  const ctx = createConversationContext();
  const response = await handleFunctionCallWithSkills(
    'totally_fake_tool',
    {},
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.ok(response.includes('totally_fake_tool'));
});

test('handleFunctionCallWithSkills returns clarification messages', async () => {
  const ctx = createConversationContext();
  const response = await handleFunctionCallWithSkills(
    'deleteCalendarEvent',
    { eventId: 'x' },
    undefined,
    ctx,
    toolCtx,
    noopBroadcast,
  );
  assert.ok(response.toLowerCase().includes('destructive') || response.toLowerCase().includes('sure'));
});

// ── Catalog integrity ──────────────────────────────────────────────────────

test('every catalog tool has a resolvable skill route', () => {
  const entries = getAllToolCatalogEntries();
  assert.ok(entries.length >= 70);
  assert.deepEqual(findUnassignedTools(), []);
  assert.deepEqual(findInvalidSkillRouteDeclarations(), []);
});

test('catalog entries carry risk + requirements metadata', () => {
  const entry = getToolCatalogEntry('deleteCalendarEvent')!;
  assert.equal(entry.risk, 'destructive');
  assert.equal(entry.requiresConfirmation, true);
  assert.ok(entry.requirements.includes('google_auth'));
});

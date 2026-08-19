import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryIntent } from '../server/queryRouter.js';
import { routeToSkill } from '../server/skillRouter.js';
import {
  createConversationContext,
  updateContextFromToolCall,
  updateContextFromSkillSelection,
  isContextStale,
  isTopicShift,
  resetContextForNewTopic,
} from '../server/conversationContext.js';

// ── Context lifecycle ──────────────────────────────────────────────────────

test('createConversationContext starts empty with a timestamp', () => {
  const ctx = createConversationContext();
  assert.ok(ctx.lastUpdatedAt);
  assert.equal(ctx.activeSkill, undefined);
  assert.equal(ctx.activeImage, undefined);
});

test('updateContextFromToolCall records last tool + result', () => {
  const ctx = createConversationContext();
  const updated = updateContextFromToolCall(ctx, 'runCliCommand', { command: 'ls' }, { ok: true });
  assert.equal(updated.lastToolName, 'runCliCommand');
  assert.deepEqual(updated.lastToolArgs, { command: 'ls' });
  assert.deepEqual(updated.lastToolResult, { ok: true });
  assert.equal(updated.activeCodingTask, 'ls');
});

test('updateContextFromToolCall tracks active image', () => {
  const ctx = createConversationContext();
  const updated = updateContextFromToolCall(
    ctx,
    'qwenImageGenerate',
    { prompt: 'robot' },
    { imageUrl: 'https://example.com/robot.png' },
  );
  assert.equal(updated.activeImage, 'https://example.com/robot.png');
});

test('updateContextFromToolCall tracks active video', () => {
  const ctx = createConversationContext();
  const updated = updateContextFromToolCall(
    ctx,
    'qwenVideoGenerate',
    { prompt: 'waves' },
    { videoUrl: 'https://example.com/waves.mp4' },
  );
  assert.equal(updated.activeVideo, 'https://example.com/waves.mp4');
});

test('updateContextFromSkillSelection sets active skill + goal', () => {
  const ctx = createConversationContext();
  const updated = updateContextFromSkillSelection(ctx, 'media.video.generate', 'make a video of waves');
  assert.equal(updated.activeSkill, 'media.video.generate');
  assert.equal(updated.lastUserGoal, 'make a video of waves');
});

test('isContextStale detects old contexts', () => {
  const fresh = createConversationContext();
  assert.equal(isContextStale(fresh), false);
  const stale = { ...createConversationContext(), lastUpdatedAt: Date.now() - 10 * 60 * 1000 };
  assert.equal(isContextStale(stale), true);
});

test('resetContextForNewTopic clears domain state but keeps general info', () => {
  const ctx = {
    ...createConversationContext(),
    activeSkill: 'media.video.generate',
    activeVideo: 'v1',
    activeImage: 'i1',
    lastToolName: 'qwenVideoGenerate',
    lastToolResult: { ok: true },
    activeRepository: 'repo',
    lastUserGoal: 'make a video',
  };
  const reset = resetContextForNewTopic(ctx);
  assert.equal(reset.activeSkill, undefined);
  assert.equal(reset.activeVideo, undefined);
  assert.equal(reset.activeImage, undefined);
  assert.equal(reset.lastToolName, undefined);
  assert.equal(reset.activeRepository, 'repo');
  assert.equal(reset.lastUserGoal, 'make a video');
});

test('isTopicShift detects explicit shifts only', () => {
  assert.equal(isTopicShift('media.video.generate', 'google', 'Show my emails'), false);
  assert.equal(isTopicShift('media.video.generate', 'google', 'Actually, show my emails'), true);
  assert.equal(isTopicShift('media.video.generate', 'media', 'Make it shorter'), false);
  assert.equal(isTopicShift(undefined, 'google', 'Show my emails'), false);
});

// ── End-to-end context routing scenarios ───────────────────────────────────

function route(q: string, ctx: ReturnType<typeof createConversationContext>) {
  const intent = parseQueryIntent(q, ctx);
  return routeToSkill(intent, ctx);
}

test('scenario: image → edit follow-up', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromToolCall(ctx, 'qwenImageGenerate', { prompt: 'robot' }, { imageUrl: 'https://example.com/robot.png' });
  ctx = updateContextFromSkillSelection(ctx, 'media.image.generate', 'create a robot image');
  assert.equal(route('Make it blue.', ctx).skillId, 'media.image.generate');
  assert.equal(route('Use the same image but bigger.', ctx).skillId, 'media.image.generate');
});

test('scenario: video → follow-ups stay on video skill', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromToolCall(ctx, 'qwenVideoGenerate', { prompt: 'waves' }, { videoUrl: 'https://example.com/waves.mp4' });
  ctx = updateContextFromSkillSelection(ctx, 'media.video.generate', 'generate a video of waves');
  assert.equal(route('Make it vertical.', ctx).skillId, 'media.video.generate');
  assert.equal(route('Do it again.', ctx).skillId, 'media.video.generate');
  assert.equal(route('Continue that.', ctx).skillId, 'media.video.generate');
});

test('scenario: coding task → continuation in same domain', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromToolCall(ctx, 'runCodingAgent', { task: 'fix the login bug' }, { ok: true });
  ctx = updateContextFromSkillSelection(ctx, 'code.modify_repository', 'fix the login bug');
  assert.equal(route('Run the tests too.', ctx).skillId, 'code.modify_repository');
  assert.equal(route('Also check the lint output.', ctx).skillId, 'code.modify_repository');
});

test('scenario: topic shift away from active skill', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromSkillSelection(ctx, 'media.video.generate', 'make a video');
  assert.equal(route('Show my latest emails.', ctx).skillId, 'google.gmail.list');
  assert.equal(route('What is the weather in Manila?', ctx).skillId, 'web.weather');
  assert.equal(route('Run npm test.', ctx).skillId, 'code.run_command');
});

test('scenario: explicit topic shift indicator resets context', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromSkillSelection(ctx, 'media.video.generate', 'make a video');
  assert.equal(route('Actually, show my latest emails.', ctx).skillId, 'google.gmail.list');
});

test('scenario: whatsapp send → follow-up send', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromToolCall(ctx, 'send_whatsapp_text', { to: 'Michael', text: 'hi' }, { ok: true });
  ctx = updateContextFromSkillSelection(ctx, 'whatsapp.send_message', 'send Michael a message');
  assert.equal(route('Send it to Maria too.', ctx).skillId, 'whatsapp.send_message');
});

test('scenario: stale context does not hijack new queries', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromSkillSelection(ctx, 'media.video.generate', 'make a video');
  ctx = { ...ctx, lastUpdatedAt: Date.now() - 10 * 60 * 1000 };
  // Even with a stale active skill, a clear new-domain query routes normally.
  assert.equal(route('Show my latest emails.', ctx).skillId, 'google.gmail.list');
});

test('scenario: no context → pronoun queries stay safe', () => {
  const ctx = createConversationContext();
  for (const q of ['Make it shorter', 'Do it again', 'Use the same image', 'Continue that', 'Fix the previous one']) {
    const intent = parseQueryIntent(q, ctx);
    const r = routeToSkill(intent, ctx);
    assert.ok(r.skillId, `should resolve to some skill for "${q}"`);
  }
});

test('scenario: context survives across multiple tool calls', () => {
  let ctx = createConversationContext();
  ctx = updateContextFromToolCall(ctx, 'runCliCommand', { command: 'npm test' }, { ok: true });
  ctx = updateContextFromToolCall(ctx, 'runCodingAgent', { task: 'fix login' }, { ok: true });
  assert.equal(ctx.lastToolName, 'runCodingAgent');
  assert.equal(ctx.activeCodingTask, 'fix login');
});

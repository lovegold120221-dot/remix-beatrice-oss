import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryIntent } from '../server/queryRouter.js';
import { createConversationContext } from '../server/conversationContext.js';

// ── Discussion vs execution ────────────────────────────────────────────────

test('discussion questions never require a tool', () => {
  const ctx = createConversationContext();
  for (const q of [
    'Explain how image generation works.',
    'Give me an image generation prompt.',
    'How would you send this to Michael?',
    'What should I say to Michael?',
    'How would you create a picture of Beatrice?',
    'Explain this JavaScript code.',
    'Explain why this test probably fails.',
    'Can you explain how weather forecasting works?',
  ]) {
    const intent = parseQueryIntent(q, ctx);
    assert.equal(intent.requiresTool, false, `${q} should NOT require a tool`);
    assert.equal(intent.intent, 'question', `${q} should be a question`);
  }
});

test('execution requests do require a tool', () => {
  const ctx = createConversationContext();
  for (const q of [
    'Generate an image of a robot.',
    'Send this to Michael.',
    'Run this JavaScript.',
    'Run npm test.',
    'Delete yesterday\'s meeting.',
    'Create a picture of Beatrice.',
  ]) {
    const intent = parseQueryIntent(q, ctx);
    assert.equal(intent.requiresTool, true, `${q} SHOULD require a tool`);
  }
});

// ── Domain detection ───────────────────────────────────────────────────────

test('domain detection across domains', () => {
  const ctx = createConversationContext();
  const cases: [string, string][] = [
    ['Build a responsive dashboard in this repository', 'code'],
    ['Run npm test', 'code'],
    ['Generate an image of a black robot', 'media'],
    ['Create a video of waves', 'media'],
    ['What is the weather in Manila?', 'web'],
    ['Find the latest Gemini documentation', 'web'],
    ['Open Gemini docs and click API reference', 'browser'],
    ['Send Michael "meeting moved to six"', 'whatsapp'],
    ['Show my latest emails', 'google'],
    ['Create a meeting tomorrow at 10', 'google'],
    ['Remember that I prefer dark mode', 'memory'],
    ['Show me a diagram of the architecture', 'presentation'],
    ['What are the system specs?', 'system'],
    ['Open the calculator', 'computer'],
  ];
  for (const [q, domain] of cases) {
    const intent = parseQueryIntent(q, ctx);
    assert.equal(intent.domain, domain, `${q} → domain ${intent.domain}, want ${domain}`);
  }
});

// ── Intent detection ───────────────────────────────────────────────────────

test('intent detection', () => {
  const ctx = createConversationContext();
  const cases: [string, string][] = [
    ['Create a picture of Beatrice', 'create'],
    ['Edit this image and remove the person', 'edit'],
    ['Run npm test', 'execute'],
    ['Delete yesterday\'s meeting', 'delete'],
    ['Show yesterday\'s meeting', 'read'],
    ['Send Michael "meeting moved to six"', 'send'],
    ['Find the latest Gemini documentation', 'search'],
    ['Remember that I like coffee', 'create'],
    ['What is the weather in Manila?', 'question'],
  ];
  for (const [q, intent] of cases) {
    const result = parseQueryIntent(q, ctx);
    assert.equal(result.intent, intent, `${q} → intent ${result.intent}, want ${intent}`);
  }
});

// ── Destructive detection ──────────────────────────────────────────────────

test('destructive queries are flagged', () => {
  const ctx = createConversationContext();
  for (const q of ['Delete yesterday\'s meeting', 'Remove this email', 'Cancel the meeting', 'Erase that file']) {
    const intent = parseQueryIntent(q, ctx);
    assert.equal(intent.destructive, true, `${q} should be destructive`);
  }
  const safe = parseQueryIntent('Show yesterday\'s meeting', ctx);
  assert.equal(safe.destructive, false);
});

// ── Fresh data questions ───────────────────────────────────────────────────

test('fresh-data questions (weather/news/recall) require a tool', () => {
  const ctx = createConversationContext();
  for (const q of [
    'What is the weather in Manila?',
    'Is it raining in Tokyo?',
    'What is the latest news about AI?',
    'Do you remember what we discussed last time?',
  ]) {
    const intent = parseQueryIntent(q, ctx);
    assert.equal(intent.requiresTool, true, `${q} should require a tool`);
    assert.equal(intent.requiresFreshData, true, `${q} should be marked fresh-data`);
  }
});

// ── Language detection ─────────────────────────────────────────────────────

test('language detection: English / Filipino / Taglish', () => {
  const ctx = createConversationContext();
  assert.equal(parseQueryIntent('Create a picture of a robot', ctx).language, 'english');
  assert.equal(parseQueryIntent('Gumawa ka ng larawan para sa akin', ctx).language, 'filipino');
  assert.equal(parseQueryIntent('Pwede bang mag-generate ka ng video?', ctx).language, 'taglish');
});

// ── ASR / voice-style fragments ────────────────────────────────────────────

test('voice-style fragments and ASR ambiguity do not misfire into tools', () => {
  const ctx = createConversationContext();
  // "open coat" could be ASR for "OpenCode" — must not fire a code tool.
  const openCoat = parseQueryIntent('open coat', ctx);
  assert.notEqual(openCoat.domain, 'code');
  // Fragmented utterances
  for (const q of ['uh generate um a picture', 'the image, make it blue', 'so yeah anyway']) {
    const intent = parseQueryIntent(q, ctx);
    assert.ok(intent.normalizedQuery.length > 0);
  }
});

// ── Short commands ─────────────────────────────────────────────────────────

test('short commands still classify', () => {
  const ctx = createConversationContext();
  assert.equal(parseQueryIntent('Run npm test', ctx).intent, 'execute');
  assert.equal(parseQueryIntent('Send it', ctx).intent, 'send');
  assert.equal(parseQueryIntent('git status', ctx).domain, 'code');
  assert.equal(parseQueryIntent('Weather in Paris', ctx).domain, 'web');
});

// ── Long complex requests ──────────────────────────────────────────────────

test('long multi-intent requests pick a dominant intent', () => {
  const ctx = createConversationContext();
  const q = 'Can you please look at my repository and implement a login feature, and also run the tests afterwards?';
  const intent = parseQueryIntent(q, ctx);
  assert.equal(intent.domain, 'code');
  assert.ok(['create', 'execute'].includes(intent.intent));
});

// ── Missing information ────────────────────────────────────────────────────

test('missing information detection', () => {
  const ctx = createConversationContext();
  const noRecipient = parseQueryIntent('Send a message', ctx);
  assert.ok(noRecipient.missingInformation.includes('recipient'));
  assert.equal(noRecipient.needsClarification, true);

  const withRecipient = parseQueryIntent('Send Michael \'meeting moved to six\'', ctx);
  assert.equal(withRecipient.needsClarification, false);
});

// ── Pronoun/context-free queries ───────────────────────────────────────────

test('pronoun-only queries stay safe without context', () => {
  const ctx = createConversationContext();
  for (const q of ['Make it shorter', 'Do it again', 'Use the same image', 'Continue that', 'Fix the previous one']) {
    const intent = parseQueryIntent(q, ctx);
    assert.ok(intent.normalizedQuery.length > 0);
  }
});

// ── Filipino / Taglish queries ─────────────────────────────────────────────

test('Taglish execution queries', () => {
  const ctx = createConversationContext();
  const q = 'Pwede mo bang i-send kay Michael yung message?';
  const intent = parseQueryIntent(q, ctx);
  assert.equal(intent.language, 'taglish');
  assert.equal(intent.intent, 'send');
});
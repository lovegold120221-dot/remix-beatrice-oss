import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFunctionDeclarations, validateToolCoverage } from '../server/toolDeclarations.js';
import { getAllToolNames } from '../server/toolCatalog.js';
import { registerAllTools, registerTool, toolNames } from '../server/toolRegistry.js';

test('every catalog tool has a Gemini declaration and vice versa', () => {
  const declared = getFunctionDeclarations()[0].functionDeclarations.map((d) => d.name);
  const catalog = getAllToolNames();
  assert.deepEqual([...declared].sort(), [...catalog].sort());
});

test('declarations only advertise real, configured models', () => {
  const declared = getFunctionDeclarations()[0].functionDeclarations;
  const qwenVideo = declared.find((d) => d.name === 'qwenVideoGenerate');
  const video = declared.find((d) => d.name === 'generateVideo');
  const tts = declared.find((d) => d.name === 'qwenTts');
  const chat = declared.find((d) => d.name === 'qwenChat');
  for (const d of [qwenVideo, video, tts, chat]) {
    assert.ok(d, `missing declaration ${d}`);
  }
  const text = JSON.stringify(declared);
  assert.ok(!/wan2\.7-t2v|wan2\.6-t2v|qwen3-tts-flash|qwen3\.8-max/.test(text));
  assert.match(text, /happyhorse-1\.1-t2v/);
  assert.match(text, /qwen-image-2\.0-pro/);
  assert.match(text, /qwen-image-2\.0-pro-2026-06-22/);
  assert.match(text, /wan3\.0-video/);
  assert.match(text, /z-image-turbo/);
  assert.match(text, /qwen-audio-3\.0-tts-plus/);
});

test('validateToolCoverage passes with no drift', () => {
  registerAllTools();
  assert.deepEqual(validateToolCoverage(), []);
  assert.ok(toolNames().length > 50);
});

test('validateToolCoverage flags a tool registered without a catalog entry', () => {
  registerAllTools();
  registerTool('__drift_sentinel__', async () => ({}));
  const problems = validateToolCoverage();
  assert.ok(problems.some((p) => p.includes('__drift_sentinel__')));
});
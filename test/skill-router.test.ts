import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryIntent } from '../server/queryRouter.js';
import { routeToSkill, routeToolToSkill } from '../server/skillRouter.js';
import { createConversationContext } from '../server/conversationContext.js';
import {
  getSkill,
  getAllSkills,
  getAllSkillIds,
  findSkillsByDomain,
  findSkillsByIntent,
  findSkillsByTool,
  validateSkillCoverage,
} from '../server/skills/index.js';
import { getAllToolCatalogEntries, findUnassignedTools, findInvalidSkillRouteDeclarations } from '../server/toolCatalog.js';

const ctx = createConversationContext();

function route(q: string, context = ctx) {
  const intent = parseQueryIntent(q, context);
  return routeToSkill(intent, context);
}

// ── Spec example routing tests ─────────────────────────────────────────────

test('spec example: media routing', () => {
  assert.equal(route('Create a picture of Beatrice.').skillId, 'media.image.generate');
  assert.equal(route('Generate an image of a robot.').skillId, 'media.image.generate');
  assert.equal(route('Edit this image and remove the person.').skillId, 'media.image.edit');
  assert.equal(route('Generate a robot video.').skillId, 'media.video.generate');
  assert.equal(route('Create a video of waves.').skillId, 'media.video.generate');
  // Discussion → NO TOOL
  assert.equal(route('How would you create a picture of Beatrice?').skillId, 'conversation.default');
  assert.equal(route('Explain how image generation works.').skillId, 'conversation.default');
});

test('spec example: code routing', () => {
  assert.equal(route('Build a responsive dashboard in this repository.').skillId, 'code.modify_repository');
  assert.equal(route('Run npm test.').skillId, 'code.run_command');
  assert.equal(route('Run this JavaScript.').skillId, 'code.run_snippet');
  assert.equal(route('Review the codebase for bugs.').skillId, 'code.review_repository');
  // Explanation → NO TOOL
  assert.equal(route('Explain this JavaScript code.').skillId, 'conversation.default');
});

test('spec example: web routing', () => {
  assert.equal(route('Find the latest Gemini documentation.').skillId, 'web.research');
  assert.equal(route('Open Gemini docs and click API reference.').skillId, 'web.browser_action');
  assert.equal(route('What is the weather in Manila?').skillId, 'web.weather');
});

test('spec example: whatsapp routing', () => {
  assert.equal(route('Send Michael \'meeting moved to six\'.').skillId, 'whatsapp.send_message');
  assert.equal(route('Send this to Michael.').skillId, 'whatsapp.send_message');
  assert.equal(route('Who is on WhatsApp?').skillId, 'whatsapp.list_contacts');
  // Discussion → NO SEND
  assert.equal(route('What should I say to Michael?').skillId, 'conversation.default');
  assert.equal(route('How would you send this to Michael?').skillId, 'conversation.default');
});

test('spec example: google routing', () => {
  assert.equal(route('Show my latest emails.').skillId, 'google.gmail.list');
  assert.equal(route('Search gmail for invoice.').skillId, 'google.gmail.search');
  assert.equal(route('Send an email to John.').skillId, 'google.gmail.send');
  assert.equal(route('Show yesterday\'s meeting.').skillId, 'google.calendar.list');
  assert.equal(route('Create a meeting tomorrow at 10.').skillId, 'google.calendar.create');
  assert.equal(route('Delete yesterday\'s meeting.').skillId, 'google.calendar.delete');
  assert.equal(route('Move the meeting to Thursday.').skillId, 'google.calendar.update');
  assert.equal(route('List my drive files.').skillId, 'google.drive.list');
  assert.equal(route('Create a doc.').skillId, 'google.docs.create');
  assert.equal(route('Search youtube for tutorials.').skillId, 'google.youtube.search');
});

test('destructive google operations route to destructive skills', () => {
  assert.equal(route('Delete yesterday\'s meeting.').skillId, 'google.calendar.delete');
  assert.equal(route('Delete this email permanently.').skillId, 'google.gmail.delete');
  const skill = getSkill('google.calendar.delete')!;
  assert.equal(skill.destructive, true);
  assert.equal(skill.risk, 'destructive');
});

// ── Context routing: follow-ups ────────────────────────────────────────────

test('follow-ups resolve against active skill (media)', () => {
  const mediaCtx = { ...ctx, activeSkill: 'media.video.generate', activeVideo: 'vid-1' };
  assert.equal(route('Make it vertical.', mediaCtx).skillId, 'media.video.generate');
  assert.equal(route('Make it shorter.', mediaCtx).skillId, 'media.video.generate');
  assert.equal(route('Do it again.', mediaCtx).skillId, 'media.video.generate');
  assert.equal(route('Continue that.', mediaCtx).skillId, 'media.video.generate');
});

test('follow-ups resolve against active skill (code)', () => {
  const codeCtx = { ...ctx, activeSkill: 'code.modify_repository', activeCodingTask: 'fix login' };
  assert.equal(route('Run the tests too.', codeCtx).skillId, 'code.modify_repository');
});

test('topic shift ignores stale task context', () => {
  const videoCtx = { ...ctx, activeSkill: 'media.video.generate', activeVideo: 'vid-1' };
  assert.equal(route('Show my latest emails.', videoCtx).skillId, 'google.gmail.list');
  assert.equal(route('What is the weather in Manila?', videoCtx).skillId, 'web.weather');
  assert.equal(route('Run npm test.', videoCtx).skillId, 'code.run_command');
});

// ── Tool → skill mapping (confusion tests) ─────────────────────────────────

test('confusion: executeCodeSandbox vs runCodingAgent', () => {
  assert.equal(routeToolToSkill('executeCodeSandbox')!.id, 'code.run_snippet');
  assert.equal(routeToolToSkill('runCodingAgent')!.id, 'code.modify_repository');
});

test('confusion: runCliCommand vs runCodingAgent', () => {
  assert.equal(routeToolToSkill('runCliCommand')!.id, 'code.run_command');
  assert.equal(routeToolToSkill('runCodingAgent')!.id, 'code.modify_repository');
});

test('confusion: deployAgentTask vs runCodingAgent', () => {
  const deploy = routeToolToSkill('deployAgentTask')!;
  // deployAgentTask is used by code.explain + code.review_repository — NOT by
  // code.modify_repository, so it must not collide with runCodingAgent.
  assert.ok(['code.explain', 'code.review_repository'].includes(deploy.id), `deployAgentTask → ${deploy.id}`);
  assert.equal(routeToolToSkill('runCodingAgent')!.id, 'code.modify_repository');
  assert.notEqual(deploy.id, 'code.modify_repository');
});

test('confusion: webSearch vs runBrowserAutomation', () => {
  assert.equal(routeToolToSkill('webSearch')!.id, 'web.research');
  assert.equal(routeToolToSkill('runBrowserAutomation')!.id, 'web.browser_action');
});

test('confusion: qwenImageGenerate vs qwenImageEdit', () => {
  assert.equal(routeToolToSkill('qwenImageGenerate')!.id, 'media.image.generate');
  assert.equal(routeToolToSkill('qwenImageEdit')!.id, 'media.image.edit');
});

test('confusion: qwenVideoGenerate vs generateVideo (canonical route)', () => {
  assert.equal(routeToolToSkill('qwenVideoGenerate')!.id, 'media.video.generate');
  // generateVideo is an internal alias — rerouted to the same canonical skill.
  assert.equal(routeToolToSkill('generateVideo')!.id, 'media.video.generate');
});

test('confusion: google contacts vs whatsapp contacts', () => {
  assert.equal(routeToolToSkill('listGoogleContacts')!.id, 'google.contacts.list');
  assert.equal(routeToolToSkill('get_whatsapp_contacts')!.id, 'whatsapp.list_contacts');
});

test('confusion: gmail sending vs whatsapp sending', () => {
  assert.equal(routeToolToSkill('sendGmailMessage')!.id, 'google.gmail.send');
  assert.equal(routeToolToSkill('send_whatsapp_text')!.id, 'whatsapp.send_message');
});

test('confusion: canvas vs google drive document', () => {
  assert.equal(routeToolToSkill('updateCanvasVisual')!.id, 'presentation.canvas');
  assert.equal(routeToolToSkill('createGoogleDoc')!.id, 'google.docs.create');
});

// ── Registry integrity ─────────────────────────────────────────────────────

test('every catalog tool has at least one skill route', () => {
  const tools = getAllToolCatalogEntries();
  assert.ok(tools.length >= 70, `expected >= 70 tools, got ${tools.length}`);
  const uncovered = findUnassignedTools();
  assert.deepEqual(uncovered, [], `tools without skill routes: ${uncovered.join(', ')}`);
});

test('all declared skillRoutes resolve to real skills', () => {
  const invalid = findInvalidSkillRouteDeclarations();
  assert.deepEqual(invalid, [], `tools with invalid skillRoutes: ${invalid.join(', ')}`);
});

test('validateSkillCoverage finds no uncovered tools', () => {
  const names = getAllToolCatalogEntries().map((t) => t.name);
  const uncovered = validateSkillCoverage(names);
  assert.deepEqual(uncovered, []);
});

test('every registered skill has steps and a valid domain', () => {
  for (const skill of getAllSkills()) {
    assert.ok(skill.steps.length > 0, `${skill.id} has no steps`);
    assert.ok(skill.domain, `${skill.id} has no domain`);
    assert.ok(skill.risk, `${skill.id} has no risk classification`);
  }
});

test('skill registry lookups work', () => {
  assert.ok(getSkill('code.run_command'));
  assert.ok(findSkillsByDomain('whatsapp').length >= 10);
  assert.ok(findSkillsByIntent('send').length >= 4);
  assert.ok(findSkillsByTool('runCliCommand').length >= 1);
  assert.ok(getAllSkillIds().length >= 75, 'expected >= 75 skills');
});

test('destructive google skills require confirmation steps', () => {
  for (const id of ['google.gmail.delete', 'google.calendar.delete', 'google.drive.delete', 'google.contacts.delete', 'google.tasks.delete']) {
    const skill = getSkill(id);
    assert.ok(skill, `${id} should exist`);
    assert.ok(
      skill!.steps.some((s) => s.action === 'confirm'),
      `${id} should have a confirm step`,
    );
  }
});

test('whatsapp.send_message has approval gate steps', () => {
  const skill = getSkill('whatsapp.send_message')!;
  const tools = skill.steps.map((s) => s.tool).filter(Boolean);
  assert.ok(tools.includes('request_whatsapp_send'), 'should request approval');
  assert.ok(tools.includes('send_whatsapp_text'), 'should send via canonical tool');
});

test('media.image.edit requires activeImage context', () => {
  const skill = getSkill('media.image.edit')!;
  assert.ok(skill.requiredContext?.includes('activeImage'));
});
/**
 * Skill registry — central lookup for all predefined skill routes.
 *
 * Every registered tool MUST have at least one skill route that uses it.
 * `validateSkillCoverage()` checks this on boot.
 */

import type {
  SkillRoute,
  SkillDomain,
  QueryIntent,
  SkillResolution,
  ActiveContext,
} from './types.js';
import { codeSkills } from './code.skill.js';
import { mediaSkills } from './media.skill.js';
import { webSkills } from './web.skill.js';
import { whatsappSkills } from './whatsapp.skill.js';
import { googleSkills } from './google.skill.js';
import { memorySkills } from './memory.skill.js';
import { systemSkills, presentationSkills } from './system.skill.js';
import { computerSkills } from './computer.skill.js';
import { getToolCatalogEntry } from '../toolCatalog.js';

// ── All skills combined ────────────────────────────────────────────────────

const ALL_SKILLS: SkillRoute[] = [
  ...codeSkills,
  ...mediaSkills,
  ...webSkills,
  ...whatsappSkills,
  ...googleSkills,
  ...memorySkills,
  ...computerSkills,
  ...systemSkills,
  ...presentationSkills,
];

// ── Indexes ────────────────────────────────────────────────────────────────

const byId = new Map<string, SkillRoute>();
const byDomain = new Map<SkillDomain, SkillRoute[]>();
const byTool = new Map<string, SkillRoute[]>();
const byIntent = new Map<QueryIntent, SkillRoute[]>();

for (const skill of ALL_SKILLS) {
  byId.set(skill.id, skill);

  // Index by domain
  const domainList = byDomain.get(skill.domain) ?? [];
  domainList.push(skill);
  byDomain.set(skill.domain, domainList);

  // Index by tool name (for fast reverse lookup from function calls)
  for (const step of skill.steps) {
    if (step.tool) {
      const toolList = byTool.get(step.tool) ?? [];
      toolList.push(skill);
      byTool.set(step.tool, toolList);
    }
  }

  // Index by intent
  for (const intent of skill.intents) {
    const intentList = byIntent.get(intent) ?? [];
    intentList.push(skill);
    byIntent.set(intent, intentList);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Get a skill by its ID (e.g. 'code.run_snippet'). */
export function getSkill(id: string): SkillRoute | undefined {
  return byId.get(id);
}

/** Get all registered skill routes. */
export function getAllSkills(): readonly SkillRoute[] {
  return ALL_SKILLS;
}

/** Get all skills in a domain. */
export function findSkillsByDomain(domain: SkillDomain): SkillRoute[] {
  return byDomain.get(domain) ?? [];
}

/** Get all skills that have a given intent. */
export function findSkillsByIntent(intent: QueryIntent): SkillRoute[] {
  return byIntent.get(intent) ?? [];
}

/** Get all skills that use a given tool (for coverage checks). */
export function findSkillsByTool(toolName: string): SkillRoute[] {
  return byTool.get(toolName) ?? [];
}

/**
 * Score a skill against a query intent + context.
 * Returns a confidence score 0..1 (0 = no match, 1 = perfect match).
 */
export function scoreSkill(
  skill: SkillRoute,
  intent: QueryIntent,
  domain: SkillDomain,
  text: string,
  context: ActiveContext,
): number {
  let score = 0;

  // Domain match (strong signal)
  if (skill.domain === domain) score += 0.35;

  // Intent match
  if (skill.intents.includes(intent)) score += 0.25;

  // Trigger keywords in text
  const lowerText = text.toLowerCase();
  if (skill.triggers && skill.triggers.length > 0) {
    const matched = skill.triggers.some((t) => lowerText.includes(t));
    if (matched) score += 0.3;
  }

  // Negative triggers (penalty)
  if (skill.negativeTriggers && skill.negativeTriggers.length > 0) {
    const matched = skill.negativeTriggers.some((t) => lowerText.includes(t));
    if (matched) score -= 0.4;
  }

  // Context bonus: if user previously interacted with this domain
  if (context.activeSkill) {
    const [activeDomain] = context.activeSkill.split('.');
    if (activeDomain === skill.domain) score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Resolve the best skill for a query intent + context.
 * Returns the top-scoring skill with confidence >= threshold.
 */
export function resolveSkill(
  intent: QueryIntent,
  domain: SkillDomain,
  text: string,
  context: ActiveContext,
  threshold = 0.4,
): SkillResolution {
  // Get candidate skills by intent + domain
  const byIntentCandidates = findSkillsByIntent(intent);
  const byDomainCandidates = findSkillsByDomain(domain);
  const candidates = [...new Set([...byIntentCandidates, ...byDomainCandidates])];

  if (candidates.length === 0) {
    // Fall back to conversation if nothing matches
    return {
      skillId: 'conversation.default',
      confidence: 0.5,
      missingInformation: [],
      reasonCode: 'no_matching_skill',
    };
  }

  // Score all candidates
  const scored = candidates
    .map((skill) => ({
      skill,
      score: scoreSkill(skill, intent, domain, text, context),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best.score >= threshold) {
    return {
      skillId: best.skill.id,
      confidence: best.score,
      missingInformation: [],
      reasonCode: 'matched',
    };
  }

  return {
    skillId: 'conversation.default',
    confidence: best.score,
    missingInformation: [],
    reasonCode: 'below_threshold',
  };
}

/**
 * Validate that every tool in the toolCatalog has at least one skill route
 * (either used in a skill step, or declared via the catalog's `skillRoutes`).
 * Returns an array of tool names with no skill coverage (empty = all covered).
 */
export function validateSkillCoverage(toolNames: string[]): string[] {
  const uncovered: string[] = [];
  for (const name of toolNames) {
    const skills = byTool.get(name);
    if (skills && skills.length > 0) continue;
    const routes = getToolCatalogEntry(name)?.skillRoutes ?? [];
    if (routes.length === 0) uncovered.push(name);
  }
  return uncovered;
}

/** Get all registered skill IDs. */
export function getAllSkillIds(): string[] {
  return ALL_SKILLS.map((s) => s.id);
}

/** Get all skill domains. */
export function getAllSkillDomains(): SkillDomain[] {
  return [...byDomain.keys()];
}

/**
 * Simple intent classification from raw text.
 * This is a lightweight heuristic; the real intent comes from the Gemini
 * function call. This is used for the queryRouter pre-routing step.
 */
export function classifyIntent(text: string): { intent: QueryIntent; domain: SkillDomain } {
  const lower = text.toLowerCase();

  // Discussion markers — "how would you X" / "explain how X" are questions
  // about the action, NOT requests to perform it.
  if (/^(how would you|how do you|what would you|what should i|explain how|could you explain|can you explain|if you were|what if you)/.test(lower)) {
    return { intent: 'question', domain: 'conversation' };
  }

  // Domain detection — order matters (most specific first).
  let domain: SkillDomain = 'conversation';
  if (/\b(click|navigate|browse|visit|scroll|fill out|submit|open the site|open a website|open the page)\b/.test(lower)) domain = 'browser';
  else if (/\b(email|emails|gmail|calendar|drive|docs|doc|document|sheets|slides|forms|tasks|youtube|meeting|appointment|schedule|event)\b/.test(lower)) domain = 'google';
  else if (/\b(send|share|forward|whatsapp|wa |message|chat|contact|group|call)\b/.test(lower)) domain = 'whatsapp';
  else if (/\b(image|video|picture|photo|draw|tts|narrate|speech|audio|logo|artwork|illustration|generate a|create a picture)\b/.test(lower)) domain = 'media';
  else if (/\b(search|find|look up|google it|weather|web|news|documentation|latest|price|forecast|raining|rain|sunny|temperature|climate|humid)\b/.test(lower)) domain = 'web';
  else if (/\b(remember|recall|memory|persona|profile)\b/.test(lower)) domain = 'memory';
  else if (/\b(open the app|open app|open the calculator|open calculator|calculator|computer|desktop)\b/.test(lower)) domain = 'computer';
  else if (/\b(code|script|function|debug|refactor|build|implement|snippet|npm|git|repository|repo|sandbox|compile|test|tests|testing|lint)\b/.test(lower)) domain = 'code';
  else if (/\b(diagram|chart|canvas|render|visualize)\b/.test(lower)) domain = 'presentation';
  else if (/\b(system|cpu|memory|disk|specs|terminal|shell)\b/.test(lower)) domain = 'system';

  // Intent detection — run first so domain rules can adapt (e.g. "send X"
  // with a meeting mention is still a send, not a calendar read).
  let intent: QueryIntent = 'question';
  if (/\b(explain|what is|what does|how does|why|when|where|who|describe|tell me about)\b/.test(lower)) intent = 'question';
  else if (/\b(send|share|forward|post|publish)\b/.test(lower)) intent = 'send';
  else if (/\b(create|make|generate|build|new|add|write|draft|compose)\b/.test(lower)) intent = 'create';
  else if (/\b(edit|modify|update|change|fix|correct|adjust|move|reschedule)\b/.test(lower)) intent = 'edit';
  else if (/\b(delete|remove|trash|bin|destroy|erase|cancel)\b/.test(lower)) intent = 'delete';
  else if (/\b(run|execute|do|perform|start|launch|continue|repeat)\b/.test(lower)) intent = 'execute';
  else if (/\b(review|audit|inspect|analyze|check for|look for issues)\b/.test(lower)) intent = 'inspect';
  else if (/\b(read|open|show|display|view|get|fetch|list|show me|check)\b/.test(lower)) intent = 'read';
  else if (/\b(search|find|look up|google|discover)\b/.test(lower)) intent = 'search';
  else if (/\b(remember|save|store|note|keep)\b/.test(lower)) intent = 'create';
  else if (/\b(recall|what did|do you remember)\b/.test(lower)) intent = 'read';

  // "send X meeting moved to six" → send intent wins over meeting (calendar)
  if (intent === 'send' && domain === 'google' && /\b(email|emails|gmail|mail)\b/.test(lower)) {
    // keep google — it's an email send
  } else if (intent === 'send') {
    domain = 'whatsapp';
  }

  return { intent, domain };
}

/**
 * Check if the query is purely conversational (no tool needed).
 */
export function isConversationOnly(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Very short messages, greetings, acknowledgments
  if (lower.length <= 3) return true;
  if (/^(hi|hey|hello|yo|sup|ok|yes|no|thanks|thank you|bye|good morning|good night|nice|cool|awesome|haha|lol)\b/.test(lower)) return true;
  // Pure opinions/feelings without tool needs
  if (/^(i feel|i think|in my opinion|i believe|i agree|i disagree)\b/.test(lower)) return true;
  return false;
}

/**
 * Skill router — resolves user intent to a specific skill route.
 * Takes QueryIntentResult + ActiveContext → selected SkillRoute.
 */

import type {
  QueryIntentResult,
  ActiveContext,
  SkillResolution,
  SkillRoute,
  SkillDomain,
} from './skills/types.js';
import {
  resolveSkill,
  getSkill,
  findSkillsByTool,
} from './skills/index.js';
import { getToolCatalogEntry } from './toolCatalog.js';
import { isTopicShift, resetContextForNewTopic } from './conversationContext.js';

/**
 * Route a query to the best skill.
 */
export function routeToSkill(
  intent: QueryIntentResult,
  context: ActiveContext,
): SkillResolution {
  // Context-aware follow-ups: short referential queries ("make it shorter",
  // "do it again", "use the same image", "continue that") resolve against the
  // active skill — but only when the query does NOT signal a topic shift.
  // This must run BEFORE the conversation-only early return, because many
  // follow-ups classify as questions ("use the same image but bigger").
  if (
    context.activeSkill &&
    context.activeSkill !== 'conversation.default' &&
    !isTopicShift(context.activeSkill, intent.domain, intent.normalizedQuery) &&
    (isReferentialFollowUp(intent.normalizedQuery, intent.domain, context.activeSkill) ||
      isContinuationInSameDomain(intent.normalizedQuery, intent.domain, context.activeSkill))
  ) {
    const active = getSkill(context.activeSkill);
    if (active) {
      return {
        skillId: active.id,
        confidence: 0.85,
        missingInformation: [],
        reasonCode: 'active_context_followup',
      };
    }
  }

  // If query is purely conversational, use the default conversation skill
  if (intent.intent === 'conversation' || !intent.requiresTool) {
    return {
      skillId: 'conversation.default',
      confidence: 0.95,
      missingInformation: [],
      reasonCode: 'conversation_only',
    };
  }

  // Check for topic shift
  if (isTopicShift(context.activeSkill, intent.domain, intent.normalizedQuery)) {
    // Reset context for the new topic
    const resetContext = resetContextForNewTopic(context);
    return resolveSkill(
      intent.intent,
      intent.domain,
      intent.normalizedQuery,
      resetContext,
    );
  }

  // Check if the query refers to the last tool result (follow-up)
  if (intent.needsClarification && context.lastToolResult) {
    // Try to resolve with context from the last tool
    const withContext = {
      ...context,
      lastUserGoal: intent.normalizedQuery,
    };
    const resolution = resolveSkill(
      intent.intent,
      intent.domain,
      intent.normalizedQuery,
      withContext,
    );
    if (resolution.confidence >= 0.4) {
      return resolution;
    }
  }

  // Standard resolution
  return resolveSkill(
    intent.intent,
    intent.domain,
    intent.normalizedQuery,
    context,
  );
}

/**
 * Detect short referential follow-ups that should resolve against the active
 * skill rather than being re-classified from scratch: pronouns ("it", "that",
 * "this"), "again"/"more", or "make it X" continuations with no own domain.
 */
function isReferentialFollowUp(query: string, domain: SkillDomain, activeSkill?: string): boolean {
  const lower = query.toLowerCase();
  // Query stays in the active domain → keep active skill (e.g. "Make it vertical").
  // A query with its own different domain is NOT referential (it's a topic shift).
  const [activeDomain] = (activeSkill ?? '').split('.');
  if (domain !== 'conversation' && domain !== activeDomain) return false;
  return (
    /\b(it|that|this|those|same|again|more|shorter|longer|bigger|smaller|vertical|horizontal|continue|repeat|redo|again)\b/.test(lower) ||
    /^(make it|do it|fix it|try again|once more|keep going)/.test(lower)
  );
}

/**
 * Detect explicit continuations of the active task in the same domain
 * ("Run the tests too", "Also check the lint output") — these should stay
 * on the active skill rather than re-classifying to a sibling skill.
 */
function isContinuationInSameDomain(
  query: string,
  domain: SkillDomain,
  activeSkill: string,
): boolean {
  const [activeDomain] = activeSkill.split('.');
  if (activeDomain !== domain) return false;
  const lower = query.toLowerCase();
  return /\b(too|as well|also|additionally|then)\b/.test(lower);
}

/**
 * Route a tool call to its owning skill.
 * Used when Gemini proposes a function call — we need to know which
 * skill owns that tool to validate and execute it properly.
 *
 * Resolution order:
 *   1. Skills whose steps actually use the tool (authoritative).
 *   2. Catalog-declared skillRoutes — used to REROUTE aliases/legacy tools
 *      into their canonical skill (e.g. `generateVideo` → media.video.generate,
 *      `send_whatsapp_message` → whatsapp.send_message). The skill's own steps
 *      then run the canonical tools.
 */
export function routeToolToSkill(toolName: string): SkillRoute | null {
  const byStep = findSkillsByTool(toolName);
  if (byStep.length > 0) return byStep[0];

  const catalogEntry = getToolCatalogEntry(toolName);
  if (catalogEntry) {
    for (const skillId of catalogEntry.skillRoutes) {
      const skill = getSkill(skillId);
      if (skill) return skill;
    }
  }

  return null;
}

/**
 * Check if a tool call should be allowed given the current skill context.
 * Returns the skill if allowed, null if the tool has no skill route.
 */
export function validateToolInSkillContext(
  toolName: string,
  activeSkill: string | undefined,
): { allowed: boolean; skill: SkillRoute | null; reason: string } {
  const skill = routeToolToSkill(toolName);

  if (!skill) {
    return {
      allowed: false,
      skill: null,
      reason: 'no_skill_route',
    };
  }

  // If there's an active skill, check if this tool belongs to it
  if (activeSkill && activeSkill !== 'conversation.default') {
    const [activeDomain] = activeSkill.split('.');
    if (skill.domain !== activeDomain && skill.domain !== 'system') {
      return {
        allowed: true, // Allow cross-domain tools but flag it
        skill,
        reason: 'cross_domain',
      };
    }
  }

  return {
    allowed: true,
    skill,
    reason: 'valid',
  };
}

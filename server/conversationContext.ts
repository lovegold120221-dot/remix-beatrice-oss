/**
 * Conversation context — tracks active state across a session.
 * Used by skill routing for pronoun resolution, follow-up detection,
 * and topic-shift detection.
 */

import type { ActiveContext } from './skills/types.js';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Create a fresh conversation context. */
export function createConversationContext(): ActiveContext {
  return {
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Update the context based on a tool call and result.
 */
export function updateContextFromToolCall(
  ctx: ActiveContext,
  toolName: string,
  toolArgs: Record<string, unknown>,
  result: unknown,
): ActiveContext {
  const updated = { ...ctx, lastUpdatedAt: Date.now() };
  updated.lastToolName = toolName;
  updated.lastToolArgs = toolArgs;
  updated.lastToolResult = result;

  // Update domain-specific context
  if (toolName === 'runCodingAgent' || toolName === 'runCliCommand') {
    updated.activeCodingTask = String(toolArgs.task || toolArgs.command || '');
  }

  if (toolName === 'qwenImageGenerate' || toolName === 'qwenImageEdit') {
    const r = result as Record<string, unknown>;
    if (r && typeof r === 'object') {
      updated.activeImage = String(r.imageUrl || r.url || '');
    }
  }

  if (toolName === 'qwenVideoGenerate' || toolName === 'generateVideo') {
    const r = result as Record<string, unknown>;
    if (r && typeof r === 'object') {
      updated.activeVideo = String(r.videoUrl || r.url || '');
    }
  }

  if (toolName === 'listGmailMessages' || toolName === 'getGmailMessage') {
    updated.activeContact = String(toolArgs.from || toolArgs.sender || '');
  }

  return updated;
}

/**
 * Update context when a skill route is selected.
 */
export function updateContextFromSkillSelection(
  ctx: ActiveContext,
  skillId: string,
  userGoal: string,
): ActiveContext {
  return {
    ...ctx,
    activeSkill: skillId,
    lastUserGoal: userGoal,
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Check if the context is stale (no updates for a while).
 */
export function isContextStale(ctx: ActiveContext): boolean {
  if (!ctx.lastUpdatedAt) return true;
  return Date.now() - ctx.lastUpdatedAt > STALE_THRESHOLD_MS;
}

/**
 * Reset context for a new topic (clear domain-specific state but keep general info).
 */
export function resetContextForNewTopic(ctx: ActiveContext): ActiveContext {
  return {
    lastUserGoal: ctx.lastUserGoal,
    lastToolName: undefined,
    lastToolArgs: undefined,
    lastToolResult: undefined,
    activeRepository: ctx.activeRepository,
    activeBrowserSession: ctx.activeBrowserSession,
    activeComputerSession: ctx.activeComputerSession,
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Detect if the user's query is a topic shift from the active skill.
 */
export function isTopicShift(
  currentSkill: string | undefined,
  newDomain: string,
  newText: string,
): boolean {
  if (!currentSkill) return false;

  const [currentDomain] = currentSkill.split('.');
  if (currentDomain === newDomain) return false;

  // Check for explicit topic shift indicators
  const lowerText = newText.toLowerCase();
  const shiftIndicators = ['actually', 'instead', 'forget that', 'never mind', 'wait', 'hold on', 'different thing', 'change topic', 'by the way', 'oh also', 'also'];
  return shiftIndicators.some((indicator) => lowerText.includes(indicator));
}

/**
 * Query router — parses raw user text into a structured QueryIntent.
 * This is the FIRST step in the routing pipeline:
 *   QueryIntent → SkillRouter → SkillExecutor → ToolRegistry
 */

import type { QueryIntent, QueryIntentResult, ActiveContext, SkillDomain } from './skills/types.js';
import { classifyIntent, isConversationOnly, getAllSkills } from './skills/index.js';

/**
 * Parse a raw user query into a structured QueryIntentResult.
 *
 * This is a lightweight heuristic classifier. For richer intent detection,
 * the Gemini function call provides the intent; this router pre-classifies
 * for the skill routing pipeline.
 */
export function parseQueryIntent(
  rawQuery: string,
  context: ActiveContext,
): QueryIntentResult {
  const normalizedQuery = rawQuery.trim();
  const lowerQuery = normalizedQuery.toLowerCase();

  // Detect language (basic heuristic)
  const language = detectLanguage(lowerQuery);

  // Check if this is purely conversational
  const conversationOnly = isConversationOnly(normalizedQuery);

  if (conversationOnly) {
    return {
      rawQuery,
      normalizedQuery,
      language,
      intent: 'conversation',
      domain: 'conversation',
      action: 'respond',
      entities: {},
      constraints: {},
      requiresTool: false,
      requiresFreshData: false,
      requiresExternalAction: false,
      destructive: false,
      missingInformation: [],
      candidateSkills: ['conversation.default'],
      confidence: 0.95,
      needsClarification: false,
      reasonCode: 'conversation_only',
    };
  }

  // Classify intent and domain
  const { intent, domain } = classifyIntent(normalizedQuery);

  // Extract entities
  const entities = extractEntities(lowerQuery, domain);

  // Detect missing information
  const missingInformation = detectMissingInfo(intent, domain, entities);

  // Determine if tools are needed:
  // - 'conversation' never needs a tool.
  // - 'question' needs a tool only when it asks for fresh/external data
  //   (weather, live search, news, latest info) or memory recall — not for
  //   conceptual "how does X work" discussion.
  // - any other intent (create/edit/execute/send/read/delete/...) needs a tool.
  const freshData = /\b(weather|forecast|news|latest|current|search|look up|find|recall|do you remember|what did we discuss|raining|rain|temperature|sunny|hot|cold)\b/.test(lowerQuery);
  let requiresTool = intent !== 'conversation' && intent !== 'question';
  if (intent === 'question') {
    if (freshData && (domain === 'web' || domain === 'memory')) requiresTool = true;
    // Questions about the user's own live data (WhatsApp/Google) need a tool.
    if (domain === 'whatsapp') requiresTool = true;
  }

  // Determine if destructive
  const destructive = intent === 'delete';

  // Find candidate skills
  const candidateSkills = findCandidateSkills(intent, domain, lowerQuery);

  // Check if clarification is needed
  const needsClarification = missingInformation.length > 0 && requiresTool;

  return {
    rawQuery,
    normalizedQuery,
    language,
    intent,
    domain,
    action: intent,
    entities,
    constraints: {},
    requiresTool,
    requiresFreshData: freshData,
    requiresExternalAction: false,
    destructive,
    missingInformation,
    candidateSkills,
    confidence: candidateSkills.length > 0 ? 0.7 : 0.3,
    needsClarification,
    reasonCode: candidateSkills.length > 0 ? 'classified' : 'no_candidates',
  };
}

/**
 * Find candidate skills for a given intent + domain + query text.
 */
function findCandidateSkills(
  intent: QueryIntent,
  domain: SkillDomain,
  text: string,
): string[] {
  const candidates: string[] = [];

  const skills = getAllSkills();

  for (const skill of skills) {
    let score = 0;

    // Domain match
    if (skill.domain === domain) score += 0.4;

    // Intent match
    if (skill.intents.includes(intent)) score += 0.3;

    // Trigger keyword match
    if (skill.triggers && skill.triggers.length > 0) {
      const matched = skill.triggers.some((t: string) => text.includes(t));
      if (matched) score += 0.3;
    }

    // Negative trigger penalty
    if (skill.negativeTriggers && skill.negativeTriggers.length > 0) {
      const matched = skill.negativeTriggers.some((t: string) => text.includes(t));
      if (matched) score -= 0.5;
    }

    if (score > 0.3) {
      candidates.push(skill.id);
    }
  }

  return candidates.sort();
}

/**
 * Extract named entities from the query (basic NER).
 */
function extractEntities(text: string, domain: SkillDomain): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  // File paths
  const filePathMatch = text.match(/(?:file|document|script)\s+([^\s]+\.(?:js|ts|py|json|md|txt|html|css))/);
  if (filePathMatch) entities.filePath = filePathMatch[1];

  // URLs
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) entities.url = urlMatch[1];

  // Email-like patterns
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) entities.email = emailMatch[1];

  // Commands (for code domain)
  if (domain === 'code') {
    const cmdMatch = text.match(/(?:run|execute|do)\s+(.+?)(?:\s+for me|\s+please|$)/);
    if (cmdMatch) entities.command = cmdMatch[1];
  }

  // Recipients (whatsapp / google send)
  if (domain === 'whatsapp' || (domain === 'google' && /\bsend\b/.test(text))) {
    const toMatch = text.match(/\b(?:to|tell|text|message|send)\s+(?!(?:this|it|that|the|a|an|me|him|her|them|us|my|your|an?|email|gmail|mail)\b)([a-z][a-z0-9]+)/);
    if (toMatch) entities.recipient = toMatch[1];
    const quoted = text.match(/"([^"]+)"|'([^']+)'/);
    if (quoted) entities.message = quoted[1] ?? quoted[2];
  }

  return entities;
}

/**
 * Detect missing information that would prevent execution.
 */
function detectMissingInfo(
  intent: QueryIntent,
  domain: SkillDomain,
  entities: Record<string, unknown>,
): string[] {
  const missing: string[] = [];

  if (domain === 'whatsapp' && (intent === 'send' || intent === 'create')) {
    if (!entities.recipient) missing.push('recipient');
    if (!entities.message && !entities.text) missing.push('message content');
  }

  if (domain === 'google' && intent === 'send') {
    if (!entities.to && !entities.recipient) missing.push('recipient');
  }

  if (domain === 'code' && intent === 'execute') {
    if (!entities.code && !entities.command) missing.push('code or command');
  }

  return missing;
}

/**
 * Basic language detection.
 */
function detectLanguage(text: string): string {
  // Tagalog/Filipino indicators
  const tagalogWords = ['ang', 'mga', 'ng', 'sa', 'ko', 'mo', 'niya', 'nila', 'namin', 'natin', 'para', 'kung', 'dahil', 'pero', 'at', 'o', 'hindi', 'pwede', 'sige', 'ge', 'yun', 'gumawa', 'gawin', 'kaya', 'bang', 'po', 'opo', 'ano', 'saan', 'bakit', 'paano'];
  const words = text.replace(/[?!.,;:]/g, '').split(/\s+/);
  const tagalogCount = tagalogWords.reduce((n, w) => n + (words.includes(w) ? 1 : 0), 0);
  const hasTagalog = tagalogCount > 0;

  // Common English words that signal a Taglish mix (Filipino text with English loanwords)
  const englishMarkers = ['picture', 'video', 'image', 'generate', 'send', 'message', 'weather', 'file', 'email', 'code', 'test', 'the', 'this', 'that', 'with', 'from', 'for', 'and', 'please', 'create', 'delete', 'show', 'list', 'make', 'open', 'close', 'do', 'run', 'can'];
  const hasEnglishMarker = englishMarkers.some((w) => words.includes(w));

  if (hasTagalog && hasEnglishMarker) return 'taglish';
  if (hasTagalog) return 'filipino';
  return 'english';
}

import type { SkillRoute } from './types.js';

export const memorySkills: SkillRoute[] = [
  {
    id: 'memory.remember',
    domain: 'memory',
    intents: ['create'],
    description: 'Store a memory for long-term recall',
    triggers: ['remember that', 'save this', 'don\'t forget', 'store this', 'note this down', 'keep in mind'],
    negativeTriggers: ['recall', 'what did you remember', 'forget that', 'forget about'],
    risk: 'write',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Memory content is valid.',
        onFailure: 'Ask what to remember.',
      },
      {
        id: 'store',
        action: 'tool',
        tool: 'remember_memory',
        argsBuilder: (ctx) => ({
          content: ctx.content,
          category: ctx.category,
        }),
        required: true,
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'text',
  },
  {
    id: 'memory.recall',
    domain: 'memory',
    intents: ['read', 'question'],
    description: 'Search long-term memory for relevant context',
    triggers: ['recall', 'what do you know about', 'do you remember', 'our previous', 'last time', 'what did we discuss'],
    negativeTriggers: ['remember this', 'save this', 'forget that'],
    risk: 'read',
    steps: [
      {
        id: 'search',
        action: 'tool',
        tool: 'recall_memory',
        argsBuilder: (ctx) => ({
          query: ctx.query,
          limit: ctx.limit,
        }),
        required: true,
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'text',
  },
  {
    id: 'memory.core_profile',
    domain: 'memory',
    intents: ['read', 'question'],
    description: 'Read the core persona profile from memory',
    triggers: ['core profile', 'persona', 'who are you', 'what is your personality'],
    negativeTriggers: ['remember something', 'recall a conversation'],
    risk: 'read',
    steps: [
      {
        id: 'read',
        action: 'tool',
        tool: 'get_core_memory',
        required: true,
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'text',
  },
];

export default memorySkills;

import type { SkillRoute } from './types.js';

export const systemSkills: SkillRoute[] = [
  {
    id: 'conversation.default',
    domain: 'conversation',
    intents: ['conversation', 'question'],
    description: 'Plain conversation — no tool needed',
    triggers: [],
    risk: 'read',
    steps: [{ id: 'respond', action: 'respond' }],
    outputMode: 'text',
  },
  {
    id: 'system.info',
    domain: 'system',
    intents: ['read', 'question'],
    description: 'Get system information (OS, CPU, memory, disk)',
    triggers: ['system info', 'system specs', 'how much memory', 'disk space', 'cpu usage', 'what os', 'server info'],
    negativeTriggers: ['run a command', 'execute code', 'build something'],
    risk: 'read',
    steps: [
      {
        id: 'info',
        action: 'tool',
        tool: 'getSystemInfo',
        required: true,
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'text',
  },
  {
    id: 'system.terminal',
    domain: 'system',
    intents: ['execute', 'control'],
    description: 'Open a terminal for the user (in-browser on desktop, Termius on mobile)',
    triggers: ['open a terminal', 'give me a terminal', 'open the terminal', 'terminal please', 'ssh terminal'],
    negativeTriggers: ['run', 'execute', 'npm', 'git', 'ls'],
    risk: 'execute',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Terminal request is valid.',
        onFailure: 'Ask what the user needs the terminal for.',
      },
      {
        id: 'open',
        action: 'tool',
        tool: 'openLocalTerminal',
        argsBuilder: (ctx) => ({
          command: ctx.command,
        }),
        required: true,
        onSuccess: 'Terminal opened.',
        onFailure: 'Report the error.',
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'action',
  },
];

export const presentationSkills: SkillRoute[] = [
  {
    id: 'presentation.canvas',
    domain: 'presentation',
    intents: ['create'],
    description: 'Update the canvas with diagrams, markdown, charts, or code',
    triggers: ['show diagram', 'draw chart', 'display markdown', 'canvas', 'render', 'visualize', 'show as'],
    negativeTriggers: ['generate an image', 'create a document', 'send a file'],
    risk: 'write',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
      },
      {
        id: 'render',
        action: 'tool',
        tool: 'updateCanvasVisual',
        argsBuilder: (ctx) => ({
          type: ctx.type,
          content: ctx.content,
          title: ctx.title,
        }),
        required: true,
      },
      { id: 'respond', action: 'respond' },
    ],
    outputMode: 'media',
  },
];

export default [...systemSkills, ...presentationSkills];

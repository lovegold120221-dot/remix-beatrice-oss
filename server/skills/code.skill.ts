import type { SkillRoute } from './types.js';

export const codeSkills: SkillRoute[] = [
  {
    id: 'code.explain',
    domain: 'code',
    intents: ['question', 'conversation'],
    description: 'Explain what code does, answer questions about code',
    triggers: ['explain', 'what does', 'how does', 'what is', 'walk me through', 'walkthrough', 'describe', 'meaning of', 'purpose of'],
    negativeTriggers: ['run', 'execute', 'build', 'deploy', 'fix', 'change', 'edit', 'modify', 'refactor', 'write', 'create', 'implement'],
    risk: 'read',
    steps: [
      {
        id: 'resolve',
        action: 'resolve',
        when: 'code reference is ambiguous (pronouns, "this", "that")',
        onSuccess: 'Analyze the resolved code file or snippet.',
        onFailure: 'Ask the user which file or code block they mean.',
      },
      {
        id: 'search',
        action: 'tool',
        tool: 'deployAgentTask',
        argsBuilder: (ctx) => ({
          task: `Explain the following code the user asked about: ${ctx.query}`,
          filesToRead: ctx.filesToRead,
        }),
        onSuccess: 'Summarize the explanation.',
        onFailure: 'Use the information from the resolved context to explain.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Provide a clear, step-by-step explanation.',
      },
    ],
    outputMode: 'text',
  },
  {
    id: 'code.run_snippet',
    domain: 'code',
    intents: ['execute'],
    description: 'Execute a short code snippet in a sandboxed environment',
    triggers: ['run this', 'execute this', 'show me a quick', 'test this snippet', 'run snippet', 'run code', 'sandbox', 'playground'],
    negativeTriggers: ['run my project', 'run the server', 'run npm', 'run the build', 'modify my code', 'build a feature'],
    risk: 'execute',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Code is valid for sandbox execution.',
        onFailure: 'Ask the user for the code to execute or specify the language.',
      },
      {
        id: 'execute',
        action: 'tool',
        tool: 'executeCodeSandbox',
        argsBuilder: (ctx) => ({
          code: ctx.code,
          language: ctx.language,
        }),
        required: true,
        onSuccess: 'Return the output.',
        onFailure: 'Report the execution error.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Show output and explain.',
      },
    ],
    successCriteria: [
      { name: 'output_produced', description: 'Sandbox returned stdout/stderr output' },
    ],
    outputMode: 'text',
  },
  {
    id: 'code.run_command',
    domain: 'code',
    intents: ['execute'],
    description: 'Run a shell command (npm, git, ls, etc.)',
    triggers: ['run', 'execute', 'npm', 'git', 'ls', 'cd', 'node', 'python', 'shell', 'terminal', 'bash', 'command'],
    negativeTriggers: ['run a code snippet', 'execute a snippet', 'run sandbox code', 'build a feature', 'modify my code'],
    risk: 'execute',
    requiredContext: ['command or shell command detected'],
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Command is safe to execute.',
        onFailure: 'Ask the user which command to run.',
      },
      {
        id: 'execute',
        action: 'tool',
        tool: 'runCliCommand',
        argsBuilder: (ctx) => ({
          command: ctx.command,
          workingDirectory: ctx.workingDirectory,
        }),
        required: true,
        onSuccess: 'Return the output.',
        onFailure: 'Report the command error.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Show command output.',
      },
    ],
    successCriteria: [
      { name: 'output_produced', description: 'CLI returned output or exit code 0' },
    ],
    outputMode: 'text',
  },
  {
    id: 'code.modify_repository',
    domain: 'code',
    intents: ['create', 'edit', 'execute'],
    description: 'Build, implement, refactor, or fix features in the codebase',
    triggers: ['build', 'implement', 'fix', 'refactor', 'create a', 'add a', 'change the', 'modify', 'update the', 'write', 'develop', 'scaffold', 'feature', 'bug', 'issue'],
    negativeTriggers: ['run a command', 'run npm', 'git status', 'explain this', 'what does this do', 'run a snippet'],
    risk: 'write',
    requiredContext: ['description of the feature or change'],
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Clear task description available.',
        onFailure: 'Ask the user what they want to build or change.',
      },
      {
        id: 'deploy',
        action: 'tool',
        tool: 'runCodingAgent',
        argsBuilder: (ctx) => ({
          task: ctx.task,
          workingDirectory: ctx.workingDirectory,
          model: ctx.model,
        }),
        required: true,
        onSuccess: 'Code changes applied.',
        onFailure: 'Report the coding agent error.',
      },
      {
        id: 'verify',
        action: 'verify',
        onSuccess: 'Changes are ready.',
        onFailure: 'Ask the user to verify.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Summarize changes.',
      },
    ],
    successCriteria: [
      { name: 'files_modified', description: 'At least one file was created or modified' },
      { name: 'build_passes', description: 'Typecheck passes after changes' },
    ],
    fallback: [
      {
        trigger: 'coding_agent_unavailable',
        skillId: 'code.run_command',
        description: 'Fall back to manual CLI commands if the coding agent cannot handle it',
      },
    ],
    outputMode: 'text',
  },
  {
    id: 'code.review_repository',
    domain: 'code',
    intents: ['inspect', 'question'],
    description: 'Review, audit, or analyze the codebase',
    triggers: ['review', 'audit', 'analyze', 'check for', 'find bugs', 'security audit', 'code review', 'look for issues', 'assess', 'evaluate'],
    negativeTriggers: ['fix the bugs', 'implement a feature', 'build something', 'modify the code'],
    risk: 'read',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Review scope is clear.',
        onFailure: 'Ask the user what to focus on.',
      },
      {
        id: 'deploy',
        action: 'tool',
        tool: 'deployAgentTask',
        argsBuilder: (ctx) => ({
          task: ctx.task,
          filesToRead: ctx.filesToRead,
        }),
        required: true,
        onSuccess: 'Analysis complete.',
        onFailure: 'Report the review error.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Provide structured findings.',
      },
    ],
    outputMode: 'text',
  },
];

export default codeSkills;

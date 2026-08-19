// Core types for the Beatrice skill-based routing architecture.
//
// FUNCTIONS = low-level capabilities.
// SKILLS = predefined ways those capabilities are used.
// ROUTES = mapping from user intent to the correct skill.
//
// Beatrice must:
//   UNDERSTAND → SELECT SKILL → FOLLOW FLOW → EXECUTE TOOLS → VERIFY → RESPOND

// ── Domain & Intent Taxonomy ────────────────────────────────────────────────

export type SkillDomain =
  | 'code'
  | 'media'
  | 'web'
  | 'whatsapp'
  | 'google'
  | 'memory'
  | 'browser'
  | 'computer'
  | 'system'
  | 'presentation'
  | 'conversation';

export type QueryIntent =
  | 'conversation'
  | 'question'
  | 'search'
  | 'create'
  | 'edit'
  | 'execute'
  | 'inspect'
  | 'send'
  | 'read'
  | 'delete'
  | 'schedule'
  | 'generate'
  | 'control'
  | 'remember'
  | 'recall'
  | 'research'
  | 'none';

export type SkillAction =
  | 'analyze'
  | 'resolve'
  | 'validate'
  | 'tool'
  | 'confirm'
  | 'transform'
  | 'verify'
  | 'respond';

export type RiskLevel = 'read' | 'write' | 'execute' | 'generate' | 'destructive';

// ── Query Intent (parsed user request) ──────────────────────────────────────

export interface QueryIntentResult {
  rawQuery: string;
  normalizedQuery: string;
  language: string;
  intent: QueryIntent;
  domain: SkillDomain;
  action: string;
  entities: Record<string, unknown>;
  constraints: Record<string, unknown>;
  requiresTool: boolean;
  requiresFreshData: boolean;
  requiresExternalAction: boolean;
  destructive: boolean;
  missingInformation: string[];
  candidateSkills: string[];
  selectedSkill?: string;
  confidence: number;
  needsClarification: boolean;
  reasonCode: string;
}

// ── Skill Route Definition ──────────────────────────────────────────────────

export interface SkillRoute {
  id: string;
  domain: SkillDomain;
  intents: QueryIntent[];
  description: string;
  triggers?: string[];
  negativeTriggers?: string[];
  requiredContext?: string[];
  requiredPermissions?: string[];
  destructive?: boolean;
  risk: RiskLevel;
  steps: SkillStep[];
  successCriteria?: SkillSuccessCriteria[];
  fallback?: SkillFallback[];
  outputMode?: 'text' | 'media' | 'file' | 'action' | 'mixed';
}

export interface SkillStep {
  id: string;
  action: SkillAction;
  /** Registered tool name — required when action === 'tool'. */
  tool?: string;
  /** Optional args builder: receives context from previous steps. */
  argsBuilder?: (context: Record<string, unknown>) => Record<string, unknown>;
  required?: boolean;
  when?: string;
  onSuccess?: string;
  onFailure?: string;
}

export interface SkillSuccessCriteria {
  name: string;
  description: string;
}

export interface SkillFallback {
  trigger: string;
  skillId: string;
  description: string;
}

// ── Active Conversation/Task Context ────────────────────────────────────────

export interface ActiveContext {
  lastUserGoal?: string;
  activeSkill?: string;
  lastToolName?: string;
  lastToolArgs?: Record<string, unknown>;
  lastToolResult?: unknown;
  activeRepository?: string;
  activeFile?: string;
  activeContact?: string;
  activeImage?: string;
  activeVideo?: string;
  activeBrowserSession?: string;
  activeComputerSession?: string;
  activeCodingTask?: string;
  /** Timestamp of last context update for staleness detection. */
  lastUpdatedAt?: number;
}

// ── Skill Execution State ───────────────────────────────────────────────────

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface SkillStepExecution {
  id: string;
  status: StepStatus;
  tool?: string;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface SkillExecution {
  id: string;
  skillId: string;
  domain: SkillDomain;
  status: ExecutionStatus;
  currentStep: string;
  steps: SkillStepExecution[];
  context: Record<string, unknown>;
  artifacts: { type: string; value: string }[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

// ── Routing Decision ────────────────────────────────────────────────────────

export type RoutingDecision = 'allow' | 'reroute' | 'clarify' | 'block';

export interface ToolRouteDecision {
  decision: RoutingDecision;
  tool: string;
  args: Record<string, unknown>;
  reasonCode: string;
  message?: string;
}

// ── Skill Resolution Result ─────────────────────────────────────────────────

export interface SkillResolution {
  skillId: string;
  confidence: number;
  missingInformation: string[];
  reasonCode: string;
}

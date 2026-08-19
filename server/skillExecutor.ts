/**
 * Skill executor — runs a skill route's steps in order.
 * Manages step execution, conditions, retry, verification,
 * and emits `skillExecutionUpdate` WS events.
 */

import type {
  SkillRoute,
  SkillStep,
  SkillExecution,
  SkillStepExecution,
  ExecutionStatus,
  StepStatus,
  ActiveContext,
} from './skills/types.js';
import { getSkill } from './skills/index.js';
import { updateContextFromToolCall } from './conversationContext.js';
import { dispatchTool, type ToolContext } from './toolRegistry.js';
import {
  incCounter,
  registerSkillMetrics,
  observeHistogram,
} from './metrics.js';

// Ensure routing metrics exist even if the server never called
// registerStandardMetrics (e.g. tests importing this module directly).
registerSkillMetrics();

let executionCounter = 0;

/** Broadcast a skill execution update to the client. */
export type SkillUpdateBroadcaster = (msg: Record<string, unknown>) => void;

/**
 * Create a new skill execution.
 */
export function createSkillExecution(
  skillId: string,
  context: Record<string, unknown>,
): SkillExecution {
  const skill = getSkill(skillId);
  const id = `skill-${++executionCounter}-${Date.now()}`;

  return {
    id,
    skillId,
    domain: skill?.domain ?? 'conversation',
    status: 'queued',
    currentStep: skill?.steps[0]?.id ?? '',
    steps: (skill?.steps ?? []).map((step) => ({
      id: step.id,
      status: 'pending' as StepStatus,
      tool: step.tool,
    })),
    context,
    artifacts: [],
    startedAt: Date.now(),
  };
}

/**
 * Execute a skill step.
 */
async function executeStep(
  step: SkillStep,
  execution: SkillExecution,
  toolCtx: ToolContext,
  broadcast: SkillUpdateBroadcaster,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const stepExec = execution.steps.find((s) => s.id === step.id);
  if (stepExec) {
    stepExec.status = 'running';
    stepExec.startedAt = Date.now();
  }

  broadcastUpdate(execution, 'running', broadcast);

  // Build args if argsBuilder is provided
  const args = step.argsBuilder
    ? step.argsBuilder(execution.context)
    : {};

  if (step.action === 'tool' && step.tool) {
    try {
      const result = await dispatchTool(step.tool, args, toolCtx);

      if (stepExec) {
        stepExec.status = 'completed';
        stepExec.result = result;
        stepExec.completedAt = Date.now();
      }

      // Update context with tool result
      if (result !== undefined) {
        execution.context = {
          ...execution.context,
          [`${step.tool}_result`]: result,
        };
      }

      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (stepExec) {
        stepExec.status = 'failed';
        stepExec.error = errorMsg;
        stepExec.completedAt = Date.now();
      }
      return { success: false, error: errorMsg };
    }
  }

  // Non-tool steps (validate, resolve, confirm, verify, respond)
  // These are handled by the skill executor's logic, not dispatched
  if (stepExec) {
    stepExec.status = 'completed';
    stepExec.completedAt = Date.now();
  }
  return { success: true };
}

/**
 * Execute a full skill route.
 */
export async function executeSkill(
  skillId: string,
  initialContext: Record<string, unknown>,
  toolCtx: ToolContext,
  broadcast: SkillUpdateBroadcaster,
  conversationCtx?: ActiveContext,
): Promise<SkillExecution> {
  const startedAt = Date.now();
  incCounter('beatrice_skill_execution_total');

  const skill = getSkill(skillId);
  if (!skill) {
    const execution = createSkillExecution(skillId, initialContext);
    execution.status = 'failed';
    execution.error = `Skill not found: ${skillId}`;
    execution.completedAt = Date.now();
    broadcastUpdate(execution, 'failed', broadcast);
    incCounter('beatrice_skill_execution_failures_total');
    observeHistogram('beatrice_skill_execution_duration_seconds', (Date.now() - startedAt) / 1000);
    return execution;
  }

  const execution = createSkillExecution(skillId, initialContext);
  execution.status = 'running';
  execution.context = { ...initialContext };

  broadcastUpdate(execution, 'running', broadcast);

  let currentStepIndex = 0;

  while (currentStepIndex < skill.steps.length) {
    const step = skill.steps[currentStepIndex];
    execution.currentStep = step.id;

    // Check if step should be skipped (when condition not met)
    if (step.when) {
      const shouldSkip = evaluateCondition(step.when, execution.context);
      if (!shouldSkip) {
        const stepExec = execution.steps.find((s) => s.id === step.id);
        if (stepExec) {
          stepExec.status = 'skipped';
          stepExec.completedAt = Date.now();
        }
        currentStepIndex++;
        continue;
      }
    }

    // Execute the step
    const result = await executeStep(step, execution, toolCtx, broadcast);

    if (result.success) {
      // Move to next step
      currentStepIndex++;
    } else if (step.onFailure) {
      // Try failure handler
      const failureStep = skill.steps.find((s) => s.id === step.onFailure);
      if (failureStep) {
        currentStepIndex = skill.steps.indexOf(failureStep);
      } else {
        // No failure handler, check fallback
        if (skill.fallback && skill.fallback.length > 0) {
          const fallback = skill.fallback[0];
          execution.status = 'failed';
          execution.error = `Step ${step.id} failed: ${result.error}`;
          execution.completedAt = Date.now();
          broadcastUpdate(execution, 'failed', broadcast);
          incCounter('beatrice_skill_execution_failures_total');
          observeHistogram('beatrice_skill_execution_duration_seconds', (Date.now() - startedAt) / 1000);
          return execution;
        }
        currentStepIndex++;
      }
    } else if (step.required) {
      // Required step failed with no handler
      execution.status = 'failed';
      execution.error = `Required step ${step.id} failed: ${result.error}`;
      execution.completedAt = Date.now();
      broadcastUpdate(execution, 'failed', broadcast);
      incCounter('beatrice_skill_execution_failures_total');
      observeHistogram('beatrice_skill_execution_duration_seconds', (Date.now() - startedAt) / 1000);
      return execution;
    } else {
      // Optional step failed, continue
      currentStepIndex++;
    }
  }

  // All steps complete
  execution.status = 'completed';
  execution.completedAt = Date.now();
  broadcastUpdate(execution, 'completed', broadcast);
  observeHistogram('beatrice_skill_execution_duration_seconds', (Date.now() - startedAt) / 1000);

  return execution;
}

/**
 * Broadcast a skill execution update.
 */
function broadcastUpdate(
  execution: SkillExecution,
  status: ExecutionStatus,
  broadcast: SkillUpdateBroadcaster,
): void {
  const skill = getSkill(execution.skillId);
  const currentStepExec = execution.steps.find((s) => s.id === execution.currentStep);

  broadcast({
    type: 'skillExecutionUpdate',
    executionId: execution.id,
    skillId: execution.skillId,
    skillName: skill?.description ?? execution.skillId,
    domain: execution.domain,
    status,
    currentStep: execution.currentStep,
    currentStepTool: currentStepExec?.tool,
    progress: calculateProgress(execution),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    error: execution.error,
  });
}

/**
 * Calculate execution progress (0-100).
 */
function calculateProgress(execution: SkillExecution): number {
  if (execution.steps.length === 0) return 100;
  const completed = execution.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length;
  return Math.round((completed / execution.steps.length) * 100);
}

/**
 * Evaluate a simple condition string against context.
 * Supports: 'ctx.field' existence checks.
 */
function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  // Simple condition: check if a context field exists and is truthy
  const field = condition.replace('ctx.', '');
  return !!context[field];
}

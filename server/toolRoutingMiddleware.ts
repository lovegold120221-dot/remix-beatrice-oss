/**
 * Tool routing middleware — intercepts Gemini function calls and
 * routes them through the skill system before execution.
 *
 * Flow:
 *   Gemini proposes function call → ToolRoutingMiddleware
 *     → resolveToolCall() → ALLOW / REROUTE / CLARIFY / BLOCK
 *     → If ALLOW: dispatch to toolRegistry
 *     → If REROUTE: dispatch to the correct tool via skill route
 *     → If CLARIFY: return clarification response to Gemini
 *     → If BLOCK: return block response to Gemini
 */

import type { QueryIntentResult, ToolRouteDecision, SkillExecution, ActiveContext } from './skills/types.js';
import { getToolCatalogEntry } from './toolCatalog.js';
import { routeToolToSkill, validateToolInSkillContext } from './skillRouter.js';
import { getSkill } from './skills/index.js';
import { dispatchTool, type ToolContext } from './toolRegistry.js';
import {
  executeSkill,
  createSkillExecution,
  type SkillUpdateBroadcaster,
} from './skillExecutor.js';
import {
  incCounter,
  registerSkillMetrics,
  observeHistogram,
} from './metrics.js';

// Ensure routing metrics exist even if the server never called
// registerStandardMetrics (e.g. tests importing this module directly).
registerSkillMetrics();

/**
 * Result of routing a single tool call.
 */
export interface ToolRouteResult {
  decision: ToolRouteDecision;
  execution?: SkillExecution;
}

/**
 * Resolve a Gemini function call through the skill routing system.
 *
 * This is the main entry point called from the server.ts function call loop.
 */
export function resolveToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  activeSkill: string | undefined,
  conversationContext: ActiveContext,
): ToolRouteDecision {
  // 1. Check if tool exists in catalog
  const catalogEntry = getToolCatalogEntry(toolName);
  if (!catalogEntry) {
    incCounter('beatrice_tool_validation_failures_total');
    return {
      decision: 'block',
      tool: toolName,
      args: toolArgs,
      reasonCode: 'unknown_tool',
      message: `I don't know how to use the tool "${toolName}".`,
    };
  }

  // 2. Check if tool has a skill route
  const skill = routeToolToSkill(toolName);
  if (!skill) {
    incCounter('beatrice_tool_validation_failures_total');
    return {
      decision: 'block',
      tool: toolName,
      args: toolArgs,
      reasonCode: 'no_skill_route',
      message: `The tool "${toolName}" is not assigned to any skill route.`,
    };
  }

  // 3. Validate tool in current skill context
  const validation = validateToolInSkillContext(toolName, activeSkill);

  if (!validation.allowed) {
    incCounter('beatrice_tool_validation_failures_total');
    return {
      decision: 'block',
      tool: toolName,
      args: toolArgs,
      reasonCode: validation.reason,
      message: `Cannot use "${toolName}" in the current context.`,
    };
  }

  // 4. Check if confirmation is needed for destructive operations
  if (catalogEntry.requiresConfirmation && catalogEntry.risk === 'destructive') {
    incCounter('beatrice_skill_route_clarification_total');
    return {
      decision: 'clarify',
      tool: toolName,
      args: toolArgs,
      reasonCode: 'confirmation_required',
      message: `This will perform a destructive operation. Are you sure you want to proceed with "${toolName}"?`,
    };
  }

  // 5. Check if requirements are met
  const missingReqs = checkRequirements(catalogEntry.requirements, conversationContext);
  if (missingReqs.length > 0) {
    incCounter('beatrice_skill_route_clarification_total');
    return {
      decision: 'clarify',
      tool: toolName,
      args: toolArgs,
      reasonCode: 'missing_requirements',
      message: `Missing requirements for "${toolName}": ${missingReqs.join(', ')}.`,
    };
  }

  // 6. Cross-domain check: suggest rerouting if tool is from a different domain
  if (validation.reason === 'cross_domain') {
    incCounter('beatrice_skill_route_override_total');
    return {
      decision: 'reroute',
      tool: toolName,
      args: toolArgs,
      reasonCode: 'cross_domain_suggestion',
      message: `The "${toolName}" tool belongs to the ${skill.domain} domain. Using it in the current context.`,
    };
  }

  // 7. Allow the tool call
  incCounter('beatrice_skill_route_total');
  return {
    decision: 'allow',
    tool: toolName,
    args: toolArgs,
    reasonCode: 'valid',
  };
}

/**
 * Execute a tool call through the skill routing system.
 * This handles the full lifecycle: resolve → execute → broadcast.
 */
export async function executeToolWithSkillRouting(
  toolName: string,
  toolArgs: Record<string, unknown>,
  activeSkill: string | undefined,
  conversationContext: ActiveContext,
  toolCtx: ToolContext,
  broadcast: SkillUpdateBroadcaster,
): Promise<ToolRouteResult> {
  // Resolve the tool call
  const decision = resolveToolCall(toolName, toolArgs, activeSkill, conversationContext);

  if (decision.decision === 'block') {
    return { decision };
  }

  if (decision.decision === 'clarify') {
    return { decision };
  }

  // For allow/reroute, execute through the skill system
  const skill = routeToolToSkill(toolName);
  if (!skill) {
    // Fallback: direct dispatch
    try {
      const result = await dispatchTool(toolName, toolArgs, toolCtx);
      return {
        decision,
        execution: {
          id: `direct-${Date.now()}`,
          skillId: 'direct',
          domain: 'conversation',
          status: 'completed',
          currentStep: 'direct',
          steps: [{ id: 'direct', status: 'completed', tool: toolName, result }],
          context: toolArgs,
          artifacts: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
      };
    } catch (err) {
      return {
        decision: {
          ...decision,
          decision: 'block',
          reasonCode: 'execution_error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // Execute through the skill
  const execution = await executeSkill(
    skill.id,
    { ...toolArgs, _originalTool: toolName, _originalArgs: toolArgs },
    toolCtx,
    broadcast,
    conversationContext,
  );

  // Record the active skill so follow-ups ("make it shorter", "do it again")
  // can resolve against this skill in the conversation context.
  if (execution.status === 'running' || execution.status === 'completed') {
    conversationContext.activeSkill = execution.skillId;
  }

  return { decision, execution };
}

/**
 * Check if all requirements for a tool are met.
 */
function checkRequirements(
  requirements: string[],
  context: ActiveContext,
): string[] {
  const missing: string[] = [];

  for (const req of requirements) {
    switch (req) {
      case 'activeImage':
        if (!context.activeImage) missing.push('an image (use image generation first)');
        break;
      case 'activeVideo':
        if (!context.activeVideo) missing.push('a video (use video generation first)');
        break;
      case 'google_auth':
        // Google auth is checked at runtime by the handler
        break;
      case 'whatsapp_connected':
        // WhatsApp connection is checked at runtime
        break;
      case 'memory_service':
        // Memory service is checked at runtime
        break;
      case 'DASHSCOPE_API_KEY':
        // API key is checked at runtime
        break;
    }
  }

  return missing;
}

/**
 * Handle the function call loop iteration through the skill system.
 * Called from server.ts for each Gemini function call.
 *
 * Returns the tool response string to send back to Gemini.
 */
export async function handleFunctionCallWithSkills(
  functionName: string,
  functionArgs: Record<string, unknown>,
  activeSkill: string | undefined,
  conversationContext: ActiveContext,
  toolCtx: ToolContext,
  broadcast: SkillUpdateBroadcaster,
): Promise<string> {
  const result = await executeToolWithSkillRouting(
    functionName,
    functionArgs,
    activeSkill,
    conversationContext,
    toolCtx,
    broadcast,
  );

  // Update conversation context with the tool call
  // (This is done by the caller in server.ts)

  // Return appropriate response
  if (result.decision.decision === 'block') {
    return result.decision.message || `Cannot execute "${functionName}".`;
  }

  if (result.decision.decision === 'clarify') {
    return result.decision.message || `Need more information to execute "${functionName}".`;
  }

  if (result.execution) {
    if (result.execution.status === 'completed') {
      // Find the tool step result
      const toolStep = result.execution.steps.find(
        (s) => s.tool === functionName && s.status === 'completed',
      );
      if (toolStep?.result !== undefined) {
        return typeof toolStep.result === 'string'
          ? toolStep.result
          : JSON.stringify(toolStep.result);
      }
      return `Skill "${result.execution.skillId}" completed successfully.`;
    }

    if (result.execution.status === 'failed') {
      return result.execution.error || `Skill "${result.execution.skillId}" failed.`;
    }
  }

  return `Processed "${functionName}" through skill routing.`;
}

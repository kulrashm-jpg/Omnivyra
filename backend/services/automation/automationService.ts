import { supabase } from '../../db/supabaseClient';
import {
  CONFIDENCE_RANK,
  DECISION_REASONS,
  MIN_PATTERN_SAMPLE_SIZE,
  MIN_PATTERN_UPLIFT,
  isAutomatableActionType,
  isGlobalAutomationDisabled,
} from './automationConstants';
import {
  getAutomationConfig,
  allowedActionsFromConfig,
  type AutomationConfig,
} from './automationConfigStore';
import { recordAutomationDecision } from './automationLogger';
import type { IntelligenceResponse } from '../intelligence/intelligenceService';
import type { CommunityAiAction, ExecutionResult } from '../communityAiActionExecutor';
import { ownedDbTable } from '../../db/writeOwner';

/**
 * Automation decision engine + execution orchestrator.
 *
 * Safety contract (in order of evaluation):
 *   1. GLOBAL_AUTOMATION_DISABLED env → hard block.
 *   2. Org config.enabled === true.
 *   3. action_type in hard automatable whitelist AND in config.allowed_actions
 *      AND the matching per-action toggle (auto_reply_enabled / auto_dm_enabled).
 *   4. intelligence.confidence.level ≥ config.min_confidence_level.
 *   5. intelligence.recommendation must be present.
 *   6. A learned comparison must back it with sample_size ≥ threshold and
 *      uplift_percent implies ratio ≥ 1.1.
 *   7. Daily limit not exceeded (atomic DB gate via
 *      increment_automation_usage_if_allowed).
 *
 * EVERY decision, allowed or blocked, is audited. If the audit write
 * fails the decision is demoted to BLOCKED — no log, no automation.
 */

export type ShouldAutoExecuteInput = {
  organization_id: string;
  platform: string;
  action_type: string;
  target_id: string;
  action_id?: string | null;
  intelligence: IntelligenceResponse;
};

export type ShouldAutoExecuteResult = {
  allowed: boolean;
  reason: string;
  pattern_type?: string | null;
  /**
   * Present when a decision has been persisted to automation_logs.
   * Callers can thread this into downstream metadata for cross-join.
   */
  log_id?: string | null;
  config?: AutomationConfig | null;
};

function confidenceSatisfies(
  observed: 'low' | 'medium' | 'high' | undefined,
  floor: 'medium' | 'high',
): boolean {
  if (!observed) return false;
  return CONFIDENCE_RANK[observed] >= CONFIDENCE_RANK[floor];
}

function topEligibleComparison(ir: IntelligenceResponse): {
  pattern_type: string;
  sample_size: number;
  uplift_percent: number | null;
} | null {
  const cmps = Array.isArray(ir.comparisons) ? ir.comparisons : [];
  for (const c of cmps) {
    const uplift = typeof c.uplift_percent === 'number' ? c.uplift_percent : null;
    const samples = typeof c.sample_size === 'number' ? c.sample_size : 0;
    if (samples < MIN_PATTERN_SAMPLE_SIZE) continue;
    if (uplift === null) continue;
    if (1 + uplift / 100 < MIN_PATTERN_UPLIFT) continue;
    return { pattern_type: c.winner, sample_size: samples, uplift_percent: uplift };
  }
  return null;
}

/**
 * Decide whether to auto-execute. Writes ONE audit row per invocation
 * (allowed OR blocked). Does NOT dispatch; callers should chain into
 * `runAutoExecution` when `allowed === true`.
 */
export async function shouldAutoExecute(
  input: ShouldAutoExecuteInput,
): Promise<ShouldAutoExecuteResult> {
  const commonLogFields = {
    organization_id: input.organization_id,
    action_id: input.action_id ?? null,
    platform: input.platform,
    action_type: input.action_type,
    target_id: input.target_id,
    confidence_level: input.intelligence?.confidence?.level ?? null,
    confidence_score: input.intelligence?.confidence?.score ?? null,
  } as const;

  async function deny(reason: string, pattern_type: string | null = null, metadata?: Record<string, unknown>) {
    const log = await recordAutomationDecision({
      ...commonLogFields,
      decision: 'blocked',
      reason,
      pattern_type,
      metadata: metadata ?? null,
    });
    return {
      allowed: false,
      reason,
      pattern_type,
      log_id: log.row_id ?? null,
    };
  }

  // 1. Global kill switch.
  if (isGlobalAutomationDisabled()) {
    return deny(DECISION_REASONS.GLOBAL_DISABLED);
  }

  // 2. Org config.
  const config = await getAutomationConfig(input.organization_id);
  if (!config.enabled) {
    return deny(DECISION_REASONS.ORG_DISABLED);
  }

  // 3. Action whitelist — both the hard-coded list AND the org's config.
  const actionType = (input.action_type || '').toLowerCase();
  if (!isAutomatableActionType(actionType)) {
    return deny(DECISION_REASONS.ACTION_NOT_AUTOMATABLE);
  }
  const orgAllowed = allowedActionsFromConfig(config);
  if (!orgAllowed.includes(actionType as 'reply' | 'dm')) {
    return deny(DECISION_REASONS.ACTION_NOT_WHITELISTED);
  }

  // 4. Confidence floor.
  const level = input.intelligence?.confidence?.level;
  if (!confidenceSatisfies(level, config.min_confidence_level)) {
    return deny(DECISION_REASONS.LOW_CONFIDENCE);
  }

  // 5. Recommendation must exist.
  if (!input.intelligence?.recommendation) {
    return deny(DECISION_REASONS.NO_RECOMMENDATION);
  }

  // 6. Pattern strength gate (samples + uplift).
  const top = topEligibleComparison(input.intelligence);
  if (!top) {
    return deny(DECISION_REASONS.WEAK_PATTERN);
  }

  // 7. Daily limit — atomic DB-side gate.
  let newCount: number | null = null;
  try {
    const { data } = await supabase.rpc('increment_automation_usage_if_allowed', {
      p_org_id: input.organization_id,
      p_limit:  config.daily_limit,
    });
    newCount = typeof data === 'number' ? data : (data ?? null);
  } catch (err: any) {
    console.warn('[automationService] usage increment failed:', err?.message || err);
  }
  if (newCount === null || newCount === undefined) {
    return deny(DECISION_REASONS.DAILY_LIMIT, top.pattern_type, {
      daily_limit: config.daily_limit,
    });
  }

  // Allowed.
  const log = await recordAutomationDecision({
    ...commonLogFields,
    decision: 'allowed',
    reason: DECISION_REASONS.ALLOWED,
    pattern_type: top.pattern_type,
    metadata: {
      usage_after: newCount,
      daily_limit: config.daily_limit,
      recommendation: input.intelligence.recommendation,
      uplift_percent: top.uplift_percent,
      sample_size: top.sample_size,
    },
  });

  // NO LOG, NO AUTOMATION: if we can't write the allowed row, we
  // reverse course — but we already incremented usage on the DB.
  // Bump the counter back down to keep the limit honest.
  if (!log.ok) {
    try {
      await ownedDbTable('automation_usage')
        .update({
          actions_executed: Math.max(0, (newCount ?? 1) - 1),
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', input.organization_id)
        .eq('day', new Date().toISOString().slice(0, 10));
    } catch { /* swallow */ }
    return {
      allowed: false,
      reason: 'audit_log_write_failed',
      pattern_type: top.pattern_type,
      log_id: null,
      config,
    };
  }

  return {
    allowed: true,
    reason: DECISION_REASONS.ALLOWED,
    pattern_type: top.pattern_type,
    log_id: log.row_id ?? null,
    config,
  };
}

/**
 * Orchestrator: decision + execution in one call. Callers that want to
 * preview the decision without dispatching should use `shouldAutoExecute`
 * directly; `runAutoExecution` is the "do it if the engine says yes"
 * helper that threads the automation metadata into the executor.
 *
 * Returns `auto_executed: true` + the executor's ExecutionResult when
 * automation fired; `auto_executed: false` + the decision reason when
 * the engine blocked it.
 */
export async function runAutoExecution(input: {
  action: CommunityAiAction;
  intelligence: IntelligenceResponse;
}): Promise<
  | { auto_executed: true; decision: ShouldAutoExecuteResult; result: ExecutionResult }
  | { auto_executed: false; decision: ShouldAutoExecuteResult }
> {
  const decision = await shouldAutoExecute({
    organization_id: input.action.organization_id,
    platform: input.action.platform,
    action_type: input.action.action_type,
    target_id: input.action.target_id,
    action_id: input.action.id,
    intelligence: input.intelligence,
  });
  if (!decision.allowed) {
    return { auto_executed: false, decision };
  }

  // Use the SAME execution pipeline the manual path uses. persist:true
  // + auto_insert:true cover the ad-hoc action case (engagement APIs
  // generate synthetic ids); the auto flag is surfaced on the result
  // so UIs can badge the row.
  const { executeAction } = await import('../communityAiActionExecutor');
  const result = await executeAction(
    input.action,
    true,
    {
      source: 'auto',
      persist: true,
      auto_insert: true,
      auto: true,
      automation_decision_log_id: decision.log_id ?? undefined,
    },
  );

  return { auto_executed: true, decision, result };
}

export type { AutomationConfig };

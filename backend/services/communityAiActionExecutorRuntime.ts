/** Community AI actions — execution runtime + dispatch — split from communityAiActionExecutor.ts (barrel preserved; importers unchanged). */
import { createHash, randomUUID } from 'crypto';
import { normalizePlatform } from '../constants/platforms';
import { notifyCommunityAi } from './communityAiNotificationService';
import { sendCommunityAiWebhooks } from './communityAiWebhookService';
import { supabase } from '../db/supabaseClient';

import { getPlaybookById } from './playbooks/playbookService';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getToken } from './platformTokenService';
import { executeRpaTask } from './rpaWorker/rpaWorkerService';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { getCommunityAiPlatformPolicy } from './communityAiPlatformPolicyService';
import { logUsageEvent } from './usageLedgerService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';
import { ownedDbTable } from '../db/writeOwner';

import { type CommunityAiAction, type ExecutionMode, type ResultStatus, type ExecutionResult, type MetricEventType, deriveAutoIdempotencyKey, recordExecutionMetric, TERMINAL_ROW_STATUSES, validateAction, requiresApproval, loadHistoryMetrics, resolveExecutionMode, recordManualSimulation, runApiExecution, runRpaExecution, prepareBrowserDispatch, buildDmCommandChain } from './communityAiActionExecutorContracts';

export async function advanceCommandChain(input: {
  actionId: string;
  organizationId: string;
  correlationId: string;
}): Promise<{ advanced: boolean; next_index?: number; error?: string }> {
  try {
    const { data: row, error: readErr } = await ownedDbTable('community_ai_actions')
      .select('id, command_chain, command_chain_index, status')
      .eq('id', input.actionId)
      .maybeSingle();
    if (readErr || !row) return { advanced: false, error: 'ACTION_NOT_FOUND' };
    const chain = (row as any).command_chain as CommandChainStep[] | null;
    const index = ((row as any).command_chain_index as number | null) ?? 0;
    if (!Array.isArray(chain) || chain.length === 0) {
      return { advanced: false, error: 'NO_CHAIN' };
    }
    const nextIndex = index + 1;
    if (nextIndex >= chain.length) {
      return { advanced: false }; // caller should finalize terminal status
    }
    const { error: upErr } = await ownedDbTable('community_ai_actions')
      .update({
        status: 'pending',
        command_chain_index: nextIndex,
        dispatch_lease_id: null,
        dispatch_lease_expires_at: null,
        dispatch_lease_holder_id: null,
        dispatch_acknowledged_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.actionId);
    if (upErr) return { advanced: false, error: upErr.message };

    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_started',
      metadata: { phase: 'chain_advance', next_index: nextIndex },
    });
    return { advanced: true, next_index: nextIndex };
  } catch (err: any) {
    return { advanced: false, error: err?.message || 'CHAIN_ADVANCE_FAILED' };
  }
}

const emitWebhook = async (
  action: CommunityAiAction,
  event: 'executed' | 'failed' | 'sent_unverified',
  enabled: boolean
) => {
  if (!enabled) return;
  try {
    await sendCommunityAiWebhooks({
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: event === 'sent_unverified' ? 'executed' : event,
      action_id: action.id,
      message: `Action ${event} on ${action.platform}`,
      metadata: {
        platform: action.platform,
        action_type: action.action_type,
        confirmed: event === 'executed',
      },
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_WEBHOOK_FAILED', error?.message || error);
  }
};

const recordUsage = async (action: CommunityAiAction) => {
  try {
    await logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_LOG_FAILED', error?.message || error);
  }
  try {
    await incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_METER_FAILED', error?.message || error);
  }
};

/**
 * Central row-write for a finished execution. This is the ONLY code path
 * permitted to touch community_ai_actions.status / execution_mode /
 * execution_result / idempotency_key / execution_correlation_id / lease
 * fields. Every other caller must route through here.
 *
 * Contract:
 *  - 'dispatched' is an executor-internal hint meaning "queued for the
 *    browser extension". The row is written back as 'pending' so the
 *    extension's /commands route can claim it; the real 'dispatched' state
 *    is stamped there under a lease.
 *  - Any terminal status (executed / sent_unverified / failed / skipped /
 *    blocked) clears all lease fields defensively.
 *  - Idempotency-key: if absent on the row, stamped from the caller value
 *    or — if none supplied — from a deterministic hash over
 *    (organization_id, platform, action_type, target_id).
 *  - Accepts a leaseGuard so the /action-result route can require a CAS
 *    match on (dispatch_lease_id, dispatch_lease_holder_id) as part of the
 *    same atomic update.
 *  - Accepts expectedFromStatuses so state-machine transitions are enforced
 *    at write time (zero rows matched → returns { ok: false }).
 *
 * Returns { ok, current_status, error? }. Callers should treat ok=false
 * as "row was not in the expected state" and react accordingly.
 */
export type CommandChainStep = {
  action_type: string;
  payload?: Record<string, unknown>;
};

export async function persistExecutionResult(input: {
  actionId: string;
  organizationId: string;
  result: ExecutionResult;
  correlationId: string;
  idempotencyKey?: string | null;
  leaseGuard?: { expectedLeaseId: string; expectedHolderId: string };
  expectedFromStatuses?: string[];
  rowHint?: { platform?: string | null; action_type?: string | null; target_id?: string | null };
  final_text?: string | null;
  /**
   * Optional multi-step dispatch plan for the Chrome extension. When set,
   * /api/extension/commands emits command_chain[command_chain_index] as
   * the next step; /api/extension/action-result advances the index on
   * intermediate success and marks the row terminal on the last step.
   */
  command_chain?: CommandChainStep[];
}): Promise<{ ok: boolean; current_status?: string; error?: string; deduplicated?: boolean; prior_action_id?: string | null }> {
  const result = input.result;
  const finalStatus = result.status === 'dispatched' ? 'pending' : result.status;
  const effectiveMode = result.execution_mode || null;

  const update: Record<string, any> = {
    status: finalStatus,
    execution_correlation_id: input.correlationId,
    execution_result: {
      ...result,
      execution_mode: effectiveMode,
      final_text: input.final_text ?? undefined,
      source: (result as any)?.response?.source || 'executor',
    },
    updated_at: new Date().toISOString(),
  };
  if (effectiveMode) update.execution_mode = effectiveMode;
  if (input.final_text != null) update.final_text = input.final_text;
  if (Array.isArray(input.command_chain) && input.command_chain.length > 0) {
    update.command_chain = input.command_chain;
    update.command_chain_index = 0;
  }

  if (TERMINAL_ROW_STATUSES.has(finalStatus)) {
    update.dispatch_lease_id = null;
    update.dispatch_lease_expires_at = null;
    update.dispatch_lease_holder_id = null;
    update.dispatch_acknowledged_at = null;
    if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
      update.executed_at = new Date().toISOString();
    }
  }

  // Stamp idempotency key: prefer caller, then row-hint hash.
  if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
    update.idempotency_key = input.idempotencyKey.trim();
  } else if (input.rowHint) {
    update.idempotency_key = deriveAutoIdempotencyKey({
      organization_id: input.organizationId,
      platform: input.rowHint.platform ?? null,
      action_type: input.rowHint.action_type ?? null,
      target_id: input.rowHint.target_id ?? null,
    });
  }

  let q = ownedDbTable('community_ai_actions').update(update).eq('id', input.actionId);
  if (input.expectedFromStatuses && input.expectedFromStatuses.length > 0) {
    q = q.in('status', input.expectedFromStatuses);
  }
  if (input.leaseGuard) {
    q = q.eq('dispatch_lease_id', input.leaseGuard.expectedLeaseId)
         .eq('dispatch_lease_holder_id', input.leaseGuard.expectedHolderId);
  }

  const { data: updated, error: updateError } = await q.select('id, status').maybeSingle();

  if (updateError) {
    // Unique-index collision (idempotency_key) surfaces here. Resolve by
    // returning the prior terminal row so the caller can reply idempotently.
    if (update.idempotency_key) {
      const { data: prior } = await ownedDbTable('community_ai_actions')
        .select('id, status')
        .eq('organization_id', input.organizationId)
        .eq('idempotency_key', update.idempotency_key)
        .maybeSingle();
      if (prior?.id) {
        return {
          ok: true,
          current_status: prior.status || finalStatus,
          deduplicated: true,
          prior_action_id: prior.id,
        };
      }
    }
    return { ok: false, error: updateError.message };
  }
  if (!updated) {
    const { data: latest } = await ownedDbTable('community_ai_actions')
      .select('status')
      .eq('id', input.actionId)
      .maybeSingle();
    return { ok: false, current_status: latest?.status ?? undefined, error: 'STATE_MISMATCH' };
  }

  // Emit terminal-state metrics. 'dispatched' (stored as 'pending') is
  // in-flight, so no success/failure metric yet — /action-result will emit
  // on terminal transition.
  if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_success',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        platform_id: result.platform_id ?? null,
      },
    });
  } else if (finalStatus === 'failed' || finalStatus === 'blocked' || finalStatus === 'skipped') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_failed',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        error: typeof result.error === 'string' ? result.error : result.error ?? null,
        reason: result.reason ?? null,
      },
    });
  }

  return { ok: true, current_status: updated.status };
}

export const executeAction = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: {
    notify?: boolean;
    webhook?: boolean;
    source?: 'manual' | 'auto' | 'scheduler' | 'bulk';
    /** If true, executeAction takes full responsibility for writing the
     *  terminal row state; callers must NOT write status/execution_mode/
     *  execution_result themselves. When false (default), the executor
     *  only returns the result and the caller persists (legacy behaviour,
     *  retained for ad-hoc engagement API paths that don't persist rows). */
    persist?: boolean;
    /** Caller-supplied correlation id. If omitted, the executor generates
     *  one and returns it on `result.correlation_id`. */
    correlation_id?: string;
    /** Caller-supplied idempotency key for the row write. */
    idempotency_key?: string;
    /** final_text to record on persist. */
    final_text?: string | null;
    /** When true + persist:true, insert a minimal `pending` row for the
     *  given action id if none exists. Used by ad-hoc callers (engagement
     *  APIs, bulk engagement) that pass a synthetic action id rather than
     *  reading a pre-persisted row. */
    auto_insert?: boolean;
    /** Mark this invocation as automation-driven. Surfaced on the
     *  ExecutionResult as `auto_executed`, stamped into the row's
     *  execution_result for audit, and echoed back so UIs can badge
     *  the outcome (e.g. "Auto-replied"). The execution pipeline is
     *  otherwise unchanged — this is metadata only, NOT a behaviour
     *  toggle. The decision to call executeAction with auto:true is
     *  made by the automation service. */
    auto?: boolean;
    /** Audit join key: the automation_logs row id that decided this
     *  run. Threaded into execution_result.metadata for traceability. */
    automation_decision_log_id?: string;
  }
): Promise<ExecutionResult> => {
  const correlationId = options?.correlation_id || randomUUID();
  const metricBase = {
    organization_id: action.organization_id,
    action_id: action.id,
    correlation_id: correlationId,
    platform: action.platform,
    action_type: action.action_type,
  };

  await recordExecutionMetric({
    ...metricBase,
    event_type: 'execution_started',
    execution_mode: action.execution_mode ?? null,
    metadata: { source: options?.source || 'unknown' },
  });

  // auto_insert: for ad-hoc callers that synthesize an action id on the
  // fly (engagement APIs, bulk engagement). Inserts a minimal pending row
  // if none exists so the downstream persist path has something to update.
  if (options?.persist && options?.auto_insert) {
    const { data: existing } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('id', action.id)
      .maybeSingle();
    if (!existing) {
      const { error: insertError } = await ownedDbTable('community_ai_actions')
        .insert({
          id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          platform: action.platform,
          action_type: action.action_type,
          target_id: action.target_id,
          suggested_text: action.suggested_text,
          risk_level: action.risk_level ?? 'low',
          requires_human_approval: false,
          requires_approval: action.requires_approval ?? null,
          execution_mode: action.execution_mode ?? null,
          playbook_id: action.playbook_id ?? null,
          tone_used: action.tone_used ?? null,
          acting_user_id: action.acting_user_id ?? null,
          status: 'pending',
          execution_correlation_id: correlationId,
          approved_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (insertError && !String(insertError.code || '').match(/^23505$/)) {
        // 23505 = unique_violation (row inserted concurrently) — safe to ignore.
        throw new Error(`community_ai_action_auto_insert_failed:${insertError.message}`);
      }
    }
  }

  const runResult = await runExecution(action, approved, options);
  runResult.correlation_id = correlationId;
  // Echo automation-entry metadata back on the result. These are pure
  // pass-throughs: the execution pipeline behaves identically whether
  // auto or manual. UIs use auto_executed to badge the outcome; ops
  // use automation_decision_log_id to join back to automation_logs.
  if (options?.auto) {
    runResult.auto_executed = true;
    runResult.automation_decision_log_id = options?.automation_decision_log_id ?? null;
  }

  if (options?.persist) {
    const chain = (runResult as ExecutionResult & { command_chain?: CommandChainStep[] }).command_chain;
    const persistOutcome = await persistExecutionResult({
      actionId: action.id,
      organizationId: action.organization_id,
      result: runResult,
      correlationId,
      idempotencyKey: options?.idempotency_key ?? null,
      final_text: options?.final_text ?? null,
      command_chain: Array.isArray(chain) && chain.length > 0 ? chain : undefined,
      rowHint: {
        platform: action.platform,
        action_type: action.action_type,
        target_id: action.target_id,
      },
    });
    if (!persistOutcome.ok) {
      // Persist failed but execution itself may have happened. Surface both.
      return {
        ...runResult,
        ok: false,
        status: 'failed',
        error: persistOutcome.error || 'PERSIST_FAILED',
        response: { ...(runResult.response || {}), persist_error: persistOutcome.error || 'PERSIST_FAILED', current_status: persistOutcome.current_status },
      };
    }
    // Dedup: persist hit the (org, idempotency_key) unique index, meaning a
    // prior row already terminalized this action. Reflect the prior terminal
    // status instead of whatever the second runExecution produced — otherwise
    // a second click on a successful Like would surface as 502 "Execution
    // failed" even though LinkedIn already accepted the like.
    if (persistOutcome.deduplicated && persistOutcome.current_status) {
      const priorStatus = persistOutcome.current_status;
      const priorIsTerminalSuccess = priorStatus === 'executed' || priorStatus === 'sent_unverified';
      return {
        ok: priorIsTerminalSuccess,
        status: priorStatus,
        deduplicated: true,
        prior_action_id: persistOutcome.prior_action_id ?? null,
        correlation_id: correlationId,
        execution_mode: runResult.execution_mode,
        response: {
          ...(runResult.response || {}),
          dedup: {
            reason: 'idempotency_key_collision',
            prior_status: priorStatus,
            prior_action_id: persistOutcome.prior_action_id ?? null,
          },
        },
      } as ExecutionResult;
    }
  }

  return runResult;
};

/**
 * Core execution flow, free of row-write responsibility. Returns the
 * result; persistence is the caller's responsibility via persist:true or a
 * direct call to persistExecutionResult.
 */
const runExecution = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: { notify?: boolean; webhook?: boolean; source?: 'manual' | 'auto' | 'scheduler' | 'bulk' }
): Promise<ExecutionResult> => {
  const policy = await getCommunityAiPlatformPolicy();
  if (!policy.execution_enabled) {
    await ownedDbTable('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'execution_enabled',
        action_id: action.id,
        source: options?.source || 'unknown',
      },
      created_at: new Date().toISOString(),
    });
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'execution_enabled',
        source: options?.source || 'unknown',
      },
    });
    return { ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' };
  }

  if (policy.require_human_approval && !action.approved_at) {
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'require_human_approval',
        source: options?.source || 'unknown',
      },
    });
    return { ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' };
  }

  const validation = validateAction(action);
  if (!validation.ok) {
    return { ok: false, status: 'failed', error: validation.error };
  }

  if (requiresApproval(action, approved)) {
    return { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED' };
  }

  const executionMode = await resolveExecutionMode(action);

  let playbook = null;
  if (action.playbook_id) {
    try {
      playbook = await getPlaybookById(action.playbook_id, action.tenant_id, action.organization_id);
    } catch {
      return { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND' };
    }

    const historyMetrics = await loadHistoryMetrics(
      action.tenant_id,
      action.organization_id,
      action.playbook_id
    );
    const playbookValidation = validateActionAgainstPlaybook(
      {
        action_type: action.action_type,
        text: action.suggested_text,
        execution_mode: executionMode,
        risk_level: action.risk_level,
      },
      playbook,
      historyMetrics
    );
    if (!playbookValidation.allowed) {
      return {
        ok: false,
        status: 'failed',
        error: playbookValidation.reason || 'PLAYBOOK_VIOLATION',
      };
    }
  } else if (executionMode !== 'manual' && options?.source !== 'manual') {
    return { ok: false, status: 'failed', error: 'PLAYBOOK_REQUIRED' };
  }

  const enforcement = await checkUsageBeforeExecution({
    organization_id: action.organization_id,
    resource_key: 'automation_executions',
    projected_increment: 1,
  });
  if (!enforcement.allowed) {
    return {
      ok: false,
      status: 'blocked',
      error: { code: 'PLAN_LIMIT_EXCEEDED', ...enforcement },
    };
  }

  // ── Execute through the resolved mode, with a single API→Browser fallback.
  let result: ExecutionResult;
  const notify = options?.notify !== false;
  const webhook = options?.webhook !== false;

  switch (executionMode) {
    case 'manual':
      result = recordManualSimulation(action);
      break;
    case 'rpa':
      result = await runRpaExecution(action);
      break;
    case 'browser': {
      // DM orchestration: synthesize multi-step chain when target is a
      // thread url / id, or a user handle. Non-DM browser dispatches
      // stay as single-step.
      const chain = buildDmCommandChain(action) ?? undefined;
      result = prepareBrowserDispatch(chain);
      break;
    }
    case 'api':
    default:
      result = await runApiExecution(action);
      if (!result.ok) {
        // Single fallback: API → Browser. No second retry, no infinite loop.
        await recordExecutionMetric({
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'fallback_triggered',
          platform: action.platform,
          action_type: action.action_type,
          execution_mode: 'api',
          metadata: { api_error: result.error, fallback_to: 'browser' },
        });
        const chain = buildDmCommandChain(action) ?? undefined;
        const fallback = prepareBrowserDispatch(chain);
        fallback.response = {
          ...fallback.response,
          fallback_from: 'api',
          api_error: result.error,
        };
        result = fallback;
      }
      break;
  }

  // Notify + webhook only on terminal outcomes. 'dispatched' is in-flight;
  // /api/extension/action-result will emit the terminal events.
  if (result.status === 'executed' || result.status === 'sent_unverified') {
    if (notify) {
      try {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'executed',
          message: `Action ${result.status} on ${action.platform}`,
        });
      } catch (error: any) {
        console.warn('COMMUNITY_AI_NOTIFY_FAILED', error?.message || error);
      }
    }
    await emitWebhook(action, result.status === 'executed' ? 'executed' : 'sent_unverified', webhook);
    await recordUsage(action);
  } else if (result.status === 'failed') {
    if (notify) {
      try {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action failed on ${action.platform}`,
        });
      } catch (error: any) {
        console.warn('COMMUNITY_AI_NOTIFY_FAILED', error?.message || error);
      }
    }
    await emitWebhook(action, 'failed', webhook);
  }

  return result;
};

export type { CommunityAiAction, ExecutionResult, ExecutionMode, ResultStatus, MetricEventType };


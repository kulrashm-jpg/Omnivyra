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
import { recheckCommunityRecipient, isRecipientRecheckRefusal } from './communityRecipientRecheck';

import { type CommunityAiAction, type ExecutionMode, type ResultStatus, type ExecutionResult, type MetricEventType, deriveAutoIdempotencyKey, recordExecutionMetric, TERMINAL_ROW_STATUSES, validateAction, requiresApproval, loadHistoryMetrics, resolveExecutionMode, recordManualSimulation, runApiExecution, runRpaExecution, prepareBrowserDispatch, buildDmCommandChain, dmCommandChainRefusal } from './communityAiActionExecutorContracts';

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

/**
 * Statuses a row may be written FROM when the caller names no expected state.
 * Every other status is terminal (executed, sent_unverified, failed, skipped,
 * blocked, uncertain) and is never revived by a persist.
 */
const NON_TERMINAL_ROW_STATUSES = ['pending', 'approved', 'scheduled', 'dispatched', 'acknowledged', 'executing'];

/** A pre-claim refusal never overwrites a row another worker has claimed. */
const PRE_CLAIM_ROW_STATUSES = NON_TERMINAL_ROW_STATUSES.filter((s) => s !== 'executing');

export async function persistExecutionResult(input: {
  actionId: string;
  organizationId: string;
  result: ExecutionResult;
  correlationId: string;
  idempotencyKey?: string | null;
  leaseGuard?: { expectedLeaseId: string; expectedHolderId: string };
  expectedFromStatuses?: string[];
  /** Only write while no extension holds (or ever held) a claim on the row. */
  requireUnleased?: boolean;
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
  // 'dispatched' -> 'pending' (extension claims it under a lease).
  // 'deferred'   -> 'approved' (provably not acted; durably queued in
  //                 rpa_retry_queue, whose flush must claim approved ->
  //                 executing before running it).
  const finalStatus =
    result.status === 'dispatched' ? 'pending'
    : result.status === 'deferred' ? 'approved'
    : result.status;
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
  } else {
    // Default guard: a terminal row (incl. 'uncertain' — may have acted) is
    // never revived or overwritten. Without it a deterministic action id that
    // collided with an earlier reaped/failed row was rewritten to 'pending'
    // and dispatched a second time.
    q = q.in('status', NON_TERMINAL_ROW_STATUSES);
  }
  if (input.requireUnleased) {
    q = q.is('dispatch_lease_id', null);
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
  } else if (finalStatus === 'failed' || finalStatus === 'blocked' || finalStatus === 'skipped' || finalStatus === 'uncertain') {
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
    /** Compare-and-set guard for the terminal row write. A caller that
     *  claimed the row (e.g. approved -> executing) passes ['executing'] so
     *  a row changed underneath it (reaper -> uncertain, cancel, another
     *  claimant) is never overwritten. */
    expected_from_statuses?: string[];
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
  // fly (engagement APIs, bulk engagement). If a row with this id already
  // exists (a retry of the same request, a concurrent duplicate, or an earlier
  // terminal/uncertain row for the same deterministic id) this call does NOT
  // execute — it reports the existing row.
  //
  // D-01: an ad-hoc action has no persisted human approval, so it is refused
  // here, BEFORE any row is written: only the event log entry is recorded, no
  // 'executing' row is left for the reaper to mark 'uncertain', and the id
  // stays unused. The connector is never reached.
  if (options?.persist && options?.auto_insert) {
    const { data: existing } = await ownedDbTable('community_ai_actions')
      .select('id, status, organization_id')
      .eq('id', action.id)
      .maybeSingle();
    if (!existing) {
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        // 'skipped': the value community_ai_action_logs_event_type_check accepts.
        event_type: 'skipped',
        event_payload: {
          policy_flag: 'require_human_approval',
          reason: 'ad_hoc_action_has_no_human_approval',
          source: options?.source || 'unknown',
        },
      });
      return {
        ok: false,
        status: 'skipped',
        reason: 'HUMAN_APPROVAL_REQUIRED',
        may_have_acted: false,
        correlation_id: correlationId,
        execution_mode: (action.execution_mode as ExecutionMode | undefined) ?? undefined,
      } as ExecutionResult;
    }
    const status = String((existing as { status?: string | null }).status ?? '') || 'unknown';
    return {
      ok: status === 'executed' || status === 'sent_unverified',
      status: status as ResultStatus,
      deduplicated: true,
      prior_action_id: action.id,
      correlation_id: correlationId,
      execution_mode: (action.execution_mode as ExecutionMode | undefined) ?? undefined,
      response: { dedup: { reason: 'action_id_exists', prior_status: status, prior_action_id: action.id } },
    } as ExecutionResult;
  }

  // Single-execution claim. A caller that already won the atomic
  // approved -> executing claim says so with expected_from_statuses
  // ['executing'] (manual execute, scheduler, RPA retry flush, orchestration
  // adapter). Any other persisting caller (the auto-rule service) is claimed
  // HERE, by the same conditional UPDATE, after every pre-dispatch gate and
  // immediately before the connector / RPA / browser step: a refusal therefore
  // leaves the row unclaimed, and only the caller that gets the row back acts.
  const expectedFrom = Array.isArray(options?.expected_from_statuses) && options!.expected_from_statuses!.length > 0
    ? options!.expected_from_statuses!
    : undefined;
  const callerHoldsClaim = !!expectedFrom && expectedFrom.length === 1 && expectedFrom[0] === 'executing';
  const selfClaim = options?.persist === true && !callerHoldsClaim;
  let selfClaimed = false;
  let claimLost = false;
  const claim = selfClaim
    ? async () => {
        const c = await claimCommunityActionForExecution({
          actionId: action.id,
          tenantId: action.tenant_id,
          organizationId: action.organization_id,
        });
        selfClaimed = c.claimed;
        claimLost = !c.claimed;
        return c.claimed;
      }
    : undefined;

  const runResult = await runExecution(action, approved, options, claim);
  runResult.correlation_id = correlationId;
  if (claimLost) {
    // Another worker holds (or finished) the row, or it is no longer
    // claimable: nothing was dispatched and the row is not ours to write.
    return runResult;
  }
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
      // Claimed (by the caller or here): compare-and-set from 'executing', so a
      // refusal after the claim ends terminal ('skipped' / 'failed') and a row
      // changed underneath (reaper, cancel) is never overwritten. Refused
      // before a self-claim: written only while no worker has claimed the row
      // and no extension holds a lease on it.
      expectedFromStatuses: selfClaim
        ? (selfClaimed ? ['executing'] : PRE_CLAIM_ROW_STATUSES)
        : expectedFrom,
      requireUnleased: selfClaim && !selfClaimed ? true : undefined,
      rowHint: {
        platform: action.platform,
        action_type: action.action_type,
        target_id: action.target_id,
      },
    });
    if (!persistOutcome.ok) {
      // Persist failed but execution itself may have happened. Surface both.
      // A may-have-acted outcome keeps its 'uncertain' status so no caller
      // mistakes it for a retryable failure.
      return {
        ...runResult,
        ok: false,
        status:
          runResult.status === 'uncertain' || runResult.status === 'executed' || runResult.status === 'sent_unverified'
            ? 'uncertain'
            : 'failed',
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
  options?: { notify?: boolean; webhook?: boolean; source?: 'manual' | 'auto' | 'scheduler' | 'bulk' },
  /** Atomic single-execution claim, run after every gate (see executeAction). */
  claim?: () => Promise<boolean>
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
    return { ok: false, status: 'skipped', reason: 'PLATFORM_POLICY', may_have_acted: false };
  }

  // D-01: a persisted human approval is required whatever the platform policy
  // says; require_human_approval=false no longer waives it. Refused as
  // 'skipped' (never acted), which the approval-integrity CHECK permits.
  if (!action.approved_at) {
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
    return { ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false };
  }

  const validation = validateAction(action);
  if (!validation.ok) {
    return { ok: false, status: 'failed', error: validation.error, may_have_acted: false };
  }

  if (requiresApproval(action, approved)) {
    return { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED', may_have_acted: false };
  }

  const executionMode = await resolveExecutionMode(action);

  // DM send policy, for EVERY acting mode (api, rpa, browser): no authoritative
  // person -> thread mapping exists and no Instagram tier is server-verified
  // (dmDispatchSafety), so a DM is refused here — before any connector, RPA
  // task or browser dispatch. 'manual' records a simulation and never acts.
  if (executionMode !== 'manual') {
    const dmRefusal = dmCommandChainRefusal(action);
    if (dmRefusal) {
      return { ok: false, status: 'failed', error: dmRefusal, execution_mode: executionMode, may_have_acted: false };
    }
  }

  let playbook = null;
  if (action.playbook_id) {
    try {
      playbook = await getPlaybookById(action.playbook_id, action.tenant_id, action.organization_id);
    } catch {
      return { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND', may_have_acted: false };
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
        may_have_acted: false,
      };
    }
  } else if (executionMode !== 'manual' && options?.source !== 'manual') {
    return { ok: false, status: 'failed', error: 'PLAYBOOK_REQUIRED', may_have_acted: false };
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
      may_have_acted: false,
    };
  }

  // L-3: the recipient's consent, suppression and opt-out are rechecked here,
  // after every other gate and immediately before the platform call / browser
  // enqueue, so an opt-out recorded after approval still stops the action.
  // Every entry point (manual execute, scheduler, retry flush, auto-rule,
  // orchestration adapter) passes through this line. 'manual' is a recorded
  // simulation that contacts no one.
  if (executionMode !== 'manual') {
    const recheck = await recheckCommunityRecipient(action);
    if (isRecipientRecheckRefusal(recheck)) {
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'skipped',
        event_payload: {
          policy_flag: 'recipient_recheck',
          code: recheck.code,
          reason: recheck.reason,
          governance: recheck.governance ?? null,
          source: options?.source || 'unknown',
        },
      });
      return { ok: false, status: 'skipped', reason: recheck.code, error: recheck.code, execution_mode: executionMode, may_have_acted: false };
    }
  }

  // Every return above is a pre-dispatch gate: nothing reached the platform,
  // so each is marked may_have_acted:false (request idempotency releases
  // such an attempt for a same-key retry; see engagementRequestIdempotency).

  // Single-execution claim (callers that did not claim before calling the
  // executor): only the winner of the conditional UPDATE reaches the switch.
  if (claim && !(await claim())) {
    return { ok: false, status: 'skipped', reason: 'CLAIM_LOST', execution_mode: executionMode, may_have_acted: false };
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
      if (result.status === 'deferred') {
        // Remember who initiated the run so the retry flush re-applies the
        // same playbook rule (human-initiated runs may omit a playbook).
        result.response = { ...(result.response || {}), deferred_source: options?.source || 'unknown' };
      }
      break;
    case 'browser': {
      // DM orchestration: synthesize multi-step chain when target is a
      // thread url / id, or a user handle. Non-DM browser dispatches
      // stay as single-step. An unresolved DM target is refused (not acted).
      const dmRefusal = dmCommandChainRefusal(action);
      if (dmRefusal) {
        result = { ok: false, status: 'failed', error: dmRefusal, execution_mode: 'browser', may_have_acted: false };
        break;
      }
      const chain = buildDmCommandChain(action) ?? undefined;
      result = prepareBrowserDispatch(chain);
      break;
    }
    case 'api':
    default:
      result = await runApiExecution(action);
      // Fallback API → Browser ONLY when the API attempt provably did not
      // reach the platform (pre-request refusal). A may-have-acted outcome
      // ('uncertain': timeout, throw, lost or unclassified response) is
      // NEVER re-routed — that would risk a duplicate send.
      if (!result.ok && result.status === 'failed' && result.may_have_acted === false) {
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
        const dmRefusal = dmCommandChainRefusal(action);
        if (dmRefusal) {
          // The browser path would not know whom to message: keep the
          // (not-acted) API failure, annotated with the refusal.
          result = { ...result, response: { ...(result.response || {}), fallback_refused: dmRefusal } };
          break;
        }
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
  } else if (result.status === 'uncertain') {
    // Human review required. In-app notification only: a 'failed' webhook
    // could prompt an external system to resend.
    if (notify) {
      try {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action outcome uncertain on ${action.platform} — review required; it will not be retried automatically`,
        });
      } catch (error: any) {
        console.warn('COMMUNITY_AI_NOTIFY_FAILED', error?.message || error);
      }
    }
  }

  return result;
};

/**
 * Atomic, tenant-scoped claim of an action row for execution:
 * `status IN fromStatuses` -> 'executing'. Exactly one concurrent caller
 * wins; losers get `claimed:false` and must do nothing. The winner must pass
 * `expected_from_statuses: ['executing']` to executeAction so its terminal
 * write is itself compare-and-set.
 */
export async function claimCommunityActionForExecution(input: {
  actionId: string;
  tenantId: string;
  organizationId: string;
  /** Only ['approved'] is claimable (D-01); kept for existing callers. */
  fromStatuses?: string[];
  /** Columns the manual execute route stamps in the same UPDATE as the claim. */
  stamp?: { execution_mode?: string; final_text?: string | null; idempotency_key?: string | null };
}): Promise<{ claimed: boolean; error?: string }> {
  const from = input.fromStatuses && input.fromStatuses.length > 0 ? input.fromStatuses : ['approved'];
  if (!input.actionId || !input.tenantId || !input.organizationId) {
    return { claimed: false, error: 'CLAIM_SCOPE_MISSING' };
  }
  // Single-execution claim: one conditional UPDATE ... RETURNING. Only a
  // human-approved row (status 'approved' AND approved_at, the D-01 evidence)
  // that no one has claimed or cancelled is taken; exactly one concurrent
  // caller gets the row back. A 'pending' row is never claimable here: with
  // approved_at it is a browser dispatch the extension claims under a lease.
  if (from.length !== 1 || from[0] !== 'approved') {
    return { claimed: false, error: 'CLAIM_STATUS_UNSUPPORTED' };
  }
  const update: Record<string, unknown> = { status: 'executing', updated_at: new Date().toISOString() };
  if (input.stamp?.execution_mode) update.execution_mode = input.stamp.execution_mode;
  if (input.stamp && input.stamp.final_text !== undefined) update.final_text = input.stamp.final_text;
  if (input.stamp?.idempotency_key) update.idempotency_key = input.stamp.idempotency_key;
  const { data, error } = await ownedDbTable('community_ai_actions')
    .update(update)
    .eq('id', input.actionId)
    .eq('tenant_id', input.tenantId)
    .eq('organization_id', input.organizationId)
    .eq('status', 'approved')
    .not('approved_at', 'is', null)
    .is('cancel_requested_at', null)
    .select('id, status')
    .maybeSingle();
  if (error) return { claimed: false, error: error.message };
  return { claimed: !!data };
}

export type { CommunityAiAction, ExecutionResult, ExecutionMode, ResultStatus, MetricEventType };


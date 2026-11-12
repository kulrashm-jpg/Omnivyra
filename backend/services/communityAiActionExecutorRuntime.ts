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
import { getCommunityExecutionPolicy } from './communityAiPlatformPolicyService';
import { recordCommunityExecutionRefusal } from './communityExecutionRefusal';
import { evaluateCommunityApprovalEvidence, COMMUNITY_APPROVAL_EVIDENCE_COLUMNS } from './communityApprovalBinding';
import { recordCommunityExecutionUsage } from './communityExecutionUsage';
import { checkUsageBeforeExecution, releaseUsageReservation, type UsageReservation } from './usageEnforcementService';
import { ownedDbTable, ownedDbRpc } from '../db/writeOwner';
import { recheckCommunityRecipient, isRecipientRecheckRefusal } from './communityRecipientRecheck';

import { type CommunityAiAction, type ExecutionMode, type ResultStatus, type ExecutionResult, type MetricEventType, deriveAutoIdempotencyKey, recordExecutionMetric, TERMINAL_ROW_STATUSES, validateAction, requiresApproval, loadHistoryMetrics, resolveExecutionMode, recordManualSimulation, runApiExecution, runRpaExecution, prepareBrowserDispatch, buildDmCommandChain, dmCommandChainRefusal } from './communityAiActionExecutorContracts';

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

/** Metering of a synchronous send (moved to communityExecutionUsage, shared with the browser path). */
const recordUsage = (action: CommunityAiAction) => recordCommunityExecutionUsage(action);

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
  /**
   * Keep the lease fields on an 'uncertain' outcome (default false: every terminal
   * status clears them, as before). Set ONLY for an extension 1.5 post-submit
   * failure, so the holder's later report reaches the existing late-result path,
   * exactly as the lease reaper leaves an uncertain row. Kept in lockstep with
   * communityAiExecutionResultService.persistExecutionResult.
   */
  retainLeaseOnUncertain?: boolean;
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

  if (TERMINAL_ROW_STATUSES.has(finalStatus) && !(finalStatus === 'uncertain' && input.retainLeaseOnUncertain === true)) {
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
    source?: 'manual' | 'auto' | 'scheduler' | 'bulk' | 'orchestration';
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
  let claimCode = null as string | null;
  // SEC3-F3: no external dispatch (api, rpa, browser) without the atomic
  // claim. Run by runExecution after every gate, immediately before the
  // switch:
  //   - self-claim: the executor takes the claim (persisting callers that do
  //     not hold one: the auto-rule service);
  //   - a caller that says it holds the claim (expected_from ['executing']):
  //     it must pass the claim's correlation id, and a DB read must confirm
  //     the row is 'executing' for this tenant and organization under exactly
  //     that id; otherwise nothing is dispatched (CLAIM_NOT_HELD);
  //   - neither (persist omitted / false): only 'manual' (a recorded
  //     simulation that contacts no one) may proceed; every external mode is
  //     refused (CLAIM_REQUIRED).
  const claim = async (mode?: string): Promise<boolean> => {
    if (selfClaim) {
      const c = await claimCommunityActionForExecution({
        actionId: action.id,
        tenantId: action.tenant_id,
        organizationId: action.organization_id,
        claimPoint: options?.source === 'scheduler' ? 'scheduler' : options?.source === 'auto' ? 'auto'
          : options?.source === 'orchestration' ? 'orchestration' : 'manual',
        correlationId,
        // CLASS-2 A19: an auto-rule run re-checks its guardrails INSIDE the claim, atomically
        // (canExecuteAction ran earlier, outside any lock).
        guardrailSource: options?.source === 'auto' ? 'evaluation' : undefined,
      });
      selfClaimed = c.claimed;
      claimLost = !c.claimed;
      claimCode = c.code;
      return c.claimed;
    }
    if (callerHoldsClaim) {
      const held = await communityActionClaimIsHeld({
        actionId: action.id,
        tenantId: action.tenant_id,
        organizationId: action.organization_id,
        correlationId: options?.correlation_id ?? null,
      });
      if (!held) { claimLost = true; claimCode = 'CLAIM_NOT_HELD'; }
      return held;
    }
    if (mode === 'manual') return true;
    claimLost = true;
    claimCode = 'CLAIM_REQUIRED';
    return false;
  };

  // A20: the plan-usage reservation taken by runExecution (if any) is settled here, once, whatever
  // path the run took. A throw leaves it unreleased (it may have acted): it counts until its TTL.
  const usage: UsageReservationHolder = { reservation: null };
  const runResult = await runExecution(action, approved, options, claim, usage);
  await settleUsageReservation(usage, runResult);
  runResult.correlation_id = correlationId;
  if (claimLost) {
    // Not claimed: another worker holds (or finished) the row (CLAIM_CONFLICT,
    // reported as CLAIM_LOST), or the claim refused it (policy, approval
    // evidence, expiry), which recorded the refusal and left the row
    // 'approved'. Nothing was dispatched and the row is not ours to write.
    if (claimCode && claimCode !== 'CLAIM_CONFLICT') {
      runResult.reason = claimCode;
      runResult.error = claimCode;
    }
    return runResult;
  }
  const preDispatchRefusal = (runResult.response as { pre_claim_refusal?: unknown } | undefined)?.pre_claim_refusal === true
    && runResult.may_have_acted === false;
  if (selfClaim && !selfClaimed && preDispatchRefusal) {
    // LD-7: refused by a gate before the claim (policy, approval, expiry). The
    // gate recorded the refusal; nothing was claimed or dispatched, so the row
    // keeps its state ('approved' stays re-claimable) and is not written here.
    return runResult;
  }
  if (callerHoldsClaim && preDispatchRefusal) {
    // SEC3-F1 (LD-7): the caller holds the claim and a gate refused BEFORE any
    // dispatch (nothing acted). The approval is not burned: the claim is given
    // back executing -> approved, compare-and-set on 'executing' AND the
    // claim's correlation id. Without the caller's correlation id, or if the
    // row moved on, nothing is written (the row stays 'executing' and the
    // reaper handles it; never 'approved' on a guess, never terminal here).
    // Anything that may have acted never reaches this branch.
    const released = await releaseCommunityActionClaim({
      actionId: action.id,
      tenantId: action.tenant_id,
      organizationId: action.organization_id,
      correlationId: options?.correlation_id ?? null,
    });
    runResult.response = { ...(runResult.response || {}), claim_released: released };
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
  options?: { notify?: boolean; webhook?: boolean; source?: 'manual' | 'auto' | 'scheduler' | 'bulk' | 'orchestration'; auto?: boolean },
  /** Atomic single-execution claim, run after every gate (see executeAction). */
  claim?: (mode?: string) => Promise<boolean>,
  /** A20: receives the plan-usage reservation; executeAction settles it. */
  usage?: UsageReservationHolder,
): Promise<ExecutionResult> => {
  // ── Prompt 3 policy and approval gate (OD-1, OD-3, LD-4, LD-7) ─────────────
  // Every refusal here is pre-claim and pre-dispatch: nothing acted, and the row
  // is left as it is (response.pre_claim_refusal), never burned. Each writes
  // exactly one governance refusal record (community_ai_action_logs, idempotent
  // by refusal_key; recordCommunityExecutionRefusal). The claim RPC re-applies
  // all of it atomically and is authoritative; this is defence in depth.
  const source = options?.source;
  const claimPoint =
    source === 'scheduler' ? 'scheduler'
      : source === 'auto' ? 'auto'
        : source === 'orchestration' ? 'orchestration'
          : 'manual';
  const gateRefusal = async (
    reason: string,
    code: string,
    payload: Record<string, unknown>,
  ): Promise<ExecutionResult> => {
    await recordCommunityExecutionRefusal({
      actionId: action.id,
      organizationId: action.organization_id,
      tenantId: action.tenant_id,
      claimPoint,
      code,
      payload: { ...payload, source: source || 'unknown' },
    });
    return {
      ok: false,
      status: 'skipped',
      reason,
      error: code,
      may_have_acted: false,
      response: { pre_claim_refusal: true, code },
    };
  };

  // Tenant-scoped execution policy: missing, unreadable, malformed, ambiguous or
  // another tenant's row all refuse; there is no global fallback.
  const decision = await getCommunityExecutionPolicy({
    organizationId: action.organization_id,
    tenantId: action.tenant_id,
  });
  if (decision.ok !== true) {
    // Security audit (LD-6: not a governance record).
    await ownedDbTable('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'execution_policy',
        code: decision.code,
        action_id: action.id,
        source: source || 'unknown',
      },
      created_at: new Date().toISOString(),
    });
    return gateRefusal('PLATFORM_POLICY', decision.code, { policy_flag: 'execution_policy' });
  }

  // LD-4: 'auto' means auto-rule origin, and needs auto_rules_enabled === true.
  // Orchestration journey execution is never 'auto', whatever its flags.
  const autoRuleOrigin = source === 'auto' || (options?.auto === true && source !== 'orchestration');
  if (autoRuleOrigin && decision.policy.auto_rules_enabled !== true) {
    return gateRefusal('PLATFORM_POLICY', 'POLICY_AUTO_RULES_DISABLED', { policy_flag: 'auto_rules_enabled' });
  }

  // Unattended dispatch (scheduler, orchestration) needs a human approval of
  // record; and so does every other source (D-01: no AI flag waives it).
  if (!action.approved_at) {
    return gateRefusal('HUMAN_APPROVAL_REQUIRED', 'HUMAN_APPROVAL_REQUIRED', {
      policy_flag: source === 'scheduler' || source === 'orchestration' ? 'approval_of_record' : 'require_human_approval',
    });
  }

  // The STORED approval evidence, never the caller's copy: approver, content
  // binding, passkey window and the 7-day lifetime from the server-recorded
  // approved_at (evaluateCommunityApprovalEvidence; D-02 constants).
  let stored: Record<string, unknown> | null = null;
  try {
    const { data, error } = await ownedDbTable('community_ai_actions')
      .select(COMMUNITY_APPROVAL_EVIDENCE_COLUMNS)
      .eq('id', action.id)
      .eq('organization_id', action.organization_id)
      .eq('tenant_id', action.tenant_id)
      .maybeSingle();
    if (error) {
      return gateRefusal('APPROVAL_EVIDENCE_REQUIRED', 'APPROVAL_EVIDENCE_UNREADABLE', { policy_flag: 'approval_evidence' });
    }
    stored = (data as unknown as Record<string, unknown> | null) ?? null;
  } catch {
    return gateRefusal('APPROVAL_EVIDENCE_REQUIRED', 'APPROVAL_EVIDENCE_UNREADABLE', { policy_flag: 'approval_evidence' });
  }
  const evidence = evaluateCommunityApprovalEvidence(stored as never);
  if (evidence.ok !== true) {
    return gateRefusal(evidence.code, evidence.code, { policy_flag: 'approval_evidence', detail: evidence.detail });
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
    // CLASS-2 A20: a real reply / DM is never sent on an unverifiable plan usage.
    failClosed: true,
    // CLASS-2 A20: reserved atomically - concurrent sends can no longer each read the same meter.
    reserve: { action_id: action.id },
  });
  if (enforcement.allowed && enforcement.reservation) {
    if (usage) usage.reservation = enforcement.reservation;
    else await releaseUsageReservation(enforcement.reservation); // no holder: nothing could settle it
  }
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
  if (claim && !(await claim(executionMode))) {
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

/** A20: the plan-usage reservation of one run. */
type UsageReservationHolder = { reservation: UsageReservation | null };

/**
 * A20: settle a run's plan-usage reservation. Released when the meter now counts the send (executed
 * / sent_unverified: recordUsage ran) or when nothing could have acted (may_have_acted false). Kept
 * otherwise - a browser dispatch, a deferred RPA run, an uncertain outcome: it may have acted and the
 * executor does not meter it, so the reservation counts until its TTL (erring toward refusing).
 */
async function settleUsageReservation(holder: UsageReservationHolder, result: ExecutionResult): Promise<void> {
  const reservation = holder.reservation;
  if (!reservation) return;
  const metered = result.status === 'executed' || result.status === 'sent_unverified';
  if (metered || result.may_have_acted === false) {
    holder.reservation = null;
    await releaseUsageReservation(reservation);
  }
}

/** Executor entry points that claim through the single claim. */
export type CommunityActionClaimPoint = 'manual' | 'scheduler' | 'auto' | 'orchestration' | 'rpa_retry';

export interface CommunityActionClaimResult {
  claimed: boolean;
  /**
   * NULL when claimed. Otherwise the refusal or conflict code from
   * claim_community_ai_action_for_execution: a policy code
   * (PLATFORM_KILL_SWITCH, POLICY_*), APPROVAL_REQUIRED,
   * APPROVAL_EVIDENCE_REQUIRED, APPROVAL_EXPIRED, CLAIM_CONFLICT (lost race
   * or not claimable; see currentStatus), ACTION_NOT_FOUND,
   * TENANT_SCOPE_VIOLATION; with `guardrailSource`, a guardrail refusal
   * (GUARDRAIL_AUTO_DISABLED, GUARDRAIL_DAILY_PLATFORM_LIMIT,
   * GUARDRAIL_PER_POST_LIMIT, GUARDRAIL_PER_EVALUATION_LIMIT); or, from this wrapper, CLAIM_SCOPE_MISSING,
   * CLAIM_STATUS_UNSUPPORTED, IDEMPOTENCY_KEY_CONFLICT, CLAIM_STAMP_FAILED,
   * CLAIM_RPC_ERROR.
   */
  code: string | null;
  /** The row's status when the claim ran ('executing' when claimed). */
  currentStatus: string | null;
  /** Transport / stamp error text, for logs only. */
  error?: string;
}

/**
 * The single approved -> executing claim for every executor path. A thin
 * wrapper over claim_community_ai_action_for_execution
 * (20270126000001_community_action_approval_claim.sql), which applies, inside
 * one locked statement: the tenant execution policy, the auto-rules switch
 * for claim point 'auto', the approval evidence (approver, the approve
 * route's 'approved' log, content hash, passkey), the 7-day expiry, and the
 * CAS with tenant, organization and no cancel request. A refusal writes one
 * refusal record and leaves the row 'approved'; a conflict writes nothing.
 * Exactly one concurrent caller gets claimed:true. The winner must pass
 * `expected_from_statuses: ['executing']` to executeAction so its terminal
 * write is itself compare-and-set.
 *
 * `stamp.final_text` / `stamp.idempotency_key` are written right after a won
 * claim (compare-and-set from 'executing'). If that write fails (the
 * idempotency key is already taken in the organization) the claim is
 * released (executing -> approved; nothing ran) and IDEMPOTENCY_KEY_CONFLICT
 * is returned.
 */
export async function claimCommunityActionForExecution(input: {
  actionId: string;
  tenantId: string;
  organizationId: string;
  claimPoint: CommunityActionClaimPoint;
  executionMode?: string | null;
  correlationId?: string | null;
  /** Only ['approved'] is claimable (D-01); kept for existing callers. */
  fromStatuses?: string[];
  /** Columns the manual execute route stamps with the claim. */
  stamp?: { execution_mode?: string; final_text?: string | null; idempotency_key?: string | null };
  /**
   * CLASS-2 A19: claim THROUGH the execution guardrails - community_ai_claim_within_limits
   * (migration 20270217000021) re-checks the daily / per-post / per-evaluation limits and claims in
   * one transaction under a per (organization, platform) lock, so two claimants can no longer both
   * see room. 'scheduler' and 'evaluation' (auto-rules) are the sources the guardrails apply to.
   */
  guardrailSource?: 'scheduler' | 'evaluation';
}): Promise<CommunityActionClaimResult> {
  const from = input.fromStatuses && input.fromStatuses.length > 0 ? input.fromStatuses : ['approved'];
  if (!input.actionId || !input.tenantId || !input.organizationId) {
    return { claimed: false, code: 'CLAIM_SCOPE_MISSING', currentStatus: null };
  }
  if (from.length !== 1 || from[0] !== 'approved') {
    return { claimed: false, code: 'CLAIM_STATUS_UNSUPPORTED', currentStatus: null };
  }
  const claimArgs = {
    p_action_id: input.actionId,
    p_org: input.organizationId,
    p_tenant: input.tenantId,
    p_claim_point: input.claimPoint,
    p_execution_mode: input.executionMode ?? input.stamp?.execution_mode ?? null,
    p_correlation_id: input.correlationId ?? null,
  };
  const { data, error } = input.guardrailSource
    ? await ownedDbRpc('community_ai_claim_within_limits', { ...claimArgs, p_source: input.guardrailSource })
    : await ownedDbRpc('claim_community_ai_action_for_execution', claimArgs);
  if (error) {
    return { claimed: false, code: 'CLAIM_RPC_ERROR', currentStatus: null, error: (error as { message?: string }).message || 'claim failed' };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; code?: string | null; current_status?: string | null } | null;
  if (!row || row.claimed !== true) {
    return { claimed: false, code: row?.code ?? 'CLAIM_CONFLICT', currentStatus: row?.current_status ?? null };
  }

  const stamp: Record<string, unknown> = {};
  if (input.stamp && input.stamp.final_text !== undefined) stamp.final_text = input.stamp.final_text;
  if (input.stamp?.idempotency_key) stamp.idempotency_key = input.stamp.idempotency_key;
  if (Object.keys(stamp).length > 0) {
    const { error: stampError } = await ownedDbTable('community_ai_actions')
      .update(stamp)
      .eq('id', input.actionId)
      .eq('tenant_id', input.tenantId)
      .eq('organization_id', input.organizationId)
      .eq('status', 'executing');
    if (stampError) {
      // Nothing has run yet: give the row back so a later claim can take it.
      let release = ownedDbTable('community_ai_actions')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', input.actionId)
        .eq('tenant_id', input.tenantId)
        .eq('organization_id', input.organizationId)
        .eq('status', 'executing');
      if (UUID_RE.test(input.correlationId ?? '')) release = release.eq('execution_correlation_id', input.correlationId);
      await release;
      const message = (stampError as { message?: string }).message || 'stamp failed';
      const code = (stampError as { code?: string }).code === '23505' || /duplicate key|unique/i.test(message)
        ? 'IDEMPOTENCY_KEY_CONFLICT' : 'CLAIM_STAMP_FAILED';
      return { claimed: false, code, currentStatus: 'approved', error: message };
    }
  }
  return { claimed: true, code: null, currentStatus: 'executing' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the caller's claim is real: the row is 'executing' for this tenant
 * and organization AND carries the caller's correlation id, which the claim
 * stamped (SEC3 NEW-1). The id is REQUIRED and must be UUID-shaped: without
 * it, any 'executing' row (another worker's claim) would look held. A read
 * failure is "not held".
 */
export async function communityActionClaimIsHeld(input: {
  actionId: string;
  tenantId: string;
  organizationId: string;
  correlationId?: string | null;
}): Promise<boolean> {
  if (!input.actionId || !input.tenantId || !input.organizationId) return false;
  if (!UUID_RE.test(input.correlationId ?? '')) return false;
  try {
    const { data, error } = await ownedDbTable('community_ai_actions')
      .select('id, status, execution_correlation_id')
      .eq('id', input.actionId)
      .eq('tenant_id', input.tenantId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { status?: string | null; execution_correlation_id?: string | null };
    if (row.status !== 'executing') return false;
    if (row.execution_correlation_id !== input.correlationId) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Give back a claim after a PRE-DISPATCH refusal: executing -> approved,
 * compare-and-set on status 'executing' and the claim's correlation id, for
 * this tenant and organization. Without a correlation id nothing is written.
 * Never call it for an outcome that may have acted (that would allow a second
 * send). Returns whether the row was released.
 */
export async function releaseCommunityActionClaim(input: {
  actionId: string;
  tenantId: string;
  organizationId: string;
  correlationId: string | null;
}): Promise<boolean> {
  if (!input.actionId || !input.tenantId || !input.organizationId || !UUID_RE.test(input.correlationId ?? '')) return false;
  try {
    const { data, error } = await ownedDbTable('community_ai_actions')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', input.actionId)
      .eq('tenant_id', input.tenantId)
      .eq('organization_id', input.organizationId)
      .eq('status', 'executing')
      .eq('execution_correlation_id', input.correlationId)
      .select('id')
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

export type { CommunityAiAction, ExecutionResult, ExecutionMode, ResultStatus, MetricEventType };


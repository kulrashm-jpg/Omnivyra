/**
 * WS-3 Milestone-5A — the Internal Dispatch Runtime.
 *
 * The first executable runtime in WS-3, deliberately limited to the ONE channel
 * that contacts nobody. It runs the full chain — governance, quota consumption,
 * lifecycle, attempt, transport, evidence — so that when Milestone-5B adds the
 * first external channel, it does so on a runtime that has already run.
 *
 * ─── GOVERNANCE ALWAYS PRECEDES DISPATCH ───────────────────────────────────
 * There is no code path to the transport that does not pass through
 * `evaluateTaskGovernance` first, and any verdict other than `allowed` returns
 * before the lifecycle is touched. This is the frozen ordering, enforced
 * structurally rather than by convention.
 *
 * ─── DOUBLE-SEND IS THE FAILURE THAT MATTERS ───────────────────────────────
 * Three independent guards, so no single bug can produce a duplicate:
 *   1. `approved → queued → dispatching` are compare-and-set, so exactly one
 *      caller can claim a task; a second caller finds it already moved.
 *   2. `(company_id, task_id, attempt_number)` is unique, so two attempts
 *      cannot share a number.
 *   3. `(company_id, task_id, attempt_id)` is unique on the work item, so the
 *      transport itself cannot act twice for one attempt.
 *
 * ─── WHAT THIS RUNTIME MAY NOT DO ──────────────────────────────────────────
 * No email, WhatsApp, LinkedIn or SMS. No HTTP client, third-party SDK or
 * external queue. No retries, no delivered/completed transitions, no business
 * outcomes, no feedback emission — those are later milestones.
 */

import {
  appendAttempt,
  appendDeliveryEvidence,
  getOutreachTaskById,
  setOutreachTaskState,
  listAttempts,
  transitionOutreachTaskState,
} from './storage';
import { evaluateTaskGovernance, loadTenantGovernanceConfig, type EvaluateOptions } from './governanceService';
import { reconcileQuota, releaseQuota, reserveQuota } from './quota';
import { buildIdempotencyKey, resolveTransport, type TransportOutcome } from './transport';
import { EXECUTION_RUNTIME_VERSION } from './runtimeVersion';
import {
  recordDispatchDuration,
  recordExternalOutcome,
  recordProviderLatency,
  recordProviderResponse,
  recordDispatchOutcome,
  recordQuotaReconciled,
  recordQuotaReserved,
  recordFailure,
  recordLifecycleTransition,
  recordStageOutcome,
} from './telemetry';
import type { GovernanceEvaluation } from './governance';
import type { OutreachTask } from './types';

/** Why a dispatch did not send. A closed set — no free-form outcomes. */
export type DispatchOutcome =
  | 'sent'
  | 'skipped_no_transport'
  | 'skipped_not_found'
  | 'blocked_governance'
  | 'deferred_governance'
  | 'deferred_quota'
  | 'skipped_already_dispatched'
  | 'skipped_transport_disabled'
  | 'rejected'
  | 'timeout'
  | 'failed';

/** Map a transport's verdict onto the dispatch outcome vocabulary. */
const transportOutcomeToDispatch = (outcome: TransportOutcome): DispatchOutcome => {
  switch (outcome) {
    case 'accepted': return 'sent';
    case 'rejected': return 'rejected';
    case 'timeout': return 'timeout';
    case 'disabled': return 'skipped_transport_disabled';
    default: return 'failed';
  }
};

export interface DispatchResult {
  ok: boolean;
  taskId: string;
  outcome: DispatchOutcome;
  /** The task status after the run. */
  status: string | null;
  /** Delivery axis: what the transport could actually assert. */
  deliveryStatus?: 'confirmed' | 'sent_unverified' | 'failed' | 'bounced' | null;
  attemptNumber: number | null;
  workItemId: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  transportOutcome?: TransportOutcome | null;
  governance: GovernanceEvaluation | null;
  limiterLayer: 'redis' | 'db' | null;
  reason: string;
  durationMs: number;
}

export interface DispatchOptions extends EvaluateOptions {
  /** Injected instant, for deterministic tests. */
  now?: string;
}

const result = (
  taskId: string,
  outcome: DispatchOutcome,
  reason: string,
  startedMs: number,
  over: Partial<DispatchResult> = {},
): DispatchResult => ({
  ok: outcome === 'sent',
  taskId,
  outcome,
  status: null,
  attemptNumber: null,
  workItemId: null,
  governance: null,
  limiterLayer: null,
  reason,
  durationMs: Math.max(0, Date.now() - startedMs),
  ...over,
});

/** Next attempt number for a task. Sequential and gap-free per task. */
async function nextAttemptNumber(companyId: string, taskId: string): Promise<number> {
  const attempts = await listAttempts(companyId, taskId);
  return attempts.length + 1;
}

/**
 * Dispatch ONE internal task.
 *
 * Never throws. Every non-send outcome is a named, recorded reason — a dispatch
 * that quietly does nothing is indistinguishable from one that was never
 * attempted, and that ambiguity is exactly what makes outreach incidents
 * unresolvable.
 */
export async function dispatchInternalOutreachTask(
  companyId: string,
  taskId: string,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const startedMs = Date.now();
  const at = options.now ?? new Date().toISOString();

  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) {
    recordDispatchOutcome('skipped');
    return result(taskId, 'skipped_not_found', 'no such task for this tenant', startedMs);
  }

  // ── channel guard ────────────────────────────────────────────────────────
  // WS-3 M5B: resolved through the transport registry rather than a hardcoded
  // channel check. A channel with no registered transport is skipped — which
  // is how WhatsApp, SMS and LinkedIn remain undispatchable without this
  // function knowing they exist.
  const transport = resolveTransport(task.channel);
  if (!transport) {
    recordDispatchOutcome('skipped');
    return result(taskId, 'skipped_no_transport', `no transport serves the "${task.channel}" channel`, startedMs, { status: task.status });
  }

  recordDispatchOutcome('started');

  // ── 1. GOVERNANCE, before anything is touched ────────────────────────────
  const governed = await evaluateTaskGovernance(companyId, taskId, {
    recipient: options.recipient ?? null,
    region: options.region ?? null,
    evaluatedAt: at,
  });
  if (!governed.ok || !governed.evaluation) {
    recordDispatchOutcome('failed');
    return result(taskId, 'failed', governed.error ?? 'governance evaluation failed', startedMs, { status: task.status });
  }
  const evaluation = governed.evaluation;
  if (evaluation.decision !== 'allowed') {
    const outcome: DispatchOutcome = evaluation.decision === 'deferred' ? 'deferred_governance' : 'blocked_governance';
    recordDispatchOutcome(evaluation.decision === 'deferred' ? 'deferred' : 'blocked');
    return result(taskId, outcome, evaluation.reasoning, startedMs, { status: task.status, governance: evaluation });
  }

  // ── 2. CLAIM the task — compare-and-set, so only one dispatcher proceeds ──
  const claimedQueued = await transitionOutreachTaskState(companyId, task.id, 'approved', 'queued');
  if (!claimedQueued.ok) {
    recordDispatchOutcome('failed');
    return result(taskId, 'failed', claimedQueued.error ?? 'could not queue task', startedMs, { governance: evaluation });
  }
  if (!claimedQueued.changed) {
    // Someone else already moved it, or it was never approved.
    const current = await getOutreachTaskById(companyId, taskId);
    recordDispatchOutcome('skipped');
    return result(taskId, 'skipped_already_dispatched', `task is not approved (now ${current?.status ?? 'unknown'})`, startedMs, {
      status: current?.status ?? null, governance: evaluation,
    });
  }

  const claimedDispatching = await transitionOutreachTaskState(companyId, task.id, 'queued', 'dispatching');
  if (!claimedDispatching.ok || !claimedDispatching.changed) {
    recordDispatchOutcome('failed');
    return result(taskId, 'failed', 'could not claim task for dispatch', startedMs, { status: 'queued', governance: evaluation });
  }

  // ── 3. RESERVE quota — after the claim, before the send ───────────────────
  const config = await loadTenantGovernanceConfig(companyId);
  const reservation = await reserveQuota({
    companyId,
    leadId: task.leadId,
    at,
    dailyLimitTenant: config.dailyLimitTenant,
    dailyLimitLead: config.dailyLimitLead,
  });
  recordQuotaReserved(reservation.granted ? 'granted' : 'refused', reservation.layer);

  if (!reservation.granted) {
    // Deferred, not failed — the task stays dispatchable later. It is returned
    // to `queued`, which is a state it can be picked up from again.
    await transitionOutreachTaskState(companyId, task.id, 'dispatching', 'queued');
    recordDispatchOutcome('deferred');
    return result(taskId, 'deferred_quota', reservation.reason, startedMs, {
      status: 'queued', governance: evaluation, limiterLayer: reservation.layer,
    });
  }

  // ── 4. RECORD the attempt before acting ──────────────────────────────────
  // The attempt exists before the transport runs, so a crash mid-dispatch
  // leaves evidence that something was tried rather than a silent gap.
  const attemptNumber = await nextAttemptNumber(companyId, task.id);
  // Deterministic — identity only, never time or randomness. Carried to the
  // provider so a duplicate request can be refused by the provider itself.
  const idempotencyKey = buildIdempotencyKey(companyId, task.id, attemptNumber);
  const attempt = await appendAttempt({
    companyId,
    taskId: task.id,
    attemptNumber,
    channel: task.channel,
    transport: transport.provider,
    governanceVersion: evaluation.governanceVersion,
    executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
    limiterLayer: reservation.layer,
    idempotencyKey,
    outcome: null,
    error: null,
    startedAt: at,
    completedAt: null,
  });
  if (!attempt.ok) {
    await releaseQuota(companyId, task.leadId, reservation);
    await transitionOutreachTaskState(companyId, task.id, 'dispatching', 'queued');
    recordDispatchOutcome('failed');
    return result(taskId, 'failed', attempt.error ?? 'could not record the attempt', startedMs, {
      status: 'queued', governance: evaluation, limiterLayer: reservation.layer,
    });
  }

  // ── 5. DISPATCH through the resolved transport ───────────────────────────
  const dispatched = await transport.send({
    task,
    attemptId: attempt.data?.id ?? null,
    attemptNumber,
    idempotencyKey,
    recipient: options.recipient ?? null,
    at,
  });
  recordProviderResponse(transport.provider, dispatched.outcome);
  if (typeof dispatched.latencyMs === 'number') recordProviderLatency(dispatched.latencyMs);

  // ── 6. EVIDENCE — written for EVERY outcome ──────────────────────────────
  // A failed send that leaves no evidence is indistinguishable from one never
  // attempted, so evidence precedes the branch on success.
  const evidenceWritten = await appendDeliveryEvidence({
    companyId,
    taskId: task.id,
    attemptId: attempt.data?.id ?? null,
    deliveryStatus: dispatched.deliveryStatus,
    provider: dispatched.provider,
    providerMessageId: dispatched.providerMessageId,
    transportResponse: { outcome: dispatched.outcome, duplicate: dispatched.duplicate, ...dispatched.response },
    observedAt: at,
  });
  // WS-3 M6 (observability only).
  recordStageOutcome('evidence', evidenceWritten.ok ? 'ok' : 'failed');
  if (!evidenceWritten.ok) recordFailure('evidence', evidenceWritten.error);
  recordStageOutcome('transport', dispatched.outcome === 'accepted' ? 'ok' : dispatched.outcome === 'disabled' ? 'skipped' : 'failed');
  if (dispatched.outcome !== 'accepted' && dispatched.outcome !== 'disabled') recordFailure(dispatched.outcome === 'provider_error' ? 'provider' : 'transport', dispatched.error);

  if (dispatched.outcome !== 'accepted') {
    // Quota is released and the task returns to `queued`. NO retry is
    // scheduled — that is a later milestone; failure stops after persistence.
    await releaseQuota(companyId, task.leadId, reservation);
    await transitionOutreachTaskState(companyId, task.id, 'dispatching', 'queued');
    recordExternalOutcome(transport.external, dispatched.outcome);
    recordDispatchOutcome(dispatched.outcome === 'disabled' ? 'skipped' : 'failed');
    return result(taskId, transportOutcomeToDispatch(dispatched.outcome), dispatched.error ?? `transport reported ${dispatched.outcome}`, startedMs, {
      status: 'queued', attemptNumber, governance: evaluation, limiterLayer: reservation.layer,
      provider: dispatched.provider, providerMessageId: dispatched.providerMessageId, transportOutcome: dispatched.outcome,
    });
  }

  // Accepted. The task status becomes `sent`; the DELIVERY axis records whether
  // that was a platform-confirmed write or a third party's acceptance. The
  // frozen lifecycle has no `sent_unverified` task state — it is a delivery
  // status, and adding one would change the lifecycle.
  await transitionOutreachTaskState(companyId, task.id, 'dispatching', 'sent');
  await setOutreachTaskState(companyId, task.id, { deliveryStatus: dispatched.deliveryStatus });
  recordLifecycleTransition('dispatching', 'sent');
  recordStageOutcome('dispatch', 'ok');
  recordExternalOutcome(transport.external, 'accepted');

  // ── 7. RECONCILE the fast path to the durable truth ──────────────────────
  const reconciliation = await reconcileQuota(companyId, task.leadId, at);
  recordQuotaReconciled(reconciliation.reconciled ? 'reconciled' : 'unavailable', reconciliation.drift !== 0);

  recordDispatchOutcome('sent');
  const durationMs = Math.max(0, Date.now() - startedMs);
  recordDispatchDuration(durationMs);

  return {
    ok: true,
    taskId,
    outcome: 'sent',
    status: 'sent',
    deliveryStatus: dispatched.deliveryStatus,
    attemptNumber,
    workItemId: dispatched.providerMessageId,
    provider: dispatched.provider,
    providerMessageId: dispatched.providerMessageId,
    transportOutcome: 'accepted',
    governance: evaluation,
    limiterLayer: reservation.layer,
    reason: dispatched.duplicate
      ? 'provider recognised this as a repeat of the same attempt'
      : `${transport.provider} accepted the message`,
    durationMs,
  };
}

/**
 * Dispatch several internal tasks, sequentially and independently.
 *
 * Sequential on purpose: quota is consumed per task, and running them in
 * parallel would let several dispatchers race for the same remaining units.
 * One task's outcome never influences another's.
 */
export async function dispatchInternalBatch(
  companyId: string,
  taskIds: string[],
  options: DispatchOptions = {},
): Promise<DispatchResult[]> {
  const out: DispatchResult[] = [];
  for (const id of taskIds) out.push(await dispatchInternalOutreachTask(companyId, id, options));
  return out;
}

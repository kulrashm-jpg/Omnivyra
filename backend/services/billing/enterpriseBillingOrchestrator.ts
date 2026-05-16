/**
 * Enterprise Billing Orchestrator — Phase A
 *
 * SINGLE ENTRY POINT for all credit-deducting work that originates outside of
 * the HTTP request lifecycle (queues, crons, workers) AND the preferred entry
 * point for HTTP routes too.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  HTTP / queue / cron / webhook                                      │
 *   │            ↓                                                        │
 *   │  enterpriseBillingOrchestrator.runBilledOperation()                 │
 *   │            ↓                                                        │
 *   │  billingIdempotencyService — derive key from caller class           │
 *   │            ↓                                                        │
 *   │  billingCorrelationService — propagate / seed lineage               │
 *   │            ↓                                                        │
 *   │  billing_operations row INSERT (status='initiated')                 │
 *   │            ↓                                                        │
 *   │  creditExecutionService.executeWithCredits — the atomic RPC core   │
 *   │            ↓                                                        │
 *   │  billing_operations UPDATE (status='confirmed'|'released'|...)     │
 *   │            ↓                                                        │
 *   │  billingAuditEmitter — financial audit + anomalies                  │
 *   │            ↓                                                        │
 *   │  billingMetrics — counters                                          │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Backward compatibility:
 *   - executeWithCredits() in creditExecutionService remains the legal low-
 *     level path; this orchestrator wraps it but does not replace it.
 *   - Existing callers continue to work unchanged.
 *   - New callers and migrating callers should prefer runBilledOperation().
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import {
  executeWithCredits,
  type ExecuteWithCreditsOptionsFixed,
  type ExecuteWithCreditsOptionsLlm,
  type ExecuteResult,
  type LlmExecutorResult,
  type CreditAction,
} from '../creditExecutionService';
import {
  buildBillingIdempotencyKey,
  type BillingIdempotencyArgs,
  type BillingIdempotencyKey,
} from './billingIdempotencyService';
import {
  seedBillingCorrelation,
  getBillingCorrelation,
} from './billingCorrelationService';
import { emitAnomaly, emitFinancialAudit } from './billingAuditEmitter';
import { incrCounter } from './billingMetrics';

export interface OrchestratedOperationBase {
  module:        string;                  // 'queue:contentGen' | 'http:reports' | etc.
  action:        CreditAction;
  userId:        string;
  orgId:         string;
  referenceType: string;
  referenceId:   string;
  idempotency:   BillingIdempotencyArgs;  // descriptor; key is derived inside
  note?:         string;
  amountOverride?: number;
  metadata?:     Record<string, unknown>;
  validateMembership?: boolean;
}

export interface OrchestratedFixed<T> extends OrchestratedOperationBase {
  llmPricing?: undefined;
  executor:    () => Promise<T>;
}

export interface OrchestratedLlm<T> extends OrchestratedOperationBase {
  llmPricing: NonNullable<ExecuteWithCreditsOptionsLlm<T>['llmPricing']>;
  executor:   () => Promise<LlmExecutorResult<T>>;
}

export type OrchestratedOperation<T> = OrchestratedFixed<T> | OrchestratedLlm<T>;

export interface OrchestratorResult<T> {
  operationId:    string;
  correlationId:  string;
  idempotencyKey: string;
  result:         ExecuteResult<T>;
}

/**
 * Run a billed operation through the full orchestrator pipeline. This is the
 * mandatory entry-point for queue/cron/worker code. HTTP code may use it
 * directly OR continue calling executeWithCredits() — both end up enforcing
 * the same DB-level invariants because they share the underlying RPC.
 */
export async function runBilledOperation<T>(
  opts: OrchestratedOperation<T>,
): Promise<OrchestratorResult<T>> {
  // 1. Resolve / seed correlation
  const correlation = opts.idempotency.kind === 'queue' || opts.idempotency.kind === 'cron'
    ? seedBillingCorrelation({
        module: opts.module,
        seed: describeSeedFor(opts.idempotency),
      })
    : getBillingCorrelation({ module: opts.module });

  // 2. Compute idempotency key
  const idemKey = buildBillingIdempotencyKey(opts.idempotency);

  // 3. Open a billing_operations row (idempotent via UNIQUE on idempotency_key)
  const operationId = await openBillingOperation({
    correlationId:   correlation.correlationId,
    module:          opts.module,
    action:          opts.action,
    organizationId:  opts.orgId,
    actorUserId:     opts.userId,
    idempotencyKey:  idemKey.root,
    amountEstimated: opts.amountOverride ?? null,
    metadata:        opts.metadata ?? {},
  });

  incrCounter('billing_operations_total');

  // 4. Delegate to executeWithCredits — wrapped in try/finally so the
  //    billing_operations row ALWAYS reaches a terminal status (Phase
  //    Idempotency-Remediation D). If `reconcileBillingOperationToResult`
  //    itself fails, the finally block guarantees the row gets an `error`
  //    status with a recovery-eligible reason. The expiry cron will then
  //    pick it up if it stays inconsistent.
  let result: ExecuteResult<T> | null = null;
  let finalized = false;
  try {
    if (opts.llmPricing) {
      result = await executeWithCredits<T>({
        userId:         opts.userId,
        orgId:          opts.orgId,
        action:         opts.action,
        referenceType:  opts.referenceType,
        referenceId:    opts.referenceId,
        idempotencyKey: idemKey.root,
        note:           opts.note,
        validateMembership: opts.validateMembership,
        amountOverride: opts.amountOverride,
        llmPricing:     opts.llmPricing,
        executor:       (opts as OrchestratedLlm<T>).executor,
      } as ExecuteWithCreditsOptionsLlm<T>);
    } else {
      result = await executeWithCredits<T>({
        userId:         opts.userId,
        orgId:          opts.orgId,
        action:         opts.action,
        referenceType:  opts.referenceType,
        referenceId:    opts.referenceId,
        idempotencyKey: idemKey.root,
        note:           opts.note,
        validateMembership: opts.validateMembership,
        amountOverride: opts.amountOverride,
        executor:       (opts as OrchestratedFixed<T>).executor,
      } as ExecuteWithCreditsOptionsFixed<T>);
    }
    await reconcileBillingOperationToResult(operationId, result);
    finalized = true;
  } catch (err: unknown) {
    try {
      await closeBillingOperation(operationId, {
        status: 'error',
        failureReason: err instanceof Error ? err.message : String(err),
      });
    } catch { /* swallow — re-thrown below */ }
    incrCounter('billing_operations_errored');
    incrCounter('deduction_failures_total');
    emitAnomaly({
      organizationId: opts.orgId,
      kind: 'queue_replay_blocked',  // reuse closest existing kind
      severity: 'critical',
      message: 'orchestrator_unexpected_error',
      correlationId: correlation.correlationId,
      metadata: {
        module: opts.module,
        action: opts.action,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    finalized = true;
    throw err;
  } finally {
    if (!finalized) {
      // Reached only if reconcileBillingOperationToResult threw — the row
      // could still be sitting in 'initiated'/'held'/'executed'. Force
      // terminal so the expiry cron doesn't have to clean up.
      try {
        await closeBillingOperation(operationId, {
          status: 'error',
          failureReason: 'orchestrator_finalize_unreachable_outcome',
        });
        incrCounter('billing_operations_errored');
      } catch { /* already in a degraded state — surface via cron */ }
    }
  }

  if (!result) {
    // Should be unreachable: either the try block populated result and
    // continued, or the catch re-threw. Defensive return for type narrowing.
    throw new Error('[orchestrator] internal invariant: result is null after finalize');
  }
  return {
    operationId,
    correlationId:  correlation.correlationId,
    idempotencyKey: idemKey.root,
    result,
  };
}

/**
 * Lower-cost wrapper for callers that just want correlation + idempotency
 * book-keeping without running through executeWithCredits (e.g. a service
 * that already holds a credit handle from a parent operation). Most callers
 * should NOT use this — use runBilledOperation() instead.
 */
export async function openBillingOperation(args: {
  correlationId:   string;
  module:          string;
  action:          string;
  organizationId:  string;
  actorUserId:     string;
  idempotencyKey:  string;
  amountEstimated: number | null;
  metadata:        Record<string, unknown>;
}): Promise<string> {
  // billing_operations.idempotency_key UNIQUE — second insert returns the
  // existing row via the ON CONFLICT path below.
  const id = randomUUID();
  const { data, error } = await supabase
    .from('billing_operations')
    .upsert(
      {
        id,
        correlation_id:   args.correlationId,
        module:           args.module,
        action:           args.action,
        organization_id:  args.organizationId,
        actor_user_id:    args.actorUserId,
        idempotency_key:  args.idempotencyKey,
        amount_estimated: args.amountEstimated,
        status:           'initiated',
        metadata:         args.metadata,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) {
    // Fall back to a SELECT — race with another worker.
    logger.warn('billing_op_upsert_failed', {
      idempotency_key: args.idempotencyKey, message: error.message,
    });
    const { data: existing } = await supabase
      .from('billing_operations')
      .select('id')
      .eq('idempotency_key', args.idempotencyKey)
      .maybeSingle();
    if (existing?.id) return existing.id;
    throw new Error(`[billingOrchestrator] could not open operation: ${error.message}`);
  }

  return (data?.id as string) ?? id;
}

export async function closeBillingOperation(
  operationId: string,
  patch: {
    status:          'confirmed' | 'released' | 'insufficient' | 'duplicate' | 'error' | 'executed' | 'held';
    amountCharged?:  number;
    reservationTxnId?: string;
    confirmTxnId?:   string;
    releaseTxnId?:   string;
    failureReason?:  string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('billing_operations')
    .update({
      status:             patch.status,
      amount_charged:     patch.amountCharged ?? null,
      reservation_txn_id: patch.reservationTxnId ?? null,
      confirm_txn_id:     patch.confirmTxnId ?? null,
      release_txn_id:     patch.releaseTxnId ?? null,
      failure_reason:     patch.failureReason ?? null,
      completed_at:       new Date().toISOString(),
    })
    .eq('id', operationId);
  if (error) {
    logger.error('billing_op_close_failed', { operationId, message: error.message });
  }
}

async function reconcileBillingOperationToResult<T>(
  operationId: string,
  result: ExecuteResult<T>,
): Promise<void> {
  if (result.status === 'executed' || result.status === 'already_confirmed') {
    incrCounter('billing_operations_confirmed');
    const charged =
      result.status === 'executed' && result.settlement
        ? (result.settlement as { creditsCharged?: number }).creditsCharged
        : undefined;
    await closeBillingOperation(operationId, { status: 'confirmed', amountCharged: charged });
    return;
  }
  if (result.status === 'already_released') {
    incrCounter('billing_operations_released');
    await closeBillingOperation(operationId, { status: 'released' });
    return;
  }
  if (result.status === 'insufficient_credits') {
    incrCounter('billing_operations_insufficient');
    incrCounter('deduction_failures_total');
    await closeBillingOperation(operationId, {
      status: 'insufficient',
      failureReason: `need ${result.required} have ${result.available}`,
    });
    return;
  }
  // no_credit_account | not_a_member | org_control_blocked
  incrCounter('deduction_failures_total');
  await closeBillingOperation(operationId, {
    status: 'error',
    failureReason: result.status,
  });
}

function describeSeedFor(idem: BillingIdempotencyArgs): string {
  switch (idem.kind) {
    case 'queue':   return `${idem.queueName}::${idem.jobId}`;
    case 'cron':    return `${idem.cronName}::${idem.action}`;
    case 'webhook': return `${idem.provider}::${idem.providerEventId}`;
    case 'http':    return `${idem.actorUserId}::${idem.action}::${idem.referenceId}`;
  }
}

/**
 * Convenience for admin-flow callers that want correlation/audit propagation
 * but route the actual ledger write through the admin grant service. The
 * orchestrator owns the operationId but does NOT call executeWithCredits.
 */
export async function recordAdminFinancialOperation(args: {
  module:          string;
  actorUserId:     string;
  organizationId:  string;
  action:          'admin_grant' | 'admin_adjust' | 'admin_refund' | 'admin_rate_change' | 'admin_revoke';
  amountCredits?:  number;
  reasonType?:     string;
  reason?:         string;
  approvalId?:     string;
  ledgerIdempotencyKey?: string;
  metadata?:       Record<string, unknown>;
}): Promise<void> {
  const correlation = getBillingCorrelation({ module: args.module });

  await emitFinancialAudit({
    actorUserId:    args.actorUserId,
    actionType:     args.action,
    organizationId: args.organizationId,
    amountCredits:  args.amountCredits,
    reasonType:     args.reasonType,
    reason:         args.reason,
    approvalId:     args.approvalId,
    ledgerIdempotencyKey: args.ledgerIdempotencyKey,
    correlationId:  correlation.correlationId,
    metadata:       args.metadata ?? {},
  });

  if (args.action === 'admin_grant')        incrCounter('admin_grants_total');
  if (args.action === 'admin_adjust')       incrCounter('admin_adjustments_total');
  if (args.action === 'admin_refund')       incrCounter('admin_refunds_total');
}

export type { ExecuteResult } from '../creditExecutionService';

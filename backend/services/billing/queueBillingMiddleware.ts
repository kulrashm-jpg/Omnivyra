/**
 * Queue Billing Middleware — C-1 closure
 *
 * Wraps a queue-job handler with exactly-once billing semantics:
 *
 *   1. Compute deterministic execution_hash from (queueName, jobId, payloadFingerprint)
 *   2. Atomically claim the job_execution_registry row
 *      - First sight: status='reserved', proceed
 *      - Replay of completed/released job: short-circuit, no work, no charge
 *      - Replay of in-flight job: depends on policy (default: short-circuit)
 *   3. Delegate to enterpriseBillingOrchestrator.runBilledOperation()
 *   4. Advance the registry status on completion
 *
 * Callers (Bull MQ workers, custom queue runners) wrap their handler:
 *
 *   const result = await withQueueBilling({
 *     queueName: 'content-gen',
 *     jobId:     job.id,
 *     payload:   job.data,
 *     ...billing context...
 *   }, async (creditHandleContext) => {
 *     // The actual job work. creditHandleContext is forwarded to executeWithCredits.
 *     return await generateContent(...);
 *   });
 *
 * Backward compatibility:
 *   - Existing queue processors keep working without wrapping. The wrap is
 *     opt-in. A subsequent PR migrates the four highest-risk processors
 *     identified in the audit (content gen, BOLT content, creator content,
 *     campaign planning).
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import {
  buildExecutionHash,
  fingerprintPayload,
  deriveCorrelationId,
} from './billingCorrelationService';
import { buildBillingIdempotencyKey } from './billingIdempotencyService';
import { runBilledOperation, type OrchestratedOperation, type OrchestratorResult } from './enterpriseBillingOrchestrator';
import { emitAnomaly } from './billingAuditEmitter';
import { incrCounter } from './billingMetrics';
import type { CreditAction, LlmExecutorResult } from '../creditExecutionService';

export interface QueueBillingContext<TPayload> {
  queueName:      string;
  jobId:          string;
  payload:        TPayload;
  organizationId: string;
  userId:         string;
  action:         CreditAction;
  referenceType:  string;
  referenceId:    string;
  amountOverride?: number;
  note?:          string;
  metadata?:      Record<string, unknown>;
  /** When true, in-flight retries (`status='reserved'`) re-enter executor. Default false. */
  allowConcurrentReentry?: boolean;
}

export interface QueueClaimResult {
  registryId:   string;
  executionHash: string;
  correlationId: string;
  firstSeen:    boolean;
  retryCount:   number;
  isTerminal:   boolean;
  status:       string;
}

export type QueueBillingResult<T> =
  | { kind: 'executed';          orchestrator: OrchestratorResult<T> }
  | { kind: 'duplicate_blocked'; reason: string; registryId: string };

/**
 * Run a fixed-cost (non-LLM) queue job through the billing middleware.
 */
export async function withQueueBilling<TPayload, TResult>(
  ctx: QueueBillingContext<TPayload>,
  executor: () => Promise<TResult>,
): Promise<QueueBillingResult<TResult>> {
  return withQueueBillingCore(ctx, async (op) =>
    runBilledOperation({
      ...op,
      executor,
    } as OrchestratedOperation<TResult>),
  );
}

/**
 * Run an LLM (token-priced) queue job through the billing middleware.
 */
export async function withQueueBillingLlm<TPayload, TResult>(
  ctx: QueueBillingContext<TPayload> & { llmPricing: NonNullable<Parameters<typeof runBilledOperation<TResult>>[0]['llmPricing']> },
  executor: () => Promise<LlmExecutorResult<TResult>>,
): Promise<QueueBillingResult<TResult>> {
  return withQueueBillingCore(ctx, async (op) =>
    runBilledOperation({
      ...op,
      llmPricing: ctx.llmPricing,
      executor,
    } as OrchestratedOperation<TResult>),
  );
}

async function withQueueBillingCore<TPayload, TResult>(
  ctx: QueueBillingContext<TPayload>,
  invokeOrchestrator: (op: Omit<OrchestratedOperation<TResult>, 'executor' | 'llmPricing'>) => Promise<OrchestratorResult<TResult>>,
): Promise<QueueBillingResult<TResult>> {
  // 1. Fingerprint + execution hash
  const payloadFingerprint = fingerprintPayload(ctx.payload);
  const executionHash = buildExecutionHash({
    queueName: ctx.queueName,
    jobId:     ctx.jobId,
    payloadFingerprint,
  });
  const correlationId = deriveCorrelationId(`queue:${ctx.queueName}`, ctx.jobId);

  // 2. Build idempotency descriptor (orchestrator will compute the key)
  const idempotency = {
    kind:           'queue' as const,
    queueName:      ctx.queueName,
    jobId:          ctx.jobId,
    organizationId: ctx.organizationId,
    action:         ctx.action,
    payloadFingerprint,
  };
  const idemKey = buildBillingIdempotencyKey(idempotency);

  // 3. Claim or detect duplicate at the registry layer
  const claim = await claimRegistryRow({
    jobId:           ctx.jobId,
    queueName:       ctx.queueName,
    executionHash,
    correlationId,
    idempotencyKey:  idemKey.root,
    organizationId:  ctx.organizationId,
    metadata:        {
      action:        ctx.action,
      referenceType: ctx.referenceType,
      referenceId:   ctx.referenceId,
      ...(ctx.metadata ?? {}),
    },
  });

  if (claim.isTerminal) {
    incrCounter('duplicate_prevention_hits_total');
    incrCounter('queue_replay_blocked_total');
    emitAnomaly({
      organizationId: ctx.organizationId,
      kind: 'queue_replay_blocked',
      severity: 'warn',
      message: `queue replay blocked status=${claim.status}`,
      correlationId,
      metadata: {
        queueName: ctx.queueName, jobId: ctx.jobId, executionHash, retryCount: claim.retryCount,
      },
    });
    return { kind: 'duplicate_blocked', reason: claim.status, registryId: claim.registryId };
  }

  if (!claim.firstSeen && !ctx.allowConcurrentReentry) {
    // Concurrent retry while still in-flight. The orchestrator + ledger
    // idempotency would catch this too, but we surface the signal earlier
    // for ops dashboards.
    incrCounter('duplicate_prevention_hits_total');
    logger.warn('queue_concurrent_retry_short_circuited', {
      queueName: ctx.queueName, jobId: ctx.jobId, executionHash, retryCount: claim.retryCount,
    });
    return { kind: 'duplicate_blocked', reason: 'in_flight_retry', registryId: claim.registryId };
  }

  // 4. Run the orchestrator
  await advanceRegistryRow(executionHash, 'in_progress');

  let orchestratorResult: OrchestratorResult<TResult>;
  try {
    orchestratorResult = await invokeOrchestrator({
      module:         `queue:${ctx.queueName}`,
      action:         ctx.action,
      userId:         ctx.userId,
      orgId:          ctx.organizationId,
      referenceType:  ctx.referenceType,
      referenceId:    ctx.referenceId,
      idempotency,
      note:           ctx.note,
      amountOverride: ctx.amountOverride,
      metadata:       ctx.metadata,
    });
  } catch (err: unknown) {
    await advanceRegistryRow(executionHash, 'released', undefined, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // 5. Advance registry to terminal status
  const terminal: 'completed' | 'released' =
    orchestratorResult.result.status === 'executed' || orchestratorResult.result.status === 'already_confirmed'
      ? 'completed'
      : 'released';
  await advanceRegistryRow(executionHash, terminal, orchestratorResult.operationId);

  return { kind: 'executed', orchestrator: orchestratorResult };
}

async function claimRegistryRow(args: {
  jobId:          string;
  queueName:      string;
  executionHash:  string;
  correlationId:  string;
  idempotencyKey: string;
  organizationId: string;
  metadata:       Record<string, unknown>;
}): Promise<QueueClaimResult & { registryId: string }> {
  const { data, error } = await supabase.rpc('claim_job_execution', {
    p_job_id:          args.jobId,
    p_queue_name:      args.queueName,
    p_execution_hash:  args.executionHash,
    p_correlation_id:  args.correlationId,
    p_idempotency_key: args.idempotencyKey,
    p_organization_id: args.organizationId,
    p_metadata:        args.metadata,
  });

  if (error) {
    throw new Error(`[queueBillingMiddleware] claim_job_execution failed: ${error.message}`);
  }

  const row = data as {
    id:           string;
    status:       string;
    first_seen:   boolean;
    retry_count:  number;
    is_terminal:  boolean;
  } | null;

  if (!row) {
    throw new Error('[queueBillingMiddleware] claim_job_execution returned empty data');
  }

  return {
    registryId:    row.id,
    executionHash: args.executionHash,
    correlationId: args.correlationId,
    firstSeen:     row.first_seen,
    retryCount:    row.retry_count,
    isTerminal:    row.is_terminal,
    status:        row.status,
  };
}

async function advanceRegistryRow(
  executionHash: string,
  status: 'in_progress' | 'completed' | 'released' | 'orphan_reaped' | 'duplicate_blocked',
  billingOperationId?: string,
  error?: string,
): Promise<void> {
  const { error: rpcError } = await supabase.rpc('advance_job_execution', {
    p_execution_hash:       executionHash,
    p_status:               status,
    p_billing_operation_id: billingOperationId ?? null,
    p_error:                error ?? null,
  });
  if (rpcError) {
    logger.error('queue_advance_registry_failed', {
      executionHash, status, message: rpcError.message,
    });
  }
}

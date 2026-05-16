/**
 * Billing Correlation Service — Phase A
 *
 * Propagates correlation IDs across orchestrator → reservation → executor →
 * audit emission so a single piece of work can be reconstructed end-to-end.
 *
 * The general request-context AsyncLocalStorage (backend/services/requestContext.ts)
 * already supplies correlationId / requestId. This service narrows that scope
 * to billing-specific lineage:
 *
 *   - correlationId  — outermost request lineage (header → ALS)
 *   - operationId    — single billing operation row in billing_operations
 *   - phaseLineage   — current HOLD / CONFIRM / RELEASE for log/metric tags
 *
 * Background jobs (queue, cron) don't have a request and must call
 * `seedBillingCorrelation()` at entry.
 */

import { createHash, randomUUID } from 'crypto';
import {
  getRequestContext,
  mergeRequestContext,
} from '../requestContext';

export interface BillingCorrelation {
  correlationId: string;
  operationId:   string;
  module:        string;
  parentSpan?:   string;
}

/**
 * Read the current billing correlation. If no operation has been seeded yet,
 * synthesises one from the request context. Pure read — no mutation.
 */
export function getBillingCorrelation(opts?: { module?: string }): BillingCorrelation {
  const req = getRequestContext();
  const correlationId = req.correlationId ?? req.requestId ?? randomUUID();
  return {
    correlationId,
    operationId:  randomUUID(),
    module:       opts?.module ?? 'unknown',
  };
}

/**
 * Seed a billing correlation for non-request contexts (queue, cron, worker).
 *
 * Returns the seeded BillingCorrelation. Callers receive the same correlation
 * on retries when they pass the same `seed` value — critical for queue replay
 * dedup (the orchestrator's idempotency key derives from this).
 */
export function seedBillingCorrelation(opts: {
  module:     string;
  seed?:      string;            // deterministic source (job id, cron-tick, etc.)
  parentSpan?: string;
}): BillingCorrelation {
  const correlationId = opts.seed
    ? deriveCorrelationId(opts.module, opts.seed)
    : randomUUID();
  mergeRequestContext({ correlationId });
  return {
    correlationId,
    operationId:  randomUUID(),
    module:       opts.module,
    parentSpan:   opts.parentSpan,
  };
}

/**
 * Deterministic correlation ID from a module + seed pair. Two calls with the
 * same arguments return the same ID — so a Bull retry with the same job id
 * produces the same correlation as the first attempt, enabling end-to-end
 * trace consolidation.
 */
export function deriveCorrelationId(module: string, seed: string): string {
  const input = `${module}::${seed}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Build an execution_hash for the job_execution_registry. Includes a payload
 * fingerprint so two jobs with the same job_id but different payloads are
 * still considered distinct (Bull MQ can reuse IDs across queues otherwise).
 */
export function buildExecutionHash(opts: {
  queueName:        string;
  jobId:            string;
  payloadFingerprint: string;
}): string {
  return createHash('sha256')
    .update(`${opts.queueName}::${opts.jobId}::${opts.payloadFingerprint}`)
    .digest('hex');
}

/**
 * Hash arbitrary payload to a stable fingerprint. Order-stable for objects.
 * Callers should pass the canonical job inputs (NOT timestamps or worker-side
 * derived fields), so that retries produce identical fingerprints.
 */
export function fingerprintPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 24);
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

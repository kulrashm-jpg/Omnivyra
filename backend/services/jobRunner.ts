/**
 * Job Runner — single canonical wrapper for every background-execution
 * surface (cron, queue, scheduler, admin-triggered, system maintenance).
 *
 * Composes the existing primitives so callers stop hand-rolling:
 *   - executionContext: AsyncLocalStorage-backed attribution + lineage.
 *   - TenantGuard:      tenant-scoped jobs validate active membership +
 *                       reject soft-deleted orgs.
 *   - workerRetryService: bounded retry + dead-letter for terminal
 *                       failures (existing module — we wrap it, do
 *                       not replace it).
 *   - idempotency replay: pre-execution probe of the dead-letter queue
 *                       so a replay of an already-permanently-failed key
 *                       does not run again.
 *
 * Why not extend executeWithRetry directly:
 *   `executeWithRetry` is generic (HTTP retries, transient failures);
 *   the job runner adds DOMAIN governance (tenant context, attribution,
 *   replay safety, audit). Keeping them composable means HTTP retries
 *   are unaffected.
 *
 * Replay semantics:
 *   - Each `runJob` call MUST supply an idempotencyKey (or the runner
 *     derives one from jobName + tenantId + time bucket).
 *   - Before executing, the runner checks the dead-letter queue for the
 *     same idempotencyKey + worker_name. If found and `replayDLQ` is
 *     false, the call short-circuits with `status='dead_letter_skip'`
 *     so an operator must explicitly approve the replay.
 *
 * Tenant safety:
 *   - When `tenantId` is supplied, the runner runs `assertTenantAccess`
 *     before invoking the job. Soft-deleted orgs / nonexistent orgs are
 *     rejected with `status='tenant_invalid'` — no work runs, no DLQ
 *     entry is written (the trigger itself was malformed).
 *   - Platform-wide jobs (`tenantId = null`) skip the tenant check.
 *     Their work must internally iterate orgs and validate each.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { assertTenantAccess } from '../security/TenantGuard';
import { executeWithRetry, moveToDeadLetter } from './workerRetryService';
import { acquire as governorAcquire } from './executionGovernor';
import {
  buildExecutionContext,
  runWithExecutionContext,
  type ExecutionContext,
  type ExecutionTriggerSource,
} from './executionContext';

export interface RunJobSpec {
  /** Job name — used for dead-letter classification + audit. */
  jobName: string;
  /** Where the trigger came from. */
  triggerSource: ExecutionTriggerSource;
  /** Tenant the work acts on. Null for platform-wide work. */
  tenantId?: string | null;
  /** User attributable for the work. Null for system-triggered. */
  principalUserId?: string | null;
  /** Free-text label of the principal kind. */
  principalKind?: string;
  /** Chain correlationId from upstream — defaults to the active request context. */
  correlationId?: string;
  /** Deterministic idempotency key. Strongly recommended. */
  idempotencyKey?: string;
  /** Retry attempt count when the broker re-delivered. Default 1. */
  attempt?: number;
  /** Free-form payload — recorded with the DLQ entry on terminal failure. */
  payload?: Record<string, unknown>;
  /**
   * When true and a DLQ entry already exists for this idempotency key,
   * the runner allows execution (operator-driven replay). Default false:
   * skip with `status='dead_letter_skip'`.
   */
  replayDLQ?: boolean;
  /**
   * Who owns retry semantics:
   *   'inner'    — runJob wraps the handler in `executeWithRetry` (3
   *                attempts internal + DLQ on terminal failure). Use for
   *                cron, scheduler dispatchers, and direct invocations
   *                where no broker is upstream.
   *   'external' — runJob skips the inner retry; the caller (e.g.
   *                BullMQ) owns retry and re-invokes runJob on each
   *                attempt. The handler runs once per call; on throw,
   *                the runner still enriches the DLQ with execution
   *                context so operator triage has lineage. Use for
   *                queue processors so BullMQ + runJob don't double-
   *                retry (3 inner × N broker = exponential explosion).
   * Default: 'inner'.
   */
  retryOwner?: 'inner' | 'external';
  /**
   * Optional execution-governor binding. When set, the runner acquires
   * a concurrency lease against `concurrency.key` (max
   * `concurrency.max`) before invoking the handler and releases it in
   * `finally`. Used for tenant-fair concurrency caps + retry-storm
   * detection without rewriting the handler:
   *
   *   { concurrency: { key: `tenant:${orgId}`, max: 5 } }
   *
   * If the governor refuses (concurrency / retry-storm / burst),
   * the runner returns `pressure_rejected` and writes an audit row.
   * The caller decides whether to back off + retry later or shed.
   *
   * NOT a replacement for `executeWithRetry`'s bounded retry — those
   * are domain-bounded retries; the governor is rate-bounded acquires.
   */
  concurrency?: {
    key: string;
    max: number;
    maxPerSecond?: number;
    maxRetriesPerMinute?: number;
  };
}

export type RunJobOutcome<T> =
  | { status: 'completed';        result: T;     ctx: ExecutionContext }
  | { status: 'dead_letter_skip'; reason: string; ctx: ExecutionContext }
  | { status: 'tenant_invalid';   reason: string; ctx: ExecutionContext }
  | { status: 'pressure_rejected';reason: 'CONCURRENCY_LIMIT' | 'RETRY_STORM' | 'BURST_LIMIT'; key: string; ctx: ExecutionContext }
  | { status: 'failed';           error: unknown; ctx: ExecutionContext };

/**
 * Run a background job with canonical context, tenant safety, idempotent
 * replay protection, and dead-lettering. The handler receives the active
 * `ExecutionContext` so it can chain attribution into downstream
 * mutations (e.g. credit ledger writes get `performed_by`).
 */
export async function runJob<T>(
  spec: RunJobSpec,
  handler: (ctx: ExecutionContext) => Promise<T>,
): Promise<RunJobOutcome<T>> {
  const ctx = buildExecutionContext({
    triggerSource:   spec.triggerSource,
    jobName:         spec.jobName,
    tenantId:        spec.tenantId ?? null,
    principalUserId: spec.principalUserId ?? null,
    principalKind:   spec.principalKind,
    correlationId:   spec.correlationId,
    idempotencyKey:  spec.idempotencyKey,
    attempt:         spec.attempt,
  });

  // ── 1. Replay safety: skip if already in DLQ for this idempotency key ────
  // The DLQ is the canonical "permanently failed" surface; a key landing
  // here means an operator must intervene before another attempt is safe.
  if (!spec.replayDLQ) {
    const inDLQ = await dlqHasKey(ctx.jobName, ctx.idempotencyKey);
    if (inDLQ) {
      logger.warn('jobrunner_dead_letter_skip', {
        jobName: ctx.jobName,
        executionId: ctx.executionId,
        idempotencyKey: ctx.idempotencyKey,
      });
      void auditOutcome(ctx, 'dead_letter_skip', 'idempotency-key in DLQ');
      return {
        status: 'dead_letter_skip',
        reason: 'idempotency-key in DLQ — explicit replay required',
        ctx,
      };
    }
  }

  // ── 2. Tenant safety: validate membership + active org for tenant-scoped work
  if (ctx.tenantId) {
    const access = await assertTenantAccess({
      userId:         ctx.principalUserId ?? ctx.tenantId, // system jobs use orgId as actor
      organizationId: ctx.tenantId,
      consultPlatformSuperAdmin: !!ctx.principalUserId,
    });
    // System-triggered jobs (no principalUserId) bypass platform-super-admin
    // resolution but still hit the org-state check below. The simplest correct
    // behavior: re-run as a pure org-state probe when no user is attributable.
    if (access.ok !== true) {
      // For system-triggered jobs, only ORG_INACTIVE / ORG_NOT_FOUND should
      // hard-stop. NOT_A_MEMBER for a system actor is expected — the system
      // isn't "a member". Re-check just the org existence + state.
      const isSystemActor = !ctx.principalUserId;
      if (isSystemActor && (access.reason === 'NOT_A_MEMBER' || access.reason === 'STALE_MEMBERSHIP')) {
        // System actor — fall through to org-state probe.
        const orgOk = await orgIsActive(ctx.tenantId);
        if (!orgOk) {
          logger.warn('jobrunner_tenant_invalid', {
            jobName: ctx.jobName,
            executionId: ctx.executionId,
            tenantId: ctx.tenantId,
            reason: 'ORG_INACTIVE_OR_MISSING',
          });
          void auditOutcome(ctx, 'tenant_invalid', 'ORG_INACTIVE_OR_MISSING');
          return { status: 'tenant_invalid', reason: 'ORG_INACTIVE_OR_MISSING', ctx };
        }
      } else {
        logger.warn('jobrunner_tenant_invalid', {
          jobName: ctx.jobName,
          executionId: ctx.executionId,
          tenantId: ctx.tenantId,
          reason: access.reason,
        });
        void auditOutcome(ctx, 'tenant_invalid', access.reason);
        return { status: 'tenant_invalid', reason: access.reason, ctx };
      }
    }
  }

  // ── 3. Optional concurrency / pressure gate via executionGovernor ─────────
  // Caller opts in by passing `spec.concurrency`. The governor enforces the
  // per-key cap and surfaces pressure rejections back to the caller. The
  // lease is released in `finally` regardless of outcome.
  let governorLease: { release: () => void } | null = null;
  if (spec.concurrency) {
    const lease = governorAcquire({
      key:                  spec.concurrency.key,
      max:                  spec.concurrency.max,
      maxPerSecond:         spec.concurrency.maxPerSecond,
      maxRetriesPerMinute:  spec.concurrency.maxRetriesPerMinute,
      isRetry:              (spec.attempt ?? 1) > 1,
    });
    if (lease.ok !== true) {
      logger.warn('jobrunner_pressure_rejected', {
        jobName:    ctx.jobName,
        executionId: ctx.executionId,
        tenantId:   ctx.tenantId,
        reason:     lease.reason,
        key:        lease.key,
      });
      void auditOutcome(ctx, 'pressure_rejected', `${lease.reason} key=${lease.key}`);
      return {
        status: 'pressure_rejected',
        reason: lease.reason,
        key:    lease.key,
        ctx,
      };
    }
    governorLease = lease;
  }

  // ── 4. Execute. Two retry-ownership modes:
  //   'inner'    — wrap in executeWithRetry (3 attempts + DLQ).
  //   'external' — call handler once; broker owns retry. DLQ on throw.
  const retryOwner = spec.retryOwner ?? 'inner';
  try {
    if (retryOwner === 'external') {
      const result = await runWithExecutionContext(ctx, () => handler(ctx));
      void auditOutcome(ctx, 'completed', null);
      return { status: 'completed', result, ctx };
    }
    const result = await runWithExecutionContext(ctx, () =>
      executeWithRetry(ctx.jobName, spec.payload ?? {}, () => handler(ctx)),
    );
    void auditOutcome(ctx, 'completed', null);
    return { status: 'completed', result, ctx };
  } catch (error) {
    // 'inner' mode: executeWithRetry already wrote a DLQ entry on terminal
    // failure (its write lacks execution context). 'external' mode: nothing
    // wrote a DLQ entry yet. Either way, write the canonical-context DLQ
    // entry so operator triage has lineage. The DLQ table tolerates
    // duplicate (worker_name, payload) entries — different queries surface
    // them differently. The canonical-context entry is what the inspector
    // surfaces.
    await enrichDLQ(ctx, spec.payload ?? {}, error);
    void auditOutcome(ctx, 'failed', error instanceof Error ? error.message : String(error));
    return { status: 'failed', error, ctx };
  } finally {
    // Always release the governor lease — even on tenant_invalid /
    // dead_letter_skip / pressure_rejected paths the lease was either
    // never acquired (early-return before acquire) or was acquired and
    // must be returned. Defensive idempotent release — `release()`
    // is a no-op after the first call.
    governorLease?.release();
  }
}

// ── Dead-letter helpers ──────────────────────────────────────────────────────

async function dlqHasKey(jobName: string, idempotencyKey: string): Promise<boolean> {
  const { data } = await ownedDbTable('worker_dead_letter_queue')
    .select('id')
    .eq('worker_name', jobName)
    .contains('job_payload', { idempotencyKey })
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function enrichDLQ(
  ctx: ExecutionContext,
  payload: Record<string, unknown>,
  error: unknown,
): Promise<void> {
  // executeWithRetry's DLQ row already exists with the raw payload + error.
  // We add a canonical-attribution row alongside it so operators have the
  // execution lineage. Idempotent on (worker_name, idempotencyKey).
  try {
    const enriched: Record<string, unknown> = {
      ...payload,
      __executionContext: {
        executionId:    ctx.executionId,
        triggerSource:  ctx.triggerSource,
        tenantId:       ctx.tenantId,
        principalUserId: ctx.principalUserId,
        principalKind:  ctx.principalKind,
        correlationId:  ctx.correlationId,
        idempotencyKey: ctx.idempotencyKey,
        attempt:        ctx.attempt,
        startedAt:      ctx.startedAt,
      },
    };
    await moveToDeadLetter(
      ctx.jobName,
      enriched,
      error instanceof Error ? error : new Error(String(error)),
    );
  } catch (err) {
    logger.warn('jobrunner_enrich_dlq_failed', {
      executionId: ctx.executionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function orgIsActive(orgId: string): Promise<boolean> {
  const { data } = await ownedDbTable('companies')
    .select('id, status')
    .eq('id', orgId)
    .maybeSingle();
  if (!data) return false;
  return (data as { status?: string | null }).status === 'active';
}

async function auditOutcome(
  ctx: ExecutionContext,
  status: 'completed' | 'failed' | 'tenant_invalid' | 'dead_letter_skip' | 'pressure_rejected',
  reason: string | null,
): Promise<void> {
  try {
    await logSecurityEvent({
      capability:      'billing.audit.view', // closest existing capability — observability tier
      decision:        status === 'completed' ? 'allowed' : 'denied',
      actorUserId:     ctx.principalUserId,
      principalUserId: ctx.principalUserId,
      resourceId:      ctx.tenantId ?? ctx.executionId,
      reason: `jobrunner status=${status} job=${ctx.jobName} trigger=${ctx.triggerSource} corr=${ctx.correlationId} attempt=${ctx.attempt}${reason ? ` why=${reason}` : ''}`,
    });
  } catch {
    /* fail-soft */
  }
}

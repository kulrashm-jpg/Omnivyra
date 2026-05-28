/**
 * Phase 18C — Write-side smoke verification.
 *
 * The Phase-17 boot smoke test was READ-ONLY: it called
 * `getExecutionById('_smoke_probe_xxx')` and expected `null`. That probe
 * does NOT prove the writer can actually persist rows — it only proves the
 * select round-trip works. Production has shipped at least one configuration
 * (service-role key swapped, RLS policy regression, table renamed) where
 * reads succeed but writes silently fail under RLS.
 *
 * This module runs a full insert → update → cleanup probe across all three
 * tables (executions, checkpoints, leases) on a SENTINEL companyId so the
 * residue is filterable. The probe is idempotent + bounded; the try/finally
 * deletes leave zero residual rows even if any individual step fails.
 *
 * ─────────────────────────────────────────────────────────────────────
 * GUARANTEES
 * ─────────────────────────────────────────────────────────────────────
 * - Pure verification: no orchestration semantics, no replay, no recovery.
 * - Bounded: each probe targets exactly ONE row per table (3 rows max).
 * - Sentinel scoping: companyId = `00000000-0000-0000-0000-000000000000`
 *   and executionId is prefixed `_writesmoke_` for grep + cleanup ops.
 * - Cleanup: try/finally deletes the inserted row regardless of failure
 *   mode. Cascade DELETE on FK clears checkpoints + leases automatically.
 * - Telemetry: every step emits structured single-line JSON.
 * - Bounded duration: each individual call uses the underlying stores'
 *   built-in transient retry. Hard-fail surfaces fast.
 *
 * Scope: WRITE VERIFICATION ONLY. NO production data is touched. NO
 * autonomous recovery is invoked.
 */

import { SupabaseExecutionStore } from './supabaseExecutionStore';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { SupabaseLeaseStore } from './supabaseLeaseStore';
import type {
  ExecutionRecord,
  ExecutionCheckpoint,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';

// ── Constants ────────────────────────────────────────────────────────

/** Reserved companyId used as the sentinel-tenant for write-smoke probes. */
export const WRITE_SMOKE_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

/** All probe executionIds share this prefix for grep / cleanup ops. */
export const WRITE_SMOKE_EXECUTION_PREFIX = '_writesmoke_';

/** All probe checkpointIds share this prefix for grep / cleanup ops. */
export const WRITE_SMOKE_CHECKPOINT_PREFIX = '_writesmoke_cp_';

// ── Telemetry ────────────────────────────────────────────────────────

export type WriteSmokeTelemetryEvent =
  | 'write_smoke_test_started'
  | 'write_smoke_test_passed'
  | 'write_smoke_test_failed'
  | 'write_smoke_test_cleanup_failed';

export interface WriteSmokeTelemetrySink {
  emit(event: WriteSmokeTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: WriteSmokeTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'write_smoke_test_failed' || event === 'write_smoke_test_cleanup_failed') {
        console.warn(`[write_smoke] ${line}`);
      } else {
        console.log(`[write_smoke] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ── Errors ───────────────────────────────────────────────────────────

export class WriteSmokeVerificationError extends Error {
  constructor(
    public readonly stage: string,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[write_smoke.${stage}] ${code}: ${message}`);
    this.name = 'WriteSmokeVerificationError';
  }
}

// ── Result shape ─────────────────────────────────────────────────────

export interface WriteSmokeVerificationResult {
  passed: boolean;
  executionId: string;
  checkpointId: string | null;
  leaseId: string | null;
  durationMs: number;
  stagesCompleted: string[];
  cleanupSucceeded: boolean;
}

export interface WriteSmokeVerificationOptions {
  executionStore?: SupabaseExecutionStore;
  checkpointStore?: SupabaseCheckpointStore;
  leaseStore?: SupabaseLeaseStore;
  telemetry?: WriteSmokeTelemetrySink;
  /**
   * Override the probe id generator (tests). Default produces a unique
   * suffix keyed on time + entropy.
   */
  idSuffix?: string;
  /** Skip the lease probe (tests / partial deployments). */
  skipLease?: boolean;
  /** Skip the checkpoint probe (tests / partial deployments). */
  skipCheckpoint?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeSuffix(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string { return new Date().toISOString(); }

// ── Main entrypoint ─────────────────────────────────────────────────

/**
 * Run insert → update → cleanup probes against execution + checkpoint +
 * lease tables using a sentinel companyId. Returns a result describing
 * which stages succeeded; throws WriteSmokeVerificationError on the FIRST
 * unrecoverable failure, after cleanup has been attempted.
 */
export async function runWriteSideSmokeVerification(
  options: WriteSmokeVerificationOptions = {},
): Promise<WriteSmokeVerificationResult> {
  const executionStore = options.executionStore ?? new SupabaseExecutionStore();
  const checkpointStore = options.checkpointStore ?? (options.skipCheckpoint ? null : new SupabaseCheckpointStore());
  const leaseStore = options.leaseStore ?? (options.skipLease ? null : new SupabaseLeaseStore());
  const telemetry = options.telemetry ?? defaultTelemetrySink;

  const suffix = options.idSuffix ?? makeSuffix();
  const executionId = `${WRITE_SMOKE_EXECUTION_PREFIX}${suffix}`;
  const checkpointId = `${WRITE_SMOKE_CHECKPOINT_PREFIX}${suffix}`;
  const startedAt = nowIso();

  telemetry.emit('write_smoke_test_started', { executionId, checkpointId });

  const t0 = Date.now();
  const stagesCompleted: string[] = [];
  let acquiredLeaseId: string | null = null;
  let probeErr: unknown = null;

  try {
    // ── Stage 1: insert execution row ───────────────────────────────
    const record: ExecutionRecord = {
      executionId,
      runtimeSessionId: `${executionId}_session`,
      threadId: `${executionId}_thread`,
      companyId: WRITE_SMOKE_COMPANY_ID,
      orchestrationPhase: 'precheck',
      executionStatus: 'pending',
      executionOwner: null,
      retryCount: 0,
      recoveryState: 'idle',
      startedAt,
      heartbeatAt: null,
      completedAt: null,
      failureReason: null,
      replayCheckpointId: null,
    };
    await executionStore.createExecution(record);
    stagesCompleted.push('insert_execution');

    // ── Stage 2: update execution row ───────────────────────────────
    const updated = await executionStore.updateExecution(executionId, {
      executionStatus: 'running',
      heartbeatAt: nowIso(),
    });
    if (!updated) {
      throw new WriteSmokeVerificationError('update_execution', 'NOT_FOUND', `update returned null for ${executionId}`);
    }
    if (updated.executionStatus !== 'running') {
      throw new WriteSmokeVerificationError('update_execution', 'NOT_APPLIED', `status remained ${updated.executionStatus}`);
    }
    stagesCompleted.push('update_execution');

    // ── Stage 3: insert checkpoint (only if checkpointStore present) ─
    if (checkpointStore) {
      const cp: ExecutionCheckpoint = {
        checkpointId,
        executionId,
        takenAt: nowIso(),
        phase: 'generation',
        completedNodeOperationIds: [],
        pendingNodeOperationIds: [],
        pendingTopologyMutationIds: [],
        recoveryProgress: null,
        replayContinuity: null,
      };
      await checkpointStore.appendCheckpoint(cp);
      stagesCompleted.push('append_checkpoint');

      const exists = await checkpointStore.checkpointExists(checkpointId);
      if (!exists) {
        throw new WriteSmokeVerificationError('checkpoint_readback', 'NOT_FOUND', `checkpoint ${checkpointId} not readable after insert`);
      }
      stagesCompleted.push('readback_checkpoint');
    }

    // ── Stage 4: acquire + release lease (only if leaseStore present) ─
    if (leaseStore) {
      const workerId = `_writesmoke_worker_${suffix}`;
      const lease = await leaseStore.acquireLease({
        executionId,
        workerId,
        durationMs: 30_000,
      });
      if (!lease) {
        throw new WriteSmokeVerificationError('acquire_lease', 'ALREADY_HELD', `lease acquisition returned null for ${executionId}`);
      }
      acquiredLeaseId = lease.leaseId;
      stagesCompleted.push('acquire_lease');

      await leaseStore.releaseLease(lease.leaseId);
      stagesCompleted.push('release_lease');
    }
  } catch (err) {
    probeErr = err;
  }

  // ── Cleanup phase — always runs, even on failure ────────────────
  // Deleting the execution row cascades to checkpoints + leases via the
  // FK ON DELETE CASCADE on both child tables (see migration 20260808).
  let cleanupSucceeded = true;
  try {
    // Use the raw client via executionStore.tableName access — but we don't
    // expose the client directly. Easiest path: call into the underlying
    // supabase client via dependency injection on the executionStore.
    // For cleanup we just need a delete; reuse the executionStore's client.
    // Since we don't expose the client publicly, fall back to a deletion
    // path through a tiny helper that uses the same default client.
    await cleanupExecutionRow(executionId, options);
  } catch (cleanupErr) {
    cleanupSucceeded = false;
    telemetry.emit('write_smoke_test_cleanup_failed', {
      executionId,
      error: (cleanupErr as Error)?.message ?? String(cleanupErr),
    });
  }

  const durationMs = Date.now() - t0;
  if (probeErr) {
    const code = probeErr instanceof WriteSmokeVerificationError ? probeErr.code : 'UNKNOWN';
    const stage = probeErr instanceof WriteSmokeVerificationError ? probeErr.stage : 'unknown';
    telemetry.emit('write_smoke_test_failed', {
      executionId, checkpointId, leaseId: acquiredLeaseId,
      durationMs, stagesCompleted, cleanupSucceeded,
      stage, code, error: (probeErr as Error)?.message ?? String(probeErr),
    });
    if (probeErr instanceof WriteSmokeVerificationError) throw probeErr;
    throw new WriteSmokeVerificationError(
      stage,
      code,
      (probeErr as Error)?.message ?? String(probeErr),
      probeErr,
    );
  }

  telemetry.emit('write_smoke_test_passed', {
    executionId, checkpointId, leaseId: acquiredLeaseId,
    durationMs, stagesCompleted, cleanupSucceeded,
  });

  return {
    passed: true,
    executionId,
    checkpointId: checkpointStore ? checkpointId : null,
    leaseId: acquiredLeaseId,
    durationMs,
    stagesCompleted,
    cleanupSucceeded,
  };
}

// ── Cleanup helper ──────────────────────────────────────────────────

async function cleanupExecutionRow(
  executionId: string,
  options: WriteSmokeVerificationOptions,
): Promise<void> {
  // Cleanup uses the default supabase client (or an injected client through
  // the executionStore option). Direct DELETE: FK ON DELETE CASCADE clears
  // both child tables atomically.
  // We import the default supabase client lazily so that pure-memory tests
  // never trigger an import-time connection attempt.
  const { supabase } = await import('@/backend/db/supabaseClient');
  const client = (options.executionStore as unknown as { client?: { from: (t: string) => unknown } })?.client
    ?? supabase;
  const tableClient = client.from('thread_runtime_executions') as {
    delete: () => { eq: (col: string, value: string) => Promise<{ error: { message?: string } | null }> };
  };
  const { error } = await tableClient.delete().eq('execution_id', executionId);
  if (error) {
    throw new WriteSmokeVerificationError(
      'cleanup',
      'DELETE_FAILED',
      error.message ?? 'unknown cleanup error',
      error,
    );
  }
}

// ── Public test helper ──────────────────────────────────────────────

/**
 * Manual residual-cleanup helper. Use to clear any orphaned probe rows
 * left behind by a crashed smoke run (e.g. after a process kill mid-test).
 * Safe to call repeatedly. Filters strictly on the sentinel companyId so
 * it cannot touch real tenant data.
 */
export async function purgeWriteSmokeResiduals(opts?: {
  client?: { from: (t: string) => unknown };
}): Promise<{ deleted: number }> {
  const { supabase } = await import('@/backend/db/supabaseClient');
  const client = opts?.client ?? supabase;
  const tableClient = client.from('thread_runtime_executions') as {
    delete: () => {
      eq: (col: string, value: string) => {
        like: (col: string, value: string) => Promise<{ data: unknown[] | null; error: { message?: string } | null; count?: number | null }>;
      };
    };
  };
  const { data, error } = await tableClient
    .delete()
    .eq('company_id', WRITE_SMOKE_COMPANY_ID)
    .like('execution_id', `${WRITE_SMOKE_EXECUTION_PREFIX}%`);
  if (error) {
    throw new WriteSmokeVerificationError(
      'purge', 'DELETE_FAILED',
      error.message ?? 'unknown purge error',
    );
  }
  return { deleted: Array.isArray(data) ? data.length : 0 };
}

export { defaultTelemetrySink as defaultWriteSmokeTelemetrySink };

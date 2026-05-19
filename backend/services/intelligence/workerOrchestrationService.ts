/**
 * Production worker orchestration — distributed-safe, observable.
 *
 * Runs the existing opt-in workers (replay, oauth-refresh, security-response)
 * under the hardened atomic lease so only one instance runs a company's
 * worker pass at a time; dead-worker recovery is automatic via lease TTL
 * expiry. Heartbeats use the EXISTING worker_health table
 * (queueOperationsService.recordWorkerHeartbeat) — no new schema, no refactor
 * of the workers themselves.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordWorkerHeartbeat } from '../queueOperationsService';
import { acquireAtomicLock, releaseAtomicLock } from './atomicLockService';
import { runReplayWorker } from '../../workers/replayWorker';
import { runOAuthRefreshWorker } from '../../workers/oauthRefreshWorker';
import { runSecurityResponse } from './securityResponseEngine';

export type OrchestratedWorker = 'replay' | 'oauth_refresh' | 'security_response';

export interface WorkerRunOutcome {
  worker: OrchestratedWorker;
  ran: boolean;
  detail: string;
}

export interface WorkerOrchestrationResult {
  companyId: string;
  startedAt: string;
  finishedAt: string;
  acquired: boolean;
  fencing: number | null;
  lockMode: string | null;
  outcomes: WorkerRunOutcome[];
}

const LEASE_TTL_MS = 5 * 60_000;

export async function runOrchestratedWorkers(args: {
  companyId: string;
  workers?: OrchestratedWorker[];
  actorUserId?: string | null;
}): Promise<WorkerOrchestrationResult> {
  const companyId = args.companyId;
  const workers = args.workers ?? ['replay', 'oauth_refresh', 'security_response'];
  const startedAt = new Date().toISOString();

  const lock = await acquireAtomicLock({
    companyId,
    scope: 'worker_orchestration',
    owner: `worker:${process.pid}`,
    ttlMs: LEASE_TTL_MS,
  }).catch(() => null);

  if (!lock) {
    return {
      companyId, startedAt, finishedAt: new Date().toISOString(),
      acquired: false, fencing: null, lockMode: null,
      outcomes: workers.map((w) => ({ worker: w, ran: false, detail: 'another instance holds the worker lease' })),
    };
  }

  const outcomes: WorkerRunOutcome[] = [];
  try {
    for (const w of workers) {
      const t0 = Date.now();
      let detail = '';
      let failed = false;
      try {
        if (w === 'replay') {
          const r = await runReplayWorker(companyId);
          detail = JSON.stringify(r);
        } else if (w === 'oauth_refresh') {
          const r = await runOAuthRefreshWorker(companyId);
          detail = JSON.stringify('skipped' in r ? r : { scanned: r.scanned });
        } else {
          // Non-destructive by default (dry-run); operator gates destructive.
          const r = await runSecurityResponse({ companyId, actorUserId: args.actorUserId ?? null, allowDestructive: false });
          detail = `mode=${r.mode} anomalies=${r.anomalies} actions=${r.actions.length}`;
        }
        outcomes.push({ worker: w, ran: true, detail });
      } catch (err) {
        failed = true;
        detail = err instanceof Error ? err.message : 'error';
        outcomes.push({ worker: w, ran: false, detail });
      }
      // Heartbeat per worker (existing worker_health table).
      await recordWorkerHeartbeat({
        workerId: `${w}:${companyId}`,
        workerType: `cms.${w}`,
        status: failed ? 'failed' : 'healthy',
        processedCount: 1,
        failedCount: failed ? 1 : 0,
        lastError: failed ? detail : null,
        metadata: { fencing: lock.fencing, lockMode: lock.mode, durationMs: Date.now() - t0 },
      }).catch(() => undefined);
    }
    return {
      companyId, startedAt, finishedAt: new Date().toISOString(),
      acquired: true, fencing: lock.fencing, lockMode: lock.mode, outcomes,
    };
  } finally {
    await releaseAtomicLock(lock).catch(() => undefined);
  }
}

/** Read worker health for the orchestration dashboard (tenant-scoped). */
export async function getWorkerHealth(companyId: string): Promise<any[]> {
  try {
    const { data } = await ownedDbTable('worker_health')
      .select('worker_id, worker_type, status, heartbeat_at, processed_count, failed_count, last_error, metadata')
      .like('worker_id', `%:${companyId}`)
      .order('heartbeat_at', { ascending: false })
      .limit(50);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

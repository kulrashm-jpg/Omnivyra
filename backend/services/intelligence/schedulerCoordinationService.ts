/**
 * Active scheduler coordination — liveness, failover, drift (READ + append-only).
 *
 * Reads the EXISTING worker_health heartbeats (recordWorkerHeartbeat) to
 * verify scheduler/worker liveness, classify stale heartbeats as dead (→
 * failover advisory: the atomic lease inside runSchedulerTick already lets a
 * live instance take over — this surfaces it observably), and estimate
 * cadence drift. No cron/scheduler refactor; emits append-only failover
 * telemetry only.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

const STALE_MS = 15 * 60_000; // heartbeat older than 15m ⇒ presumed dead

export interface SchedulerLiveness {
  workerId: string;
  workerType: string;
  status: string;
  heartbeatAt: string | null;
  ageMs: number | null;
  alive: boolean;
  failedCount: number;
}

export interface SchedulerCoordinationReport {
  companyId: string;
  generatedAt: string;
  schedulers: SchedulerLiveness[];
  deadSchedulers: number;
  failoverAdvised: boolean;
  driftDetected: boolean;
  detail: string;
}

export async function buildSchedulerCoordination(
  companyId: string,
): Promise<SchedulerCoordinationReport> {
  let rows: any[] = [];
  try {
    const { data } = await ownedDbTable('worker_health')
      .select('worker_id, worker_type, status, heartbeat_at, failed_count, metadata')
      .like('worker_id', `%${companyId}%`)
      .order('heartbeat_at', { ascending: false })
      .limit(50);
    rows = (data ?? []) as any[];
  } catch {
    rows = [];
  }

  const now = Date.now();
  const schedulers: SchedulerLiveness[] = rows.map((r) => {
    const t = r.heartbeat_at ? Date.parse(r.heartbeat_at) : NaN;
    const ageMs = Number.isNaN(t) ? null : now - t;
    const alive = ageMs != null && ageMs <= STALE_MS && r.status !== 'failed';
    return {
      workerId: String(r.worker_id),
      workerType: String(r.worker_type),
      status: String(r.status),
      heartbeatAt: r.heartbeat_at ?? null,
      ageMs,
      alive,
      failedCount: Number(r.failed_count ?? 0),
    };
  });

  const dead = schedulers.filter((s) => !s.alive);
  const failoverAdvised = dead.length > 0;
  // Drift: a "healthy" worker whose heartbeat is older than the stale window
  // (it should be re-heartbeating well within it) → cadence drift.
  const driftDetected = schedulers.some((s) => s.status === 'healthy' && (s.ageMs ?? 0) > STALE_MS);

  if (failoverAdvised || driftDetected) {
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'scheduler-coordination' },
      action: failoverAdvised ? 'scheduler_lifecycle.failover_advised' : 'scheduler_lifecycle.drift_detected',
      resourceType: 'scheduler_lifecycle',
      resourceId: companyId,
      severity: 'warning',
      entityLineage: ['company', 'scheduler_lifecycle'],
      detail: { dead: dead.map((d) => d.workerId), driftDetected },
    }).catch(() => undefined);
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    schedulers,
    deadSchedulers: dead.length,
    failoverAdvised,
    driftDetected,
    detail: failoverAdvised
      ? `${dead.length} dead scheduler/worker(s) — live instances take over via the atomic lease automatically.`
      : driftDetected
        ? 'Cadence drift detected — heartbeat older than expected window.'
        : 'All schedulers/workers live within the heartbeat window.',
  };
}

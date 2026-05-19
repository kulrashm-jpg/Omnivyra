/**
 * Active worker liveness validation (OBSERVATIONAL — does not run workers).
 *
 * Closes the prior "wedged-but-heartbeating" gap WITHOUT touching
 * orchestration or leases:
 *   1. write a self-test heartbeat for a dedicated `liveness_probe` worker and
 *      read it back → proves the heartbeat pipeline (write→read) is live and
 *      measures round-trip latency.
 *   2. sample worker_health twice across a short interval → a worker that
 *      reports `healthy` but whose heartbeat timestamp does NOT advance and is
 *      stale is flagged WEDGED (heartbeat present, work stalled).
 *   3. deterministic reliability score from failed_count + responsiveness.
 * Append-only liveness telemetry. No worker execution, no restart, no lease
 * tampering — fully rollback-safe and non-destabilizing.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordWorkerHeartbeat } from '../queueOperationsService';
import { recordComplianceAudit } from '../audit/complianceAuditService';

const STALE_MS = 15 * 60_000;
const SAMPLE_GAP_MS = 1_500;

export interface WorkerLiveness {
  workerId: string;
  workerType: string;
  status: string;
  heartbeatAdvanced: boolean;
  ageMs: number | null;
  wedged: boolean;
  reliabilityScore: number; // 0..100
}

export interface LivenessReport {
  companyId: string;
  generatedAt: string;
  heartbeatPipelineLive: boolean;
  probeRoundTripMs: number | null;
  workers: WorkerLiveness[];
  wedgedCount: number;
  detail: string;
}

async function readHealth(companyId: string): Promise<any[]> {
  try {
    const { data } = await ownedDbTable('worker_health')
      .select('worker_id, worker_type, status, heartbeat_at, failed_count, processed_count')
      .like('worker_id', `%${companyId}%`)
      .order('heartbeat_at', { ascending: false })
      .limit(50);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

function reliability(failed: number, processed: number, responsive: boolean, wedged: boolean): number {
  const total = failed + processed;
  let s = total > 0 ? Math.round((processed / total) * 70) : 50;
  if (responsive) s += 20;
  if (wedged) s -= 40;
  return Math.max(0, Math.min(100, s));
}

export async function probeWorkerLiveness(companyId: string): Promise<LivenessReport> {
  // (1) Self-test heartbeat pipeline.
  const probeId = `liveness_probe:${companyId}`;
  const t0 = Date.now();
  let heartbeatPipelineLive = false;
  let probeRoundTripMs: number | null = null;
  try {
    await recordWorkerHeartbeat({
      workerId: probeId,
      workerType: 'cms.liveness_probe',
      status: 'healthy',
      processedCount: 1,
      metadata: { probeAt: new Date(t0).toISOString() },
    });
    const { data } = await ownedDbTable('worker_health')
      .select('heartbeat_at')
      .eq('worker_id', probeId)
      .maybeSingle();
    heartbeatPipelineLive = Boolean((data as any)?.heartbeat_at);
    probeRoundTripMs = Date.now() - t0;
  } catch {
    heartbeatPipelineLive = false;
  }

  // (2) Two samples across a short interval (no work triggered).
  const sample1 = await readHealth(companyId);
  await new Promise((r) => setTimeout(r, SAMPLE_GAP_MS));
  const sample2 = await readHealth(companyId);
  const beat1 = new Map(sample1.map((r) => [r.worker_id, r.heartbeat_at]));

  const now = Date.now();
  const workers: WorkerLiveness[] = sample2
    .filter((r) => !String(r.worker_id).startsWith('liveness_probe:'))
    .map((r) => {
      const prev = beat1.get(r.worker_id);
      const advanced = Boolean(prev && r.heartbeat_at && prev !== r.heartbeat_at);
      const t = r.heartbeat_at ? Date.parse(r.heartbeat_at) : NaN;
      const ageMs = Number.isNaN(t) ? null : now - t;
      // Wedged: claims healthy, heartbeat did NOT advance, and is stale.
      const wedged = r.status === 'healthy' && !advanced && (ageMs ?? 0) > STALE_MS;
      return {
        workerId: String(r.worker_id),
        workerType: String(r.worker_type),
        status: String(r.status),
        heartbeatAdvanced: advanced,
        ageMs,
        wedged,
        reliabilityScore: reliability(Number(r.failed_count ?? 0), Number(r.processed_count ?? 0), advanced, wedged),
      };
    });

  const wedgedCount = workers.filter((w) => w.wedged).length;
  if (wedgedCount > 0 || !heartbeatPipelineLive) {
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'worker-liveness' },
      action: wedgedCount > 0 ? 'worker_liveness.wedged_detected' : 'worker_liveness.pipeline_degraded',
      resourceType: 'worker_liveness',
      resourceId: companyId,
      severity: 'warning',
      entityLineage: ['company', 'worker_liveness'],
      detail: { wedged: workers.filter((w) => w.wedged).map((w) => w.workerId), heartbeatPipelineLive },
    }).catch(() => undefined);
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    heartbeatPipelineLive,
    probeRoundTripMs,
    workers,
    wedgedCount,
    detail: !heartbeatPipelineLive
      ? 'Heartbeat pipeline did not round-trip — telemetry path degraded.'
      : wedgedCount > 0
        ? `${wedgedCount} wedged worker(s): healthy status but heartbeat not advancing.`
        : 'Heartbeat pipeline live; no wedged workers detected.',
  };
}

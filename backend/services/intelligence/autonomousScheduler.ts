/**
 * Autonomous scheduler — isolated, env-gated, opt-in.
 *
 * Self-contained interval loop that drives runSchedulerTick for an EXPLICIT
 * env-provided company allow-list (no full-table scans, no surprise scope).
 * It is NOT injected into the stable cron/scheduler infrastructure (no
 * refactor / no destabilization) — a deployment opts in by setting:
 *   CMS_AUTONOMOUS_SCHEDULER=true
 *   CMS_AUTONOMOUS_SCHEDULER_COMPANIES=<uuid,uuid,...>
 *   CMS_AUTONOMOUS_SCHEDULER_INTERVAL_MS=<optional, default 300000>
 *
 * Distributed-safe: each tick acquires the existing atomic lease + durable
 * cooldown inside runSchedulerTick, so multiple instances running this loop
 * cannot double-execute a company. Heartbeat is persisted via the existing
 * worker_health table; dead-scheduler staleness is therefore observable.
 * Idempotent, rollback-safe (delegates only to idempotent ticks).
 */
import { recordWorkerHeartbeat } from '../queueOperationsService';
import { runSchedulerTick } from './workerSchedulerService';

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const INSTANCE = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function companies(): string[] {
  return String(process.env.CMS_AUTONOMOUS_SCHEDULER_COMPANIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function intervalMs(): number {
  const v = Number(process.env.CMS_AUTONOMOUS_SCHEDULER_INTERVAL_MS);
  return Number.isFinite(v) && v >= 60_000 ? v : 300_000;
}

async function tickAll(): Promise<void> {
  if (inFlight) return; // single-flight per instance
  inFlight = true;
  const list = companies();
  let ok = 0;
  let fail = 0;
  try {
    for (const companyId of list) {
      try {
        const r = await runSchedulerTick({ companyId, actorUserId: null });
        if (r.status === 'ran' && r.failures === 0) ok += 1;
        else if (r.status === 'ran') fail += 1;
      } catch {
        fail += 1;
      }
    }
    await recordWorkerHeartbeat({
      workerId: `autonomous-scheduler:${INSTANCE}`,
      workerType: 'cms.autonomous_scheduler',
      status: fail > 0 ? 'degraded' : 'healthy',
      processedCount: ok,
      failedCount: fail,
      metadata: { companies: list.length, instance: INSTANCE },
    }).catch(() => undefined);
  } finally {
    inFlight = false;
  }
}

/** Idempotent: starts the loop only if enabled and not already running. */
export function startAutonomousSchedulerIfEnabled(): { started: boolean; reason: string } {
  if (process.env.CMS_AUTONOMOUS_SCHEDULER !== 'true') {
    return { started: false, reason: 'CMS_AUTONOMOUS_SCHEDULER not enabled' };
  }
  if (timer) return { started: false, reason: 'already running in this process' };
  if (companies().length === 0) {
    return { started: false, reason: 'CMS_AUTONOMOUS_SCHEDULER_COMPANIES is empty' };
  }
  timer = setInterval(() => { void tickAll(); }, intervalMs());
  if (typeof timer.unref === 'function') timer.unref(); // never block process exit
  // Kick one tick immediately so startup is observable.
  void tickAll();
  return { started: true, reason: `interval ${intervalMs()}ms, ${companies().length} company(ies)` };
}

/** Graceful shutdown (e.g. SIGTERM handler) — safe replay resumption: the
 *  next instance's tick simply re-acquires the lease and continues. */
export function stopAutonomousScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export function autonomousSchedulerStatus(): { running: boolean; instance: string; companies: number } {
  return { running: Boolean(timer), instance: INSTANCE, companies: companies().length };
}

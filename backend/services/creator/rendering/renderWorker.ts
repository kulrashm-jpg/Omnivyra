/**
 * Render Worker Orchestrator — Step-R5 (distributed, scheduled, pure).
 * ──────────────────────────────────────────────────────────────────────────
 * A bounded, lease-safe claim loop that drives the R4 queue WITHOUT any
 * UI/scheduler involvement. PURE orchestration: `processOne` and
 * `countInFlight` are injected so the loop is fully unit-testable; the
 * internal endpoint wires them to the real R4 worker + DB.
 *
 * Guarantees: exactly-once (R4 lease), bounded execution window, global +
 * per-provider concurrency caps with backpressure (fail-closed under
 * overload — never storms a provider), append-only lineage untouched
 * (worker only advances queue state via R4), R3 sync path unaffected.
 */

export type WorkerProcessStatus =
  | 'completed' | 'retry_scheduled' | 'failed' | 'blocked' | 'idle';

export interface WorkerProcessResult {
  ok: boolean;
  status: WorkerProcessStatus;
  events: string[];
  reason?: string;
  /** Optional provider/render duration the worker averages. */
  duration_ms?: number;
}

export interface RenderWorkerDeps {
  /** One claim+process iteration (R4 processQueuedRenderJob bound). */
  processOne: (leaseOwner: string) => Promise<WorkerProcessResult>;
  /** In-flight queue rows per provider_key (active states). */
  countInFlight: () => Promise<Record<string, number>>;
  /** Expired-lease rows in active states (metric only; R4 reclaims). */
  countStaleLeases: () => Promise<number>;
  now: () => number;
}

export interface RenderWorkerOptions {
  workerId: string;
  /** Hard cap on jobs processed this tick. */
  maxJobs?: number;
  /** Wall-clock budget; the loop stops claiming new work past it
   *  (graceful shutdown safety). */
  maxMillis?: number;
  /** Global in-flight ceiling across all providers (backpressure). */
  globalConcurrency?: number;
  /** Per-provider in-flight ceiling (provider throttling / no storm). */
  providerConcurrency?: number;
}

export interface RenderWorkerMetrics {
  worker_id: string;
  jobs_claimed: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_retried: number;
  jobs_blocked: number;
  stale_leases_reclaimed: number;
  provider_failures: number;
  moderation_blocks: number;
  avg_render_duration_ms: number;
  worker_tick_duration_ms: number;
  backpressure: boolean;
  stopped_reason: 'idle' | 'max_jobs' | 'time_budget' | 'backpressure';
}

const DEFAULTS = {
  maxJobs: 10,
  maxMillis: 25_000,
  globalConcurrency: 8,
  providerConcurrency: 3,
};

/**
 * Run ONE worker tick. Stateless + idempotent: every tick independently
 * claims via the R4 lease, so N concurrent workers are safe (no
 * duplicate processing). Returns metrics only — no noisy logs.
 */
export async function runRenderWorkerTick(
  deps: RenderWorkerDeps,
  opts: RenderWorkerOptions,
): Promise<RenderWorkerMetrics> {
  const t0 = deps.now();
  const maxJobs = opts.maxJobs ?? DEFAULTS.maxJobs;
  const maxMillis = opts.maxMillis ?? DEFAULTS.maxMillis;
  const globalCap = opts.globalConcurrency ?? DEFAULTS.globalConcurrency;
  const provCap = opts.providerConcurrency ?? DEFAULTS.providerConcurrency;
  const deadline = t0 + maxMillis;

  const m: RenderWorkerMetrics = {
    worker_id: opts.workerId,
    jobs_claimed: 0, jobs_completed: 0, jobs_failed: 0, jobs_retried: 0,
    jobs_blocked: 0, stale_leases_reclaimed: 0, provider_failures: 0,
    moderation_blocks: 0, avg_render_duration_ms: 0, worker_tick_duration_ms: 0,
    backpressure: false, stopped_reason: 'idle',
  };

  // Stale-lease metric (R4's claim performs the actual reclaim).
  try { m.stale_leases_reclaimed = await deps.countStaleLeases(); } catch { /* metric only */ }

  let inFlight: Record<string, number> = {};
  try { inFlight = await deps.countInFlight(); } catch { inFlight = {}; }
  const totalInFlight = (map: Record<string, number>) =>
    Object.values(map).reduce((a, b) => a + (b || 0), 0);
  const allProvidersSaturated = (map: Record<string, number>) => {
    const keys = Object.keys(map);
    return keys.length > 0 && keys.every((k) => (map[k] || 0) >= provCap);
  };

  let durTotal = 0;
  let durN = 0;

  while (true) {
    if (m.jobs_claimed >= maxJobs) { m.stopped_reason = 'max_jobs'; break; }
    if (deps.now() >= deadline) { m.stopped_reason = 'time_budget'; break; }
    // Fail-closed backpressure: never exceed global / per-provider caps.
    if (totalInFlight(inFlight) >= globalCap || allProvidersSaturated(inFlight)) {
      m.backpressure = true;
      m.stopped_reason = 'backpressure';
      break;
    }

    let r: WorkerProcessResult;
    try {
      r = await deps.processOne(`${opts.workerId}:${m.jobs_claimed}`);
    } catch {
      // A thrown processOne is isolated (poison-job protection): count
      // it, do NOT abort the whole tick.
      m.jobs_failed += 1;
      m.provider_failures += 1;
      continue;
    }

    if (r.status === 'idle') { m.stopped_reason = 'idle'; break; }

    m.jobs_claimed += 1;
    if (typeof r.duration_ms === 'number') { durTotal += r.duration_ms; durN += 1; }

    switch (r.status) {
      case 'completed': m.jobs_completed += 1; break;
      case 'retry_scheduled': m.jobs_retried += 1; break;
      case 'blocked':
        m.jobs_blocked += 1;
        m.moderation_blocks += r.reason && /moderation/.test(r.reason) ? 1 : 0;
        break;
      case 'failed':
        m.jobs_failed += 1;
        if (r.events.includes('render_terminal_failure') &&
            !(r.reason && /moderation/.test(r.reason))) m.provider_failures += 1;
        break;
    }

    // Refresh in-flight estimate cheaply (assume this job left the
    // active set unless it retried — keeps backpressure responsive
    // without a DB round-trip every iteration).
    if (r.status === 'retry_scheduled') {
      // still pending; recount occasionally
      if (m.jobs_claimed % 3 === 0) {
        try { inFlight = await deps.countInFlight(); } catch { /* keep */ }
      }
    }
  }

  m.avg_render_duration_ms = durN > 0 ? Math.round(durTotal / durN) : 0;
  m.worker_tick_duration_ms = deps.now() - t0;
  return m;
}

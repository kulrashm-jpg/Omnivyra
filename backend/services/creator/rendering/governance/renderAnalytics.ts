/**
 * Render Analytics — Step-R6 operational aggregation (PURE, no PII).
 * ──────────────────────────────────────────────────────────────────────────
 * Aggregates already-loaded queue/attempt/output/job-state rows into
 * structured operational metrics. NO PII: only ids, statuses, counts,
 * timestamps. Pure + deterministic; the caller owns DB reads.
 *
 * Cost reuses the existing flat per-render estimate (5 credits — same
 * value the R3/R4 billing HOLD uses) — NO new ledger; this is reporting
 * only, never a charge.
 */

const PER_RENDER_CREDITS = 5;

export interface QueueRowLite {
  queue_state: string;
  retry_count?: number;
  created_at?: string;
  updated_at?: string;
}
export interface AttemptRowLite {
  status: string;
  provider_key?: string;
}
export interface JobStateRowLite {
  current_state: string;
}
export interface AnalyticsInput {
  queueRows: QueueRowLite[];
  attemptRows: AttemptRowLite[];
  jobStateRows: JobStateRowLite[];
  /** stale-lease count surfaced by the worker/health probe. */
  staleLeaseCount?: number;
  /** distinct deduped/reused renders observed (duplicate_render_reused). */
  duplicateReuseCount?: number;
}

export interface RenderAnalytics {
  total_jobs: number;
  render_success_rate: number;
  avg_render_duration_ms: number;
  moderation_block_rate: number;
  retry_rate: number;
  provider_failure_rate: number;
  avg_queue_latency_ms: number;
  stale_lease_rate: number;
  duplicate_reuse_rate: number;
  estimated_cost_credits: number;
  reuse_savings_credits: number;
  prevented_duplicate_renders: number;
}

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 1000 : 0;
}
function ms(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const t0 = Date.parse(a); const t1 = Date.parse(b);
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? t1 - t0 : null;
}

export function aggregateRenderAnalytics(input: AnalyticsInput): RenderAnalytics {
  const q = Array.isArray(input.queueRows) ? input.queueRows : [];
  const a = Array.isArray(input.attemptRows) ? input.attemptRows : [];
  const js = Array.isArray(input.jobStateRows) ? input.jobStateRows : [];
  const total = q.length;

  const completed = q.filter((r) => r.queue_state === 'completed').length;
  const failed = q.filter((r) => r.queue_state === 'failed').length;
  const retried = q.filter((r) => (r.retry_count ?? 0) > 0).length;

  const modBlocked = js.filter((r) =>
    r.current_state === 'failed_moderation_post' || r.current_state === 'failed_moderation_pre').length;
  const providerFailedAttempts = a.filter((r) => r.status === 'failed' || r.status === 'timed_out').length;

  const latencies = q
    .filter((r) => r.queue_state === 'completed')
    .map((r) => ms(r.created_at, r.updated_at))
    .filter((x): x is number => x != null);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : 0;

  const dupReuse = Number.isFinite(input.duplicateReuseCount) ? Number(input.duplicateReuseCount) : 0;
  const stale = Number.isFinite(input.staleLeaseCount) ? Number(input.staleLeaseCount) : 0;

  return {
    total_jobs: total,
    render_success_rate: rate(completed, total),
    // duration ≈ queue latency for sync-like single-attempt renders.
    avg_render_duration_ms: avgLatency,
    moderation_block_rate: rate(modBlocked, total || js.length),
    retry_rate: rate(retried, total),
    provider_failure_rate: rate(providerFailedAttempts, a.length),
    avg_queue_latency_ms: avgLatency,
    stale_lease_rate: rate(stale, total || 1),
    duplicate_reuse_rate: rate(dupReuse, total + dupReuse),
    estimated_cost_credits: completed * PER_RENDER_CREDITS,
    // Each prevented duplicate is one render NOT billed.
    reuse_savings_credits: dupReuse * PER_RENDER_CREDITS,
    prevented_duplicate_renders: dupReuse,
  };
}

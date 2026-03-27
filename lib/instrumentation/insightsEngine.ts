/**
 * Cross-service correlation insights engine — v2.
 *
 * v2 changes:
 *  - Each Insight now carries an `action` string — a concrete next step
 *  - Detectors are baseline-aware: when SystemBaselines are provided, dynamic
 *    thresholds (baseline × multiplier) replace static values; static thresholds
 *    are used as a fallback when history is unavailable
 *
 * Detections:
 *   API → Redis   : Rate limiting / caching driving Redis ops
 *   API → External: Uncached AI calls inflating cost
 *   Redis → Cost  : Dominant feature / command consuming disproportionate ops
 *   Auth load     : Firebase verify rate close to API request rate (no token caching)
 *   Supabase      : Error spike, high write ratio
 *   External APIs : Elevated error rates
 *   Latency       : API p95 above baseline or static threshold
 *   Cost          : Dominant cost driver, Redis near free tier, rising trend
 */

import type { SystemMetrics }  from './systemMetrics';
import type { CostEstimate }   from './costEngine';
import type { CostProjection } from './costProjection';
import type { SystemBaselines } from './baselineEngine';
import { WARN_MULTIPLIER, CRITICAL_MULTIPLIER } from './baselineEngine';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Insight {
  /** One-line description of the finding. */
  summary: string;
  /** Concrete next step the operator can take immediately. */
  action:  string;
  /** Severity. */
  level:   'info' | 'warn' | 'critical';
  /** Services involved in this correlation. */
  tags:    string[];
}

// ── Context passed to every detector ──────────────────────────────────────────

interface DetectionContext {
  metrics:    SystemMetrics;
  cost:       CostEstimate | null;
  projection: CostProjection | null;
  baselines:  SystemBaselines | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function featurePct(metrics: SystemMetrics, feature: string): number {
  return metrics.redis?.topFeatures?.find(f => f.feature === feature)?.pct ?? 0;
}

/**
 * Return the effective warn/critical thresholds for a metric.
 * Uses dynamic baseline when available, otherwise falls back to static values.
 */
function thresholds(
  baselineVal: number | null | undefined,
  staticWarn: number,
  staticCritical: number,
): { warn: number; critical: number; isDynamic: boolean } {
  if (baselineVal != null && baselineVal > 0) {
    return {
      warn:      baselineVal * WARN_MULTIPLIER,
      critical:  baselineVal * CRITICAL_MULTIPLIER,
      isDynamic: true,
    };
  }
  return { warn: staticWarn, critical: staticCritical, isDynamic: false };
}

// ── Detection rules ────────────────────────────────────────────────────────────

function detectRateLimitPressure({ metrics, baselines }: DetectionContext): Insight | null {
  const rlPct  = featurePct(metrics, 'rate_limit');
  const apiCpm = metrics.api?.callsPerMin ?? 0;
  const thresh = thresholds(baselines?.apiCpm?.mean, 10, 50);

  if (rlPct >= 40 && apiCpm > thresh.warn) {
    const hint = thresh.isDynamic
      ? `(${Math.round(apiCpm / thresh.warn * 100)}% above your ${Math.round(thresh.warn)}/min baseline)`
      : '';
    return {
      summary: `Rate limiting consumes ${rlPct}% of Redis ops — driven by API traffic at ${apiCpm} req/min ${hint}`.trim(),
      action:  'Raise rate-limit window size or increase allowed burst; review suspicious client IPs in API logs',
      level:   rlPct >= 60 ? 'warn' : 'info',
      tags:    ['redis', 'api', 'rate_limit'],
    };
  }
  return null;
}

function detectCacheMiss({ metrics, cost }: DetectionContext): Insight | null {
  const cachePct    = featurePct(metrics, 'ai_cache');
  const openaiCalls = metrics.external?.byService?.['openai']?.calls    ?? 0;
  const anthropicCalls = metrics.external?.byService?.['anthropic']?.calls ?? 0;
  const aiCalls     = openaiCalls + anthropicCalls;

  if (aiCalls > 0 && cachePct < 10) {
    const aiCost   = cost?.breakdown?.['AI APIs']?.estimatedMonthly ?? 0;
    const costHint = aiCost > 5 ? ` (~$${aiCost.toFixed(0)}/mo est.)` : '';
    return {
      summary: `AI cache is only ${cachePct}% of Redis ops while ${aiCalls} AI calls are active${costHint} — prompts not being cached`,
      action:  'Increase ai_cache TTL and ensure cache key includes all prompt variables; target ≥ 30% cache hit ratio',
      level:   aiCalls > 5 ? 'warn' : 'info',
      tags:    ['redis', 'ai_apis', 'cost'],
    };
  }
  return null;
}

function detectQueuePressure({ metrics, baselines }: DetectionContext): Insight | null {
  const queuePct  = featurePct(metrics, 'queue');
  const opsPerMin = metrics.redis?.opsPerMin ?? 0;
  const thresh    = thresholds(baselines?.redisOpsPerMin?.mean, 50, 200);

  if (queuePct >= 30 && opsPerMin > thresh.warn) {
    const queueOps = Math.round(opsPerMin * queuePct / 100);
    return {
      summary: `BullMQ queues drive ${queuePct}% of Redis ops (${queueOps} ops/min)`,
      action:  'Batch similar jobs, reduce job state polling frequency, or enable BullMQ flow producers to reduce per-job overhead',
      level:   queuePct >= 50 ? 'warn' : 'info',
      tags:    ['redis', 'queue'],
    };
  }
  return null;
}

function detectSupabaseErrors({ metrics, baselines }: DetectionContext): Insight | null {
  if (!metrics.supabase) return null;
  const { reads, writes, errors, avgReadLatency } = metrics.supabase;
  const total   = reads + writes;
  const errPct  = pct(errors, total);
  const thresh  = thresholds(baselines?.apiErrorRate?.mean, 5, 15);

  if (errPct >= thresh.warn && errors > 0) {
    const latencyHint = avgReadLatency && avgReadLatency > 500
      ? ` — avg read latency ${avgReadLatency}ms suggests pool saturation`
      : '';
    return {
      summary: `Supabase error rate is ${errPct}% (${errors}/${total} queries)${latencyHint}`,
      action:  errPct >= thresh.critical
        ? 'Investigate connection pool exhaustion: increase pool size or enable PgBouncer; check for missing indexes on hot queries'
        : 'Review Supabase logs for repeated constraint violations or RLS policy mismatches',
      level:   errPct >= thresh.critical ? 'critical' : 'warn',
      tags:    ['supabase'],
    };
  }
  return null;
}

function detectHighWriteRatio({ metrics }: DetectionContext): Insight | null {
  if (!metrics.supabase) return null;
  const { reads, writes } = metrics.supabase;
  const total = reads + writes;
  if (total < 10) return null;

  const writeRatio = writes / total;
  if (writeRatio > 0.5) {
    return {
      summary: `Supabase write ratio is ${Math.round(writeRatio * 100)}% (${writes}/${total} ops) — unusually write-heavy`,
      action:  'Consider batching writes, using Postgres triggers for derived data, or switching hot write paths to an append-only queue',
      level:   writeRatio > 0.7 ? 'warn' : 'info',
      tags:    ['supabase', 'cost'],
    };
  }
  return null;
}

// detectHighAuthLoad removed — Firebase auth replaced by Supabase JWT

function detectExternalApiErrors({ metrics }: DetectionContext): Insight | null {
  const services  = metrics.external?.topServices ?? [];
  const highError = services.filter(s => s.errorRate > 0.1 && s.calls > 2);

  if (highError.length === 0) return null;

  const names    = highError.map(s => `${s.service} (${Math.round(s.errorRate * 100)}%)`).join(', ');
  const isCrit   = highError.some(s => s.errorRate > 0.3);
  const topSvc   = highError[0].service;
  return {
    summary: `High error rates on external APIs: ${names}`,
    action:  `Add exponential-backoff retry for ${topSvc}; set up a dead-letter queue for failed calls; check API key expiry and quota limits`,
    level:   isCrit ? 'critical' : 'warn',
    tags:    ['external_apis'],
  };
}

function detectApiLatencySpike({ metrics, baselines }: DetectionContext): Insight | null {
  const p95  = metrics.api?.p95LatencyMs ?? null;
  const avg  = metrics.api?.avgLatencyMs ?? null;
  if (!p95 || !avg) return null;

  const thresh = thresholds(baselines?.apiP95Ms?.mean, 3_000, 8_000);

  if (p95 > thresh.warn) {
    const dynamicHint = thresh.isDynamic
      ? ` (${Math.round(p95 / thresh.warn * 100)}% above your ${Math.round(thresh.warn)}ms baseline)`
      : '';
    return {
      summary: `API p95 latency is ${p95}ms (avg ${avg}ms)${dynamicHint}`,
      action:  p95 > thresh.critical
        ? 'Immediate action: profile the slowest endpoints in Vercel Analytics; check for blocking synchronous calls in hot paths; consider edge caching'
        : 'Instrument slow endpoints with withApiTracking(); look for cold-start patterns in non-warmed routes',
      level:   p95 > thresh.critical ? 'critical' : 'warn',
      tags:    ['api', 'vercel'],
    };
  }
  return null;
}

function detectDominantCostDriver({ cost }: DetectionContext): Insight | null {
  if (!cost || cost.topCostDrivers.length === 0) return null;
  const top   = cost.topCostDrivers[0];
  const total = cost.totalMonthlyEstimate;
  const share = pct(top.impact, total);

  if (share >= 40 && total >= 5) {
    return {
      summary: `${top.service} drives ~${share}% of monthly cost ($${top.impact.toFixed(2)}): ${top.reason}`,
      action:  `Review the ${top.service} cost driver; consider optimising usage pattern or upgrading plan tier if nearing overage`,
      level:   share >= 60 ? 'warn' : 'info',
      tags:    [top.service.toLowerCase().replace(/\s+/g, '_'), 'cost'],
    };
  }
  return null;
}

function detectRedisNearFree({ metrics, baselines }: DetectionContext): Insight | null {
  if (!metrics.redis) return null;
  const opsPerMin   = metrics.redis.opsPerMin;
  const monthlyOps  = opsPerMin * 60 * 24 * 30;
  const monthlyFree = 10_000 * 30;   // Upstash: 10K/day free
  const ratio       = monthlyOps / monthlyFree;

  // Use dynamic baseline to project whether trend will breach the free tier
  const baselineOps = baselines?.redisOpsPerMin?.mean;
  const trendNote   = baselineOps && opsPerMin > baselineOps * 1.2
    ? ' — current rate is rising above your 7-day average'
    : '';

  if (ratio > 0.8 && ratio < 1.0) {
    return {
      summary: `Redis usage at ${Math.round(ratio * 100)}% of Upstash free tier${trendNote}`,
      action:  'Audit highest-ops features (see Redis breakdown); consider increasing cache TTLs or debouncing frequent writes to stay within the free tier',
      level:   'warn',
      tags:    ['redis', 'cost'],
    };
  }
  return null;
}

function detectRisingCostTrend({ projection }: DetectionContext): Insight | null {
  if (!projection || projection.trend !== 'rising') return null;
  if (projection.confidence === 'low') return null;
  if (!projection.weeklyDeltaPct || projection.weeklyDeltaPct < 10) return null;

  const projected = projection.projectedMonthlyCost;
  const projStr   = projected != null ? ` — projected to reach $${projected.toFixed(0)}/mo` : '';
  return {
    summary: `Infrastructure cost is rising at +${projection.weeklyDeltaPct}%/week${projStr}`,
    action:  'Identify the fastest-growing service in the Cost Overview card; set a cost alert in your cloud provider dashboard',
    level:   projection.weeklyDeltaPct > 25 ? 'critical' : 'warn',
    tags:    ['cost'],
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Derive actionable insights from a current snapshot, optional cost estimate,
 * optional cost projection, and optional dynamic baselines.
 *
 * Pure function — no side effects, no I/O.
 */
export function deriveInsights(
  metrics:    SystemMetrics,
  cost:       CostEstimate | null,
  projection: CostProjection | null = null,
  baselines:  SystemBaselines | null = null,
): Insight[] {
  const ctx: DetectionContext = { metrics, cost, projection, baselines };

  const checks = [
    detectRateLimitPressure(ctx),
    detectCacheMiss(ctx),
    detectQueuePressure(ctx),
    detectSupabaseErrors(ctx),
    detectHighWriteRatio(ctx),
    detectExternalApiErrors(ctx),
    detectApiLatencySpike(ctx),
    detectDominantCostDriver(ctx),
    detectRedisNearFree(ctx),
    detectRisingCostTrend(ctx),
  ];

  return checks.filter((i): i is Insight => i !== null);
}

/**
 * Convenience: return summary strings only (backward-compatible with v1).
 */
export function getInsightSummaries(
  metrics:    SystemMetrics,
  cost:       CostEstimate | null,
  projection: CostProjection | null = null,
  baselines:  SystemBaselines | null = null,
): string[] {
  return deriveInsights(metrics, cost, projection, baselines).map(i => i.summary);
}

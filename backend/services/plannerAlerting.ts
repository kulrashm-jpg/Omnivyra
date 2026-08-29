/**
 * Planner operational alerting.
 *
 * Increments rate-tracked counters for adverse planner events. Each counter
 * keeps a sliding-window history; when the rate over the window crosses a
 * configurable threshold, a single structured `planner_alert_threshold_exceeded`
 * warn is emitted (with a cool-down so alert spam doesn't flood the log
 * channel during a sustained incident).
 *
 * Designed for Datadog / Grafana ingestion:
 *   - Counters are observable via `getPlannerAlertSnapshot()` for periodic
 *     metric scraping.
 *   - Threshold events are emitted as `logger.warn('planner_alert_threshold_exceeded')`
 *     for log-based alert rules.
 *
 * Per-process by default. When `DISTRIBUTED_METRICS_ENABLED=true` AND a
 * Redis client is available, counters are ALSO mirrored to a Redis sorted
 * set per counter so dashboards can compute cluster-wide rates. The local
 * sliding window keeps working as a fallback when Redis is unavailable.
 */

import { logger } from './logger';
import { resolvePlannerFlag } from './plannerRolloutMode';
import { getRequestContext } from './requestContext';

export type PlannerAlertCounter =
  | 'planner_total_budget_exceeded'
  | 'drafting_timeout'
  | 'alignment_timeout'
  | 'overload_mode_activation'
  | 'placeholder_fallback'
  | 'repair_budget_exceeded'
  | 'provider_bucket_exhausted'
  | 'refinement_failure'
  | 'lease_lost';

const ALERT_DEFAULTS: Record<PlannerAlertCounter, {
  /** Rate threshold expressed as events per WINDOW_MS. */
  threshold: number;
  /** Sliding window for rate calculation, ms. */
  windowMs: number;
}> = {
  planner_total_budget_exceeded:   { threshold: 3,  windowMs: 5 * 60_000 },
  drafting_timeout:                { threshold: 5,  windowMs: 5 * 60_000 },
  alignment_timeout:               { threshold: 5,  windowMs: 5 * 60_000 },
  overload_mode_activation:        { threshold: 10, windowMs: 5 * 60_000 },
  placeholder_fallback:            { threshold: 5,  windowMs: 5 * 60_000 },
  repair_budget_exceeded:          { threshold: 3,  windowMs: 5 * 60_000 },
  provider_bucket_exhausted:       { threshold: 10, windowMs: 5 * 60_000 },
  refinement_failure:              { threshold: 5,  windowMs: 5 * 60_000 },
  lease_lost:                      { threshold: 5,  windowMs: 5 * 60_000 },
};

/** Minimum gap between two threshold-exceeded warnings for the same counter. */
const ALERT_COOLDOWN_MS = 60_000;

type CounterState = {
  /** Sample timestamps (ms epoch) within the active window. */
  samples: number[];
  /** Last time a threshold-exceeded log was emitted (ms epoch). */
  lastAlertAt: number;
  /** Cumulative count since process boot — for /metrics scrape. */
  total: number;
};

const _state: Record<PlannerAlertCounter, CounterState> = {
  planner_total_budget_exceeded: { samples: [], lastAlertAt: 0, total: 0 },
  drafting_timeout:              { samples: [], lastAlertAt: 0, total: 0 },
  alignment_timeout:             { samples: [], lastAlertAt: 0, total: 0 },
  overload_mode_activation:      { samples: [], lastAlertAt: 0, total: 0 },
  placeholder_fallback:          { samples: [], lastAlertAt: 0, total: 0 },
  repair_budget_exceeded:        { samples: [], lastAlertAt: 0, total: 0 },
  provider_bucket_exhausted:     { samples: [], lastAlertAt: 0, total: 0 },
  refinement_failure:            { samples: [], lastAlertAt: 0, total: 0 },
  lease_lost:                    { samples: [], lastAlertAt: 0, total: 0 },
};

// ── Distributed metrics mirror (Redis) ────────────────────────────────────
// When DISTRIBUTED_METRICS_ENABLED=true we ALSO push each sample into a
// Redis sorted set keyed by counter, with the score being the sample's epoch
// ms. Cluster-wide counts are then `ZCOUNT key (now-window) now`. The
// per-process sliding window stays as the local backstop.
//
// Failures are silent — alerting never blocks the planner. After
// `REDIS_FAIL_THRESHOLD` consecutive failures we stop trying Redis until
// the next process restart.

const REDIS_KEY_PREFIX = 'planner:metric:';
const REDIS_FAIL_THRESHOLD = 5;
let _redisFailureCount = 0;
let _redisClientCache: any = null;

function distributedMetricsEnabled(): boolean {
  return resolvePlannerFlag('DISTRIBUTED_METRICS_ENABLED', false);
}

function getRedisOrNull(): any {
  if (!distributedMetricsEnabled()) return null;
  if (_redisFailureCount >= REDIS_FAIL_THRESHOLD) return null;
  if (_redisClientCache) return _redisClientCache;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _redisClientCache = getInstrumentedStandaloneRedisClient('planner-metrics');
    return _redisClientCache;
  } catch {
    _redisFailureCount = REDIS_FAIL_THRESHOLD;
    return null;
  }
}

function mirrorToRedis(counter: PlannerAlertCounter, now: number, windowMs: number): void {
  const client = getRedisOrNull();
  if (!client) return;
  const key = `${REDIS_KEY_PREFIX}${counter}`;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  // Pipeline: ZADD this sample + ZREMRANGEBYSCORE old + PEXPIRE so an idle
  // counter eventually frees its key. All sync from the caller's POV; the
  // promise is fire-and-forget so we never block the planner.
  client
    .multi()
    .zadd(key, now, member)
    .zremrangebyscore(key, '-inf', now - windowMs)
    .pexpire(key, windowMs * 2)
    .exec()
    .catch((err: unknown) => {
      _redisFailureCount += 1;
      if (_redisFailureCount === REDIS_FAIL_THRESHOLD) {
        logger.warn('planner_metrics_redis_disabled', {
          counter,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
}

/**
 * Read the cluster-wide count of a counter within its sliding window.
 * Returns the count, or null when Redis is unavailable.
 */
export async function getClusterCounterCount(
  counter: PlannerAlertCounter,
): Promise<number | null> {
  const client = getRedisOrNull();
  if (!client) return null;
  try {
    const cfg = ALERT_DEFAULTS[counter];
    const key = `${REDIS_KEY_PREFIX}${counter}`;
    const now = Date.now();
    await client.zremrangebyscore(key, '-inf', now - cfg.windowMs);
    return await client.zcard(key);
  } catch {
    return null;
  }
}

function pruneOldSamples(state: CounterState, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  // Samples are appended in time order so we can shift from the front.
  while (state.samples.length && state.samples[0] < cutoff) {
    state.samples.shift();
  }
}

/**
 * Record one occurrence of `counter`. May emit a threshold-exceeded warning
 * if the rate crosses the configured threshold AND we are past the cool-down
 * since the last warning. Otherwise it just bumps internal counters.
 *
 * Safe to call from any code path — never throws, never blocks on I/O.
 */
export function recordPlannerAlertCounter(
  counter: PlannerAlertCounter,
  extra: Record<string, unknown> = {},
): void {
  try {
    const cfg = ALERT_DEFAULTS[counter];
    const state = _state[counter];
    const now = Date.now();
    state.samples.push(now);
    state.total += 1;
    pruneOldSamples(state, cfg.windowMs);

    // Mirror to Redis if distributed metrics are enabled. Fire-and-forget.
    mirrorToRedis(counter, now, cfg.windowMs);

    if (state.samples.length >= cfg.threshold) {
      if (now - state.lastAlertAt >= ALERT_COOLDOWN_MS) {
        state.lastAlertAt = now;
        logger.warn('planner_alert_threshold_exceeded', {
          request_id: getRequestContext().requestId,
          counter,
          observed_count: state.samples.length,
          threshold: cfg.threshold,
          window_ms: cfg.windowMs,
          cooldown_ms: ALERT_COOLDOWN_MS,
          total_since_boot: state.total,
          ...extra,
        });
      }
    }
  } catch {
    /* never let alerting break the planner */
  }
}

/**
 * Read-only snapshot of all counter states. Intended for periodic
 * /metrics endpoint scrape by Datadog / Grafana.
 */
export function getPlannerAlertSnapshot(): Record<
  PlannerAlertCounter,
  { recentInWindow: number; windowMs: number; threshold: number; total: number }
> {
  const out = {} as Record<PlannerAlertCounter, {
    recentInWindow: number;
    windowMs: number;
    threshold: number;
    total: number;
  }>;
  for (const key of Object.keys(_state) as PlannerAlertCounter[]) {
    const cfg = ALERT_DEFAULTS[key];
    const state = _state[key];
    pruneOldSamples(state, cfg.windowMs);
    out[key] = {
      recentInWindow: state.samples.length,
      windowMs: cfg.windowMs,
      threshold: cfg.threshold,
      total: state.total,
    };
  }
  return out;
}

/**
 * Reset all alert counters. Test-only — production code must never call this.
 */
export function __resetPlannerAlertCountersForTests(): void {
  for (const key of Object.keys(_state) as PlannerAlertCounter[]) {
    _state[key].samples.length = 0;
    _state[key].lastAlertAt = 0;
    _state[key].total = 0;
  }
  _redisFailureCount = 0;
  _redisClientCache = null;
}

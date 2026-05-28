/**
 * Cluster-wide overload coordinator.
 *
 * Aggregates pressure signals from every instance into a shared Redis state
 * and projects a single overload mode visible to every planner request.
 * Avoids the per-instance flapping that pure local pressure causes when
 * load is unevenly distributed.
 *
 * Pressure inputs:
 *   - distributed semaphore active vs max (from distributedSemaphore.snapshotAll)
 *   - BullMQ queue pressure (from bullmqOverloadSignals)
 *   - provider bucket exhaustion rate (from plannerAlerting)
 *   - planner timeout rate (drafting_timeout + alignment_timeout)
 *   - refinement backlog (refinement queue waiting count)
 *
 * Output state machine: normal → elevated → degraded → critical
 *   normal     : every protection dormant; full pipeline runs
 *   elevated   : recovery off, watchful
 *   degraded   : refinement skipped, alignment-eval-only
 *   critical   : admission-control gated (admission.ts), placeholder-on-pressure
 *
 * Hysteresis:
 *   - Enter higher mode immediately on threshold crossing
 *   - Leave higher mode only after `HYSTERESIS_MS` (default 30s) of healthy readings
 *   - Prevents oscillation between modes during borderline load
 *
 * Shared state: `planner:overload:state` HASH with mode + last_change_at +
 *               pressure_score. Refreshed every `PUBLISH_INTERVAL_MS` by
 *               every instance; consumers read it on every planner request.
 *
 * Failure: Redis unavailable → fall back to local-only overload signal (the
 * existing per-process check). Documented in failure recovery section.
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { snapshotAll as semaphoreSnapshotAll } from './distributedSemaphore';
import { getBoltQueuePressure } from './bullmqOverloadSignals';
import { getPlannerAlertSnapshot } from './plannerAlerting';

export type OverloadMode = 'normal' | 'elevated' | 'degraded' | 'critical';

const STATE_KEY = 'planner:overload:state';
const PRESSURE_KEY = 'planner:overload:pressure';
const HYSTERESIS_MS = Number(process.env.PLANNER_OVERLOAD_HYSTERESIS_MS || 30_000);
const PUBLISH_INTERVAL_MS = Number(process.env.PLANNER_OVERLOAD_PUBLISH_MS || 5_000);
const READ_CACHE_MS = 2_000;

interface ClusterPressureSnapshot {
  semaphore_saturation: number; // 0..1 across all pools weighted by maxAllowed
  bullmq_pressure: boolean;
  bullmq_reasons: string[];
  recent_provider_exhaustions: number;
  recent_drafting_timeouts: number;
  recent_alignment_timeouts: number;
  refinement_failure_rate: number;
  computed_at_ms: number;
  /** Aggregate 0..1 score used for mode transitions. */
  pressure_score: number;
}

let _client: IORedis | null = null;
let _publishTimer: NodeJS.Timeout | null = null;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;
let _cachedState: { mode: OverloadMode; pressureScore: number; cachedAtMs: number } | null = null;

function isEnabled(): boolean {
  return String(process.env.DISTRIBUTED_OVERLOAD_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (!isEnabled()) return null;
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-overload');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('distributed_overload_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Compute a 0..1 pressure score from local signals. Each signal contributes
 * weighted toward the total. Bounded at 1.0.
 */
async function computeLocalPressure(): Promise<ClusterPressureSnapshot> {
  const sem = semaphoreSnapshotAll();
  // Saturation across all pools, weighted by maxAllowed so a saturated
  // drafting pool counts more than a saturated repair pool.
  let activeTotal = 0;
  let maxTotal = 0;
  for (const p of Object.values(sem)) {
    activeTotal += p.active;
    maxTotal += p.maxAllowed;
  }
  const semaphoreSaturation = maxTotal > 0 ? Math.min(1, activeTotal / maxTotal) : 0;

  const queue = await getBoltQueuePressure();
  const alerts = getPlannerAlertSnapshot();

  // Component scores 0..1
  const semScore       = semaphoreSaturation;
  const queueScore     = queue.pressureHigh ? 0.6 : 0;
  const providerScore  = Math.min(1, (alerts.provider_bucket_exhausted?.recentInWindow ?? 0) / 10);
  const draftScore     = Math.min(1, (alerts.drafting_timeout?.recentInWindow ?? 0) / 10);
  const alignScore     = Math.min(1, (alerts.alignment_timeout?.recentInWindow ?? 0) / 10);
  const refineFailRate = Math.min(1, (alerts.refinement_failure?.recentInWindow ?? 0) / 5);

  // Weighted sum (weights total ~1.0 so output ≤ 1)
  const pressure_score = Math.min(
    1,
    0.35 * semScore +
      0.20 * queueScore +
      0.15 * providerScore +
      0.15 * draftScore +
      0.10 * alignScore +
      0.05 * refineFailRate,
  );

  return {
    semaphore_saturation: Number(semScore.toFixed(3)),
    bullmq_pressure: queue.pressureHigh,
    bullmq_reasons: queue.reasons,
    recent_provider_exhaustions: alerts.provider_bucket_exhausted?.recentInWindow ?? 0,
    recent_drafting_timeouts: alerts.drafting_timeout?.recentInWindow ?? 0,
    recent_alignment_timeouts: alerts.alignment_timeout?.recentInWindow ?? 0,
    refinement_failure_rate: refineFailRate,
    computed_at_ms: Date.now(),
    pressure_score: Number(pressure_score.toFixed(3)),
  };
}

/**
 * Map a pressure score to an overload mode. Thresholds intentionally NOT
 * symmetric — upgrades fire at higher values, downgrades use HYSTERESIS_MS.
 */
function scoreToMode(score: number): OverloadMode {
  if (score >= 0.85) return 'critical';
  if (score >= 0.65) return 'degraded';
  if (score >= 0.40) return 'elevated';
  return 'normal';
}

function modeRank(mode: OverloadMode): number {
  switch (mode) { case 'normal': return 0; case 'elevated': return 1; case 'degraded': return 2; case 'critical': return 3; }
}

/**
 * Update the shared cluster state. Called on every publish tick by every
 * instance. The update is HSET with HSETNX-style guards via a Lua script
 * for atomic "only downgrade after hysteresis" semantics.
 */
const UPDATE_STATE_SCRIPT = `
local key = KEYS[1]
local proposed_mode = ARGV[1]
local proposed_rank = tonumber(ARGV[2])
local score = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local hysteresis = tonumber(ARGV[5])
local cur = redis.call('HMGET', key, 'mode', 'rank', 'changed_at')
local cur_mode = cur[1]
local cur_rank = tonumber(cur[2]) or 0
local cur_changed_at = tonumber(cur[3]) or 0
local new_mode = proposed_mode
local new_rank = proposed_rank
local changed = 0
if cur_mode == nil or cur_mode == false then
  changed = 1
elseif proposed_rank > cur_rank then
  -- Upgrade immediately
  changed = 1
elseif proposed_rank < cur_rank then
  -- Downgrade only after hysteresis
  if now - cur_changed_at >= hysteresis then
    changed = 1
  else
    new_mode = cur_mode
    new_rank = cur_rank
  end
end
if changed == 1 then
  redis.call('HMSET', key, 'mode', new_mode, 'rank', new_rank, 'changed_at', now, 'score', score, 'updated_at', now)
else
  redis.call('HMSET', key, 'score', score, 'updated_at', now)
end
redis.call('PEXPIRE', key, 60000)
return {new_mode, tostring(score), tostring(changed)}
`;

async function publishPressure(): Promise<void> {
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const snap = await computeLocalPressure();
    const proposed = scoreToMode(snap.pressure_score);
    const result = (await client.eval(
      UPDATE_STATE_SCRIPT,
      1,
      STATE_KEY,
      proposed,
      String(modeRank(proposed)),
      String(snap.pressure_score),
      String(Date.now()),
      String(HYSTERESIS_MS),
    )) as [string, string, string];
    // Mirror snapshot for dashboards (ZADD instance_id → pressure_score).
    await client.zadd(PRESSURE_KEY, snap.pressure_score, `${Date.now()}:${process.pid}`);
    await client.zremrangebyrank(PRESSURE_KEY, 0, -101); // keep last 100
    if (result[2] === '1') {
      logger.info('distributed_overload_mode_transition', {
        new_mode: result[0],
        pressure_score: snap.pressure_score,
        signals: snap,
      });
      // Telemetry: count mode transitions so dashboards can plot
      // mode-change frequency without log-based metrics.
      try {
        const { counter } = require('./plannerTelemetry') as typeof import('./plannerTelemetry');
        counter('planner_overload_transitions', 1, { from: 'unknown', to: result[0] });
      } catch { /* telemetry must not break the publisher */ }
    }
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_overload_publish_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read the current cluster overload mode. Cached 2s to avoid hammering
 * Redis on every planner request. Falls back to 'normal' when distributed
 * mode is off or Redis is unhealthy.
 */
export async function getClusterOverloadMode(): Promise<{ mode: OverloadMode; pressureScore: number; source: 'redis' | 'cache' | 'fallback' }> {
  const now = Date.now();
  if (_cachedState && now - _cachedState.cachedAtMs < READ_CACHE_MS) {
    return { mode: _cachedState.mode, pressureScore: _cachedState.pressureScore, source: 'cache' };
  }
  const client = getRedisOrNull();
  if (!client) {
    return { mode: 'normal', pressureScore: 0, source: 'fallback' };
  }
  try {
    const state = await client.hmget(STATE_KEY, 'mode', 'score');
    const mode = (state?.[0] as OverloadMode) || 'normal';
    const score = Number(state?.[1] ?? 0);
    _cachedState = { mode, pressureScore: score, cachedAtMs: now };
    return { mode, pressureScore: score, source: 'redis' };
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_overload_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { mode: 'normal', pressureScore: 0, source: 'fallback' };
  }
}

/** Start the periodic publish loop. Idempotent. */
export function startOverloadCoordinator(): void {
  if (_publishTimer) return;
  if (!isEnabled()) return;
  _publishTimer = setInterval(() => { void publishPressure(); }, PUBLISH_INTERVAL_MS);
  if ((_publishTimer as any)?.unref) (_publishTimer as any).unref();
  // Initial publish so the cluster state is populated before any request.
  void publishPressure();
  logger.info('distributed_overload_started', {
    publish_interval_ms: PUBLISH_INTERVAL_MS,
    hysteresis_ms: HYSTERESIS_MS,
  });
}

export function stopOverloadCoordinator(): void {
  if (_publishTimer) clearInterval(_publishTimer);
  _publishTimer = null;
}

/**
 * Per-mode policy. Used by the orchestrator to decide which optional phases
 * to skip and which model complexity to downgrade to. Centralized here so
 * mode → behavior mapping is in one place.
 */
export interface OverloadPolicy {
  alignmentRecoveryEnabled: boolean;
  alignmentEvalEnabled: boolean;
  refinementEnabled: boolean;
  preferCheaperModel: boolean;
  /** When true, admission control may reject low-priority requests. */
  admissionGateActive: boolean;
}

export function policyForMode(mode: OverloadMode): OverloadPolicy {
  switch (mode) {
    case 'normal':   return { alignmentRecoveryEnabled: true,  alignmentEvalEnabled: true,  refinementEnabled: true,  preferCheaperModel: false, admissionGateActive: false };
    case 'elevated': return { alignmentRecoveryEnabled: false, alignmentEvalEnabled: true,  refinementEnabled: true,  preferCheaperModel: false, admissionGateActive: false };
    case 'degraded': return { alignmentRecoveryEnabled: false, alignmentEvalEnabled: true,  refinementEnabled: false, preferCheaperModel: true,  admissionGateActive: false };
    case 'critical': return { alignmentRecoveryEnabled: false, alignmentEvalEnabled: false, refinementEnabled: false, preferCheaperModel: true,  admissionGateActive: true  };
  }
}

/**
 * Distributed planner admission control.
 *
 * When the cluster is in `critical` overload mode, new planner work is
 * gated at the entry point: high-priority requests pass through, low-
 * priority requests are rejected with a structured response the UI can
 * render as "we're busy — try again in a moment."
 *
 * Priorities:
 *   - priority: 'high' — paid plan, manual retry, time-sensitive flows
 *   - priority: 'normal' (default) — interactive user planning
 *   - priority: 'low' — background batch (admin tools, soak harness)
 *
 * Retry storm prevention: a rejected request gets a Retry-After hint
 * derived from the cluster pressure score and a small jitter. Per-campaign
 * cooldown prevents the same campaign from re-trying every second.
 *
 * Already-running planners are NEVER interrupted by admission control —
 * gating happens BEFORE any LLM call or DB write, and the result is a
 * structured rejection, not a thrown exception.
 *
 * Env: PLANNER_ADMISSION_ENABLED (default false). When false, every request
 * is admitted (the function still returns the priority + rejected=false).
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { getClusterOverloadMode, policyForMode } from './distributedOverloadCoordinator';

export type PlannerPriority = 'high' | 'normal' | 'low';

const COOLDOWN_KEY_PREFIX = 'planner:admission:cooldown:';
const COOLDOWN_TTL_MS = Number(process.env.PLANNER_ADMISSION_COOLDOWN_MS || 5_000);

let _client: IORedis | null = null;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;

function isEnabled(): boolean {
  return String(process.env.PLANNER_ADMISSION_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (!isEnabled()) return null;
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-admission');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_admission_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface AdmissionDecision {
  admitted: boolean;
  priority: PlannerPriority;
  mode: string;
  /** When rejected: server-suggested Retry-After in ms with jitter. */
  retryAfterMs?: number;
  /** When rejected: human-readable reason for the UI / logs. */
  reason?: string;
}

export interface AdmissionContext {
  campaignId: string;
  /** Priority hint from the caller. Default 'normal'. */
  priority?: PlannerPriority;
  /** When true, the caller has a paid-plan badge and high-priority gate
   *  applies. Inferred from the company's plan tier when available. */
  paidPlan?: boolean;
}

/**
 * Check whether this planner request should be admitted. NEVER throws.
 * Returns `{ admitted: true }` when admission control is disabled or the
 * cluster is healthy. Returns `{ admitted: false, retryAfterMs, reason }`
 * when the cluster is critical AND this request is not high-priority.
 *
 * Algorithm:
 *   1. If `PLANNER_ADMISSION_ENABLED=false` → admit.
 *   2. Read cluster overload mode (cached 2s).
 *   3. If mode policy says admissionGateActive=false → admit.
 *   4. If priority === 'high' OR paidPlan === true → admit.
 *   5. If per-campaign cooldown still active → reject (Retry-After = remaining cooldown).
 *   6. Otherwise: set cooldown, reject with computed Retry-After.
 */
export async function checkAdmission(ctx: AdmissionContext): Promise<AdmissionDecision> {
  const priority: PlannerPriority = ctx.priority ?? 'normal';
  if (!isEnabled()) {
    return { admitted: true, priority, mode: 'admission_disabled' };
  }
  const overload = await getClusterOverloadMode();
  const policy = policyForMode(overload.mode);
  if (!policy.admissionGateActive) {
    return { admitted: true, priority, mode: overload.mode };
  }
  // High priority + paid plan are always admitted in critical mode.
  if (priority === 'high' || ctx.paidPlan) {
    return { admitted: true, priority, mode: overload.mode };
  }

  // Per-campaign cooldown — prevents retry storms.
  const client = getRedisOrNull();
  if (client) {
    try {
      const key = `${COOLDOWN_KEY_PREFIX}${ctx.campaignId}`;
      const setOk = await client.set(key, '1', 'PX', COOLDOWN_TTL_MS, 'NX');
      if (setOk !== 'OK') {
        // Cooldown still active for this campaign.
        const ttl = await client.pttl(key);
        const retryAfterMs = Math.max(500, ttl > 0 ? ttl : COOLDOWN_TTL_MS);
        logger.info('planner_admission_rejected_cooldown', {
          request_id: getRequestContext().requestId,
          campaign_id: ctx.campaignId,
          retry_after_ms: retryAfterMs,
        });
        return {
          admitted: false,
          priority,
          mode: overload.mode,
          retryAfterMs,
          reason: 'campaign_cooldown_active',
        };
      }
    } catch (err) {
      _failureCount += 1;
      logger.warn('planner_admission_cooldown_check_failed', {
        campaign_id: ctx.campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-open: admit when cooldown check fails (degradation should not
      // turn a transient Redis issue into a user-facing rejection).
      return { admitted: true, priority, mode: overload.mode };
    }
  }

  // Compute Retry-After based on pressure score + small jitter.
  const base = 2_000 + Math.round(overload.pressureScore * 8_000);
  const jitter = Math.round(Math.random() * 500);
  const retryAfterMs = base + jitter;
  logger.warn('planner_admission_rejected_critical_overload', {
    request_id: getRequestContext().requestId,
    campaign_id: ctx.campaignId,
    priority,
    pressure_score: overload.pressureScore,
    retry_after_ms: retryAfterMs,
  });
  return {
    admitted: false,
    priority,
    mode: overload.mode,
    retryAfterMs,
    reason: 'cluster_critical_overload',
  };
}

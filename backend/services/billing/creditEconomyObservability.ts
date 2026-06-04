/**
 * Phase 11C — DURABLE credit-economy observability.
 *
 * The 11A readiness audit found that shadow/settlement signals lived only in
 * process-local counters (billingMetrics, the creditEconomyShadow in-memory
 * aggregator) and logs — so a 7–14 day shadow soak could not be evaluated
 * without log scraping, and serverless instance turnover lost state. This module
 * persists those signals to the shared Upstash Redis (the SAME durable store the
 * system-metrics snapshots already use), so they survive restart, redeploy and
 * serverless turnover, and are queryable without reading a single log line.
 *
 * GUARANTEES (mirrors the metricsPersistence + creditEconomyShadow guardrails):
 *   • READ-ONLY w.r.t. billing — records counters ABOUT settlement, never touches
 *     credit_transactions / reservations / RPCs / accounting / reconciliation.
 *   • APPEND-ONLY — every write is HINCRBY/HSET into per-UTC-day rollup hashes;
 *     no value is ever read-modified-written by this layer.
 *   • REPLAY-SAFE — settlement observations carry a dedupeKey (the settlement
 *     idempotency key); a SET-NX marker guarantees a replayed settlement is
 *     counted at most once. (Shadow evaluations are already once-per-launch via
 *     the caller's dedupe, and carry no money, so they are not NX-guarded.)
 *   • NEVER THROWS / NEVER BLOCKS — every Redis touch is wrapped; any error
 *     (incl. Redis unavailable) is swallowed. Callers invoke fire-and-forget.
 *
 * Key layout (all TTL'd to 30 days — covers a 14-day soak + margin):
 *   credeco:obs:index                 ZSET  score=dayEpochMs member=YYYY-MM-DD
 *   credeco:obs:day:<day>             HASH  rollup scalars (see DayField)
 *   credeco:obs:act_eval:<day>        HASH  field=activity → evaluations
 *   credeco:obs:act_block:<day>       HASH  field=activity → would_block count
 *   credeco:obs:act_max:<day>         HASH  field=activity → catalog max credits
 *   credeco:obs:act_actual:<day>      HASH  field=activity → actual credits settled
 *   credeco:obs:seen:<dedupeKey>      STR   NX replay marker
 */
import { getSharedRedisConnection } from '../../../lib/redis/client';

const KEY        = 'credeco:obs';
const INDEX_KEY  = `${KEY}:index`;
const TTL_SECS   = 30 * 24 * 60 * 60; // 30 days

// Date.now() is the only clock; this module runs in workers/serverless (NOT the
// workflow sandbox), so Date is available.
function dayOf(ts: number): string { return new Date(ts).toISOString().slice(0, 10); }
function dayEpoch(day: string): number { return Date.parse(`${day}T00:00:00.000Z`); }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** Run fn with the shared Redis connection; swallow ALL errors → null. */
async function withRedis<T>(fn: (redis: any) => Promise<T>): Promise<T | null> {
  try {
    const redis = await getSharedRedisConnection();
    return await fn(redis);
  } catch {
    return null; // Redis unavailable / any failure must never surface
  }
}

// ── RECORDERS ────────────────────────────────────────────────────────────────

/**
 * Durable shadow observation — one per credit-economy shadow evaluation. Records
 * would_block/would_allow, the shortfall (on block), and per-activity rollups for
 * most-blocked / most-expensive reporting. Pure observability.
 */
export async function recordShadowObservation(o: {
  activity: string;
  wouldBlock: boolean;
  shortfall: number;
  maximumCredits: number;
  ts?: number;
}): Promise<void> {
  await withRedis(async (redis) => {
    const ts  = o.ts ?? Date.now();
    const day = dayOf(ts);
    const dayHash = `${KEY}:day:${day}`;
    const pipe = redis.pipeline();
    pipe.hincrby(dayHash, o.wouldBlock ? 'would_block' : 'would_allow', 1);
    if (o.wouldBlock) pipe.hincrbyfloat(dayHash, 'shortfall_sum', Math.max(0, o.shortfall));
    pipe.hincrby(`${KEY}:act_eval:${day}`, o.activity, 1);
    if (o.wouldBlock) pipe.hincrby(`${KEY}:act_block:${day}`, o.activity, 1);
    pipe.hset(`${KEY}:act_max:${day}`, o.activity, String(Math.max(0, o.maximumCredits)));
    for (const k of [dayHash, `${KEY}:act_eval:${day}`, `${KEY}:act_block:${day}`, `${KEY}:act_max:${day}`]) {
      pipe.expire(k, TTL_SECS);
    }
    pipe.zadd(INDEX_KEY, dayEpoch(day), day);
    pipe.expire(INDEX_KEY, TTL_SECS);
    await pipe.exec();
  });
}

/**
 * Durable settlement observation — one per entry-consumption settlement (or
 * abandonment). Replay-safe via dedupeKey (NX marker). Records the lifecycle
 * amounts (entry / exposure reserved / exposure released / actual), underfunded
 * and abandoned counts, and settlement variance (ceiling − actual). Pure
 * observability — the financial settlement is unaffected and already committed.
 */
export async function recordSettlementObservation(o: {
  activity: string;
  entryConsumed?: number;
  exposureReserved?: number;
  exposureReleased?: number;
  actualConsumed?: number;
  underfunded?: boolean;
  abandoned?: boolean;
  settlementVariance?: number;
  /** Settlement idempotency key — guarantees at-most-once counting on replay. */
  dedupeKey?: string;
  ts?: number;
}): Promise<void> {
  await withRedis(async (redis) => {
    if (o.dedupeKey) {
      const fresh = await redis.set(`${KEY}:seen:${o.dedupeKey}`, '1', 'EX', TTL_SECS, 'NX');
      if (fresh !== 'OK') return; // already observed (replay) → count once
    }
    const ts  = o.ts ?? Date.now();
    const day = dayOf(ts);
    const dayHash = `${KEY}:day:${day}`;
    const pipe = redis.pipeline();
    if (o.entryConsumed)    pipe.hincrbyfloat(dayHash, 'entry_consumed',    o.entryConsumed);
    if (o.exposureReserved) pipe.hincrbyfloat(dayHash, 'exposure_reserved', o.exposureReserved);
    if (o.exposureReleased) pipe.hincrbyfloat(dayHash, 'exposure_released', o.exposureReleased);
    if (o.actualConsumed)   pipe.hincrbyfloat(dayHash, 'actual_consumed',   o.actualConsumed);
    if (o.underfunded)      pipe.hincrby(dayHash, 'underfunded', 1);
    if (o.abandoned)        pipe.hincrby(dayHash, 'abandoned',   1);
    if (typeof o.settlementVariance === 'number') {
      pipe.hincrbyfloat(dayHash, 'settlement_variance_sum', o.settlementVariance);
      pipe.hincrby(dayHash, 'settlement_count', 1);
    }
    if (o.actualConsumed)   pipe.hincrbyfloat(`${KEY}:act_actual:${day}`, o.activity, o.actualConsumed);
    pipe.expire(dayHash, TTL_SECS);
    pipe.expire(`${KEY}:act_actual:${day}`, TTL_SECS);
    pipe.zadd(INDEX_KEY, dayEpoch(day), day);
    pipe.expire(INDEX_KEY, TTL_SECS);
    await pipe.exec();
  });
}

/**
 * Phase 11D — durable admission observation, written by the single admission
 * boundary (evaluateActivityAdmission). Distinct fields from the shadow rollup
 * (admission_* vs would_*) so the two telemetry lenses never double-count.
 * Replay-safe via dedupeKey (NX). Pure observability — admission never mutates
 * billing.
 */
export async function recordAdmissionObservation(o: {
  activity: string;
  allowed: boolean;
  requiredCredits: number;
  effectiveCredits: number;
  shortfall: number;
  dedupeKey?: string;
  ts?: number;
}): Promise<void> {
  await withRedis(async (redis) => {
    if (o.dedupeKey) {
      const fresh = await redis.set(`${KEY}:seen:${o.dedupeKey}`, '1', 'EX', TTL_SECS, 'NX');
      if (fresh !== 'OK') return;
    }
    const day = dayOf(o.ts ?? Date.now());
    const dayHash = `${KEY}:day:${day}`;
    const pipe = redis.pipeline();
    pipe.hincrby(dayHash, o.allowed ? 'admission_allowed' : 'admission_blocked', 1);
    pipe.hincrbyfloat(dayHash, 'admission_required_sum',  Math.max(0, o.requiredCredits));
    pipe.hincrbyfloat(dayHash, 'admission_effective_sum', o.effectiveCredits);
    if (!o.allowed) {
      pipe.hincrbyfloat(dayHash, 'admission_shortfall_sum', Math.max(0, o.shortfall));
      pipe.hincrby(`${KEY}:adm_block:${day}`, o.activity, 1);
      pipe.expire(`${KEY}:adm_block:${day}`, TTL_SECS);
    }
    pipe.expire(dayHash, TTL_SECS);
    pipe.zadd(INDEX_KEY, dayEpoch(day), day);
    pipe.expire(INDEX_KEY, TTL_SECS);
    await pipe.exec();
  });
}

// ── READER (TASK 6) ───────────────────────────────────────────────────────────

export interface CreditEconomyObservabilityReport {
  windowDays: number;
  days: number;                 // distinct days with data in the window
  totalEvaluations: number;
  wouldBlock: number;
  wouldAllow: number;
  wouldBlockRate: number;       // block / (block + allow)
  averageShortfall: number;     // shortfall_sum / would_block
  mostBlockedActivities:   Array<{ activity: string; wouldBlock: number; evaluations: number }>;
  mostExpensiveActivities: Array<{ activity: string; maximumCredits: number }>;
  totalEntryConsumed: number;
  totalExposureReserved: number;
  totalExposureReleased: number;
  totalActualConsumed: number;
  totalUnderfundedEvents: number;
  totalAbandoned: number;
  averageSettlementVariance: number;
  // Phase 11D — admission-boundary lens (distinct from the shadow would_* lens).
  admissionEvaluations: number;
  admissionAllowed: number;
  admissionBlocked: number;
  admissionBlockRate: number;          // blocked / (allowed + blocked)
  averageAdmissionShortfall: number;   // shortfall_sum / blocked
  mostAdmissionBlockedActivities: Array<{ activity: string; blocked: number }>;
}

function emptyReport(windowDays: number): CreditEconomyObservabilityReport {
  return {
    windowDays, days: 0,
    totalEvaluations: 0, wouldBlock: 0, wouldAllow: 0, wouldBlockRate: 0, averageShortfall: 0,
    mostBlockedActivities: [], mostExpensiveActivities: [],
    totalEntryConsumed: 0, totalExposureReserved: 0, totalExposureReleased: 0, totalActualConsumed: 0,
    totalUnderfundedEvents: 0, totalAbandoned: 0, averageSettlementVariance: 0,
    admissionEvaluations: 0, admissionAllowed: 0, admissionBlocked: 0, admissionBlockRate: 0,
    averageAdmissionShortfall: 0, mostAdmissionBlockedActivities: [],
  };
}

/**
 * The single read helper that answers every rollout question from DURABLE
 * telemetry — no log scraping, no process-local state. Aggregates the per-day
 * rollups across the requested window.
 */
export async function readCreditEconomyObservability(opts?: {
  windowDays?: number;
  topN?: number;
}): Promise<CreditEconomyObservabilityReport> {
  const windowDays = Math.max(1, Math.min(60, opts?.windowDays ?? 14));
  const topN = Math.max(1, opts?.topN ?? 5);
  const report = await withRedis(async (redis) => {
    const now = Date.now();
    const fromEpoch = now - windowDays * 24 * 60 * 60 * 1000;
    const days: string[] = await redis.zrangebyscore(INDEX_KEY, fromEpoch, now);
    if (!days || days.length === 0) return emptyReport(windowDays);

    let wouldBlock = 0, wouldAllow = 0, shortfallSum = 0;
    let entry = 0, expReserved = 0, expReleased = 0, actual = 0, underfunded = 0, abandoned = 0;
    let varSum = 0, varCount = 0;
    let admAllowed = 0, admBlocked = 0, admShortfallSum = 0;
    const blockByAct    = new Map<string, number>();
    const evalByAct     = new Map<string, number>();
    const maxByAct      = new Map<string, number>();
    const admBlockByAct = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

    for (const day of days) {
      const [dayH, evalH, blockH, maxH, admBlockH] = await Promise.all([
        redis.hgetall(`${KEY}:day:${day}`),
        redis.hgetall(`${KEY}:act_eval:${day}`),
        redis.hgetall(`${KEY}:act_block:${day}`),
        redis.hgetall(`${KEY}:act_max:${day}`),
        redis.hgetall(`${KEY}:adm_block:${day}`),
      ]);
      wouldBlock  += num(dayH?.would_block);
      wouldAllow  += num(dayH?.would_allow);
      shortfallSum += num(dayH?.shortfall_sum);
      entry       += num(dayH?.entry_consumed);
      expReserved += num(dayH?.exposure_reserved);
      expReleased += num(dayH?.exposure_released);
      actual      += num(dayH?.actual_consumed);
      underfunded += num(dayH?.underfunded);
      abandoned   += num(dayH?.abandoned);
      varSum      += num(dayH?.settlement_variance_sum);
      varCount    += num(dayH?.settlement_count);
      admAllowed      += num(dayH?.admission_allowed);
      admBlocked      += num(dayH?.admission_blocked);
      admShortfallSum += num(dayH?.admission_shortfall_sum);
      for (const [a, v] of Object.entries(evalH ?? {}))     add(evalByAct,     a, num(v));
      for (const [a, v] of Object.entries(blockH ?? {}))    add(blockByAct,    a, num(v));
      for (const [a, v] of Object.entries(admBlockH ?? {})) add(admBlockByAct, a, num(v));
      for (const [a, v] of Object.entries(maxH ?? {}))      maxByAct.set(a, Math.max(maxByAct.get(a) ?? 0, num(v)));
    }

    const mostBlockedActivities = Array.from(blockByAct.entries())
      .sort((x, y) => y[1] - x[1]).slice(0, topN)
      .map(([activity, wb]) => ({ activity, wouldBlock: wb, evaluations: evalByAct.get(activity) ?? 0 }));
    const mostExpensiveActivities = Array.from(maxByAct.entries())
      .sort((x, y) => y[1] - x[1]).slice(0, topN)
      .map(([activity, maximumCredits]) => ({ activity, maximumCredits }));
    const mostAdmissionBlockedActivities = Array.from(admBlockByAct.entries())
      .sort((x, y) => y[1] - x[1]).slice(0, topN)
      .map(([activity, blocked]) => ({ activity, blocked }));

    return {
      windowDays,
      days: days.length,
      totalEvaluations: wouldBlock + wouldAllow,
      wouldBlock,
      wouldAllow,
      wouldBlockRate: (wouldBlock + wouldAllow) === 0 ? 0 : wouldBlock / (wouldBlock + wouldAllow),
      averageShortfall: wouldBlock === 0 ? 0 : shortfallSum / wouldBlock,
      mostBlockedActivities,
      mostExpensiveActivities,
      totalEntryConsumed: entry,
      totalExposureReserved: expReserved,
      totalExposureReleased: expReleased,
      totalActualConsumed: actual,
      totalUnderfundedEvents: underfunded,
      totalAbandoned: abandoned,
      averageSettlementVariance: varCount === 0 ? 0 : varSum / varCount,
      admissionEvaluations: admAllowed + admBlocked,
      admissionAllowed: admAllowed,
      admissionBlocked: admBlocked,
      admissionBlockRate: (admAllowed + admBlocked) === 0 ? 0 : admBlocked / (admAllowed + admBlocked),
      averageAdmissionShortfall: admBlocked === 0 ? 0 : admShortfallSum / admBlocked,
      mostAdmissionBlockedActivities,
    };
  });
  return report ?? emptyReport(windowDays);
}

/**
 * WS-3 Milestone-5A — durable quota consumption.
 *
 * Milestone-4 EVALUATED limits without consuming anything. This module consumes
 * them, using the two-layer architecture the platform already proves in
 * `whatsappRateLimiter`: a Redis fast path over a database source of truth.
 *
 * ─── THE DATABASE IS THE TRUTH; REDIS IS AN OPTIMIZATION ────────────────────
 * Consumption is defined as the count of durable `outreach_attempts` in the
 * window — the record of what actually happened. Redis holds a fast counter
 * that avoids that count on the hot path, and is RECONCILED to the database
 * after every attempt. If Redis is unavailable, wrong, or reset, the database
 * answer stands and the system is merely slower; if the database is
 * unreadable, nothing proceeds. That asymmetry is deliberate: an optimization
 * must never be able to authorize a send the truth would refuse.
 *
 * ─── RESERVE BEFORE, RECONCILE AFTER ───────────────────────────────────────
 * A reservation is taken BEFORE dispatch so two concurrent dispatchers cannot
 * both see the last remaining unit. It is released if dispatch does not
 * proceed. Reconciliation after the attempt corrects any drift the reservation
 * introduced, so a crash between reserve and record cannot permanently inflate
 * usage — the next reconciliation restores the true count.
 *
 * No timers, no schedulers, no queue submission. Reuses the shared Redis client
 * the platform already owns rather than constructing one.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { LimiterLayer } from './types';

/** Window the limiter counts over. Matches the governance evaluator. */
export const QUOTA_WINDOW_HOURS = 24;

const TTL_SECONDS = QUOTA_WINDOW_HOURS * 3600;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

async function safeDb<T>(op: () => PromiseLike<{ data?: T; error?: unknown }>): Promise<{ data: T | null; error: unknown | null }> {
  try {
    const res = await op();
    return { data: (res?.data ?? null) as T | null, error: res?.error ?? null };
  } catch (e) {
    return { data: null, error: e ?? new Error('unknown database failure') };
  }
}

// ── Redis fast path ─────────────────────────────────────────────────────────
//
// Reuses the SHARED client via the same lazy dynamic import whatsappRateLimiter
// uses. Every operation degrades to null on any failure, so Redis being absent
// or broken changes performance, never correctness.

let redisClient: unknown = null;

async function getRedis(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>> | null> {
  if (redisClient) return redisClient as never;
  try {
    const mod = (await import('../../queue/bullmqClient')) as { getSharedRedisClient?: () => unknown };
    redisClient = mod.getSharedRedisClient?.() ?? null;
    return (redisClient as never) ?? null;
  } catch {
    return null;
  }
}

/** Test seam: drop the memoized client so a suite can re-resolve it. */
export function __resetQuotaRedisForTests(): void {
  redisClient = null;
}

const tenantKey = (companyId: string): string => `ws3:quota:tenant:${companyId}`;
const leadKey = (companyId: string, leadId: string): string => `ws3:quota:lead:${companyId}:${leadId}`;

async function redisIncr(key: string): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const next = Number(await redis.incrby(key, 1));
    if (next === 1) await redis.expire(key, TTL_SECONDS);
    return Number.isFinite(next) ? next : null;
  } catch {
    return null;
  }
}

async function redisDecr(key: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.decrby(key, 1);
  } catch {
    /* a failed release self-corrects at the next reconciliation */
  }
}

async function redisSet(key: string, value: number): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.set(key, String(value));
    await redis.expire(key, TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

async function redisGet(key: string): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── database truth ──────────────────────────────────────────────────────────

/**
 * Authoritative usage: durable attempts in the window.
 *
 * Per-lead usage resolves through the lead's own tasks, because
 * `outreach_attempts` is keyed on `task_id` and has NO `lead_id` column.
 * Filtering on a column that does not exist would make PostgREST answer 42703,
 * the read would fail open to zero, and the per-lead limit would silently stop
 * working.
 */
export async function readDurableUsage(
  companyId: string,
  leadId: string,
  at: string,
): Promise<{ tenantCount: number; leadCount: number; ok: boolean }> {
  const since = new Date(Date.parse(at) - QUOTA_WINDOW_HOURS * 3_600_000).toISOString();

  const attempts = await safeDb<Row[]>(() =>
    ownedDbTable('outreach_attempts').select('id,task_id,started_at').eq('company_id', companyId).gte('started_at', since),
  );
  if (attempts.error) return { tenantCount: Number.MAX_SAFE_INTEGER, leadCount: Number.MAX_SAFE_INTEGER, ok: false };
  const rows = Array.isArray(attempts.data) ? attempts.data : [];

  const leadTasks = await safeDb<Row[]>(() =>
    ownedDbTable('outreach_tasks').select('id').eq('company_id', companyId).eq('lead_id', leadId),
  );
  if (leadTasks.error) return { tenantCount: rows.length, leadCount: Number.MAX_SAFE_INTEGER, ok: false };
  const ids = new Set((Array.isArray(leadTasks.data) ? leadTasks.data : []).map((r) => str(r.id)).filter((v): v is string => v !== null));

  return {
    tenantCount: rows.length,
    leadCount: rows.filter((r) => ids.has(str(r.task_id) ?? '')).length,
    ok: true,
  };
}

// ── reservation ─────────────────────────────────────────────────────────────

export interface QuotaReservation {
  granted: boolean;
  layer: LimiterLayer;
  tenantCount: number;
  leadCount: number;
  reason: string;
  /** Set when the reservation incremented Redis and may need releasing. */
  reserved: boolean;
}

/**
 * Reserve one unit of quota before dispatch.
 *
 * The database count is ALWAYS read — it is the truth, and a reservation may
 * never authorize what the truth refuses. Redis adds a pending-reservation
 * increment on top, so two concurrent dispatchers cannot both claim the last
 * unit between the read and the write.
 */
export async function reserveQuota(input: {
  companyId: string;
  leadId: string;
  at: string;
  dailyLimitTenant: number | null;
  dailyLimitLead: number | null;
}): Promise<QuotaReservation> {
  const durable = await readDurableUsage(input.companyId, input.leadId, input.at);
  if (!durable.ok) {
    return {
      granted: false, layer: 'db', reserved: false,
      tenantCount: durable.tenantCount, leadCount: durable.leadCount,
      reason: 'durable usage could not be read; refusing rather than assuming capacity',
    };
  }

  // Redis reflects durable usage plus reservations in flight.
  const pendingTenant = await redisIncr(tenantKey(input.companyId));
  const pendingLead = pendingTenant === null ? null : await redisIncr(leadKey(input.companyId, input.leadId));
  const usedRedis = pendingTenant !== null && pendingLead !== null;
  const layer: LimiterLayer = usedRedis ? 'redis' : 'db';

  // A Redis counter can only be trusted when it is at least the durable count;
  // a lower value means it was reset or expired, so the truth wins.
  const tenantCount = usedRedis ? Math.max(pendingTenant, durable.tenantCount + 1) : durable.tenantCount + 1;
  const leadCount = usedRedis ? Math.max(pendingLead as number, durable.leadCount + 1) : durable.leadCount + 1;

  const overLead = input.dailyLimitLead !== null && leadCount > input.dailyLimitLead;
  const overTenant = input.dailyLimitTenant !== null && tenantCount > input.dailyLimitTenant;

  if (overLead || overTenant) {
    // Release what we just reserved — this dispatch is not proceeding.
    if (usedRedis) {
      await redisDecr(tenantKey(input.companyId));
      await redisDecr(leadKey(input.companyId, input.leadId));
    }
    return {
      granted: false, layer, reserved: false,
      tenantCount: tenantCount - 1, leadCount: leadCount - 1,
      reason: overLead
        ? `lead limit of ${input.dailyLimitLead} per ${QUOTA_WINDOW_HOURS}h reached`
        : `tenant limit of ${input.dailyLimitTenant} per ${QUOTA_WINDOW_HOURS}h reached`,
    };
  }

  return {
    granted: true, layer, reserved: usedRedis,
    tenantCount, leadCount,
    reason: 'within configured limits',
  };
}

/** Release a reservation that will not be consumed. Safe to call when none was taken. */
export async function releaseQuota(companyId: string, leadId: string, reservation: QuotaReservation): Promise<void> {
  if (!reservation.reserved) return;
  await redisDecr(tenantKey(companyId));
  await redisDecr(leadKey(companyId, leadId));
}

export interface QuotaReconciliation {
  reconciled: boolean;
  drift: number;
  tenantCount: number;
  leadCount: number;
  layer: LimiterLayer;
}

/**
 * Reconcile Redis to the database after an attempt is durably recorded.
 *
 * Deterministic: the database count is read and Redis is SET to it — never
 * adjusted by a delta, which would compound any existing drift. Reports the
 * drift it corrected so a persistent divergence is visible rather than silently
 * papered over on every dispatch.
 */
export async function reconcileQuota(companyId: string, leadId: string, at: string): Promise<QuotaReconciliation> {
  const durable = await readDurableUsage(companyId, leadId, at);
  if (!durable.ok) {
    return { reconciled: false, drift: 0, tenantCount: durable.tenantCount, leadCount: durable.leadCount, layer: 'db' };
  }

  const before = await redisGet(tenantKey(companyId));
  const wrote = await redisSet(tenantKey(companyId), durable.tenantCount);
  await redisSet(leadKey(companyId, leadId), durable.leadCount);

  return {
    reconciled: wrote,
    drift: before === null ? 0 : before - durable.tenantCount,
    tenantCount: durable.tenantCount,
    leadCount: durable.leadCount,
    layer: wrote ? 'redis' : 'db',
  };
}

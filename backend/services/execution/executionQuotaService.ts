/**
 * LC-501 (W5.1) — C4 Distributed execution controls (rate limits + quotas).
 *
 * Replaces execution-critical in-memory enforcement with DISTRIBUTED counters over the
 * existing canonical Redis/Upstash client. Enforces per-tenant daily, per-connector
 * daily, per-campaign daily, and burst limits. Fail-CLOSED under Redis error (an
 * execution control must not silently allow on infra failure). Best-effort fallback
 * to the existing in-memory limiter only when Redis is NOT configured at all.
 */

import { checkInMemoryRateLimit } from '../trackingRateLimitService';

const LIMITS = {
  tenantDaily: Number(process.env.EXEC_QUOTA_TENANT_DAILY || 1000),
  connectorDaily: Number(process.env.EXEC_QUOTA_CONNECTOR_DAILY || 500),
  campaignDaily: Number(process.env.EXEC_QUOTA_CAMPAIGN_DAILY || 500),
  burst: Number(process.env.EXEC_QUOTA_BURST || 20),        // per burst window
  burstWindowMs: Number(process.env.EXEC_QUOTA_BURST_MS || 10_000),
};
const DAY_MS = 86_400_000;

export interface QuotaResult { allowed: boolean; reason?: string; evidence: Record<string, number> }

function dayKey(): string { const d = Math.floor(Date.now() / DAY_MS); return String(d); }

/** Check-and-count all execution quotas for one intended dispatch. */
export async function checkQuota(companyId: string, campaignId: string | null, connector: string): Promise<QuotaResult> {
  const day = dayKey();
  const buckets: Array<{ key: string; limit: number; ttlMs: number; label: string }> = [
    { key: `exec:q:tenant:${companyId}:${day}`, limit: LIMITS.tenantDaily, ttlMs: DAY_MS, label: 'tenant_daily' },
    { key: `exec:q:conn:${companyId}:${connector}:${day}`, limit: LIMITS.connectorDaily, ttlMs: DAY_MS, label: 'connector_daily' },
    { key: `exec:q:burst:${companyId}`, limit: LIMITS.burst, ttlMs: LIMITS.burstWindowMs, label: 'burst' },
  ];
  if (campaignId) buckets.push({ key: `exec:q:camp:${campaignId}:${day}`, limit: LIMITS.campaignDaily, ttlMs: DAY_MS, label: 'campaign_daily' });

  const evidence: Record<string, number> = {};
  // Fail-FAST: an unreachable quota store must never hang dispatch. Timeout → fail-closed.
  const timeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('quota_timeout')), ms))]);
  try {
    const { redisConfigured, getStandaloneRedis } = await import('../../../lib/redis/canonicalClient');
    if (redisConfigured()) {
      const result = await timeout((async () => {
        const redis = await getStandaloneRedis('gtm_execution_quota');
        for (const b of buckets) {
          const n = await redis.incr(b.key);
          if (n === 1) await redis.pexpire(b.key, b.ttlMs);
          evidence[b.label] = n;
          if (n > b.limit) { await redis.decr(b.key); return { allowed: false, reason: `quota_exceeded:${b.label}`, evidence } as QuotaResult; }
        }
        return { allowed: true, evidence } as QuotaResult;
      })(), 2500);
      return result;
    }
  } catch {
    return { allowed: false, reason: 'quota_redis_error_failclosed', evidence }; // fail-closed
  }
  // Redis not configured at all → in-memory fallback (single-instance; noted as adjustment).
  for (const b of buckets) {
    const r = checkInMemoryRateLimit(b.key, b.limit, b.ttlMs);
    evidence[b.label] = r.allowed ? 1 : b.limit + 1;
    if (!r.allowed) return { allowed: false, reason: `quota_exceeded_inmemory:${b.label}`, evidence };
  }
  return { allowed: true, evidence };
}

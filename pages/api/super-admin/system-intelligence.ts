
/**
 * GET /api/super-admin/system-intelligence
 *
 * Unified system intelligence endpoint â€” metrics + cost + projection + trends
 * + dynamic baselines + actionable insights.
 *
 * v2 additions:
 *  - insights now include `action` field (concrete next step per finding)
 *  - baselines: 7-day dynamic thresholds replacing all static values
 *  - projection: linear cost projection for next 30 days
 *  - env tag on every response
 *
 * Each data source is independently isolated: a Redis unavailability,
 * Supabase timeout, or any other connection error never blocks the response.
 * Partial data is always returned with an `errors` map.
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import { getSystemMetrics, ensureTrackingActive } from '../../../lib/instrumentation/systemMetrics';
import { estimateCost }                 from '../../../lib/instrumentation/costEngine';
import { deriveInsights }               from '../../../lib/instrumentation/insightsEngine';
import { computeBaselines }             from '../../../lib/instrumentation/baselineEngine';
import { projectCost }                  from '../../../lib/instrumentation/costProjection';
import { querySnapshots }               from '../../../lib/instrumentation/metricsPersistence';
import { getSharedRedisClient }         from '../../../backend/queue/bullmqClient';
import { parseRedisInfoMemory }         from '../../../lib/redis/instrumentation';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

// â”€â”€ Trend summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildTrends(metrics: Awaited<ReturnType<typeof getSystemMetrics>>) {
  return {
    redis: {
      opsPerMin:     metrics.redis?.opsPerMin     ?? 0,
      peakOpsPerMin: metrics.redis?.peakOpsPerMin ?? 0,
      topFeature:    metrics.redis?.topFeatures?.[0]?.feature ?? null,
      topCommand:    metrics.redis?.topCommands?.[0]?.command ?? null,
    },
    supabase: {
      queriesPerMin: metrics.supabase?.queriesPerMin ?? 0,
      readWriteRatio: metrics.supabase && (metrics.supabase.reads + metrics.supabase.writes) > 0
        ? metrics.supabase.reads / (metrics.supabase.reads + metrics.supabase.writes)
        : null,
      errorRate: metrics.supabase && (metrics.supabase.reads + metrics.supabase.writes) > 0
        ? metrics.supabase.errors / (metrics.supabase.reads + metrics.supabase.writes)
        : null,
    },
    api: {
      callsPerMin:  metrics.api?.callsPerMin  ?? 0,
      errorRate:    metrics.api?.errorRate    ?? null,
      avgLatencyMs: metrics.api?.avgLatencyMs ?? null,
      p95LatencyMs: metrics.api?.p95LatencyMs ?? null,
    },
    external: {
      totalCalls:  metrics.external?.totalExternalCalls   ?? 0,
      topService:  metrics.external?.topServices?.[0]?.service ?? null,
    },
  };
}

// â”€â”€ Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAdminScope(req, res, 'system-intelligence:view');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/system-intelligence', 'system-intelligence:view');
  }

  ensureTrackingActive();

  const errors: Record<string, string> = {};

  // â”€â”€ 1. Live metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const metrics = await getSystemMetrics();
  Object.assign(errors, metrics.errors);

  // â”€â”€ 1b. Redis storage (INFO memory) â€” injected into metrics.redis â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Upstash charges $0.25/GB/month above the 256 MB free tier.
  // redis.info() is a one-shot call; failure is non-fatal.
  try {
    const redisClient = getSharedRedisClient() as any;
    const infoStr: string = await redisClient.info('memory');
    const storageBytesUsed = parseRedisInfoMemory(infoStr);
    if (metrics.redis && storageBytesUsed > 0) {
      metrics.redis.storageBytesUsed = storageBytesUsed;
    }
  } catch {
    // Redis INFO unavailable â€” storage cost will show $0
  }

  // â”€â”€ 2. Cost estimate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let cost = null;
  try {
    cost = estimateCost(metrics);
  } catch (err) {
    errors['cost'] = String((err as Error)?.message ?? err);
  }

  // â”€â”€ 3. Historical snapshots for baselines + projection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //   7-day window for baselines, 24h for cost projection
  //   Both are best-effort: Redis unavailability returns empty arrays.
  const MS_24H = 24 * 60 * 60 * 1_000;
  const MS_7D  =  7 * MS_24H;
  const now    = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getRedis = () => getSharedRedisClient() as any;

  const [snaps7d, snaps24h] = await Promise.all([
    querySnapshots(getRedis, now - MS_7D,  now).catch(() => []),
    querySnapshots(getRedis, now - MS_24H, now).catch(() => []),
  ]);

  // â”€â”€ 4. Dynamic baselines (7-day history) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let baselines = null;
  try {
    baselines = snaps7d.length >= 12 ? computeBaselines(snaps7d) : null;
  } catch (err) {
    errors['baselines'] = String((err as Error)?.message ?? err);
  }

  // â”€â”€ 5. Cost projection (24h trend) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let projection = null;
  try {
    projection = projectCost(snaps24h.length >= 3 ? snaps24h : snaps7d);
  } catch (err) {
    errors['projection'] = String((err as Error)?.message ?? err);
  }

  // â”€â”€ 6. Actionable insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let insights = [];
  try {
    insights = deriveInsights(metrics, cost, projection, baselines);
  } catch {
    // Non-critical â€” omit rather than fail
  }

  const trends = buildTrends(metrics);

  return res.status(200).json({
    metrics,
    cost,
    trends,
    baselines,
    projection,
    insights,                              // Insight[] with summary + action + level + tags
    topCostDrivers: cost?.topCostDrivers ?? [],
    collectedAt:    metrics.collectedAt,
    env:            metrics.env,
    errors:         Object.keys(errors).length > 0 ? errors : undefined,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);

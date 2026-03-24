/**
 * GET /api/super-admin/system-intelligence
 *
 * Unified system intelligence endpoint — metrics + cost + projection + trends
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
import { getSupabaseUserFromRequest }   from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin }         from '../../../backend/services/rbacService';
import { getSystemMetrics, ensureTrackingActive } from '../../../lib/instrumentation/systemMetrics';
import { estimateCost }                 from '../../../lib/instrumentation/costEngine';
import { deriveInsights }               from '../../../lib/instrumentation/insightsEngine';
import { computeBaselines }             from '../../../lib/instrumentation/baselineEngine';
import { projectCost }                  from '../../../lib/instrumentation/costProjection';
import { querySnapshots }               from '../../../lib/instrumentation/metricsPersistence';
import { getSharedRedisClient }         from '../../../backend/queue/bullmqClient';
import { parseRedisInfoMemory }         from '../../../lib/redis/instrumentation';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  } catch {
    // Auth service unavailable — deny access
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

// ── Trend summary ─────────────────────────────────────────────────────────────

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
    firebase: {
      verificationsPerMin: metrics.firebase?.verificationsPerMin ?? 0,
      errorRate: metrics.firebase && metrics.firebase.tokenVerifications > 0
        ? metrics.firebase.authErrors / metrics.firebase.tokenVerifications
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

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  ensureTrackingActive();

  const errors: Record<string, string> = {};

  // ── 1. Live metrics ────────────────────────────────────────────────────────
  const metrics = await getSystemMetrics();
  Object.assign(errors, metrics.errors);

  // ── 1b. Redis storage (INFO memory) — injected into metrics.redis ─────────
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
    // Redis INFO unavailable — storage cost will show $0
  }

  // ── 2. Cost estimate ───────────────────────────────────────────────────────
  let cost = null;
  try {
    cost = estimateCost(metrics);
  } catch (err) {
    errors['cost'] = String((err as Error)?.message ?? err);
  }

  // ── 3. Historical snapshots for baselines + projection ────────────────────
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

  // ── 4. Dynamic baselines (7-day history) ──────────────────────────────────
  let baselines = null;
  try {
    baselines = snaps7d.length >= 12 ? computeBaselines(snaps7d) : null;
  } catch (err) {
    errors['baselines'] = String((err as Error)?.message ?? err);
  }

  // ── 5. Cost projection (24h trend) ────────────────────────────────────────
  let projection = null;
  try {
    projection = projectCost(snaps24h.length >= 3 ? snaps24h : snaps7d);
  } catch (err) {
    errors['projection'] = String((err as Error)?.message ?? err);
  }

  // ── 6. Actionable insights ────────────────────────────────────────────────
  let insights = [];
  try {
    insights = deriveInsights(metrics, cost, projection, baselines);
  } catch {
    // Non-critical — omit rather than fail
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

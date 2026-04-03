
/**
 * GET /api/super-admin/system-trends
 *
 * Historical system metrics — returns slim snapshots from the last 24 h or 7 d.
 *
 * v2: uses SlimSnapshot (lean scalar payloads ~600 bytes each vs ~8 KB previously).
 * Includes computed baselines and cost projection derived from the window.
 *
 * Query params:
 *   window  = '24h' (default) | '7d'
 *   limit   = max snapshots to return (default 288, max 2016)
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 *
 * Response shape:
 * {
 *   window:     '24h' | '7d'
 *   fromMs, toMs: number
 *   env:        'prod' | 'staging' | 'dev'
 *   snapshots:  SlimSnapshot[]
 *   costTrend:  CostTrendPoint[]
 *   projection: CostProjection
 *   baselines:  SystemBaselines | null
 *   summary:    TrendSummary
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest }   from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin }         from '../../../backend/services/rbacService';
import { querySnapshots, type SlimSnapshot } from '../../../lib/instrumentation/metricsPersistence';
import { computeBaselines }             from '../../../lib/instrumentation/baselineEngine';
import { projectCost }                  from '../../../lib/instrumentation/costProjection';
import { getSharedRedisClient }         from '../../../backend/queue/bullmqClient';
import { RUNTIME_ENV }                  from '../../../lib/instrumentation/systemMetrics';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  } catch { /* deny */ }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface CostTrendPoint {
  ts:                   number;
  iso:                  string;
  totalMonthlyEstimate: number | null;
  confidence:           string | null;
}

interface TrendSummary {
  avgRedisOpsPerMin:   number | null;
  avgSupabaseQpm:      number | null;
  avgApiCpm:           number | null;
  peakRedisOpsPerMin:  number | null;
  peakApiCpm:          number | null;
  totalAiApiCalls:     number;
  avgApiErrorRate:     number | null;
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10;
}

function peak(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function buildSummary(snapshots: SlimSnapshot[]): TrendSummary {
  const redisOps:  number[] = [];
  const supaQpm:   number[] = [];
  const apiCpm:    number[] = [];
  const apiErr:    number[] = [];
  let totalAiCalls = 0;

  for (const { redis, supabase, api, external } of snapshots) {
    if (redis?.opsPerMin    != null) redisOps.push(redis.opsPerMin);
    if (supabase?.qpm       != null) supaQpm.push(supabase.qpm);
    if (api?.cpm            != null) apiCpm.push(api.cpm);
    if (api?.errRate        != null) apiErr.push(api.errRate);
    totalAiCalls += (external?.openaiCalls ?? 0) + (external?.anthropicCalls ?? 0);
  }

  return {
    avgRedisOpsPerMin:  avg(redisOps),
    avgSupabaseQpm:     avg(supaQpm),
    avgApiCpm:          avg(apiCpm),
    peakRedisOpsPerMin: peak(redisOps),
    peakApiCpm:         peak(apiCpm),
    totalAiApiCalls:    totalAiCalls,
    avgApiErrorRate:    avg(apiErr),
  };
}

function buildCostTrend(snapshots: SlimSnapshot[]): CostTrendPoint[] {
  return snapshots.map(s => ({
    ts:                   s.ts,
    iso:                  s.iso,
    totalMonthlyEstimate: s.cost?.total      ?? null,
    confidence:           s.cost?.confidence ?? null,
  }));
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const windowParam = req.query.window === '7d' ? '7d' : '24h';
  const limitParam  = Math.min(parseInt(String(req.query.limit ?? '288'), 10) || 288, 2_016);

  const toMs   = Date.now();
  const fromMs = toMs - (windowParam === '7d' ? 7 * 24 * 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getRedis = () => getSharedRedisClient() as any;

  let snapshots: SlimSnapshot[] = [];
  let queryError: string | undefined;
  try {
    snapshots = await querySnapshots(getRedis, fromMs, toMs);
  } catch (err) {
    queryError = String((err as Error)?.message ?? err);
  }

  // Apply limit — keep most recent
  if (snapshots.length > limitParam) snapshots = snapshots.slice(-limitParam);

  // Derive projection and baselines from the same window
  const projection = (() => {
    try { return projectCost(snapshots); } catch { return null; }
  })();

  const baselines = (() => {
    try { return snapshots.length >= 12 ? computeBaselines(snapshots) : null; } catch { return null; }
  })();

  return res.status(200).json({
    window:    windowParam,
    fromMs,
    toMs,
    env:       RUNTIME_ENV,
    snapshots,
    costTrend: buildCostTrend(snapshots),
    projection,
    baselines,
    summary:   buildSummary(snapshots),
    ...(queryError ? { error: queryError } : {}),
  });
}

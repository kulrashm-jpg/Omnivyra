
/**
 * GET /api/super-admin/cron-metrics
 *
 * Returns the live cron execution report written by the cron process to Redis.
 *
 * The cron scheduler runs in a separate Railway worker process; this endpoint
 * reads its persisted report from Redis so super-admins can see execution health
 * without SSH access.
 *
 * Report includes:
 *   - cycles/min and total cycles
 *   - useful vs wasted cycle breakdown
 *   - per-cycle job-fired list (last 20 cycles)
 *   - duplicate instance detection
 *   - per-worker execution counts
 *
 * Returns 503 when the cron process has not written a report yet (not started,
 * or Redis unavailable).
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin }       from '../../../backend/services/rbacService';
import {
  getReportFromRedis,
  getRecentCyclesFromRedis,
} from '../../../backend/utils/cronInstrumentation';
import { getSharedRedisClient } from '../../../backend/queue/bullmqClient';

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

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = getSharedRedisClient() as any;

  const [report, recentCycles] = await Promise.all([
    getReportFromRedis(redis).catch(() => null),
    getRecentCyclesFromRedis(redis).catch(() => []),
  ]);

  if (!report) {
    return res.status(503).json({
      error: 'CRON_REPORT_UNAVAILABLE',
      message: 'Cron process has not started or Redis is unreachable. Ensure the cron worker is running.',
    });
  }

  // Merge latest cycles from Redis list (may be fresher than the embedded ones)
  if (recentCycles.length > 0) {
    report.recentCycles = recentCycles;
  }

  // Compute derived metrics at read-time for convenience
  const wastedCycleNames = report.recentCycles
    .filter(c => !c.usefulCycle)
    .map(c => c.cycleId);

  const jobFrequency: Record<string, number> = {};
  for (const cycle of report.recentCycles) {
    for (const job of cycle.jobNames) {
      jobFrequency[job] = (jobFrequency[job] ?? 0) + 1;
    }
  }
  const topJobs = Object.entries(jobFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([job, count]) => ({ job, count }));

  return res.status(200).json({
    ...report,
    // Convenience additions
    derivedAt:         new Date().toISOString(),
    wastedCycleIds:    wastedCycleNames,
    topJobsByFrequency: topJobs,
    hasDuplicates:     report.duplicateInstances.length > 0,
  });
}

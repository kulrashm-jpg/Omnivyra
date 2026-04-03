
/**
 * GET /api/super-admin/queue-metrics
 *
 * Returns the live BullMQ queue execution report.
 *
 * The report is written to Redis every 60 seconds by any process that creates
 * BullMQ queues or workers (cron process, Next.js API routes, Railway workers).
 * This endpoint reads the latest snapshot and enriches it with derived fields.
 *
 * Response shape:
 * {
 *   queues: {
 *     [name]: {
 *       jobsAdded, jobsCompleted, jobsFailed, jobsProcessed
 *       addedPerMin, processedPerMin
 *       avgJobDurationMs, p95JobDurationMs
 *       errorRate
 *       estimatedOpsPerJob, estimatedOpsPerMin, estimatedOpsTotal
 *     }
 *   }
 *   topQueuesByRedisOps:      [ { queueName, opsPerMin, opsPct } ]
 *   totalJobsAddedPerMin:     number
 *   totalJobsProcessedPerMin: number
 *   totalRedisOpsPerMin:      number
 *   bullmqOpsFraction:        number | null   // fraction of all Redis ops
 *   jobsPerCronCycle:         number | null   // if cron report also available
 * }
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin }       from '../../../backend/services/rbacService';
import { getQueueReportFromRedis, type QueueStats } from '../../../backend/queue/queueInstrumentation';
import { getReportFromRedis }         from '../../../backend/utils/cronInstrumentation';
import { getSharedRedisClient }       from '../../../backend/queue/bullmqClient';

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

  // Fetch queue report + cron report in parallel (both are optional)
  const [queueReport, cronReport] = await Promise.all([
    getQueueReportFromRedis(redis).catch(() => null),
    getReportFromRedis(redis).catch(() => null),
  ]);

  if (!queueReport) {
    return res.status(503).json({
      error: 'QUEUE_REPORT_UNAVAILABLE',
      message: 'No queue report found. Queue instrumentation starts when the first queue or worker is created.',
    });
  }

  // Cross-reference: jobs added per cron cycle
  // cyclesPerMin from cron report; totalJobsAddedPerMin from queue report
  let jobsPerCronCycle: number | null = null;
  if (cronReport && cronReport.cyclesPerMin > 0) {
    jobsPerCronCycle = Math.round(
      (queueReport.totalJobsAddedPerMin / cronReport.cyclesPerMin) * 10,
    ) / 10;
  }

  // Redis ops contribution text
  const opsFraction  = queueReport.bullmqOpsFraction;
  const opsContrib   = opsFraction != null
    ? `${Math.round(opsFraction * 100)}% of total Redis ops`
    : null;

  // Per-queue summary table (sorted by Redis ops desc)
  const queueSummary = (Object.values(queueReport.queues) as QueueStats[])
    .sort((a, b) => b.estimatedOpsPerMin - a.estimatedOpsPerMin)
    .map(q => ({
      queue:            q.queueName,
      addedPerMin:      q.addedPerMin,
      processedPerMin:  q.processedPerMin,
      avgDurationMs:    q.avgJobDurationMs,
      errorRate:        q.errorRate > 0 ? `${(q.errorRate * 100).toFixed(1)}%` : '0%',
      opsPerJob:        q.estimatedOpsPerJob,
      opsPerMin:        q.estimatedOpsPerMin,
      opsTotal:         q.estimatedOpsTotal,
    }));

  return res.status(200).json({
    ...queueReport,
    // Convenience fields
    jobsPerCronCycle,
    redisOpsContribution: opsContrib,
    queueSummary,
    reportedAt: new Date().toISOString(),
  });
}

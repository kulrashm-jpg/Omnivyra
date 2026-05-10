import type { NextApiRequest, NextApiResponse } from 'next';
import { getContentQueue } from '../../../backend/queue/contentGenerationQueues';

/**
 * Vercel Cron entrypoint — runs daily at 02:00 UTC (configured in vercel.json).
 *
 * Enqueues three jobs onto the 'analytics-ingestion' BullMQ queue:
 *   1. daily-growth        — social-media follower/impression snapshots
 *   2. post-polls          — process pending post_analytics_polls rows
 *   3. ga4-all-companies   — refresh GA4 canonical data for every company
 *                            with an active GA4 integration
 *
 * Enqueue-only design: this endpoint MUST return quickly. GA4 ingestion
 * for a single company can take many minutes (the first observed run
 * processed 897 sessions in ~13 min); running it inline would exceed
 * Vercel's function-execution limits and silently truncate work.
 *
 * Per-job idempotency:
 *   - Each enqueued job uses a daily jobId so two cron invocations on
 *     the same day collapse to a single queue entry.
 *   - The GA4 work itself is also gated by ingestion_runs.idempotency_key
 *     downstream, which folds in (companyId, propertyId, startDate,
 *     endDate) — see ga4IngestionService.buildGa4RunKey.
 *
 * Auth: validated via CRON_SECRET bearer.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/analytics-ingestion] CRON_SECRET not configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const enqueued: string[] = [];
  const errors: Array<{ step: string; message: string }> = [];

  try {
    const queue = getContentQueue('analytics-ingestion');

    await queue.add(
      'daily-growth',
      { type: 'daily-growth' },
      { jobId: `daily-growth-${today}`, priority: 2 },
    );
    enqueued.push('daily-growth');

    await queue.add(
      'post-polls',
      { type: 'post-polls', batchSize: 100 },
      { jobId: `post-polls-${Date.now()}`, priority: 3 },
    );
    enqueued.push('post-polls');

    await queue.add(
      'ga4-all-companies',
      { type: 'ga4-all-companies', startDate: sevenDaysAgo, endDate: today },
      { jobId: `ga4-all-companies-${today}`, priority: 4 },
    );
    enqueued.push('ga4-all-companies');
  } catch (err: any) {
    errors.push({ step: 'enqueue', message: err?.message ?? 'unknown' });
    console.error('[cron/analytics-ingestion] enqueue failed:', err?.message);
  }

  const ok = errors.length === 0;
  return res.status(ok ? 200 : 500).json({
    ok,
    enqueued,
    window: { startDate: sevenDaysAgo, endDate: today },
    errors,
  });
}

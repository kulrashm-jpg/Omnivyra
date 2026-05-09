/**
 * POST /api/cron/analytics-ingestion
 *
 * Vercel Cron Job endpoint — runs daily at 02:00 UTC (configure in vercel.json).
 * Enqueues two analytics ingestion jobs:
 *   1. daily-growth  — fetch follower/impression snapshots for all active accounts
 *   2. post-polls    — process any pending post metric polls (15-min / 24-h)
 *
 * Protected by CRON_SECRET env var.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getContentQueue } from '../../../backend/queue/contentGenerationQueues';

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

  try {
    const queue = getContentQueue('analytics-ingestion');

    await queue.add(
      'daily-growth',
      { type: 'daily-growth' },
      { jobId: `daily-growth-${new Date().toISOString().split('T')[0]}`, priority: 2 },
    );

    await queue.add(
      'post-polls',
      { type: 'post-polls', batchSize: 100 },
      { jobId: `post-polls-${Date.now()}`, priority: 3 },
    );

    return res.status(200).json({ ok: true, message: 'Analytics ingestion jobs enqueued' });
  } catch (err: any) {
    console.error('[cron/analytics-ingestion] error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Failed to enqueue analytics jobs' });
  }
}

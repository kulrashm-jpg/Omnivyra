// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { getContentQueue } from '../../../backend/queue/contentGenerationQueues';
import { assertCronAuthorized, rejectCronUnauthorized } from '../../../backend/utils/cronAuthGuard';
import { getJobRegistryEntry } from '../../../backend/jobs/jobRegistry';
import { acquireJobLock, releaseJobLock } from '../../../backend/jobs/lockService';
import { writeDeadLetter } from '../../../backend/jobs/dlqService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    assertCronAuthorized(req);
  } catch (error) {
    if (rejectCronUnauthorized(res, error)) return;
    throw error;
  }

  const registry = getJobRegistryEntry('analytics_ingestion');
  const window = new Date().toISOString().slice(0, 10);
  const lock = await acquireJobLock(registry.lock_key_builder({ type: 'cron', window }), 3600);
  if (!lock) return res.status(200).json({ ok: true, skipped: true, reason: 'locked' });

  try {
    const queue = getContentQueue('analytics-ingestion');
    await queue.add(
      'daily-growth',
      { type: 'daily-growth', window, trigger_source: 'vercel_cron' },
      { jobId: registry.idempotency_key_builder({ type: 'daily-growth', window }), priority: 2 },
    );
    await queue.add(
      'post-polls',
      { type: 'post-polls', batchSize: 100, window, trigger_source: 'vercel_cron' },
      { jobId: registry.idempotency_key_builder({ type: 'post-polls', window }), priority: 3 },
    );
    console.info(JSON.stringify({ event: 'job_completed', job_id: 'analytics_ingestion', window }));
    return res.status(200).json({ ok: true, message: 'Analytics ingestion jobs enqueued' });
  } catch (err: any) {
    await writeDeadLetter({
      job_id: 'analytics_ingestion',
      queue_name: registry.queue_name,
      payload: { window, trigger_source: 'vercel_cron' },
      error_message: err?.message ?? 'Failed to enqueue analytics jobs',
      trigger_source: 'vercel_cron',
    }).catch(() => {});
    console.error('[cron/analytics-ingestion] error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Failed to enqueue analytics jobs' });
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}


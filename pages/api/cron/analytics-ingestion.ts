// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { getContentQueue } from '../../../backend/queue/contentGenerationQueues';
import { assertCronAuthorized, rejectCronUnauthorized } from '../../../backend/utils/cronAuthGuard';
import { getJobRegistryEntry } from '../../../backend/jobs/jobRegistry';
import { acquireJobLock, releaseJobLock } from '../../../backend/jobs/lockService';
import { writeDeadLetter } from '../../../backend/jobs/dlqService';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms).unref?.();
    }),
  ]);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('CRON_ENTER');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    assertCronAuthorized(req);
  } catch (error) {
    if (rejectCronUnauthorized(res, error)) return;
    throw error;
  }
  console.log('CRON_AFTER_AUTH');

  const registry = getJobRegistryEntry('analytics_ingestion');
  const window = new Date().toISOString().slice(0, 10);
  const lock = await acquireJobLock(registry.lock_key_builder({ type: 'cron', window }), 3600);
  if (!lock) return res.status(200).json({ ok: true, skipped: true, reason: 'locked' });

  try {
    console.info(JSON.stringify({ event: 'job_started', job_id: 'analytics_ingestion', trigger_source: 'vercel_cron' }));
    console.log('CRON_BEFORE_JOB');
    const queue = getContentQueue('analytics-ingestion');
    await withTimeout(
      queue.add(
        'daily-growth',
        { type: 'daily-growth', window, trigger_source: 'vercel_cron' },
        { jobId: registry.idempotency_key_builder({ type: 'daily-growth', window }), priority: 2 },
      ),
      5_000,
      'ANALYTICS_DAILY_GROWTH_QUEUE_ADD',
    );
    await withTimeout(
      queue.add(
        'post-polls',
        { type: 'post-polls', batchSize: 100, window, trigger_source: 'vercel_cron' },
        { jobId: registry.idempotency_key_builder({ type: 'post-polls', window }), priority: 3 },
      ),
      5_000,
      'ANALYTICS_POST_POLLS_QUEUE_ADD',
    );
    console.log('CRON_AFTER_JOB');
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


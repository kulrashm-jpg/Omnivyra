// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { findDuePostsAndEnqueue } from '../../../backend/scheduler/schedulerService';
import { assertCronAuthorized, rejectCronUnauthorized } from '../../../backend/utils/cronAuthGuard';
import { getJobRegistryEntry } from '../../../backend/jobs/jobRegistry';
import { acquireJobLock, releaseJobLock } from '../../../backend/jobs/lockService';
import { writeDeadLetter } from '../../../backend/jobs/dlqService';

const BATCH_SIZE = 20;

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

  const registry = getJobRegistryEntry('publish');
  const window = new Date().toISOString().slice(0, 16);
  const lock = await acquireJobLock(registry.lock_key_builder({ trigger_source: 'vercel_cron', window }), 300);
  if (!lock) {
    console.info(JSON.stringify({ event: 'job_skipped_locked', job_id: 'publish', trigger_source: 'vercel_cron' }));
    return res.status(200).json({ ok: true, skipped: true, reason: 'locked' });
  }

  try {
    const { error: healthError } = await supabase.from('scheduled_posts').select('id').limit(1);
    if (healthError) throw healthError;

    console.info(JSON.stringify({ event: 'job_started', job_id: 'publish', trigger_source: 'vercel_cron' }));
    console.log('CRON_BEFORE_JOB');
    const result = await withTimeout(findDuePostsAndEnqueue(), 5_000, 'PUBLISH_JOB');
    console.log('CRON_AFTER_JOB');
    console.info(JSON.stringify({ event: 'job_completed', job_id: 'publish', trigger_source: 'vercel_cron', result }));
    return res.status(200).json({ ok: true, batch_size: BATCH_SIZE, ...result });
  } catch (err: any) {
    await writeDeadLetter({
      job_id: 'publish',
      queue_name: registry.queue_name,
      payload: { trigger_source: 'vercel_cron', window },
      error_message: err?.message ?? 'Failed to enqueue due posts',
      trigger_source: 'vercel_cron',
    }).catch(() => {});
    console.error(JSON.stringify({ event: 'job_failed', job_id: 'publish', trigger_source: 'vercel_cron', error: err?.message }));
    return res.status(500).json({ error: err?.message });
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}


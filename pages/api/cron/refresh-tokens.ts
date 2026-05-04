// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { refreshAllExpiringSocialAccounts } from '../../../backend/auth/tokenRefresh';
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

  const registry = getJobRegistryEntry('token_refresh');
  const window = new Date().toISOString().slice(0, 15);
  const lock = await acquireJobLock(registry.lock_key_builder({ window, trigger_source: 'vercel_cron' }), 600);
  if (!lock) return res.status(200).json({ ok: true, skipped: true, reason: 'locked' });

  const startedAt = Date.now();
  try {
    console.info(JSON.stringify({ event: 'job_started', job_id: 'token_refresh', trigger_source: 'vercel_cron' }));
    const totals = await refreshAllExpiringSocialAccounts();
    const durationMs = Date.now() - startedAt;
    console.info(JSON.stringify({ event: 'job_completed', job_id: 'token_refresh', durationMs }));
    return res.status(200).json({ ok: true, ...totals, durationMs });
  } catch (err: any) {
    await writeDeadLetter({
      job_id: 'token_refresh',
      queue_name: registry.queue_name,
      payload: { window, trigger_source: 'vercel_cron' },
      error_message: err?.message ?? 'refresh sweep failed',
      trigger_source: 'vercel_cron',
    }).catch(() => {});
    console.error('[cron/refresh-tokens] fatal:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'refresh sweep failed' });
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}


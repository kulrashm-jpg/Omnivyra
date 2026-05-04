// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { runReportAutomationCycle } from '@/backend/services/reportAutomationService';
import { assertCronAuthorized, rejectCronUnauthorized } from '@/backend/utils/cronAuthGuard';
import { getJobRegistryEntry } from '@/backend/jobs/jobRegistry';
import { acquireJobLock, releaseJobLock } from '@/backend/jobs/lockService';
import { writeDeadLetter } from '@/backend/jobs/dlqService';

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

  const registry = getJobRegistryEntry('report_automation');
  const window = new Date().toISOString().slice(0, 10);
  const lock = await acquireJobLock(registry.lock_key_builder({ window, trigger_source: 'cron' }), 3600);
  if (!lock) return res.status(200).json({ success: true, skipped: true, reason: 'locked' });

  try {
    const result = await runReportAutomationCycle();
    console.log('[cron/report-automation]', result);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    await writeDeadLetter({
      job_id: 'report_automation',
      queue_name: registry.queue_name,
      payload: { window, trigger_source: 'cron' },
      error_message: error instanceof Error ? error.message : String(error),
      trigger_source: 'cron',
    }).catch(() => {});
    console.error('[cron/report-automation] fatal error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}


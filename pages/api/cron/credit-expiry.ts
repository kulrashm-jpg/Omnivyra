// AUTH EXEMPT: cron endpoint uses cron-specific authorization
import type { NextApiRequest, NextApiResponse } from 'next';
import { runExpiryCheck } from '../../../backend/services/creditExpiryService';
import { assertCronAuthorized, rejectCronUnauthorized } from '../../../backend/utils/cronAuthGuard';
import { acquireJobLock, releaseJobLock } from '../../../backend/jobs/lockService';

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

  const dayKey = new Date().toISOString().slice(0, 10);
  const lock = await acquireJobLock(`job:credit_expiry:${dayKey}`, 600);
  if (!lock) return res.status(200).json({ ok: true, skipped: true, reason: 'locked' });

  const startedAt = Date.now();
  try {
    const result = await runExpiryCheck();
    const durationMs = Date.now() - startedAt;
    return res.status(200).json({ ok: true, ...result, durationMs });
  } catch (err: any) {
    console.error('[cron/credit-expiry] fatal:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'credit expiry sweep failed' });
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}

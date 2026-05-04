// AUTH EXEMPT: cron endpoint uses cron-specific authorization

/**
 * GET /api/cron/anomaly-sweep
 *
 * Cross-instance anomaly sweep â€” queries auth_audit_logs globally to detect
 * distributed attacks that are invisible to any single instance's in-process
 * counters.
 *
 * Schedule: every 2 minutes (configured in vercel.json).
 * Can also be triggered manually by a super admin.
 *
 * Auth: Authorization: Bearer CRON_SECRET.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runAnomalySweep } from '../../../lib/anomaly/sweepDetector';
import { assertCronAuthorized, rejectCronUnauthorized } from '../../../backend/utils/cronAuthGuard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    assertCronAuthorized(req);
  } catch (error) {
    if (rejectCronUnauthorized(res, error)) return;
    throw error;
  }

  try {
    const result = await runAnomalySweep();
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'anomaly_sweep_complete',
      ...result,
      ts: new Date().toISOString(),
    }));
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[anomaly-sweep] error:', err?.message);
    return res.status(500).json({ error: 'Sweep failed', details: err?.message });
  }
}


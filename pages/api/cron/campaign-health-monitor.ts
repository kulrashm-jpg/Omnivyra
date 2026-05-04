// AUTH EXEMPT: cron endpoint uses cron-specific authorization

/**
 * GET /api/cron/campaign-health-monitor
 *
 * Every-6-hours cron endpoint for the campaign health monitor.
 * Protected by CRON_SECRET header.
 *
 * Configure:
 *   Schedule: 0 every6h * * *  (cron: 0 slash6 * * *)
 *   Header:   Authorization: Bearer $CRON_SECRET
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignHealthMonitor } from '@/backend/services/campaignHealthMonitor';
import { assertCronAuthorized, rejectCronUnauthorized } from '@/backend/utils/cronAuthGuard';

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

  try {
    const result = await runCampaignHealthMonitor();
    console.log('[cron/campaign-health-monitor]', result);
    return res.status(200).json({ success: true, result });
  } catch (err: unknown) {
    console.error('[cron/campaign-health-monitor] fatal error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}


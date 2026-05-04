
/**
 * GET /api/admin/engagement-signal-health
 * Admin endpoint: collection status, platform breakdown, errors, queue size.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import {
  getEngagementSignalSchedulerLastRun,
  getEngagementSignalSchedulerErrors,
} from '../../../backend/jobs/engagementSignalScheduler';
import { getEngagementSignalQueueSize } from '../../../backend/queue/engagementSignalQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'health:engagement-signals');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/engagement-signal-health', 'health:engagement-signals');
  }

  try {
    const since24h = new Date();
    since24h.setHours(since24h.getHours() - 24);
    const sinceStr = since24h.toISOString();

    const { data: signals, error } = await supabase
      .from('campaign_activity_engagement_signals')
      .select('id, platform, detected_at')
      .gte('detected_at', sinceStr);

    if (error && error.code !== '42P01') {
      return res.status(500).json({ error: error.message });
    }

    const list = signals ?? [];
    const signalsCollectedLast24h = list.length;
    const signalsByPlatform: Record<string, number> = {};
    for (const s of list) {
      const p = (s as { platform?: string }).platform || 'unknown';
      signalsByPlatform[p] = (signalsByPlatform[p] || 0) + 1;
    }

    const lastRun = getEngagementSignalSchedulerLastRun();
    const collectorErrors = getEngagementSignalSchedulerErrors();
    let queueSize = 0;
    try {
      queueSize = await getEngagementSignalQueueSize();
    } catch {
      queueSize = 0;
    }

    return res.status(200).json({
      signalsCollectedLast24h,
      signalsByPlatform,
      collectorErrors,
      lastRunTime: lastRun ? new Date(lastRun).toISOString() : null,
      queueSize,
    });
  } catch (err) {
    console.error('[admin/engagement-signal-health]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

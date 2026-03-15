/**
 * GET /api/system/health/metrics
 * Returns operational health metrics for the engagement system.
 * Query: component, metric_name, time_window
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getMetrics } from '../../../../backend/services/systemHealthMetricsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const component = (req.query.component as string)?.trim() || undefined;
    const metricName = (req.query.metric_name as string)?.trim() || undefined;
    const timeWindow = req.query.time_window as string | undefined;
    const timeWindowHours = timeWindow ? parseInt(String(timeWindow), 10) : undefined;
    const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? 500), 10) || 500));

    const metrics = await getMetrics({
      component: component || null,
      metric_name: metricName || null,
      time_window_hours: Number.isFinite(timeWindowHours) && timeWindowHours! > 0 ? timeWindowHours! : null,
      limit,
    });

    return res.status(200).json({ metrics });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch metrics';
    console.error('[system/health/metrics]', msg);
    return res.status(500).json({ error: msg });
  }
}

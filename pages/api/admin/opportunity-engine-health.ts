
/**
 * GET /api/admin/opportunity-engine-health
 * Returns observability metrics for the engagement opportunity engine.
 * Requires super-admin or internal access.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireSuperAdmin } from '../../../backend/middleware/requireSuperAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const isAdmin = await requireSuperAdmin(req, res);
    if (!isAdmin) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [signalsResult, opportunitiesResult, errorsResult] = await Promise.all([
      supabase
        .from('campaign_activity_engagement_signals')
        .select('id', { count: 'exact', head: true })
        .gte('detected_at', oneHourAgo),
      supabase
        .from('opportunity_radar')
        .select('id, detected_at', { count: 'exact', head: true })
        .gte('detected_at', oneHourAgo),
      supabase
        .from('opportunity_engine_errors')
        .select('id, error_message, occurred_at')
        .gte('occurred_at', oneHourAgo)
        .order('occurred_at', { ascending: false })
        .limit(50),
    ]);

    const signals_processed_last_hour = signalsResult.count ?? 0;
    const opportunities_detected = opportunitiesResult.count ?? 0;

    let last_scan_time: string | null = null;
    if (opportunitiesResult.data?.length) {
      const latest = (opportunitiesResult.data as { detected_at?: string }[]).sort(
        (a, b) => new Date(b.detected_at ?? 0).getTime() - new Date(a.detected_at ?? 0).getTime()
      )[0];
      last_scan_time = latest?.detected_at ?? null;
    }

    const processing_errors = (errorsResult.data ?? []).map(
      (r: { error_message?: string; occurred_at?: string }) =>
        `${r.occurred_at ?? ''}: ${r.error_message ?? 'Unknown error'}`
    );

    return res.status(200).json({
      signals_processed_last_hour,
      opportunities_detected,
      processing_errors,
      last_scan_time,
      reported_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/opportunity-engine-health]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch health',
    });
  }
}

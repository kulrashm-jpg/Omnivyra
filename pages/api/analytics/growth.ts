import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/analytics/growth
 *
 * Returns platform growth snapshots (followers, impressions, reach) from
 * platform_metrics_snapshots, one row per day per platform.
 *
 * Query params:
 *   company_id   (required)
 *   platform     (optional) â€” filter to a single platform
 *   date_from    (optional) â€” YYYY-MM-DD
 *   date_to      (optional) â€” YYYY-MM-DD
 *   limit        (optional, default 90)   â€” max days to return per platform
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const {
    company_id,
    platform,
    date_from,
    date_to,
    limit = '90',
  } = req.query as Record<string, string>;

  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const limitNum = Math.min(365, Math.max(1, parseInt(limit, 10) || 90));

  let query = supabase
    .from('platform_metrics_snapshots')
    .select(
      'id, platform, followers, follower_gain, impressions, reach, engagement_rate, captured_at',
    )
    .eq('company_id', company_id)
    .order('captured_at', { ascending: false })
    .limit(limitNum);

  if (platform)  query = query.eq('platform', platform);
  if (date_from) query = query.gte('captured_at', `${date_from}T00:00:00Z`);
  if (date_to)   query = query.lte('captured_at', `${date_to}T23:59:59Z`);

  const { data, error } = await query;

  if (error) {
    console.error('[analytics/growth] query error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch growth data' });
  }

  // Group by platform for convenience
  const grouped: Record<string, typeof data> = {};
  for (const row of data ?? []) {
    const p = String(row.platform);
    if (!grouped[p]) grouped[p] = [];
    grouped[p]!.push(row);
  }

  return res.status(200).json({
    data:     data ?? [],
    grouped,
    total:    data?.length ?? 0,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);


import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/analytics/posts
 *
 * Returns paginated post analytics rows from content_analytics.
 *
 * Query params:
 *   company_id   (required) â€” filter by company
 *   platform     (optional) â€” e.g. linkedin, twitter
 *   date_from    (optional) â€” YYYY-MM-DD inclusive
 *   date_to      (optional) â€” YYYY-MM-DD inclusive
 *   page         (optional, default 1)
 *   per_page     (optional, default 50, max 200)
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
    page     = '1',
    per_page = '50',
  } = req.query as Record<string, string>;

  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const pageNum    = Math.max(1, parseInt(page, 10) || 1);
  const perPageNum = Math.min(200, Math.max(1, parseInt(per_page, 10) || 50));
  const offset     = (pageNum - 1) * perPageNum;

  // Join to scheduled_posts to filter by company_id
  let query = supabase
    .from('content_analytics')
    .select(
      `id, scheduled_post_id, platform, analytics_date,
       views, likes, shares, comments, saves, reactions,
       engagement_rate, reach, impressions, updated_at,
       scheduled_posts!inner(company_id, platform_post_id, content)`,
      { count: 'exact' },
    )
    .eq('scheduled_posts.company_id', company_id)
    .order('analytics_date', { ascending: false })
    .range(offset, offset + perPageNum - 1);

  if (platform) query = query.eq('platform', platform);
  if (date_from) query = query.gte('analytics_date', date_from);
  if (date_to)   query = query.lte('analytics_date', date_to);

  const { data, count, error } = await query;

  if (error) {
    console.error('[analytics/posts] query error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch post analytics' });
  }

  return res.status(200).json({
    data:       data ?? [],
    total:      count ?? 0,
    page:       pageNum,
    per_page:   perPageNum,
    total_pages: Math.ceil((count ?? 0) / perPageNum),
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);


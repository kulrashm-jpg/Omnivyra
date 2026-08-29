import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/analytics/posts
 *
 * Returns paginated post analytics rows from content_analytics.
 *
 * Query params:
 *   company_id   (required) — filter by company
 *   platform     (optional) — e.g. linkedin, twitter
 *   date_from    (optional) — YYYY-MM-DD inclusive
 *   date_to      (optional) — YYYY-MM-DD inclusive
 *   page         (optional, default 1)
 *   per_page     (optional, default 50, max 200)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';

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

  /*
   * ANALYTICS-SEC-001 — authorize the company BEFORE it becomes a query
   * predicate.
   *
   * Authentication proved WHO the caller is; it proved nothing about WHICH
   * company they may read. `company_id` arrives in the query string and was
   * used directly as the tenant predicate against a service-role client that
   * bypasses RLS, so any authenticated user — including a brand-new signup in
   * an unrelated tenant — could read any company's analytics by naming its id.
   *
   * requireCompanyAccess is the primitive this cluster already uses: the
   * sibling force-sync route calls it, and it delegates to
   * TenantGuard.assertTenantAccess, so soft-deleted orgs and stale memberships
   * are rejected centrally and platform super-admins keep their bypass. It
   * answers 400/404/403 itself; nothing is queried before it returns true.
   */
  if (!(await requireCompanyAccess(user.id, company_id, res))) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/posts' });

import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/analytics/summary
 *
 * Cross-platform engagement and growth summary for a company.
 *
 * Query params:
 *   company_id   (required)
 *   date_from    (optional) — YYYY-MM-DD, defaults to 30 days ago
 *   date_to      (optional) — YYYY-MM-DD, defaults to today
 *
 * Response:
 * {
 *   total_impressions, total_reach, total_engagement,
 *   platform_breakdown: { linkedin: {...}, twitter: {...}, ... }
 * }
 *
 * Sources:
 *   - content_analytics  → post-level impressions, reach, engagement metrics
 *   - platform_metrics_snapshots → latest follower count per platform
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';

interface PlatformSummary {
  impressions:      number;
  reach:            number;
  engagement:       number;
  likes:            number;
  comments:         number;
  shares:           number;
  saves:            number;
  views:            number;
  post_count:       number;
  avg_engagement_rate: number;
  followers:        number;
}

const EMPTY_PLATFORM = (): PlatformSummary => ({
  impressions: 0, reach: 0, engagement: 0,
  likes: 0, comments: 0, shares: 0, saves: 0, views: 0,
  post_count: 0, avg_engagement_rate: 0, followers: 0,
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { company_id, date_from, date_to } = req.query as Record<string, string>;
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

  const today    = new Date().toISOString().split('T')[0];
  const dfrom    = date_from ?? new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
  const dto      = date_to   ?? today;

  // ── 1. Post-level metrics from content_analytics ─────────────────────────
  const { data: postRows, error: postErr } = await supabase
    .from('content_analytics')
    .select(
      `platform, impressions, reach, likes, shares, comments, saves,
       reactions, views, engagement_rate,
       scheduled_posts!inner(company_id)`,
    )
    .eq('scheduled_posts.company_id', company_id)
    .gte('analytics_date', dfrom)
    .lte('analytics_date', dto);

  if (postErr) {
    console.error('[analytics/summary] post query error:', postErr.message);
    return res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }

  // ── 2. Latest follower counts from platform_metrics_snapshots ────────────
  const { data: snapRows } = await supabase
    .from('platform_metrics_snapshots')
    .select('platform, followers, captured_date')
    .eq('company_id', company_id)
    .order('captured_date', { ascending: false });

  // Dedupe: keep latest per platform
  const latestFollowers: Record<string, number> = {};
  for (const s of snapRows ?? []) {
    const p = String(s.platform);
    if (!(p in latestFollowers)) latestFollowers[p] = s.followers ?? 0;
  }

  // ── 3. Aggregate by platform ──────────────────────────────────────────────
  const breakdown: Record<string, PlatformSummary> = {};

  for (const row of postRows ?? []) {
    const p = String(row.platform ?? 'unknown');
    if (!breakdown[p]) breakdown[p] = EMPTY_PLATFORM();
    const b = breakdown[p]!;

    b.impressions += row.impressions ?? 0;
    b.reach       += row.reach       ?? 0;
    b.likes       += row.likes       ?? 0;
    b.comments    += row.comments    ?? 0;
    b.shares      += row.shares      ?? 0;
    b.saves       += row.saves       ?? 0;
    b.views       += row.views       ?? 0;
    b.engagement  += (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0)
                     + (row.saves ?? 0) + (row.reactions ?? 0);
    b.post_count  += 1;
  }

  // Compute avg_engagement_rate and attach followers
  for (const [p, b] of Object.entries(breakdown)) {
    b.avg_engagement_rate = b.post_count > 0
      ? parseFloat((b.engagement / b.post_count).toFixed(2))
      : 0;
    b.followers = latestFollowers[p] ?? 0;
  }

  // ── 4. Totals ─────────────────────────────────────────────────────────────
  const totals = Object.values(breakdown).reduce(
    (acc, b) => {
      acc.total_impressions += b.impressions;
      acc.total_reach       += b.reach;
      acc.total_engagement  += b.engagement;
      acc.total_likes       += b.likes;
      acc.total_comments    += b.comments;
      acc.total_shares      += b.shares;
      acc.total_views       += b.views;
      acc.total_posts       += b.post_count;
      return acc;
    },
    {
      total_impressions: 0, total_reach: 0, total_engagement: 0,
      total_likes: 0, total_comments: 0, total_shares: 0,
      total_views: 0, total_posts: 0,
    },
  );

  return res.status(200).json({
    company_id,
    date_from: dfrom,
    date_to:   dto,
    ...totals,
    platform_breakdown: breakdown,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/summary' });


/**
 * GET /api/admin/consumption/org-activity-breakdown
 *
 * Per-organisation consumption + activity breakdown for a given month.
 * Used by OrgServiceDrilldown to show company-level cost attribution
 * for any infrastructure service (Redis, Supabase, Railway, Vercel, …)
 * as well as direct LLM / API spend.
 *
 * Response:
 *  orgs[]  — one row per organisation with LLM cost, API cost, posts by
 *            platform, and campaign count for the period
 *  totals  — platform-wide sums (used as denominator for proportional alloc)
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import { getAllOrgsConsumption } from '../../../../backend/services/consumptionAnalyticsService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  } catch { /* deny */ }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const now = new Date();
  const year  = req.query.year  ? parseInt(req.query.year  as string, 10) : now.getUTCFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : now.getUTCMonth() + 1;

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate   = new Date(Date.UTC(year, month,     1)).toISOString();

  // ── 1. Per-org LLM + API spend (reuse existing service function) ────────────
  const orgRows = await getAllOrgsConsumption({ year, month });

  // ── 2. Scheduled posts per org for the period ──────────────────────────────
  // scheduled_posts has user_id; resolve to company_id via user_company_roles.
  const { data: rawPosts } = await supabase
    .from('scheduled_posts')
    .select('user_id, platform, status')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  const posts = (rawPosts ?? []) as Array<{ user_id: string; platform: string | null; status: string | null }>;

  // Resolve user_id → company_id in one batch query
  const userIds = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
  let userToCompany = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: roles } = await supabase
      .from('user_company_roles')
      .select('user_id, company_id')
      .in('user_id', userIds)
      .eq('status', 'active');
    for (const r of (roles ?? []) as Array<{ user_id: string; company_id: string }>) {
      if (!userToCompany.has(r.user_id)) userToCompany.set(r.user_id, r.company_id);
    }
  }

  // Aggregate posts per company + platform
  const postsByOrg = new Map<string, { total: number; published: number; by_platform: Record<string, number> }>();
  for (const p of posts) {
    const companyId = userToCompany.get(p.user_id);
    if (!companyId) continue;
    const entry = postsByOrg.get(companyId) ?? { total: 0, published: 0, by_platform: {} };
    entry.total++;
    if (p.status === 'published') entry.published++;
    const plat = p.platform ?? 'unknown';
    entry.by_platform[plat] = (entry.by_platform[plat] ?? 0) + 1;
    postsByOrg.set(companyId, entry);
  }

  // ── 3. Campaign count per org for the period ───────────────────────────────
  // campaigns.user_id → user_company_roles.company_id
  const { data: rawCampaigns } = await supabase
    .from('campaigns')
    .select('user_id, status')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  const campaigns = (rawCampaigns ?? []) as Array<{ user_id: string; status: string | null }>;
  const campaignUserIds = [...new Set(campaigns.map(c => c.user_id).filter(Boolean))];
  if (campaignUserIds.length > 0) {
    // Add any missing user→company mappings
    const missing = campaignUserIds.filter(uid => !userToCompany.has(uid));
    if (missing.length > 0) {
      const { data: extraRoles } = await supabase
        .from('user_company_roles')
        .select('user_id, company_id')
        .in('user_id', missing)
        .eq('status', 'active');
      for (const r of (extraRoles ?? []) as Array<{ user_id: string; company_id: string }>) {
        if (!userToCompany.has(r.user_id)) userToCompany.set(r.user_id, r.company_id);
      }
    }
  }

  const campaignsByOrg = new Map<string, { total: number; active: number }>();
  for (const c of campaigns) {
    const companyId = userToCompany.get(c.user_id);
    if (!companyId) continue;
    const entry = campaignsByOrg.get(companyId) ?? { total: 0, active: 0 };
    entry.total++;
    if (c.status === 'active') entry.active++;
    campaignsByOrg.set(companyId, entry);
  }

  // ── 4. Merge and return ────────────────────────────────────────────────────
  const orgs = orgRows.map(r => ({
    organization_id: r.organization_id,
    org_name:        r.org_name ?? null,
    llm_calls:       r.llm_calls,
    llm_cost_usd:    r.llm_cost_usd,
    api_calls:       r.api_calls,
    api_cost_usd:    r.api_cost_usd,
    total_cost_usd:  r.total_cost_usd,
    credit_balance:  r.credit_balance ?? null,
    activities: {
      posts_total:     postsByOrg.get(r.organization_id)?.total      ?? 0,
      posts_published: postsByOrg.get(r.organization_id)?.published  ?? 0,
      posts_by_platform: postsByOrg.get(r.organization_id)?.by_platform ?? {},
      campaigns_total:  campaignsByOrg.get(r.organization_id)?.total  ?? 0,
      campaigns_active: campaignsByOrg.get(r.organization_id)?.active ?? 0,
    },
  }));

  const totalLlmCost  = orgs.reduce((s, o) => s + o.llm_cost_usd,  0);
  const totalApiCost  = orgs.reduce((s, o) => s + o.api_cost_usd,  0);
  const totalCost     = orgs.reduce((s, o) => s + o.total_cost_usd, 0);
  const totalPosts    = orgs.reduce((s, o) => s + o.activities.posts_total, 0);

  return res.status(200).json({
    period: { year, month },
    orgs,
    totals: {
      llm_cost_usd:  Math.round(totalLlmCost  * 1e6) / 1e6,
      api_cost_usd:  Math.round(totalApiCost  * 1e6) / 1e6,
      total_cost_usd: Math.round(totalCost    * 1e6) / 1e6,
      posts_total:   totalPosts,
      org_count:     orgs.length,
    },
  });
}

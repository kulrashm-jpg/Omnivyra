/**
 * GET /api/blog/[slug]/campaign-signal
 *
 * Returns campaign performance signals connected to this blog's topic,
 * scoped to the requesting company only.
 *
 * Auth: COMPANY_ADMIN and above (withRBAC).
 * Company isolation: signals filtered to req.user.company_id only.
 *
 * Looks for:
 *   1. Campaigns with source_blog_id = this blog's id
 *   2. Campaigns that used this blog via campaign_versions.campaign_snapshot.blog_context
 *
 * Response:
 * {
 *   found: boolean,
 *   blog: { id, title, topic_seed },
 *   signals: Array<{
 *     campaign_id, campaign_name,
 *     evaluation_status, evaluation_score, evaluation_summary,
 *     recommended_action, next_topic, next_topic_reason,
 *     recorded_at
 *   }>
 * }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'Slug required' });
  }

  // ── Resolve company from session ─────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // Resolve companyId from the authenticated user's company membership
  const { data: membership } = await supabase
    .from('user_companies')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const companyId = (req as any).companyId ?? membership?.company_id ?? null;
  if (!companyId) {
    return res.status(200).json({ found: false, blog: null, signals: [] });
  }

  // ── Resolve the blog (public_blogs only — global knowledge layer) ─────────
  const { data: blog } = await supabase
    .from('public_blogs')
    .select('id, title, tags')
    .eq('slug', slug.trim())
    .eq('status', 'published')
    .maybeSingle();

  if (!blog) {
    return res.status(200).json({ found: false, blog: null, signals: [] });
  }

  // ── 1. Direct source: campaigns this company linked to this blog ──────────
  const { data: directCampaigns } = await supabase
    .from('campaigns')
    .select('id, name, topic_seed')
    .eq('source_blog_id', blog.id);

  // Filter to this company via campaign_versions
  let companyDirectIds: string[] = [];
  if ((directCampaigns ?? []).length > 0) {
    const ids = (directCampaigns ?? []).map((c: any) => c.id as string);
    const { data: versionCheck } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId)
      .in('campaign_id', ids);
    companyDirectIds = (versionCheck ?? []).map((v: any) => v.campaign_id as string);
  }

  // ── 2. Campaigns where blog was in campaign_snapshot.blog_context ──────────
  const { data: contextVersions } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId)
    .contains('campaign_snapshot', { blog_context: { blogs: [{ title: blog.title }] } })
    .limit(20);

  const contextCampaignIds = [...new Set(
    (contextVersions ?? []).map((v: any) => v.campaign_id as string)
  )];

  let contextCampaigns: Array<{ id: string; name: string; topic_seed: string | null }> = [];
  if (contextCampaignIds.length > 0) {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, topic_seed')
      .in('id', contextCampaignIds);
    contextCampaigns = data ?? [];
  }

  // Resolve direct campaign metadata for scoped ids
  const companyDirectCampaigns = (directCampaigns ?? []).filter(
    (c: any) => companyDirectIds.includes(c.id)
  );

  // Merge & deduplicate
  const allCampaignIds = [
    ...new Set([
      ...companyDirectIds,
      ...contextCampaignIds,
    ]),
  ];

  if (allCampaignIds.length === 0) {
    return res.status(200).json({
      found: false,
      blog: { id: blog.id, title: blog.title, topic_seed: null },
      signals: [],
    });
  }

  // ── 3. Fetch performance records — scoped to this company ────────────────
  const { data: performances } = await supabase
    .from('campaign_performance')
    .select(`
      campaign_id, evaluation_status, evaluation_score,
      evaluation_summary, recommended_action, next_topic,
      next_topic_reason, recorded_at
    `)
    .eq('company_id', companyId)
    .in('campaign_id', allCampaignIds)
    .not('evaluation_status', 'is', null)
    .order('recorded_at', { ascending: false });

  if (!performances || performances.length === 0) {
    return res.status(200).json({
      found: true,
      blog: { id: blog.id, title: blog.title, topic_seed: null },
      signals: [],
    });
  }

  // Join campaign names
  const campaignMap = new Map<string, string>();
  [...companyDirectCampaigns, ...contextCampaigns].forEach((c: any) => {
    campaignMap.set(c.id, c.name);
  });

  // One signal per campaign (most recent)
  const seen = new Set<string>();
  const signals = (performances as any[])
    .filter((p) => {
      if (seen.has(p.campaign_id)) return false;
      seen.add(p.campaign_id);
      return true;
    })
    .map((p) => ({
      campaign_id:        p.campaign_id,
      campaign_name:      campaignMap.get(p.campaign_id) ?? 'Campaign',
      evaluation_status:  p.evaluation_status,
      evaluation_score:   p.evaluation_score,
      evaluation_summary: p.evaluation_summary,
      recommended_action: p.recommended_action,
      next_topic:         p.next_topic,
      next_topic_reason:  p.next_topic_reason,
      recorded_at:        p.recorded_at,
    }))
    .slice(0, 5);

  return res.status(200).json({
    found: signals.length > 0,
    blog:  { id: blog.id, title: blog.title, topic_seed: null },
    signals,
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.COMPANY_ADMIN]);

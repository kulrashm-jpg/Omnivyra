import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/debug/bolt-state?companyId=<id>
 *
 * Diagnostic endpoint — shows what daily_content_plans and scheduled_posts
 * actually contain for the most recent BOLT campaign.
 * Remove this file after debugging.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  // Most recent campaign for this company
  const { data: versions } = await supabase
    .from('campaign_versions')
    .select('campaign_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(5);

  const campaignIds = [...new Set((versions ?? []).map((v: any) => v.campaign_id))].slice(0, 3);

  // daily_content_plans
  const { data: plans } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, week_number, date, platform, content_type, topic, title, content')
    .in('campaign_id', campaignIds)
    .order('date', { ascending: true })
    .limit(30);

  // scheduled_posts
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, campaign_id, platform, content_type, title, content, status, scheduled_for, repurpose_index, repurpose_total')
    .in('campaign_id', campaignIds)
    .order('scheduled_for', { ascending: true })
    .limit(30);

  // social_accounts
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform, is_active, company_id, user_id')
    .or(`company_id.eq.${companyId},company_id.is.null`);

  // Summarise plans
  const planSummary = (plans ?? []).map((p: any) => ({
    id: p.id,
    campaign_id: p.campaign_id,
    date: p.date,
    platform: p.platform,
    content_type: p.content_type,
    topic: (p.topic || p.title || '').slice(0, 60),
    content_status: (() => {
      if (!p.content) return 'null';
      try {
        const parsed = JSON.parse(p.content);
        return parsed?.content_status ?? (parsed?.generated_content ? 'has_generated_content' : 'no_generated_content');
      } catch { return 'not_json'; }
    })(),
  }));

  // Summarise posts
  const postSummary = (posts ?? []).map((p: any) => ({
    id: p.id,
    campaign_id: p.campaign_id,
    platform: p.platform,
    content_type: p.content_type,
    title: (p.title || '').slice(0, 60),
    has_content: Boolean(p.content && p.content.trim().length > 10),
    content_preview: (p.content || '').slice(0, 80),
    status: p.status,
    scheduled_for: p.scheduled_for,
    repurpose_index: p.repurpose_index,
    repurpose_total: p.repurpose_total,
  }));

  return res.status(200).json({
    campaign_ids: campaignIds,
    daily_plans_count: (plans ?? []).length,
    scheduled_posts_count: (posts ?? []).length,
    social_accounts: (accounts ?? []).map((a: any) => ({
      platform: a.platform,
      is_active: a.is_active,
      has_company_id: !!a.company_id,
    })),
    plans: planSummary,
    posts: postSummary,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/debug/bolt-state' });

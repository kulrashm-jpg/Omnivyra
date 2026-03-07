/**
 * Community Health API — read-only conversation health metrics.
 * Data from: post_comments, comment_replies, comment_flags, community_ai_actions, scheduled_posts.
 * No campaign performance, no strategist memory, no distribution metrics.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireTenantScope } from '../community-ai/utils';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

export interface CommunityHealthSummary {
  scope: 'company' | 'campaign';
  range_days: number;
  total_comments: number;
  total_replies: number;
  response_rate: number;
  avg_response_time_minutes: number | null;
  ai_actions_created: number;
  ai_actions_approved: number;
  ai_actions_rejected: number;
  pending_actions: number;
  flagged_comments: number;
  unresolved_flags: number;
  sentiment: { positive: number; neutral: number; negative: number };
  alerts: string[];
}

const RANGE_OPTIONS = [7, 30, 90];

function parseRange(range: string | string[] | undefined): number {
  const r = typeof range === 'string' ? range : Array.isArray(range) ? range[0] : undefined;
  const n = parseInt(r ?? '', 10);
  return RANGE_OPTIONS.includes(n) ? n : 7;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const scope = (typeof req.query.scope === 'string' ? req.query.scope : 'company').toLowerCase();
    const scopeType = scope === 'campaign' ? 'campaign' : 'company';
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : undefined;
    const rangeDays = parseRange(req.query.range);

    let companyId: string;

    if (scopeType === 'company') {
      const tenantScope = await requireTenantScope(req, res);
      if (!tenantScope) return;
      companyId = tenantScope.organizationId;
    } else {
      if (!campaignId) {
        return res.status(400).json({ error: 'campaignId required when scope=campaign' });
      }
      const access = await requireCampaignAccess(req, res, campaignId);
      if (!access) return;
      companyId = access.companyId;
    }

    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

    let scheduledPostIds: string[] = [];

    if (scopeType === 'campaign' && campaignId) {
      const { data: posts } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('campaign_id', campaignId);
      scheduledPostIds = (posts ?? []).map((p: { id: string }) => p.id);
    } else {
      const { data: versions } = await supabase
        .from('campaign_versions')
        .select('campaign_id')
        .eq('company_id', companyId);
      const cids = [...new Set((versions ?? []).map((v: { campaign_id: string }) => v.campaign_id).filter(Boolean))];
      if (cids.length > 0) {
        const { data: posts } = await supabase
          .from('scheduled_posts')
          .select('id')
          .in('campaign_id', cids);
        scheduledPostIds = (posts ?? []).map((p: { id: string }) => p.id);
      }
    }

    let total_comments = 0;
    let total_replies = 0;
    let flagged_comments = 0;
    const commentRows: { id: string; platform_created_at: string | null }[] = [];
    let positive = 0;
    let neutral = 0;
    let negative = 0;

    if (scheduledPostIds.length > 0) {
      let commentsQuery = supabase
        .from('post_comments')
        .select('id, platform_created_at, sentiment_score, is_flagged')
        .in('scheduled_post_id', scheduledPostIds)
        .gte('created_at', since);
      const { data: comments, error: commentsErr } = await commentsQuery;
      if (!commentsErr && Array.isArray(comments)) {
        total_comments = comments.length;
        commentRows.push(...comments.map((c: any) => ({ id: c.id, platform_created_at: c.platform_created_at ?? null })));
        for (const c of comments) {
          const score = c.sentiment_score != null ? Number(c.sentiment_score) : 0;
          if (score > 0.2) positive += 1;
          else if (score < -0.2) negative += 1;
          else neutral += 1;
          if (c.is_flagged === true) flagged_comments += 1;
        }
      }
    }

    const commentIds = commentRows.map((c) => c.id);
    let replyRows: { comment_id: string; sent_at: string | null }[] = [];
    if (commentIds.length > 0) {
      const { data: replies } = await supabase
        .from('comment_replies')
        .select('comment_id, sent_at')
        .in('comment_id', commentIds)
        .gte('sent_at', since);
      replyRows = (replies ?? []).map((r: any) => ({ comment_id: r.comment_id, sent_at: r.sent_at ?? null }));
      total_replies = replyRows.length;
    }

    let avg_response_time_minutes: number | null = null;
    if (commentRows.length > 0 && replyRows.length > 0) {
      const commentById = new Map(commentRows.map((c) => [c.id, c]));
      const diffs: number[] = [];
      for (const r of replyRows) {
        const comment = commentById.get(r.comment_id);
        if (!comment?.platform_created_at || !r.sent_at) continue;
        const a = new Date(comment.platform_created_at).getTime();
        const b = new Date(r.sent_at).getTime();
        if (Number.isFinite(a) && Number.isFinite(b)) diffs.push((b - a) / (60 * 1000));
      }
      if (diffs.length > 0) {
        avg_response_time_minutes = Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10;
      }
    }

    const response_rate = total_comments > 0 ? Math.round((total_replies / total_comments) * 10000) / 100 : 0;

    let unresolved_flags = 0;
    if (commentIds.length > 0) {
      const { data: flags } = await supabase
        .from('comment_flags')
        .select('id, status')
        .in('comment_id', commentIds)
        .gte('created_at', since);
      unresolved_flags = (flags ?? []).filter((f: any) => String(f?.status ?? '') === 'pending').length;
    }

    let ai_actions_created = 0;
    let ai_actions_approved = 0;
    let ai_actions_rejected = 0;
    let pending_actions = 0;
    try {
      const { data: actions } = await supabase
        .from('community_ai_actions')
        .select('status')
        .eq('tenant_id', companyId)
        .eq('organization_id', companyId)
        .gte('created_at', since);
      const list = actions ?? [];
      ai_actions_created = list.length;
      for (const a of list) {
        const s = String(a?.status ?? '').toLowerCase();
        if (s === 'approved') ai_actions_approved += 1;
        else if (s === 'pending') pending_actions += 1;
        else if (['failed', 'skipped', 'rejected'].includes(s)) ai_actions_rejected += 1;
      }
    } catch (_) {
      // table or query failed
    }

    const totalSentiment = positive + neutral + negative;
    const sentiment = {
      positive: totalSentiment > 0 ? Math.round((positive / totalSentiment) * 10000) / 100 : 0,
      neutral: totalSentiment > 0 ? Math.round((neutral / totalSentiment) * 10000) / 100 : 0,
      negative: totalSentiment > 0 ? Math.round((negative / totalSentiment) * 10000) / 100 : 0,
    };

    const alerts: string[] = [];
    if (response_rate < 40) alerts.push('Response rate is below 40%.');
    if (avg_response_time_minutes != null && avg_response_time_minutes > 180) alerts.push('Average response time is over 3 hours.');
    if (unresolved_flags > 0) alerts.push('There are unresolved flagged comments.');
    if (ai_actions_created > 10 && ai_actions_created > 0 && ai_actions_approved / ai_actions_created < 0.3) {
      alerts.push('Fewer than 30% of AI suggestions have been approved.');
    }

    const summary: CommunityHealthSummary = {
      scope: scopeType,
      range_days: rangeDays,
      total_comments,
      total_replies,
      response_rate,
      avg_response_time_minutes,
      ai_actions_created,
      ai_actions_approved,
      ai_actions_rejected,
      pending_actions,
      flagged_comments,
      unresolved_flags,
      sentiment,
      alerts,
    };

    return res.status(200).json(summary);
  } catch (err) {
    console.error('[CommunityHealth]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

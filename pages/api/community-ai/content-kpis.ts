import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';

type EngagementGoals = {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
};

const coerceNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readGoals = (raw: any): EngagementGoals => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as EngagementGoals;
};

const computeGoalHit = (metrics: EngagementGoals, goals: EngagementGoals) => {
  const targets = Object.entries(goals || {}).filter(([, value]) => coerceNumber(value) > 0);
  if (targets.length === 0) return false;
  return targets.every(([key, value]) => {
    const actual = coerceNumber((metrics as any)[key]);
    return actual >= coerceNumber(value);
  });
};

const round = (value: number) => Number(value.toFixed(2));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  const platform = typeof req.query?.platform === 'string' ? req.query.platform : null;

  let query = supabase
    .from('content_analytics')
    .select(
      'scheduled_post_id, platform, content_type, likes, comments, shares, views, engagement_rate, scheduled_posts(engagement_goals, users(company_id))'
    )
    .eq('scheduled_posts.users.company_id', scope.organizationId);

  if (platform) {
    query = query.eq('platform', platform);
  }

  const { data: analyticsRows, error } = await query;
  if (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_CONTENT_KPIS' });
  }

  const rows = analyticsRows || [];

  const perPost = new Map<
    string,
    {
      platform: string;
      content_type: string;
      likes: number;
      comments: number;
      shares: number;
      views: number;
      goals: EngagementGoals;
    }
  >();

  rows.forEach((row: any) => {
    const postId = row.scheduled_post_id;
    if (!postId) return;
    const existing = perPost.get(postId) || {
      platform: row.platform || 'unknown',
      content_type: row.content_type || 'unknown',
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      goals: readGoals(row.scheduled_posts?.engagement_goals),
    };
    existing.likes += coerceNumber(row.likes);
    existing.comments += coerceNumber(row.comments);
    existing.shares += coerceNumber(row.shares);
    existing.views += coerceNumber(row.views);
    perPost.set(postId, existing);
  });

  const platformAgg = new Map<
    string,
    {
      total_posts: number;
      total_likes: number;
      total_comments: number;
      total_shares: number;
      total_views: number;
      goal_hits: number;
    }
  >();

  const contentAgg = new Map<
    string,
    {
      total_posts: number;
      total_engagement: number;
      goal_hits: number;
    }
  >();

  perPost.forEach((row) => {
    const metrics = {
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      views: row.views,
    };
    const goals = row.goals;
    const hit = computeGoalHit(metrics, goals);

    const platformKey = row.platform || 'unknown';
    const platformBucket = platformAgg.get(platformKey) || {
      total_posts: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      total_views: 0,
      goal_hits: 0,
    };
    platformBucket.total_posts += 1;
    platformBucket.total_likes += metrics.likes;
    platformBucket.total_comments += metrics.comments;
    platformBucket.total_shares += metrics.shares;
    platformBucket.total_views += metrics.views;
    if (hit) platformBucket.goal_hits += 1;
    platformAgg.set(platformKey, platformBucket);

    const contentKey = row.content_type || 'unknown';
    const contentBucket = contentAgg.get(contentKey) || {
      total_posts: 0,
      total_engagement: 0,
      goal_hits: 0,
    };
    contentBucket.total_posts += 1;
    contentBucket.total_engagement +=
      metrics.likes + metrics.comments + metrics.shares + metrics.views;
    if (hit) contentBucket.goal_hits += 1;
    contentAgg.set(contentKey, contentBucket);
  });

  const by_platform = Array.from(platformAgg.entries()).map(([key, value]) => ({
    platform: key,
    total_posts: value.total_posts,
    avg_likes: value.total_posts ? round(value.total_likes / value.total_posts) : 0,
    avg_comments: value.total_posts ? round(value.total_comments / value.total_posts) : 0,
    avg_shares: value.total_posts ? round(value.total_shares / value.total_posts) : 0,
    goal_hit_rate: value.total_posts
      ? round((value.goal_hits / value.total_posts) * 100)
      : 0,
    underperforming_count: value.total_posts - value.goal_hits,
  }));

  const by_content_type = Array.from(contentAgg.entries()).map(([key, value]) => ({
    content_type: key,
    total_posts: value.total_posts,
    avg_engagement: value.total_posts ? round(value.total_engagement / value.total_posts) : 0,
    goal_hit_rate: value.total_posts
      ? round((value.goal_hits / value.total_posts) * 100)
      : 0,
  }));

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    by_platform,
    by_content_type,
  });
}

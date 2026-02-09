import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { evaluateInsights } from '../../../backend/services/communityAiInsightsService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope, resolveBrandVoice } from './utils';

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

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

const classifyTrend = (deltaPercent: number) => {
  if (deltaPercent > 15) return 'up';
  if (deltaPercent < -15) return 'down';
  return 'flat';
};

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
  const contentType =
    typeof req.query?.content_type === 'string' ? req.query.content_type : null;

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 7);
  const previousStart = new Date(now);
  previousStart.setDate(previousStart.getDate() - 14);
  const previousEnd = new Date(currentStart);

  let query = supabase
    .from('content_analytics')
    .select(
      'scheduled_post_id, platform, content_type, likes, comments, shares, views, engagement_rate, date, scheduled_posts(content, engagement_goals, users(company_id))'
    )
    .eq('scheduled_posts.users.company_id', scope.organizationId)
    .gte('date', toDateString(previousStart));

  if (platform) {
    query = query.eq('platform', platform);
  }
  if (contentType) {
    query = query.eq('content_type', contentType);
  }

  const { data: rows, error } = await query;
  if (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_INSIGHTS' });
  }

  const perPost = new Map<
    string,
    {
      platform: string;
      content_type: string;
      metrics: { likes: number; comments: number; shares: number; views: number };
      goals: EngagementGoals;
      content: string | null;
      last_date: string | null;
    }
  >();

  const currentAgg = new Map<
    string,
    { count: number; metrics: { likes: number; comments: number; shares: number; views: number; engagement_rate: number } }
  >();
  const previousAgg = new Map<
    string,
    { count: number; metrics: { likes: number; comments: number; shares: number; views: number; engagement_rate: number } }
  >();

  (rows || []).forEach((row: any) => {
    const dateValue = row.date ? new Date(row.date) : null;
    const isCurrent = dateValue ? dateValue >= currentStart && dateValue < now : false;
    const isPrevious = dateValue ? dateValue >= previousStart && dateValue < previousEnd : false;
    if (!isCurrent && !isPrevious) return;

    const key = `${row.platform || 'unknown'}::${row.content_type || 'unknown'}`;
    const bucket = isCurrent ? currentAgg : previousAgg;
    const entry = bucket.get(key) || {
      count: 0,
      metrics: { likes: 0, comments: 0, shares: 0, views: 0, engagement_rate: 0 },
    };
    entry.count += 1;
    entry.metrics.likes += coerceNumber(row.likes);
    entry.metrics.comments += coerceNumber(row.comments);
    entry.metrics.shares += coerceNumber(row.shares);
    entry.metrics.views += coerceNumber(row.views);
    entry.metrics.engagement_rate += coerceNumber(row.engagement_rate);
    bucket.set(key, entry);

    if (isCurrent && row.scheduled_post_id) {
      const postEntry = perPost.get(row.scheduled_post_id) || {
        platform: row.platform || 'unknown',
        content_type: row.content_type || 'unknown',
        metrics: { likes: 0, comments: 0, shares: 0, views: 0 },
        goals: readGoals(row.scheduled_posts?.engagement_goals),
        content: row.scheduled_posts?.content ?? null,
        last_date: row.date || null,
      };
      postEntry.metrics.likes += coerceNumber(row.likes);
      postEntry.metrics.comments += coerceNumber(row.comments);
      postEntry.metrics.shares += coerceNumber(row.shares);
      postEntry.metrics.views += coerceNumber(row.views);
      postEntry.last_date = row.date || postEntry.last_date;
      perPost.set(row.scheduled_post_id, postEntry);
    }
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
    { total_posts: number; total_engagement: number; goal_hits: number }
  >();

  perPost.forEach((postEntry) => {
    const metrics = postEntry.metrics;
    const hit = computeGoalHit(metrics, postEntry.goals);

    const platformKey = postEntry.platform || 'unknown';
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

    const contentKey = postEntry.content_type || 'unknown';
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

  const kpis = {
    by_platform: Array.from(platformAgg.entries()).map(([key, value]) => ({
      platform: key,
      total_posts: value.total_posts,
      avg_likes: value.total_posts ? round(value.total_likes / value.total_posts) : 0,
      avg_comments: value.total_posts ? round(value.total_comments / value.total_posts) : 0,
      avg_shares: value.total_posts ? round(value.total_shares / value.total_posts) : 0,
      goal_hit_rate: value.total_posts
        ? round((value.goal_hits / value.total_posts) * 100)
        : 0,
      underperforming_count: value.total_posts - value.goal_hits,
    })),
    by_content_type: Array.from(contentAgg.entries()).map(([key, value]) => ({
      content_type: key,
      total_posts: value.total_posts,
      avg_engagement: value.total_posts ? round(value.total_engagement / value.total_posts) : 0,
      goal_hit_rate: value.total_posts
        ? round((value.goal_hits / value.total_posts) * 100)
        : 0,
    })),
  };

  const trends = [] as Array<{
    platform: string;
    content_type: string;
    metric: string;
    previous_avg: number;
    current_avg: number;
    delta_percent: number;
    trend: 'up' | 'down' | 'flat';
  }>;

  currentAgg.forEach((currentEntry, key) => {
    const [platformKey, contentTypeKey] = key.split('::');
    const previousEntry = previousAgg.get(key);
    (['likes', 'comments', 'shares', 'views', 'engagement_rate'] as const).forEach((metric) => {
      const currentAvg = currentEntry.count
        ? currentEntry.metrics[metric] / currentEntry.count
        : 0;
      const previousAvg = previousEntry && previousEntry.count
        ? previousEntry.metrics[metric] / previousEntry.count
        : 0;
      const deltaPercent =
        previousAvg === 0 ? (currentAvg === 0 ? 0 : 100) : ((currentAvg - previousAvg) / previousAvg) * 100;
      trends.push({
        platform: platformKey,
        content_type: contentTypeKey,
        metric,
        previous_avg: round(previousAvg),
        current_avg: round(currentAvg),
        delta_percent: round(deltaPercent),
        trend: classifyTrend(deltaPercent),
      });
    });
  });

  const anomalies: Array<{
    post_id: string;
    platform: string;
    content_type: string;
    metric: string;
    value: number;
    expected_range: { min: number; max: number };
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }> = [];

  const anomalyBase = new Map<
    string,
    { likes: number; comments: number; shares: number; views: number }
  >();
  currentAgg.forEach((entry, key) => {
    anomalyBase.set(key, {
      likes: entry.count ? entry.metrics.likes / entry.count : 0,
      comments: entry.count ? entry.metrics.comments / entry.count : 0,
      shares: entry.count ? entry.metrics.shares / entry.count : 0,
      views: entry.count ? entry.metrics.views / entry.count : 0,
    });
  });

  perPost.forEach((postEntry, postId) => {
    const key = `${postEntry.platform}::${postEntry.content_type}`;
    const averages = anomalyBase.get(key);
    if (!averages) return;

    (['likes', 'comments', 'shares', 'views'] as const).forEach((metric) => {
      const value = postEntry.metrics[metric];
      const avg = averages[metric] || 0;
      const goalValue = Number((postEntry.goals as any)?.[metric] || 0);
      const exceeds = avg > 0 && value > avg * 2;
      const belowGoal = goalValue > 0 && value < goalValue * 0.5;
      if (!exceeds && !belowGoal) return;

      const severity =
        (avg > 0 && value > avg * 3) || (goalValue > 0 && value < goalValue * 0.25)
          ? 'high'
          : 'medium';
      anomalies.push({
        post_id: postId,
        platform: postEntry.platform,
        content_type: postEntry.content_type,
        metric,
        value: round(value),
        expected_range: { min: round(avg * 0.5), max: round(avg * 2) },
        severity,
        reason: exceeds
          ? 'Metric exceeds 2x platform/content average'
          : 'Metric below 50% of expected goal',
      });
    });
  });

  const recent_content_summary = Array.from(perPost.entries())
    .map(([postId, entry]) => ({
      post_id: postId,
      platform: entry.platform,
      content_type: entry.content_type,
      content: entry.content,
      likes: entry.metrics.likes,
      comments: entry.metrics.comments,
      shares: entry.metrics.shares,
      views: entry.metrics.views,
      date: entry.last_date,
    }))
    .slice(0, 5);

  const brandVoice = await resolveBrandVoice(scope.organizationId);
  const insights = await evaluateInsights({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    platform,
    content_type: contentType,
    kpis,
    trends,
    anomalies,
    brand_voice: brandVoice,
    recent_content_summary,
  });

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    summary_insight: insights.summary_insight,
    key_findings: insights.key_findings,
    recommended_actions: insights.recommended_actions,
    risks: insights.risks,
    confidence_level: insights.confidence_level,
  });
}

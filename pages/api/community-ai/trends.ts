import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';
import { sendCommunityAiWebhooks } from '../../../backend/services/communityAiWebhookService';

type MetricKey = 'likes' | 'comments' | 'shares' | 'views' | 'engagement_rate';

type MetricAggregate = Record<MetricKey, number>;

const metricKeys: MetricKey[] = ['likes', 'comments', 'shares', 'views', 'engagement_rate'];

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
  const contentType = typeof req.query?.content_type === 'string' ? req.query.content_type : null;

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 7);
  const previousStart = new Date(now);
  previousStart.setDate(previousStart.getDate() - 14);
  const previousEnd = new Date(currentStart);

  let query = supabase
    .from('content_analytics')
    .select(
      'scheduled_post_id, platform, content_type, likes, comments, shares, views, engagement_rate, date, scheduled_posts(engagement_goals, users(company_id))'
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
    return res.status(500).json({ error: 'FAILED_TO_LOAD_TRENDS' });
  }

  const currentAgg = new Map<string, { count: number; metrics: MetricAggregate }>();
  const previousAgg = new Map<string, { count: number; metrics: MetricAggregate }>();
  const postAgg = new Map<
    string,
    {
      platform: string;
      content_type: string;
      metrics: MetricAggregate;
      goals: Record<string, number>;
    }
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
      metrics: {
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
        engagement_rate: 0,
      },
    };
    entry.count += 1;
    entry.metrics.likes += Number(row.likes || 0);
    entry.metrics.comments += Number(row.comments || 0);
    entry.metrics.shares += Number(row.shares || 0);
    entry.metrics.views += Number(row.views || 0);
    entry.metrics.engagement_rate += Number(row.engagement_rate || 0);
    bucket.set(key, entry);

    if (isCurrent && row.scheduled_post_id) {
      const postEntry = postAgg.get(row.scheduled_post_id) || {
        platform: row.platform || 'unknown',
        content_type: row.content_type || 'unknown',
        metrics: {
          likes: 0,
          comments: 0,
          shares: 0,
          views: 0,
          engagement_rate: 0,
        },
        goals: row.scheduled_posts?.engagement_goals || {},
      };
      postEntry.metrics.likes += Number(row.likes || 0);
      postEntry.metrics.comments += Number(row.comments || 0);
      postEntry.metrics.shares += Number(row.shares || 0);
      postEntry.metrics.views += Number(row.views || 0);
      postEntry.metrics.engagement_rate += Number(row.engagement_rate || 0);
      postAgg.set(row.scheduled_post_id, postEntry);
    }
  });

  const trends = [] as Array<{
    platform: string;
    content_type: string;
    metric: MetricKey;
    previous_avg: number;
    current_avg: number;
    delta_percent: number;
    trend: 'up' | 'down' | 'flat';
  }>;

  currentAgg.forEach((currentEntry, key) => {
    const [platformKey, contentTypeKey] = key.split('::');
    const previousEntry = previousAgg.get(key);
    metricKeys.forEach((metric) => {
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

  const anomalyBase = new Map<string, MetricAggregate>();
  currentAgg.forEach((entry, key) => {
    const avgMetrics: MetricAggregate = {
      likes: entry.count ? entry.metrics.likes / entry.count : 0,
      comments: entry.count ? entry.metrics.comments / entry.count : 0,
      shares: entry.count ? entry.metrics.shares / entry.count : 0,
      views: entry.count ? entry.metrics.views / entry.count : 0,
      engagement_rate: entry.count ? entry.metrics.engagement_rate / entry.count : 0,
    };
    anomalyBase.set(key, avgMetrics);
  });

  const anomalies: Array<{
    post_id: string;
    platform: string;
    content_type: string;
    metric: MetricKey;
    value: number;
    expected_range: { min: number; max: number };
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }> = [];

  postAgg.forEach((postEntry, postId) => {
    const key = `${postEntry.platform}::${postEntry.content_type}`;
    const averages = anomalyBase.get(key);
    if (!averages) return;

    metricKeys.forEach((metric) => {
      const value = postEntry.metrics[metric];
      const avg = averages[metric] || 0;
      const goalValue =
        metric !== 'views' && metric !== 'engagement_rate'
          ? Number((postEntry.goals as any)?.[metric] || 0)
          : 0;
      const exceeds = avg > 0 && value > avg * 2;
      const belowGoal = goalValue > 0 && value < goalValue * 0.5;
      if (!exceeds && !belowGoal) return;

      const severity: 'high' | 'medium' | 'low' =
        (avg > 0 && value > avg * 3) || (goalValue > 0 && value < goalValue * 0.25)
          ? 'high'
          : 'medium';

      const anomaly = {
        post_id: postId,
        platform: postEntry.platform,
        content_type: postEntry.content_type,
        metric,
        value: round(value),
        expected_range: {
          min: round(avg * 0.5),
          max: round(avg * 2),
        },
        severity,
        reason: exceeds
          ? 'Metric exceeds 2x platform/content average'
          : 'Metric below 50% of expected goal',
      };
      anomalies.push(anomaly);

      if (severity === 'high') {
        void sendCommunityAiWebhooks({
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          event_type: 'anomaly',
          action_id: null,
          message: 'High severity anomaly detected',
          metadata: {
            post_id: postId,
            platform: postEntry.platform,
            content_type: postEntry.content_type,
            metric,
            value: round(value),
            expected_range: {
              min: round(avg * 0.5),
              max: round(avg * 2),
            },
            reason: anomaly.reason,
          },
        });
      }
    });
  });

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    trends,
    anomalies,
  });
}

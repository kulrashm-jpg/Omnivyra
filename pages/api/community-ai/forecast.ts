import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireTenantScope } from './utils';

type ForecastItem = {
  date: string;
  platform: string;
  content_type: string;
  predicted_likes: number;
  predicted_comments: number;
  predicted_shares: number;
  predicted_views: number;
  confidence_level: number;
};

type RiskFlag = {
  platform: string;
  content_type: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
};

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

const clamp = (value: number) => (value < 0 ? 0 : value);

const round = (value: number) => Number(value.toFixed(2));

const computeConfidence = (count: number) => round(Math.min(1, count / 20));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const platform = typeof req.query?.platform === 'string' ? req.query.platform : null;
  const contentType = typeof req.query?.content_type === 'string' ? req.query.content_type : null;
  const horizon = Number(req.query?.horizon_days || 7);
  const horizonDays = Number.isFinite(horizon) && horizon > 0 ? Math.min(30, Math.floor(horizon)) : 7;

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 7);
  const previousStart = new Date(now);
  previousStart.setDate(previousStart.getDate() - 14);
  const lookbackStart = new Date(now);
  lookbackStart.setDate(lookbackStart.getDate() - 60);
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 30);

  let query = supabase
    .from('content_analytics')
    .select(
      'scheduled_post_id, platform, content_type, likes, comments, shares, views, date, scheduled_posts(engagement_goals, users(company_id))'
    )
    .eq('scheduled_posts.users.company_id', scope.organizationId)
    .gte('date', toDateString(lookbackStart));

  if (platform) {
    query = query.eq('platform', platform);
  }
  if (contentType) {
    query = query.eq('content_type', contentType);
  }

  const { data: rows, error } = await query;
  if (error) {
    return res.status(200).json({ forecast: [], risk_flags: [] });
  }

  const groups = new Map<
    string,
    {
      platform: string;
      content_type: string;
      current: { count: number; likes: number; comments: number; shares: number; views: number };
      previous: { count: number; likes: number; comments: number; shares: number; views: number };
      recentCount: number;
    }
  >();

  (rows || []).forEach((row: any) => {
    const dateValue = row.date ? new Date(row.date) : null;
    if (!dateValue) return;
    const isCurrent = dateValue >= currentStart && dateValue < now;
    const isPrevious = dateValue >= previousStart && dateValue < currentStart;
    const isRecent = dateValue >= recentStart && dateValue < now;
    if (!isCurrent && !isPrevious && !isRecent) return;

    const key = `${row.platform || 'unknown'}::${row.content_type || 'unknown'}`;
    const entry = groups.get(key) || {
      platform: row.platform || 'unknown',
      content_type: row.content_type || 'unknown',
      current: { count: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      previous: { count: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      recentCount: 0,
    };

    if (isCurrent) {
      entry.current.count += 1;
      entry.current.likes += Number(row.likes || 0);
      entry.current.comments += Number(row.comments || 0);
      entry.current.shares += Number(row.shares || 0);
      entry.current.views += Number(row.views || 0);
    }
    if (isPrevious) {
      entry.previous.count += 1;
      entry.previous.likes += Number(row.likes || 0);
      entry.previous.comments += Number(row.comments || 0);
      entry.previous.shares += Number(row.shares || 0);
      entry.previous.views += Number(row.views || 0);
    }
    if (isRecent) {
      entry.recentCount += 1;
    }

    groups.set(key, entry);
  });

  const forecast: ForecastItem[] = [];
  const risk_flags: RiskFlag[] = [];

  groups.forEach((entry) => {
    const currentAvg = {
      likes: entry.current.count ? entry.current.likes / entry.current.count : 0,
      comments: entry.current.count ? entry.current.comments / entry.current.count : 0,
      shares: entry.current.count ? entry.current.shares / entry.current.count : 0,
      views: entry.current.count ? entry.current.views / entry.current.count : 0,
    };
    const previousAvg = {
      likes: entry.previous.count ? entry.previous.likes / entry.previous.count : 0,
      comments: entry.previous.count ? entry.previous.comments / entry.previous.count : 0,
      shares: entry.previous.count ? entry.previous.shares / entry.previous.count : 0,
      views: entry.previous.count ? entry.previous.views / entry.previous.count : 0,
    };

    const slope = {
      likes: (currentAvg.likes - previousAvg.likes) / 7,
      comments: (currentAvg.comments - previousAvg.comments) / 7,
      shares: (currentAvg.shares - previousAvg.shares) / 7,
      views: (currentAvg.views - previousAvg.views) / 7,
    };

    const confidence = computeConfidence(entry.recentCount);
    const currentTotal =
      currentAvg.likes + currentAvg.comments + currentAvg.shares + currentAvg.views;
    const predictedTotal =
      clamp(currentAvg.likes + slope.likes * horizonDays) +
      clamp(currentAvg.comments + slope.comments * horizonDays) +
      clamp(currentAvg.shares + slope.shares * horizonDays) +
      clamp(currentAvg.views + slope.views * horizonDays);

    if (currentTotal > 0) {
      const dropPercent = (currentTotal - predictedTotal) / currentTotal;
      if (dropPercent > 0.4) {
        risk_flags.push({
          platform: entry.platform,
          content_type: entry.content_type,
          reason: 'Forecasted engagement drop > 40%',
          severity: 'high',
        });
      } else if (dropPercent > 0.2) {
        risk_flags.push({
          platform: entry.platform,
          content_type: entry.content_type,
          reason: 'Forecasted engagement drop > 20%',
          severity: 'medium',
        });
      }
    }

    for (let i = 1; i <= horizonDays; i += 1) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      forecast.push({
        date: toDateString(date),
        platform: entry.platform,
        content_type: entry.content_type,
        predicted_likes: round(clamp(currentAvg.likes + slope.likes * i)),
        predicted_comments: round(clamp(currentAvg.comments + slope.comments * i)),
        predicted_shares: round(clamp(currentAvg.shares + slope.shares * i)),
        predicted_views: round(clamp(currentAvg.views + slope.views * i)),
        confidence_level: confidence,
      });
    }
  });

  return res.status(200).json({ forecast, risk_flags });
}

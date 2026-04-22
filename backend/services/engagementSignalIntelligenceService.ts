import { supabase } from '../db/supabaseClient';

export type EngagementMetricType = 'likes' | 'comments' | 'shares' | 'impressions' | 'clicks';
export type EngagementSignalConfidence = 'high' | 'low_confidence';

export interface NormalizedEngagementSignal {
  platform: string;
  content_id: string;
  campaign_id: string | null;
  metric_type: EngagementMetricType;
  value: number;
  timestamp: string;
}

export interface EngagementTrendPoint {
  date: string;
  total_engagement: number;
  impressions: number;
  clicks: number;
}

export interface EngagementTopPost {
  content_id: string;
  campaign_id: string | null;
  platform: string;
  title: string;
  timestamp: string;
  engagement_total: number;
  impressions: number;
  clicks: number;
}

export interface EngagementPlatformComparison {
  platform: string;
  engagement_total: number;
  impressions: number;
  clicks: number;
  posts: number;
}

export interface EngagementSignalsDashboardData {
  label: 'Social Engagement (Not Traffic Data)';
  confidence: EngagementSignalConfidence;
  warnings: string[];
  signals: NormalizedEngagementSignal[];
  top_performing_posts: EngagementTopPost[];
  engagement_trends: EngagementTrendPoint[];
  platform_comparison: EngagementPlatformComparison[];
}

type ContentAnalyticsRow = {
  platform: string | null;
  analytics_date?: string | null;
  date?: string | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  impressions?: number | null;
  views?: number | null;
  platform_metrics?: Record<string, unknown> | null;
  scheduled_post_id?: string | null;
  scheduled_posts?: {
    id?: string | null;
    company_id?: string | null;
    campaign_id?: string | null;
    content?: string | null;
    published_at?: string | null;
    created_at?: string | null;
  } | null;
};

const ENGAGEMENT_LABEL: EngagementSignalsDashboardData['label'] = 'Social Engagement (Not Traffic Data)';

function coerceNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeMetricValue(row: ContentAnalyticsRow, metricType: EngagementMetricType): number {
  const rawMetrics = row.platform_metrics ?? {};

  if (metricType === 'likes') return coerceNumber(row.likes);
  if (metricType === 'comments') return coerceNumber(row.comments);
  if (metricType === 'shares') return coerceNumber(row.shares);
  if (metricType === 'impressions') return Math.max(coerceNumber(row.impressions), coerceNumber(row.views));

  return Math.max(
    coerceNumber(rawMetrics.clicks),
    coerceNumber(rawMetrics.link_clicks),
    coerceNumber(rawMetrics.post_clicks),
    coerceNumber(rawMetrics.outbound_click),
    coerceNumber(rawMetrics.outbound_clicks),
  );
}

function resolveSignalTimestamp(row: ContentAnalyticsRow): string | null {
  return row.analytics_date
    ?? row.date
    ?? row.scheduled_posts?.published_at
    ?? row.scheduled_posts?.created_at
    ?? null;
}

function normalizePostTitle(value: string | null | undefined): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled post';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function buildSignals(rows: ContentAnalyticsRow[]): {
  signals: NormalizedEngagementSignal[];
  warnings: string[];
  confidence: EngagementSignalConfidence;
  topPosts: EngagementTopPost[];
  trends: EngagementTrendPoint[];
  platformComparison: EngagementPlatformComparison[];
} {
  const signals: NormalizedEngagementSignal[] = [];
  const warnings: string[] = [];
  const trendMap = new Map<string, EngagementTrendPoint>();
  const platformMap = new Map<string, EngagementPlatformComparison>();
  const topPostMap = new Map<string, EngagementTopPost>();

  let lowConfidenceRows = 0;

  for (const row of rows) {
    const timestamp = resolveSignalTimestamp(row);
    const contentId = String(row.scheduled_post_id ?? row.scheduled_posts?.id ?? '').trim();
    const platform = String(row.platform ?? '').trim().toLowerCase();

    if (!timestamp || !contentId || !platform) {
      lowConfidenceRows += 1;
      continue;
    }

    const likes = normalizeMetricValue(row, 'likes');
    const comments = normalizeMetricValue(row, 'comments');
    const shares = normalizeMetricValue(row, 'shares');
    const impressions = normalizeMetricValue(row, 'impressions');
    const clicks = normalizeMetricValue(row, 'clicks');
    const engagementTotal = likes + comments + shares + clicks;

    if (engagementTotal === 0 && impressions === 0) {
      lowConfidenceRows += 1;
      continue;
    }

    const dateKey = timestamp.slice(0, 10);
    const metrics: Array<[EngagementMetricType, number]> = [
      ['likes', likes],
      ['comments', comments],
      ['shares', shares],
      ['impressions', impressions],
      ['clicks', clicks],
    ];

    for (const [metricType, value] of metrics) {
      if (value <= 0) continue;
      signals.push({
        platform,
        content_id: contentId,
        campaign_id: row.scheduled_posts?.campaign_id ?? null,
        metric_type: metricType,
        value,
        timestamp,
      });
    }

    const currentTrend = trendMap.get(dateKey) ?? {
      date: dateKey,
      total_engagement: 0,
      impressions: 0,
      clicks: 0,
    };
    currentTrend.total_engagement += engagementTotal;
    currentTrend.impressions += impressions;
    currentTrend.clicks += clicks;
    trendMap.set(dateKey, currentTrend);

    const currentPlatform = platformMap.get(platform) ?? {
      platform,
      engagement_total: 0,
      impressions: 0,
      clicks: 0,
      posts: 0,
    };
    currentPlatform.engagement_total += engagementTotal;
    currentPlatform.impressions += impressions;
    currentPlatform.clicks += clicks;
    currentPlatform.posts += 1;
    platformMap.set(platform, currentPlatform);

    topPostMap.set(contentId, {
      content_id: contentId,
      campaign_id: row.scheduled_posts?.campaign_id ?? null,
      platform,
      title: normalizePostTitle(row.scheduled_posts?.content),
      timestamp,
      engagement_total: engagementTotal,
      impressions,
      clicks,
    });
  }

  if (lowConfidenceRows > 0) {
    warnings.push('Some social engagement rows were excluded because the data was incomplete or unreliable.');
  }

  if (signals.length === 0) {
    warnings.push('No reliable social engagement signals are available.');
  }

  const confidence: EngagementSignalConfidence = signals.length === 0 || lowConfidenceRows > rows.length / 2
    ? 'low_confidence'
    : 'high';

  return {
    signals,
    warnings,
    confidence,
    topPosts: Array.from(topPostMap.values())
      .sort((a, b) => {
        if (b.engagement_total !== a.engagement_total) return b.engagement_total - a.engagement_total;
        return b.impressions - a.impressions;
      })
      .slice(0, 5),
    trends: Array.from(trendMap.values())
      .sort((a, b) => a.date.localeCompare(b.date)),
    platformComparison: Array.from(platformMap.values())
      .sort((a, b) => {
        if (b.engagement_total !== a.engagement_total) return b.engagement_total - a.engagement_total;
        return b.impressions - a.impressions;
      }),
  };
}

export async function getEngagementSignalsDashboardData(
  companyId: string,
  days: number = 30,
): Promise<EngagementSignalsDashboardData> {
  if (!companyId) {
    return {
      label: ENGAGEMENT_LABEL,
      confidence: 'low_confidence',
      warnings: ['Company context is required to load social engagement signals.'],
      signals: [],
      top_performing_posts: [],
      engagement_trends: [],
      platform_comparison: [],
    };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('content_analytics')
    .select(`
      platform,
      analytics_date,
      date,
      likes,
      comments,
      shares,
      impressions,
      views,
      platform_metrics,
      scheduled_post_id,
      scheduled_posts!inner (
        id,
        company_id,
        campaign_id,
        content,
        published_at,
        created_at
      )
    `)
    .eq('scheduled_posts.company_id', companyId)
    .gte('analytics_date', since)
    .order('analytics_date', { ascending: false })
    .limit(250);

  if (error) {
    console.warn('[engagementSignalIntelligence] failed to load content analytics:', error.message);
    return {
      label: ENGAGEMENT_LABEL,
      confidence: 'low_confidence',
      warnings: ['Social engagement data could not be loaded.'],
      signals: [],
      top_performing_posts: [],
      engagement_trends: [],
      platform_comparison: [],
    };
  }

  const built = buildSignals((data ?? []) as ContentAnalyticsRow[]);
  return {
    label: ENGAGEMENT_LABEL,
    confidence: built.confidence,
    warnings: built.warnings,
    signals: built.signals,
    top_performing_posts: built.topPosts,
    engagement_trends: built.trends,
    platform_comparison: built.platformComparison,
  };
}

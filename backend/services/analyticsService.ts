import { listPerformanceMetrics, saveAnalyticsReport } from '../db/performanceStore';

const safeNumber = (value: any): number => (typeof value === 'number' ? value : 0);

const computeEngagement = (metrics: any): number =>
  safeNumber(metrics.likes) + safeNumber(metrics.comments) + safeNumber(metrics.shares);

export async function computeAnalytics(input: {
  companyId: string;
  campaignId?: string;
  timeframe?: string;
}): Promise<{
  engagementRate: number;
  bestPlatforms: string[];
  bestContentTypes: string[];
  bestTimes: string[];
  trendSuccess: Array<{ trend: string; score: number }>;
  underperformingAssets: string[];
  topAssets: string[];
}> {
  const metrics = await listPerformanceMetrics({ campaignId: input.campaignId });
  if (metrics.length === 0) {
    return {
      engagementRate: 0,
      bestPlatforms: [],
      bestContentTypes: [],
      bestTimes: [],
      trendSuccess: [],
      underperformingAssets: [],
      topAssets: [],
    };
  }

  const platformScores: Record<string, number[]> = {};
  const contentScores: Record<string, number[]> = {};
  const timeScores: Record<string, number[]> = {};
  const trendScores: Record<string, number[]> = {};
  const assetScores: Record<string, number> = {};
  let totalEngagement = 0;
  let totalReach = 0;

  metrics.forEach((entry) => {
    const payload = entry.metrics_json || {};
    const engagement = computeEngagement(payload);
    const reach = safeNumber(payload.reach) || safeNumber(payload.impressions) || 0;
    totalEngagement += engagement;
    totalReach += reach;

    const platform = entry.platform || 'unknown';
    platformScores[platform] = platformScores[platform] || [];
    platformScores[platform].push(reach > 0 ? engagement / reach : 0);

    const contentType = payload.contentType || payload.content_type || 'unknown';
    contentScores[contentType] = contentScores[contentType] || [];
    contentScores[contentType].push(reach > 0 ? engagement / reach : 0);

    const time = payload.scheduled_time || payload.time || '';
    if (time) {
      timeScores[time] = timeScores[time] || [];
      timeScores[time].push(reach > 0 ? engagement / reach : 0);
    }

    const trend = payload.trend || payload.trendUsed;
    if (trend) {
      trendScores[trend] = trendScores[trend] || [];
      trendScores[trend].push(reach > 0 ? engagement / reach : 0);
    }

    assetScores[entry.content_asset_id] = (assetScores[entry.content_asset_id] || 0) + engagement;
  });

  const engagementRate = totalReach > 0 ? Number((totalEngagement / totalReach).toFixed(3)) : 0;
  const sortByAvg = (scores: Record<string, number[]>) =>
    Object.entries(scores)
      .map(([key, values]) => ({
        key,
        score: values.reduce((sum, v) => sum + v, 0) / values.length,
      }))
      .sort((a, b) => b.score - a.score);

  const bestPlatforms = sortByAvg(platformScores).slice(0, 3).map((item) => item.key);
  const bestContentTypes = sortByAvg(contentScores).slice(0, 3).map((item) => item.key);
  const bestTimes = sortByAvg(timeScores).slice(0, 3).map((item) => item.key);
  const trendSuccess = sortByAvg(trendScores).map((item) => ({ trend: item.key, score: Number(item.score.toFixed(3)) }));

  const sortedAssets = Object.entries(assetScores).sort((a, b) => b[1] - a[1]);
  const topAssets = sortedAssets.slice(0, 3).map((entry) => entry[0]);
  const underperformingAssets = sortedAssets.slice(-3).map((entry) => entry[0]);

  const report = {
    engagementRate,
    bestPlatforms,
    bestContentTypes,
    bestTimes,
    trendSuccess,
    underperformingAssets,
    topAssets,
  };

  await saveAnalyticsReport({ companyId: input.companyId, campaignId: input.campaignId, report });
  console.log('ANALYTICS COMPUTED', { companyId: input.companyId, campaignId: input.campaignId });
  return report;
}
/**
 * Analytics Service
 * 
 * Tracks and aggregates engagement metrics for scheduled posts.
 * Integrates with platform APIs to fetch analytics data.
 * 
 * Features:
 * - Post engagement tracking
 * - Platform performance summaries
 * - Hashtag performance analysis
 * - Best performing content identification
 */

import { supabase } from '../db/supabaseClient';

export interface EngagementMetrics {
  views: number;
  likes: number;
  shares: number;
  comments: number;
  saves?: number;
  retweets?: number;
  quotes?: number;
  reactions?: number;
}

export interface PostAnalytics {
  scheduled_post_id: string;
  platform: string;
  analytics_date: Date;
  metrics: EngagementMetrics;
  engagement_rate: number;
  reach?: number;
  impressions?: number;
  platform_metrics?: Record<string, any>;
}

export interface PlatformPerformance {
  platform: string;
  date: Date;
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_shares: number;
  total_comments: number;
  avg_engagement_rate: number;
  best_post_id?: string;
  best_post_engagement?: number;
}

/**
 * Record analytics for a published post
 */
export async function recordPostAnalytics(
  scheduledPostId: string,
  userId: string,
  platform: string,
  metrics: EngagementMetrics,
  options: {
    reach?: number;
    impressions?: number;
    platform_metrics?: Record<string, any>;
  } = {}
): Promise<void> {
  // Calculate engagement rate
  const totalEngagement = 
    metrics.likes + 
    metrics.shares + 
    metrics.comments + 
    (metrics.saves || 0) + 
    (metrics.retweets || 0) + 
    (metrics.reactions || 0);
  
  const engagementRate = options.reach && options.reach > 0
    ? (totalEngagement / options.reach) * 100
    : 0;

  const analyticsDate = new Date().toISOString().split('T')[0];

  // Insert or update analytics record
  const { error } = await supabase
    .from('content_analytics')
    .upsert({
      scheduled_post_id: scheduledPostId,
      user_id: userId,
      platform,
      analytics_date: analyticsDate,
      views: metrics.views || 0,
      likes: metrics.likes || 0,
      shares: metrics.shares || 0,
      comments: metrics.comments || 0,
      saves: metrics.saves || 0,
      retweets: metrics.retweets || 0,
      quotes: metrics.quotes || 0,
      reactions: metrics.reactions || 0,
      engagement_rate: engagementRate,
      reach: options.reach || 0,
      impressions: options.impressions || 0,
      platform_metrics: options.platform_metrics || {},
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'scheduled_post_id,analytics_date',
    });

  if (error) {
    console.error('Failed to record analytics:', error);
    throw new Error(`Failed to record analytics: ${error.message}`);
  }

  // Update platform performance summary
  await updatePlatformPerformance(userId, platform, analyticsDate);
}

/**
 * Get analytics for a specific post
 */
export async function getPostAnalytics(
  scheduledPostId: string,
  startDate?: Date,
  endDate?: Date
): Promise<PostAnalytics[]> {
  let query = supabase
    .from('content_analytics')
    .select('*')
    .eq('scheduled_post_id', scheduledPostId)
    .order('analytics_date', { ascending: false });

  if (startDate) {
    query = query.gte('analytics_date', startDate.toISOString().split('T')[0]);
  }

  if (endDate) {
    query = query.lte('analytics_date', endDate.toISOString().split('T')[0]);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch analytics: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    scheduled_post_id: row.scheduled_post_id,
    platform: row.platform,
    analytics_date: new Date(row.analytics_date),
    metrics: {
      views: row.views || 0,
      likes: row.likes || 0,
      shares: row.shares || 0,
      comments: row.comments || 0,
      saves: row.saves || 0,
      retweets: row.retweets || 0,
      quotes: row.quotes || 0,
      reactions: row.reactions || 0,
    },
    engagement_rate: row.engagement_rate || 0,
    reach: row.reach,
    impressions: row.impressions,
    platform_metrics: row.platform_metrics,
  }));
}

/**
 * Get platform performance summary
 */
export async function getPlatformPerformance(
  userId: string,
  platform: string,
  startDate: Date,
  endDate: Date
): Promise<PlatformPerformance[]> {
  const { data, error } = await supabase
    .from('platform_performance')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', platform)
    .gte('date', startDate.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0])
    .order('date', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch platform performance: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    platform: row.platform,
    date: new Date(row.date),
    total_posts: row.total_posts || 0,
    total_views: row.total_views || 0,
    total_likes: row.total_likes || 0,
    total_shares: row.total_shares || 0,
    total_comments: row.total_comments || 0,
    avg_engagement_rate: row.avg_engagement_rate || 0,
    best_post_id: row.best_post_id,
    best_post_engagement: row.best_post_engagement || 0,
  }));
}

/**
 * Update platform performance summary (called after analytics updates)
 */
async function updatePlatformPerformance(
  userId: string,
  platform: string,
  date: string
): Promise<void> {
  // Get all posts for this platform on this date
  const { data: analytics } = await supabase
    .from('content_analytics')
    .select('scheduled_post_id, engagement_rate, views, likes, shares, comments')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('analytics_date', date);

  if (!analytics || analytics.length === 0) return;

  // Aggregate metrics
  const totalPosts = analytics.length;
  const totalViews = analytics.reduce((sum, a) => sum + (a.views || 0), 0);
  const totalLikes = analytics.reduce((sum, a) => sum + (a.likes || 0), 0);
  const totalShares = analytics.reduce((sum, a) => sum + (a.shares || 0), 0);
  const totalComments = analytics.reduce((sum, a) => sum + (a.comments || 0), 0);
  const avgEngagementRate = analytics.reduce((sum, a) => sum + (a.engagement_rate || 0), 0) / totalPosts;

  // Find best performing post
  const bestPost = analytics.reduce((best, current) => 
    (current.engagement_rate || 0) > (best.engagement_rate || 0) ? current : best
  );

  // Upsert platform performance
  await supabase
    .from('platform_performance')
    .upsert({
      user_id: userId,
      platform,
      date,
      total_posts: totalPosts,
      total_views: totalViews,
      total_likes: totalLikes,
      total_shares: totalShares,
      total_comments: totalComments,
      avg_engagement_rate: avgEngagementRate,
      best_post_id: bestPost.scheduled_post_id,
      best_post_engagement: bestPost.engagement_rate || 0,
    }, {
      onConflict: 'user_id,platform,date',
    });
}

/**
 * Get hashtag performance analysis
 */
export async function getHashtagPerformance(
  userId: string,
  hashtag: string,
  startDate: Date,
  endDate: Date
): Promise<any> {
  // This would require joining scheduled_posts with content_analytics
  // Implementation depends on hashtag_performance table structure
  const { data, error } = await supabase
    .from('hashtag_performance')
    .select('*')
    .eq('user_id', userId)
    .eq('hashtag', hashtag)
    .gte('date', startDate.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0])
    .order('date', { ascending: false });

  if (error) {
    console.warn('Hashtag performance not available:', error.message);
    return [];
  }

  return data || [];
}


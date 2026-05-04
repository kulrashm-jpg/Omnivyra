import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../backend/services/requestAccessService';

const toNumber = (value: any): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const computeEngagement = (row: any): number =>
  toNumber(row.likes) +
  toNumber(row.comments) +
  toNumber(row.shares) +
  toNumber(row.saves) +
  toNumber(row.retweets) +
  toNumber(row.quotes) +
  toNumber(row.reactions);

const computeReach = (row: any): number => {
  const reach = toNumber(row.reach);
  if (reach > 0) return reach;
  return toNumber(row.impressions);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'analytics:all-orgs');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/analytics-summary', 'analytics:all-orgs');
  }

  try {
    const { data, error } = await supabase
      .from('content_analytics')
      .select(
        'scheduled_post_id, platform, likes, comments, shares, saves, retweets, quotes, reactions, reach, impressions, engagement_rate'
      );

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LOAD_ANALYTICS' });
    }

    const rows = data || [];
    const perPost = new Map<
      string,
      {
        platform: string;
        engagement: number;
        reach: number;
        engagementRateSum: number;
        engagementRateCount: number;
      }
    >();

    rows.forEach((row: any, index: number) => {
      const postKey = row.scheduled_post_id ? String(row.scheduled_post_id) : `row-${index}`;
      const existing = perPost.get(postKey) || {
        platform: row.platform || 'unknown',
        engagement: 0,
        reach: 0,
        engagementRateSum: 0,
        engagementRateCount: 0,
      };
      existing.engagement += computeEngagement(row);
      existing.reach += computeReach(row);
      const rate = toNumber(row.engagement_rate);
      if (rate > 0) {
        existing.engagementRateSum += rate;
        existing.engagementRateCount += 1;
      }
      perPost.set(postKey, existing);
    });

    let totalPosts = 0;
    let totalEngagement = 0;
    let totalReach = 0;
    let totalRateSum = 0;
    let totalRateCount = 0;

    const platformAgg = new Map<
      string,
      {
        total_posts: number;
        total_engagement: number;
        total_reach: number;
        rateSum: number;
        rateCount: number;
      }
    >();

    perPost.forEach((post) => {
      totalPosts += 1;
      totalEngagement += post.engagement;
      totalReach += post.reach;
      if (post.engagementRateCount > 0) {
        totalRateSum += post.engagementRateSum / post.engagementRateCount;
        totalRateCount += 1;
      }

      const platformKey = post.platform || 'unknown';
      const bucket = platformAgg.get(platformKey) || {
        total_posts: 0,
        total_engagement: 0,
        total_reach: 0,
        rateSum: 0,
        rateCount: 0,
      };
      bucket.total_posts += 1;
      bucket.total_engagement += post.engagement;
      bucket.total_reach += post.reach;
      if (post.engagementRateCount > 0) {
        bucket.rateSum += post.engagementRateSum / post.engagementRateCount;
        bucket.rateCount += 1;
      }
      platformAgg.set(platformKey, bucket);
    });

    const platforms = Array.from(platformAgg.entries())
      .map(([platform, value]) => ({
        platform,
        total_posts: value.total_posts,
        total_engagement: value.total_engagement,
        total_reach: value.total_reach,
        avg_engagement_rate: value.rateCount ? value.rateSum / value.rateCount : 0,
      }))
      .sort((a, b) => b.total_engagement - a.total_engagement);

    return res.status(200).json({
      total_posts: totalPosts,
      total_engagement: totalEngagement,
      total_reach: totalReach,
      avg_engagement_rate: totalRateCount ? totalRateSum / totalRateCount : 0,
      platforms,
    });
  } catch (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_ANALYTICS' });
  }
}

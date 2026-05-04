/**
 * Analytics Ingestion Job
 *
 * Two entry points:
 *  1. runDailyGrowthIngestion()  — called by cron at 02:00 UTC daily
 *     Fetches follower/impression growth snapshots for every active social account.
 *
 *  2. runPendingPostPolls()      — called by analyticsIngestionProcessor
 *     Processes post_analytics_polls rows whose poll_after <= now().
 *
 * Both are idempotent: upserts on unique indexes prevent duplicate rows.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getToken } from '../auth/tokenStore';
import {
  ingestLinkedInPost, ingestLinkedInGrowth,
  ingestInstagramPost, ingestInstagramGrowth,
  ingestTwitterPost, ingestTwitterGrowth,
  ingestYouTubePost, ingestYouTubeGrowth,
  ingestTikTokPost, ingestTikTokGrowth,
  ingestThreadsPost, ingestThreadsGrowth,
  ingestPinterestPost, ingestPinterestGrowth,
  ingestFacebookPost, ingestFacebookGrowth,
} from '../services/platformAnalyticsIngester';
import {
  upsertPostAnalytics,
  upsertGrowthSnapshot,
  markPollDone,
  markPollFailed,
} from '../services/analyticsNormalizationService';
import { getLatestSnapshotsPerPlatform } from '../db/platformMetricsSnapshotStore';

const SUPPORTED_GROWTH_PLATFORMS = [
  'linkedin', 'facebook', 'instagram', 'twitter', 'x', 'youtube', 'tiktok', 'threads', 'pinterest',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Daily growth ingestion
// ─────────────────────────────────────────────────────────────────────────────

export async function runDailyGrowthIngestion(): Promise<void> {
  console.info('[analyticsIngestion] Starting daily growth ingestion');

  // Fetch all active social accounts for supported platforms
  const { data: accounts, error } = await supabase
    .from('social_accounts')
    .select('id, company_id, platform, platform_user_id, user_id')
    .eq('is_active', true)
    .in('platform', SUPPORTED_GROWTH_PLATFORMS);

  if (error || !accounts?.length) {
    console.info('[analyticsIngestion] No active accounts found or query failed');
    return;
  }

  for (const account of accounts) {
    try {
      const token = await getToken(account.id);
      if (!token?.access_token) continue;

      const accessToken = token.access_token;
      const platform    = account.platform as string;
      const companyId   = String(account.company_id);

      // Get previous follower count for delta calculation
      const snapshots       = await getLatestSnapshotsPerPlatform(companyId);
      const prev            = snapshots.find((s) => s.platform === platform);
      const previousFollowers = prev?.followers ?? 0;

      let growth: Partial<import('../services/platformAnalyticsIngester').AccountGrowthMetrics> = {};

      if (platform === 'linkedin') {
        growth = await ingestLinkedInGrowth(accessToken, previousFollowers);
      } else if (platform === 'instagram') {
        growth = await ingestInstagramGrowth(account.platform_user_id, accessToken, previousFollowers);
      } else if (platform === 'twitter' || platform === 'x') {
        growth = await ingestTwitterGrowth(account.platform_user_id, accessToken, previousFollowers);
      } else if (platform === 'youtube') {
        growth = await ingestYouTubeGrowth(account.platform_user_id, accessToken, previousFollowers);
      } else if (platform === 'tiktok') {
        growth = await ingestTikTokGrowth(accessToken, previousFollowers);
      } else if (platform === 'threads') {
        growth = await ingestThreadsGrowth(accessToken, previousFollowers);
      } else if (platform === 'facebook') {
        growth = await ingestFacebookGrowth(account.platform_user_id, accessToken, previousFollowers);
      } else if (platform === 'pinterest') {
        growth = await ingestPinterestGrowth(accessToken, previousFollowers);
      }

      if (Object.keys(growth).length > 0) {
        await upsertGrowthSnapshot({
          company_id:        companyId,
          social_account_id: account.id,
          platform,
          growth,
        });
      }
    } catch (e: any) {
      console.warn(`[analyticsIngestion] growth failed for account ${account.id}:`, e?.message);
    }
  }

  console.info('[analyticsIngestion] Daily growth ingestion complete');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pending post polls
// ─────────────────────────────────────────────────────────────────────────────

const POST_INGESTERS: Record<string, (postId: string, token: string) => Promise<any>> = {
  linkedin:  ingestLinkedInPost,
  instagram: ingestInstagramPost,
  twitter:   ingestTwitterPost,
  x:         ingestTwitterPost,
  youtube:   ingestYouTubePost,
  tiktok:    ingestTikTokPost,
  threads:   ingestThreadsPost,
  pinterest: ingestPinterestPost,
  facebook:  ingestFacebookPost,
};

export async function runPendingPostPolls(batchSize = 50): Promise<void> {
  const now = new Date().toISOString();

  const { data: polls, error } = await supabase
    .from('post_analytics_polls')
    .select('id, scheduled_post_id, social_account_id, platform, platform_post_id, company_id, user_id, attempts')
    .eq('status', 'pending')
    .lte('poll_after', now)
    .order('poll_after', { ascending: true })
    .limit(batchSize);

  if (error || !polls?.length) return;

  for (const poll of polls) {
    const attempts = (poll.attempts ?? 0) + 1;
    try {
      const platform = poll.platform as string;
      const ingester = POST_INGESTERS[platform];

      if (!ingester) {
        // WhatsApp and unsupported platforms — mark done, no API polling needed
        await markPollDone(poll.id);
        continue;
      }

      const accountId = poll.social_account_id;
      if (!accountId) {
        await markPollDone(poll.id);
        continue;
      }

      const token = await getToken(accountId);
      if (!token?.access_token) {
        await markPollFailed(poll.id, attempts);
        continue;
      }

      const raw = await ingester(poll.platform_post_id, token.access_token);

      const analyticsDate = new Date().toISOString().split('T')[0];
      await upsertPostAnalytics({
        scheduled_post_id: poll.scheduled_post_id,
        user_id:           poll.user_id ?? undefined,
        platform,
        analytics_date:    analyticsDate,
        metrics: {
          platform_post_id: poll.platform_post_id,
          likes:       raw.likes       ?? 0,
          comments:    raw.comments    ?? 0,
          shares:      raw.shares      ?? 0,
          views:       raw.views       ?? 0,
          saves:       raw.saves       ?? 0,
          reactions:   raw.reactions   ?? 0,
          reach:       raw.reach       ?? 0,
          impressions: raw.impressions ?? 0,
          raw:         raw.raw         ?? {},
        },
      });

      await markPollDone(poll.id);
    } catch (e: any) {
      console.warn(`[analyticsIngestion] poll ${poll.id} failed (attempt ${attempts}):`, e?.message);
      await markPollFailed(poll.id, attempts);
    }
  }
}

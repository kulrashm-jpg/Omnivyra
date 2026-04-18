/**
 * Platform Analytics Ingester
 *
 * Fetches post-level engagement metrics from each platform API.
 * Called by analyticsIngestionProcessor for each social account.
 *
 * Returns a normalized IngestionResult that analyticsNormalizationService
 * maps into content_analytics rows.
 *
 * Platform coverage:
 *  - LinkedIn  : Share statistics via UGC API
 *  - Facebook  : Insights edge on published post
 *  - Instagram : Media insights edge
 *  - Twitter/X : Tweet lookup v2 with public_metrics
 *  - YouTube   : Videos.list statistics
 *  - TikTok    : /v2/video/list/ video_id stats
 *  - Pinterest : Pin analytics endpoint
 *  - Threads   : GET /{post-id}/insights
 *  - WhatsApp  : Passthrough — metrics come from webhook delivery events
 */

import { fetchJsonWithBearer } from './platformAdapters/baseAdapter';

export interface RawPostMetrics {
  platform_post_id: string;
  likes:            number;
  comments:         number;
  shares:           number;
  views:            number;
  saves:            number;
  reactions:        number;
  reach:            number;
  impressions:      number;
  /** Extra platform-specific fields stored in raw_metrics JSONB */
  raw:              Record<string, unknown>;
}

export interface AccountGrowthMetrics {
  followers:     number;
  following:     number;
  follower_gain: number; // delta vs previous snapshot (0 if first snapshot)
  impressions:   number;
  reach:         number;
  raw:           Record<string, unknown>;
}

/** Full result of one ingest run for a single social account + post */
export interface PostIngestionResult {
  scheduled_post_id: string;
  social_account_id: string;
  platform:          string;
  platform_post_id:  string;
  metrics:           RawPostMetrics;
}

export interface AccountIngestionResult {
  social_account_id: string;
  company_id:        string;
  platform:          string;
  growth:            AccountGrowthMetrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestLinkedInPost(
  platformPostId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const shareUrn = encodeURIComponent(platformPostId);
    const data = await fetchJsonWithBearer(
      `https://api.linkedin.com/v2/socialActions/${shareUrn}`,
      accessToken,
      { extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' } },
    );
    const likes     = data?.likesSummary?.totalLikes ?? 0;
    const comments  = data?.commentsSummary?.totalFirstLevelComments ?? 0;
    const shares    = data?.shareStatistics?.shareCount ?? 0;
    return { likes, comments, shares, views: 0, raw: data ?? {} };
  } catch {
    return {};
  }
}

export async function ingestLinkedInGrowth(
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const me = await fetchJsonWithBearer(
      'https://api.linkedin.com/v2/networkSizes/urn:li:person:~?edgeType=CompanyFollowedByMember',
      accessToken,
    );
    const followers = me?.firstDegreeSize ?? 0;
    return { followers, follower_gain: followers - previousFollowers, raw: me ?? {} };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestInstagramPost(
  platformPostId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const metrics = 'impressions,reach,likes_count,comments_count,saved,shares';
    const data = await fetchJsonWithBearer(
      `https://graph.instagram.com/${platformPostId}/insights?metric=${metrics}&period=lifetime&access_token=${accessToken}`,
      accessToken,
    );
    const byName = (name: string) =>
      (data?.data ?? []).find((m: any) => m.name === name)?.values?.[0]?.value ?? 0;
    return {
      impressions: byName('impressions'),
      reach:       byName('reach'),
      likes:       byName('likes_count'),
      comments:    byName('comments_count'),
      saves:       byName('saved'),
      shares:      byName('shares'),
      raw:         data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestInstagramGrowth(
  igUserId: string,
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://graph.instagram.com/${igUserId}?fields=followers_count,following_count&access_token=${accessToken}`,
      accessToken,
    );
    const followers = data?.followers_count ?? 0;
    return {
      followers,
      following:     data?.following_count ?? 0,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Twitter / X
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestTwitterPost(
  tweetId: string,
  bearerToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`,
      bearerToken,
    );
    const pm = data?.data?.public_metrics ?? {};
    const om = data?.data?.organic_metrics ?? {};
    return {
      likes:       pm.like_count     ?? 0,
      shares:      pm.retweet_count  ?? 0,
      comments:    pm.reply_count    ?? 0,
      views:       om.impression_count ?? pm.impression_count ?? 0,
      impressions: om.impression_count ?? pm.impression_count ?? 0,
      raw:         data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestTwitterGrowth(
  userId: string,
  bearerToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://api.twitter.com/2/users/${userId}?user.fields=public_metrics`,
      bearerToken,
    );
    const pm = data?.data?.public_metrics ?? {};
    const followers = pm.followers_count ?? 0;
    return {
      followers,
      following:     pm.following_count ?? 0,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestYouTubePost(
  videoId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`,
      accessToken,
    );
    const stats = data?.items?.[0]?.statistics ?? {};
    return {
      views:    Number(stats.viewCount)    ?? 0,
      likes:    Number(stats.likeCount)    ?? 0,
      comments: Number(stats.commentCount) ?? 0,
      raw:      data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestYouTubeGrowth(
  channelId: string,
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}`,
      accessToken,
    );
    const stats = data?.items?.[0]?.statistics ?? {};
    const followers = Number(stats.subscriberCount) ?? 0;
    return {
      followers,
      follower_gain: followers - previousFollowers,
      views:         Number(stats.viewCount) ?? 0,
      raw:           data ?? {},
    } as any;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Threads
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestThreadsPost(
  postId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const metrics = 'views,likes,replies,reposts,quotes';
    const data = await fetchJsonWithBearer(
      `https://graph.threads.net/v1.0/${postId}/insights?metric=${metrics}&access_token=${accessToken}`,
      accessToken,
    );
    const byName = (name: string) =>
      (data?.data ?? []).find((m: any) => m.name === name)?.values?.[0]?.value ?? 0;
    return {
      views:    byName('views'),
      likes:    byName('likes'),
      comments: byName('replies'),
      shares:   byName('reposts'),
      raw:      data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestThreadsGrowth(
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      'https://graph.threads.net/v1.0/me?fields=id,threads_profile_audience_size',
      accessToken,
    );
    const followers = data?.threads_profile_audience_size ?? 0;
    return {
      followers,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestTikTokPost(
  videoId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://open.tiktokapis.com/v2/video/list/?fields=id,like_count,comment_count,share_count,view_count`,
      accessToken,
      {
        init: {
          method: 'POST',
          body: JSON.stringify({ filters: { video_ids: [videoId] } }),
          headers: { 'Content-Type': 'application/json' },
        },
      },
    );
    const video = (data?.data?.videos ?? []).find((v: any) => v.id === videoId) ?? {};
    return {
      likes:    video.like_count    ?? 0,
      comments: video.comment_count ?? 0,
      shares:   video.share_count   ?? 0,
      views:    video.view_count    ?? 0,
      raw:      data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestTikTokGrowth(
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count',
      accessToken,
    );
    const user = data?.data?.user ?? {};
    const followers = user.follower_count ?? 0;
    return {
      followers,
      following:     user.following_count ?? 0,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinterest
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestPinterestPost(
  pinId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://api.pinterest.com/v5/pins/${pinId}/analytics?metric_types=IMPRESSION,PIN_CLICK,SAVE,OUTBOUND_CLICK`,
      accessToken,
    );
    const summary = data?.all?.daily_metrics?.[0] ?? {};
    return {
      impressions: summary.IMPRESSION    ?? 0,
      saves:       summary.SAVE          ?? 0,
      views:       summary.OUTBOUND_CLICK ?? 0,
      raw:         data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestFacebookPost(
  postId: string,
  accessToken: string,
): Promise<Partial<RawPostMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://graph.facebook.com/v18.0/${postId}/insights?metric=post_impressions,post_reach,post_reactions_by_type_total,post_clicks&period=lifetime&access_token=${accessToken}`,
      accessToken,
    );
    const byName = (name: string) =>
      (data?.data ?? []).find((m: any) => m.name === name)?.values?.[0]?.value ?? 0;
    return {
      impressions: byName('post_impressions'),
      reach:       byName('post_reach'),
      views:       byName('post_clicks'),
      raw:         data ?? {},
    };
  } catch {
    return {};
  }
}

export async function ingestFacebookGrowth(
  pageId: string,
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      `https://graph.facebook.com/v18.0/${pageId}?fields=fan_count,followers_count&access_token=${accessToken}`,
      accessToken,
    );
    const followers = data?.fan_count ?? data?.followers_count ?? 0;
    return {
      followers,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinterest growth
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestPinterestGrowth(
  accessToken: string,
  previousFollowers = 0,
): Promise<Partial<AccountGrowthMetrics>> {
  try {
    const data = await fetchJsonWithBearer(
      'https://api.pinterest.com/v5/user_account',
      accessToken,
    );
    const followers = data?.follower_count ?? 0;
    return {
      followers,
      follower_gain: followers - previousFollowers,
      raw:           data ?? {},
    };
  } catch {
    return {};
  }
}

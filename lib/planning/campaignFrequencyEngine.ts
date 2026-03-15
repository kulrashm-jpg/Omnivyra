/**
 * Campaign Frequency Engine
 * Unified calculation and early validation for campaign frequency configuration.
 * Reuses limits from contentDistributionIntelligence and capacity logic.
 */

import {
  PLATFORM_FREQUENCY_LIMITS,
  CONTENT_TYPE_FREQUENCY_LIMITS,
} from './contentDistributionIntelligence';

export interface CampaignFrequencyInput {
  duration_weeks: number;
  cross_platform_sharing_enabled: boolean;
  platforms: string[];
  content_mix: {
    post_per_week?: number;
    video_per_week?: number;
    blog_per_week?: number;
    reel_per_week?: number;
    article_per_week?: number;
    song_per_week?: number;
  };
}

export interface CampaignFrequencyOutput {
  weekly_total_posts: number;
  weekly_total_videos: number;
  weekly_total_blogs: number;
  weekly_total_reels: number;
  weekly_total_articles: number;
  weekly_unique_content_required: number;
  total_content_required: number;
  per_platform_distribution: Record<string, { post: number; video: number; blog: number }>;
}

function normalizePlatform(p: string): string {
  const s = String(p ?? '').trim().toLowerCase();
  return s === 'x' ? 'twitter' : s;
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  return 0;
}

/**
 * Calculate campaign frequency from configuration.
 * Content mix values are applied per platform (same count on each).
 * Unique = MAX per type when shared; SUM when not shared.
 */
export function calculateCampaignFrequency(
  input: CampaignFrequencyInput
): CampaignFrequencyOutput {
  const platforms = (input.platforms ?? []).map(normalizePlatform).filter(Boolean);
  const mix = input.content_mix ?? {};
  const postPerWeek = toNum(mix.post_per_week);
  const videoPerWeek = toNum(mix.video_per_week);
  const blogPerWeek = toNum(mix.blog_per_week);
  const reelPerWeek = toNum(mix.reel_per_week);
  const articlePerWeek = toNum(mix.article_per_week);
  const songPerWeek = toNum(mix.song_per_week);

  const platformCount = Math.max(1, platforms.length);

  const perPlatform = {
    post: postPerWeek,
    video: videoPerWeek + reelPerWeek,
    blog: blogPerWeek + articlePerWeek,
  };

  const per_platform_distribution: Record<string, { post: number; video: number; blog: number }> = {};
  for (const p of platforms.length ? platforms : ['linkedin']) {
    per_platform_distribution[p] = { ...perPlatform };
  }

  let weekly_unique_content_required: number;
  if (input.cross_platform_sharing_enabled) {
    weekly_unique_content_required = Math.max(
      perPlatform.post,
      perPlatform.video,
      perPlatform.blog,
      songPerWeek
    );
  } else {
    weekly_unique_content_required =
      perPlatform.post * platformCount +
      perPlatform.video * platformCount +
      perPlatform.blog * platformCount +
      songPerWeek * platformCount;
  }

  const duration = Math.max(1, toNum(input.duration_weeks));
  const total_content_required = weekly_unique_content_required * duration;

  return {
    weekly_total_posts: postPerWeek * platformCount,
    weekly_total_videos: (videoPerWeek + reelPerWeek) * platformCount,
    weekly_total_blogs: (blogPerWeek + articlePerWeek) * platformCount,
    weekly_total_reels: reelPerWeek * platformCount,
    weekly_total_articles: articlePerWeek * platformCount,
    weekly_unique_content_required,
    total_content_required,
    per_platform_distribution,
  };
}

export interface FrequencyValidationResult {
  valid: boolean;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  x: 'Twitter',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

function getPlatformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * Validate campaign frequency against platform limits, content limits, and capacity.
 * Call during configuration, not only at plan generation.
 */
export function validateCampaignFrequency(input: {
  duration_weeks: number;
  cross_platform_sharing_enabled: boolean;
  platforms: string[];
  content_mix: CampaignFrequencyInput['content_mix'];
  max_campaign_duration_weeks?: number | null;
  available_content?: { post?: number; video?: number; blog?: number } | null;
  weekly_capacity?: { post?: number; video?: number; blog?: number } | null;
}): FrequencyValidationResult {
  const warnings: Array<{ code: string; message: string }> = [];
  const errors: Array<{ code: string; message: string }> = [];

  const calc = calculateCampaignFrequency({
    duration_weeks: input.duration_weeks,
    cross_platform_sharing_enabled: input.cross_platform_sharing_enabled,
    platforms: input.platforms,
    content_mix: input.content_mix,
  });

  const mix = input.content_mix ?? {};
  const postPerWeek = toNum(mix.post_per_week);
  const videoPerWeek = toNum(mix.video_per_week);
  const blogPerWeek = toNum(mix.blog_per_week);
  const reelPerWeek = toNum(mix.reel_per_week);
  const articlePerWeek = toNum(mix.article_per_week);
  const platforms = (input.platforms ?? []).map(normalizePlatform).filter(Boolean);

  const platformCount = Math.max(1, platforms.length);
  const postsPerPlatform = postPerWeek;
  const videosPerPlatform = videoPerWeek + reelPerWeek;
  const blogsPerPlatform = blogPerWeek + articlePerWeek;

  for (const p of platforms.length ? platforms : ['linkedin']) {
    const limit = PLATFORM_FREQUENCY_LIMITS[p] ?? PLATFORM_FREQUENCY_LIMITS.default;
    const totalPerPlatform = postsPerPlatform + videosPerPlatform + blogsPerPlatform;
    if (totalPerPlatform > limit) {
      warnings.push({
        code: 'platform_limit',
        message: `${getPlatformLabel(p)} posting frequency exceeds recommended limit (${limit}/week).`,
      });
    }
  }

  const blogTotal = blogPerWeek + articlePerWeek;
  const blogLimit = CONTENT_TYPE_FREQUENCY_LIMITS.blog;
  if (blogLimit != null && blogTotal > blogLimit) {
    warnings.push({
      code: 'content_type_limit',
      message: `Blog content frequency is high (${blogTotal}/week). Consider reducing to ${blogLimit} or fewer.`,
    });
  }

  if (
    input.max_campaign_duration_weeks != null &&
    Number.isFinite(input.max_campaign_duration_weeks) &&
    input.duration_weeks > input.max_campaign_duration_weeks
  ) {
    errors.push({
      code: 'duration_limit',
      message: `Campaign duration (${input.duration_weeks} weeks) exceeds your plan limit (${input.max_campaign_duration_weeks} weeks).`,
    });
  }

  const available = input.available_content ?? {};
  const capacity = input.weekly_capacity ?? {};
  const availPost = toNum(available.post);
  const availVideo = toNum(available.video);
  const availBlog = toNum(available.blog);
  const capPost = toNum(capacity.post);
  const capVideo = toNum(capacity.video);
  const capBlog = toNum(capacity.blog);

  const duration = Math.max(1, input.duration_weeks);
  const supplyPost = availPost + capPost * duration;
  const supplyVideo = availVideo + capVideo * duration;
  const supplyBlog = availBlog + capBlog * duration;

  let demandPost: number;
  let demandVideo: number;
  let demandBlog: number;
  if (input.cross_platform_sharing_enabled) {
    demandPost = postPerWeek * duration;
    demandVideo = (videoPerWeek + reelPerWeek) * duration;
    demandBlog = (blogPerWeek + articlePerWeek) * duration;
  } else {
    demandPost = postPerWeek * platformCount * duration;
    demandVideo = (videoPerWeek + reelPerWeek) * platformCount * duration;
    demandBlog = (blogPerWeek + articlePerWeek) * platformCount * duration;
  }

  if (demandPost > supplyPost && (capPost > 0 || availPost > 0)) {
    errors.push({
      code: 'capacity_post',
      message: "Content demand for posts exceeds your team's capacity.",
    });
  }
  if (demandVideo > supplyVideo && (capVideo > 0 || availVideo > 0)) {
    errors.push({
      code: 'capacity_video',
      message: "Content demand for videos exceeds your team's capacity.",
    });
  }
  if (demandBlog > supplyBlog && (capBlog > 0 || availBlog > 0)) {
    errors.push({
      code: 'capacity_blog',
      message: "Content demand for blogs exceeds your team's capacity.",
    });
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

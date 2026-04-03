/**
 * COMMAND CENTER CREATOR CONTENT ADAPTER
 *
 * Specialized path for creator-dependent content (video, carousel, visual stories)
 * that requires rich multimedia context enrichment.
 *
 * Key differences from text adapter:
 * - Pulls visual theme, brand guidelines, platform specs from company context
 * - Enriches prompts with multimedia constraints (duration, aspect ratio, visual tone)
 * - Includes marketing campaign description and brand visual identity
 * - Routes to separate creator content queues with platform-specific repurposing
 *
 * Flow: Creator UI → Activity Workspace Context Enrichment → Adapter → Creator Queue → Worker → Platform Variants
 */

import { makeStableJobId } from '../../queue/bullmqClient';

export type CreatorContentType = 'video_script' | 'carousel' | 'story';

export interface CreatorContextEnrichment {
  // Theme & narrative
  content_theme: string; // e.g., "educational", "inspirational", "comedic", "motivational"
  narrative_arc?: string; // e.g., "problem → insight → solution", "story → lesson → cta"

  // Marketing context
  campaign_description: string; // Current campaign brief/objective
  campaign_key_messages?: string[]; // Primary messages to emphasize

  // Visual identity
  brand_visual_tone?: string; // e.g., "modern & minimalist", "vibrant & energetic", "professional & corporate"
  color_palette?: string[]; // Brand colors
  visual_style?: string; // e.g., "animation", "live-action", "motion graphics", "user-generated look"

  // Platform requirements
  target_platforms: string[]; // e.g., ['tiktok', 'instagram_reels', 'youtube_shorts']
  platform_specs?: Record<string, {
    duration?: number; // seconds
    aspect_ratio?: string; // e.g., "9:16" for vertical
    hook_duration?: number; // seconds to hook viewer
    max_cuts?: number; // for video pacing
  }>;

  // Creator-specific guidance
  audio_guidance?: string; // e.g., "upbeat music with trending sounds", "professional voiceover with subtle background music"
  pacing?: 'slow_builds' | 'fast_cuts' | 'mixed'; // editing pace
  hooks_per_content?: number; // multiple hook opportunities in script
}

export interface CreatorGenerationInput {
  topic: string;
  audience?: string;
  creator_context: CreatorContextEnrichment;
  angle_preference?: 'analytical' | 'contrarian' | 'strategic' | null;
}

export interface CreatorGenerationJobResponse {
  jobId: string;
  pollUrl: string;
  estimatedSeconds: number;
  targetPlatforms: string[];
  repurposeTemplate: 'video_adaptive' | 'carousel_adaptive';
}

/**
 * Enrich creator content generation with activity workspace context
 * Pulls from: campaign brief, brand guidelines, platform strategies
 */
export async function enrichCreatorContext(
  company_id: string,
  contentType: CreatorContentType,
  activityContext?: Record<string, unknown>
): Promise<Partial<CreatorContextEnrichment>> {
  // TODO: Integrate with activity workspace service to pull:
  // - Current campaign description
  // - Brand visual guidelines
  // - Platform marketing strategies
  // - Target audience visual preferences

  // For now, return minimal structure (will be called from activity workspace)
  return {
    content_theme: 'engaging',
    campaign_description: activityContext?.campaign_brief as string || 'Engagement campaign',
    target_platforms: ['tiktok', 'instagram_reels', 'youtube_shorts'],
    platform_specs: {
      tiktok: { duration: 15, aspect_ratio: '9:16', hook_duration: 2, max_cuts: 6 },
      instagram_reels: { duration: 30, aspect_ratio: '9:16', hook_duration: 3, max_cuts: 8 },
      youtube_shorts: { duration: 60, aspect_ratio: '9:16', hook_duration: 3, max_cuts: 10 },
    },
  };
}

/**
 * Video Script Generation for TikTok, Instagram Reels, YouTube Shorts
 * Includes pacing, scene descriptions, dialogue, transitions, audio cues
 */
export async function generateVideoScript(
  company_id: string,
  input: CreatorGenerationInput,
  options?: {
    company_profile?: Record<string, unknown>;
    activity_workspace_context?: Record<string, unknown>;
  }
): Promise<CreatorGenerationJobResponse> {
  const { getContentQueue } = await import('../../queue/contentGenerationQueues');
  const creatorContentQueue = getContentQueue('creator-video');

  const jobId = makeStableJobId('video-script', {
    company_id,
    topic: input.topic,
    platforms: input.creator_context.target_platforms?.join(',') || 'multi',
  });

  const existing = await creatorContentQueue.getJob(jobId);
  if (existing && !['completed', 'failed'].includes(await existing.getState())) {
    return {
      jobId: existing.id!,
      pollUrl: `/api/content/generation-status/${existing.id}`,
      estimatedSeconds: 60,
      targetPlatforms: input.creator_context.target_platforms || [],
      repurposeTemplate: 'video_adaptive',
    };
  }

  const job = await creatorContentQueue.add('creator-video', {
    company_id,
    content_type: 'video_script',
    topic: input.topic,
    audience: input.audience,
    creator_context: input.creator_context,
    angle_preference: input.angle_preference,
    company_profile: options?.company_profile,
    activity_workspace: options?.activity_workspace_context,
  }, {
    jobId,
    priority: 4,
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 60,
    targetPlatforms: input.creator_context.target_platforms || [],
    repurposeTemplate: 'video_adaptive',
  };
}

/**
 * Carousel Generation for Instagram, Pinterest, LinkedIn
 * Each slide with visual description, text overlay, transition guidance
 */
export async function generateCarousel(
  company_id: string,
  input: CreatorGenerationInput,
  options?: {
    slide_count?: number; // default 5-7
    company_profile?: Record<string, unknown>;
    activity_workspace_context?: Record<string, unknown>;
  }
): Promise<CreatorGenerationJobResponse> {
  const { getContentQueue } = await import('../../queue/contentGenerationQueues');
  const creatorContentQueue = getContentQueue('creator-carousel');

  const jobId = makeStableJobId('carousel', {
    company_id,
    topic: input.topic,
    platforms: input.creator_context.target_platforms?.join(',') || 'multi',
    slides: options?.slide_count || 5,
  });

  const existing = await creatorContentQueue.getJob(jobId);
  if (existing && !['completed', 'failed'].includes(await existing.getState())) {
    return {
      jobId: existing.id!,
      pollUrl: `/api/content/generation-status/${existing.id}`,
      estimatedSeconds: 45,
      targetPlatforms: input.creator_context.target_platforms || [],
      repurposeTemplate: 'carousel_adaptive',
    };
  }

  const job = await creatorContentQueue.add('creator-carousel', {
    company_id,
    content_type: 'carousel',
    topic: input.topic,
    audience: input.audience,
    creator_context: input.creator_context,
    angle_preference: input.angle_preference,
    slide_count: options?.slide_count || 5,
    company_profile: options?.company_profile,
    activity_workspace: options?.activity_workspace_context,
  }, {
    jobId,
    priority: 5,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 45,
    targetPlatforms: input.creator_context.target_platforms || [],
    repurposeTemplate: 'carousel_adaptive',
  };
}

/**
 * Visual Story Generation
 * For Instagram Stories, TikTok, YouTube Community with visual-first narrative
 */
export async function generateVisualStory(
  company_id: string,
  input: CreatorGenerationInput,
  options?: {
    company_profile?: Record<string, unknown>;
    activity_workspace_context?: Record<string, unknown>;
  }
): Promise<CreatorGenerationJobResponse> {
  const { getContentQueue } = await import('../../queue/contentGenerationQueues');
  const creatorContentQueue = getContentQueue('creator-story');

  const jobId = makeStableJobId('visual-story', {
    company_id,
    topic: input.topic,
    platforms: input.creator_context.target_platforms?.join(',') || 'stories',
  });

  const existing = await creatorContentQueue.getJob(jobId);
  if (existing && !['completed', 'failed'].includes(await existing.getState())) {
    return {
      jobId: existing.id!,
      pollUrl: `/api/content/generation-status/${existing.id}`,
      estimatedSeconds: 40,
      targetPlatforms: input.creator_context.target_platforms || [],
      repurposeTemplate: 'video_adaptive',
    };
  }

  const job = await creatorContentQueue.add('creator-story', {
    company_id,
    content_type: 'story',
    topic: input.topic,
    audience: input.audience,
    creator_context: input.creator_context,
    angle_preference: input.angle_preference,
    company_profile: options?.company_profile,
    activity_workspace: options?.activity_workspace_context,
  }, {
    jobId,
    priority: 6,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 40,
    targetPlatforms: input.creator_context.target_platforms || [],
    repurposeTemplate: 'video_adaptive',
  };
}

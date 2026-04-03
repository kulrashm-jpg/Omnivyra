/**
 * COMMAND CENTER BLOG ADAPTER
 *
 * Thin wrapper that converts blog creation UI requests into unified engine calls,
 * queued for async processing.
 *
 * Flow: UI Input → Adapter → Queue → Worker → Response
 */

import { Queue } from 'bullmq';
import { makeStableJobId } from '../../queue/bullmqClient';

export interface BlogGenerationInput {
  topic: string;
  audience?: string;
  company_context?: string;
  angle_preference?: 'analytical' | 'contrarian' | 'strategic' | null;
}

export interface GenerationJobResponse {
  jobId: string;
  pollUrl: string;
  estimatedSeconds: number;
}

// Called from /pages/api/blogs/generate or Command Center UI
export async function generateBlogContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: BlogGenerationInput,
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<GenerationJobResponse> {
  // Stable job ID ensures deduplication on retry
  const jobId = makeStableJobId('blog', { company_id, topic: input.topic });

  // Check if job already exists
  const existing = await contentGenerationQueue.getJob(jobId);
  if (existing && !['completed', 'failed'].includes(await existing.getState())) {
    return {
      jobId: existing.id!,
      pollUrl: `/api/content/generation-status/${existing.id}`,
      estimatedSeconds: 30,
    };
  }

  // Queue the job
  const job = await contentGenerationQueue.add('content-blog', {
    company_id,
    content_type: 'blog',
    topic: input.topic,
    audience: input.audience,
    writing_style_instructions: options?.writing_style_instructions,
    target_word_count: 1200,
    intent: 'authority',
    angle_preference: input.angle_preference,
    context_payload: {
      company_context: input.company_context,
    },
    company_profile: options?.company_profile,
  }, {
    jobId,
    priority: 5,  // Standard priority for blog content
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 30,
  };
}

export async function generatePostContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: {
    topic: string;
    platforms: string[];
    angle?: 'analytical' | 'contrarian' | 'strategic';
  },
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<GenerationJobResponse> {
  const jobId = makeStableJobId('post', { company_id, topic: input.topic, platforms: input.platforms });

  const job = await contentGenerationQueue.add('content-post', {
    company_id,
    content_type: 'post',
    topic: input.topic,
    platforms: input.platforms,
    writing_style_instructions: options?.writing_style_instructions,
    target_word_count: 180,
    intent: 'awareness',
    angle_preference: input.angle,
    company_profile: options?.company_profile,
  }, {
    jobId,
    priority: 7,  // Higher priority for post content
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 20,
  };
}

export async function generateWhitepaperContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: {
    topic: string;
    research_brief?: string;
    angle?: 'analytical' | 'contrarian' | 'strategic';
  },
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<GenerationJobResponse> {
  const jobId = makeStableJobId('whitepaper', { company_id, topic: input.topic });

  const job = await contentGenerationQueue.add('content-whitepaper', {
    company_id,
    content_type: 'whitepaper',
    topic: input.topic,
    writing_style_instructions: options?.writing_style_instructions,
    target_word_count: 2500,
    intent: 'authority',
    angle_preference: input.angle,
    context_payload: {
      research_brief: input.research_brief,
    },
    company_profile: options?.company_profile,
  }, {
    jobId,
    priority: 3,  // Standard priority for post content
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 60,
  };
}

export async function generateStoryContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: {
    topic: string;
    narrative_style?: 'personal' | 'case_study' | 'expert_insight';
    angle?: 'analytical' | 'contrarian' | 'strategic';
  },
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<GenerationJobResponse> {
  const jobId = makeStableJobId('story', { company_id, topic: input.topic });

  const job = await contentGenerationQueue.add('content-story', {
    company_id,
    content_type: 'story',
    topic: input.topic,
    writing_style_instructions: options?.writing_style_instructions,
    target_word_count: 800,
    intent: 'awareness',
    angle_preference: input.angle,
    context_payload: {
      narrative_style: input.narrative_style,
    },
    company_profile: options?.company_profile,
  }, {
    jobId,
    priority: 6,  // Standard priority for story content
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 40,
  };
}

export async function generateNewsletterContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: {
    topic: string;
    angle?: 'analytical' | 'contrarian' | 'strategic';
  },
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<GenerationJobResponse> {
  const jobId = makeStableJobId('newsletter', { company_id, topic: input.topic });

  const job = await contentGenerationQueue.add('content-newsletter', {
    company_id,
    content_type: 'newsletter',
    topic: input.topic,
    writing_style_instructions: options?.writing_style_instructions,
    target_word_count: 600,
    intent: 'retention',
    angle_preference: input.angle,
    company_profile: options?.company_profile,
  }, {
    jobId,
    priority: 6,  // Standard priority for newsletter content
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });

  return {
    jobId: job.id!,
    pollUrl: `/api/content/generation-status/${job.id}`,
    estimatedSeconds: 35,
  };
}

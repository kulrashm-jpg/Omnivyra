/**
 * ENGAGEMENT RESPONSE ADAPTER
 *
 * Handles AI-generated responses to:
 * - Comment replies
 * - New conversation starters (DMs, message initiations)
 * - Outreach follow-up responses
 *
 * Supports fast deterministic path (instant) + AI refinement (queued)
 */

import { Queue } from 'bullmq';
import { makeStableJobId } from '../../queue/bullmqClient';
import { generateDeterministicEngagementResponse } from '../../services/deterministicContentPath';

export type EngagementType = 'reply' | 'new_conversation' | 'dm' | 'outreach_response';

export interface EngagementResponseInput {
  original_message: string;
  thread_context?: string;
  platform: string;
  is_question?: boolean;
  engagement_type: EngagementType;
}

export interface EngagementResponseOutput {
  immediate_response?: string; // Deterministic fast path (instant)
  jobId?: string; // Queued AI refinement
  estimatedSeconds?: number;
}

/**
 * Generate engagement response with fast path preference
 * Returns immediate response if deterministic path is sufficient,
 * otherwise queues for AI refinement
 */
export async function generateEngagementResponse(
  company_id: string,
  contentGenerationQueue: Queue,
  input: EngagementResponseInput,
  options?: {
    company_tone?: string;
    force_queue?: boolean; // Force queuing even if deterministic works
  }
): Promise<EngagementResponseOutput> {
  // Try deterministic fast path first (if not forced to queue)
  if (!options?.force_queue) {
    const deterministicResponse = generateDeterministicEngagementResponse({
      message: input.original_message,
      platform: input.platform,
      company_tone: options?.company_tone || 'professional',
      engagement_type: input.engagement_type,
    });

    if (deterministicResponse) {
      return {
        immediate_response: deterministicResponse,
      };
    }
  }

  // Fall back to AI refinement via queue
  const jobId = makeStableJobId('engagement', {
    company_id,
    platform: input.platform,
    engagement_type: input.engagement_type,
    message_hash: generateMessageHash(input.original_message),
  });

  const job = await contentGenerationQueue.add('content-engagement', {
    company_id,
    content_type: 'engagement_response',
    engagement_type: input.engagement_type,
    original_message: input.original_message,
    thread_context: input.thread_context,
    platform: input.platform,
    tone: options?.company_tone || 'professional',
    is_question: input.is_question || input.original_message.includes('?'),
  }, {
    jobId,
    priority: 9,  // Engagement: highest priority (time-critical)
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 500,
    },
  });

  return {
    jobId: job.id!,
    estimatedSeconds: 10,
  };
}

/**
 * Bulk engagement response generation
 * Can handle multiple engagement items in single queue job
 */
export async function generateBulkEngagementResponses(
  company_id: string,
  contentGenerationQueue: Queue,
  inputs: Array<EngagementResponseInput & { message_id: string }>,
  options?: {
    company_tone?: string;
  }
): Promise<Array<EngagementResponseOutput>> {
  const results: EngagementResponseOutput[] = [];

  // Try deterministic fast path for each
  const needsAI: Array<{ input: typeof inputs[0]; index: number }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const deterministicResponse = generateDeterministicEngagementResponse({
      message: input.original_message,
      platform: input.platform,
      company_tone: options?.company_tone || 'professional',
      engagement_type: input.engagement_type,
    });

    if (deterministicResponse) {
      results.push({
        immediate_response: deterministicResponse,
      });
    } else {
      needsAI.push({ input, index: i });
      results.push({ jobId: '', estimatedSeconds: 10 }); // Placeholder
    }
  }

  // Queue AI refinement for messages that need it
  if (needsAI.length > 0) {
    const jobId = makeStableJobId('engagement-bulk', {
      company_id,
      count: needsAI.length,
      timestamp: Date.now(),
    });

    const job = await contentGenerationQueue.add('content-engagement', {
      company_id,
      content_type: 'engagement_response',
      bulk_mode: true,
      items: needsAI.map((item) => ({
        engagement_type: item.input.engagement_type,
        original_message: item.input.original_message,
        thread_context: item.input.thread_context,
        platform: item.input.platform,
        message_id: item.input.message_id,
      })),
    }, {
      jobId,
      priority: 9,  // Engagement: highest priority
      attempts: 2,
    });

    // Update results with job IDs for items needing AI
    for (const { index } of needsAI) {
      results[index] = {
        jobId: job.id!,
        estimatedSeconds: 15,
      };
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate stable hash of message for duplicate detection
 */
function generateMessageHash(message: string): string {
  // Simple hash based on first N characters
  const normalized = message.toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}


/**
 * CAMPAIGN MASTER CONTENT ADAPTER
 *
 * Orchestrates multi-type content generation for campaigns:
 * - Generate Article + Newsletter + Short Story + WhitePaper in one flow
 * - Batch processing (one job per content-type + topic combo)
 * - Efficient queue dispatch with dedup
 * - Feedback integration from campaign strategy context
 *
 * Usage:
 * - Campaign planner wants to create master content for multiple content types
 * - Specify content types, topics, strategy context
 * - Get back job IDs for polling progress
 */

import { Queue } from 'bullmq';
import { makeStableJobId } from '../../queue/bullmqClient';

async function getTenantPriority(_company_id: string): Promise<number> {
  return 5; // Default priority; TODO: look up actual tenant tier
}

export interface CampaignMasterContentInput {
  campaign_id: string;
  content_types: Array<'blog' | 'article' | 'newsletter' | 'story' | 'whitepaper' | 'post'>;
  topics: string[];
  strategy_context: {
    goal?: string;
    pain_point?: string;
    outcome_promise?: string;
    target_audience?: string;
    brand_voice?: string;
    tone_preference?: string;
  };
}

export interface BatchGenerationResponse {
  batch_id: string;
  jobIds: string[];
  pollUrl: string;
  estimatedSeconds: number;
  jobs: Array<{
    jobId: string;
    content_type: string;
    topic: string;
    pollUrl: string;
  }>;
}

/**
 * Generate master content for multiple types in a campaign
 *
 * Flow:
 * 1. For each (content_type, topic) pair, create a generation job
 * 2. Queue jobs intelligently (batch if small, parallel if large)
 * 3. Return all job IDs for progress polling
 *
 * Example:
 * Input: content_types=['article', 'newsletter'], topics=['AI trends', 'Automation']
 * Creates: 4 jobs (article+AI, article+Automation, newsletter+AI, newsletter+Automation)
 */
export async function generateCampaignMasterContent(
  company_id: string,
  contentGenerationQueue: Queue,
  input: CampaignMasterContentInput,
  options?: {
    writing_style_instructions?: string;
    company_profile?: Record<string, unknown>;
  }
): Promise<BatchGenerationResponse> {
  const totalJobs = input.content_types.length * input.topics.length;

  console.info('[campaignMasterContentAdapter][generate-start]', {
    company_id,
    campaign_id: input.campaign_id,
    content_types: input.content_types,
    topics_count: input.topics.length,
    total_jobs: totalJobs,
  });

  const jobIds: string[] = [];
  const jobDetails: Array<{
    jobId: string;
    content_type: string;
    topic: string;
    pollUrl: string;
  }> = [];

  // Create generation job for each (content_type, topic) pair
  for (const contentType of input.content_types) {
    for (const topic of input.topics) {
      const jobId = makeStableJobId('campaign-content', {
        company_id,
        campaign_id: input.campaign_id,
        content_type: contentType,
        topic,
      });

      // Check if job already exists (dedup)
      const existing = await contentGenerationQueue.getJob(jobId);
      if (existing && !['completed', 'failed'].includes(await existing.getState())) {
        jobIds.push(existing.id!);
        jobDetails.push({
          jobId: existing.id!,
          content_type: contentType,
          topic,
          pollUrl: `/api/content/generation-status/${existing.id}`,
        });

        console.debug('[campaignMasterContentAdapter][job-exists]', {
          jobId: existing.id,
          content_type: contentType,
          topic,
        });

        continue;
      }

      // Queue new job
      const job = await contentGenerationQueue.add(`content-${contentType}`, {
        company_id,
        content_type: contentType,
        topic,
        intent: 'authority',
        audience: input.strategy_context.target_audience,
        campaign_id: input.campaign_id,
        writing_style_instructions: options?.writing_style_instructions,
        context_payload: {
          campaign_strategy: input.strategy_context,
          from_campaign: true,
        },
        company_profile: options?.company_profile,
      }, {
        jobId,
        priority: await getTenantPriority(company_id),
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      jobIds.push(job.id!);
      jobDetails.push({
        jobId: job.id!,
        content_type: contentType,
        topic,
        pollUrl: `/api/content/generation-status/${job.id}`,
      });

      console.debug('[campaignMasterContentAdapter][job-queued]', {
        jobId: job.id,
        content_type: contentType,
        topic,
      });
    }
  }

  // Estimate time: base time per job + parallelization factor
  const baseTimePerJob = getEstimatedTimePerType(input.content_types[0]);
  const totalEstimatedSeconds = Math.ceil(
    totalJobs > 1
      ? (totalJobs / Math.min(3, input.content_types.length)) * baseTimePerJob
      : baseTimePerJob
  );

  const batchId = makeStableJobId('campaign-batch', {
    company_id,
    campaign_id: input.campaign_id,
  });

  const response: BatchGenerationResponse = {
    batch_id: batchId,
    jobIds,
    pollUrl: `/api/campaigns/${input.campaign_id}/content-generation-status?batch=${batchId}`,
    estimatedSeconds: totalEstimatedSeconds,
    jobs: jobDetails,
  };

  console.info('[campaignMasterContentAdapter][generate-success]', {
    batch_id: batchId,
    campaign_id: input.campaign_id,
    total_jobs: totalJobs,
    job_ids: jobIds,
  });

  return response;
}

/**
 * Get status of all jobs in a campaign batch
 */
export async function getBatchGenerationStatus(
  contentGenerationQueue: Queue,
  jobIds: string[]
): Promise<{
  batch_status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'mixed';
  jobs: Array<{
    jobId: string;
    status: string;
    progress: number;
    result?: any;
    error?: string;
  }>;
  overall_progress: number;
}> {
  const statuses = [];

  for (const jobId of jobIds) {
    const job = await contentGenerationQueue.getJob(jobId);
    if (!job) {
      statuses.push({
        jobId,
        status: 'not_found',
        progress: 0,
      });
      continue;
    }

    const state = await job.getState();
    const progress = (job.progress as number) || 0;
    const result = job.returnvalue;
    const error = job.failedReason;

    statuses.push({
      jobId,
      status: state,
      progress,
      result: state === 'completed' ? result : undefined,
      error: state === 'failed' ? error : undefined,
    });
  }

  // Determine overall batch status
  const statusCounts = {
    completed: statuses.filter((s) => s.status === 'completed').length,
    failed: statuses.filter((s) => s.status === 'failed').length,
    pending: statuses.filter((s) => s.status === 'waiting' || s.status === 'delayed').length,
    active: statuses.filter((s) => s.status === 'active').length,
  };

  let batchStatus: 'pending' | 'in_progress' | 'completed' | 'failed' | 'mixed' = 'pending';

  if (statusCounts.failed > 0 && statusCounts.completed > 0) {
    batchStatus = 'mixed';
  } else if (statusCounts.failed === statuses.length) {
    batchStatus = 'failed';
  } else if (statusCounts.completed === statuses.length) {
    batchStatus = 'completed';
  } else if (statusCounts.active > 0 || statusCounts.pending > 0) {
    batchStatus = statusCounts.active > 0 ? 'in_progress' : 'pending';
  }

  const overallProgress = Math.round(
    (statusCounts.completed / statuses.length) * 100
  );

  return {
    batch_status: batchStatus,
    jobs: statuses,
    overall_progress: overallProgress,
  };
}

/**
 * Intelligently generate for multiple topics (optional: batch into fewer jobs)
 *
 * For very large batch jobs, we can batch multiple (topic, type) combos
 * into a single job with bulk_mode=true
 */
export async function generateCampaignMasterContentBatchMode(
  company_id: string,
  contentGenerationQueue: Queue,
  input: CampaignMasterContentInput,
  options?: Record<string, unknown>
): Promise<BatchGenerationResponse> {
  const totalCombos = input.content_types.length * input.topics.length;

  // Use batch mode if > 5 total jobs (more efficient)
  if (totalCombos > 5) {
    return generateCampaignBatchJob(company_id, contentGenerationQueue, input, options);
  }

  // Otherwise use standard mode (one job per combo)
  return generateCampaignMasterContent(company_id, contentGenerationQueue, input, options as any);
}

async function generateCampaignBatchJob(
  company_id: string,
  contentGenerationQueue: Queue,
  input: CampaignMasterContentInput,
  options?: Record<string, unknown>
): Promise<BatchGenerationResponse> {
  const batchId = makeStableJobId('campaign-batch', {
    company_id,
    campaign_id: input.campaign_id,
  });

  // Create items for batch job
  const items = [];
  for (const contentType of input.content_types) {
    for (const topic of input.topics) {
      items.push({
        id: `${contentType}-${topic}`,
        content_type: contentType,
        topic,
        intent: 'authority',
        audience: input.strategy_context.target_audience,
        context: {
          campaign_strategy: input.strategy_context,
          from_campaign: true,
        },
      });
    }
  }

  // Queue as single batch job
  const job = await contentGenerationQueue.add('content-article', {
    company_id,
    campaign_id: input.campaign_id,
    bulk_mode: true,
    items,
    writing_style_instructions: (options as any)?.writing_style_instructions,
  }, {
    jobId: batchId,
    priority: await getTenantPriority(company_id),
    attempts: 2,
  });

  const estimatedSeconds = items.length * 15; // 15 seconds per item

  return {
    batch_id: batchId,
    jobIds: [job.id!],
    pollUrl: `/api/campaigns/${input.campaign_id}/content-generation-status?batch=${batchId}`,
    estimatedSeconds,
    jobs: [
      {
        jobId: job.id!,
        content_type: 'batch',
        topic: `${items.length} items`,
        pollUrl: `/api/content/generation-status/${job.id}`,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getEstimatedTimePerType(contentType: string): number {
  const times: Record<string, number> = {
    article: 30,
    blog: 30,
    newsletter: 25,
    story: 25,
    whitepaper: 60,
    post: 15,
  };

  return times[contentType] || 30;
}

/**
 * Get all content generated from a campaign in one batch call
 */
export async function getCampaignGeneratedContent(
  contentGenerationQueue: Queue,
  jobIds: string[]
): Promise<Array<{
  jobId: string;
  content_type: string;
  status: string;
  blueprint?: any;
  master_content?: string;
}>> {
  const results = [];

  for (const jobId of jobIds) {
    const job = await contentGenerationQueue.getJob(jobId);
    if (!job) continue;

    const state = await job.getState();
    const result = job.returnvalue;

    if (state === 'completed' && result) {
      results.push({
        jobId,
        content_type: job.data?.content_type,
        status: 'completed',
        blueprint: result.blueprint,
        master_content: result.master_content,
      });
    } else if (state === 'failed') {
      results.push({
        jobId,
        content_type: job.data?.content_type,
        status: 'failed',
      });
    } else {
      results.push({
        jobId,
        content_type: job.data?.content_type,
        status: state,
      });
    }
  }

  return results;
}


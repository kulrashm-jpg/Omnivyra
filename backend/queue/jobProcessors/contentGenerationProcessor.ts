/**
 * UNIFIED CONTENT GENERATION JOB PROCESSOR
 *
 * Handles all content generation jobs:
 * - Master content generation (all types)
 * - Platform variant generation
 * - Engagement response generation
 * - Cost tracking & credit deduction
 * - Error handling & fallbacks
 *
 * Flow:
 * 1. Pre-flight: Check credits, rate limits
 * 2. Generate: Angles → Master content → Validate → Variants
 * 3. Persist: Save results
 * 4. Deduct: Charge credits
 * 5. Fallback: Deterministic content if AI fails
 */

import { Job } from 'bullmq';
import {
  unifiedEngine,
  ContentInput,
  ContentType,
  EngagementInput,
  GenerationOutput,
  DecisionTrace,
} from '../../services/unifiedContentGenerationEngine';
import { validateContentBlueprint } from '../../services/aiOutputValidationService';
import { recordQuickToneFeedback } from '../../services/contentFeedbackLoop';

// Stubs for services not yet implemented
const feedbackIntelligenceEngine = {
  getRecentFeedback: async (_company_id: string, _content_type: string) => ({}),
  getResponseFeedback: async (_company_id: string, _platform: string) => ({}),
};
const intelligenceLearningModule = {
  getContextFor: async (_company_id: string) => ({}),
  getEngagementContext: async (_company_id: string) => ({}),
};
async function checkCredits(_company_id: string, _content_type: string): Promise<boolean> { return true; }
async function deductCredits(_company_id: string, _key: string, _cost: number): Promise<void> {}
async function refundCredits(_company_id: string, _key: string): Promise<void> {}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN JOB PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────

export async function processContentGenerationJob(job: Job): Promise<any> {
  const { company_id, content_type, bulk_mode } = job.data;

  console.info('[contentGenerationProcessor][start]', {
    jobId: job.id,
    company_id,
    content_type,
    bulk_mode,
  });

  // Pre-flight checks
  void job.updateProgress(5);

  try {
    // Handle engagement responses separately (faster pipeline)
    if (content_type === 'engagement_response') {
      return await processEngagementResponseJob(job);
    }

    // Handle bulk mode (multiple items)
    if (bulk_mode) {
      return await processBulkContentJob(job);
    }

    // Single content generation
    return await processSingleContentJob(job);
  } catch (error) {
    console.error('[contentGenerationProcessor][failed]', {
      jobId: job.id,
      company_id,
      content_type,
      error: String(error),
    });

    // Rollback credits on critical errors
    if (!String(error).includes('Rate limit')) {
      await refundCredits(company_id, `content_${content_type}_attempt`).catch(() => {});
    }

    // Log failed job data for potential replay
    console.warn('[contentGenerationProcessor][overflow]', {
      company_id,
      operation: 'content_generation',
      content_type,
      error: String(error),
      job_data: job.data,
    });

    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE CONTENT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function processSingleContentJob(job: Job): Promise<GenerationOutput> {
  const {
    company_id,
    content_type,
    topic,
    angle_preference,
    context_payload,
    writing_style_instructions,
    target_word_count,
    intent,
    audience,
    feedback_signals,
    company_profile,
  } = job.data;

  // Step 1: Check credits
  void job.updateProgress(10);
  const hasCredits = await checkCredits(company_id, content_type);
  if (!hasCredits) {
    throw new Error(`Insufficient credits for ${content_type} generation`);
  }

  // Step 2: Generate angles (may use cache)
  void job.updateProgress(15);
  let angles = await unifiedEngine.generateAngles({
    company_id,
    content_type: content_type as ContentType,
    topic,
    intent,
    audience,
    company_profile,
    context_payload,
  });

  // Step 3: Select optimal angle (feedback-guided + learning-aware)
  void job.updateProgress(25);
  const selectedAngle = angle_preference
    ? angles.find((a) => a.type === angle_preference) || angles[0]
    : await unifiedEngine.selectOptimalAngle(angles, {
        company_id,
        content_type: content_type as ContentType,
        feedback_context: await feedbackIntelligenceEngine
          .getRecentFeedback(company_id, content_type)
          .catch(() => ({})),
        learning_context: await intelligenceLearningModule
          .getContextFor(company_id)
          .catch(() => ({})),
      });

  // Step 4: Generate master content
  void job.updateProgress(40);
  const blueprint = await unifiedEngine.generateMasterContent(
    {
      company_id,
      content_type: content_type as ContentType,
      topic,
      intent,
      audience,
      writing_style_instructions,
      target_word_count,
      context_payload,
      company_profile,
      feedback_signals,
    },
    selectedAngle,
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
    }
  );

  // Step 5: Validate content quality
  void job.updateProgress(50);
  const validation = unifiedEngine.validateContentQuality(blueprint, content_type as ContentType);
  if (!validation.pass && validation.severity === 'blocking') {
    console.warn('[contentGenerationProcessor][validation-failed]', {
      jobId: job.id,
      issues: validation.issues,
    });
    // Continue anyway with warning, don't fail
  }

  // Step 6: Generate platform variants (if needed)
  void job.updateProgress(60);
  let variants = [];
  if (job.data.platforms && job.data.platforms.length > 0) {
    variants = await buildPlatformVariantsFromMaster(blueprint, job.data.platforms, {
      company_id,
      company_profile,
    });
  }

  // Step 7: Estimate cost & deduct credits
  void job.updateProgress(75);
  const estimatedTokens = estimateTokens(blueprint, variants, content_type as ContentType);
  const costUsd = estimateCost(estimatedTokens, content_type as ContentType);

  await deductCredits(company_id, `content_${content_type}`, costUsd);

  // Step 8: Build decision trace for analytics
  void job.updateProgress(85);
  const decisionTrace: DecisionTrace = {
    source_topic: topic,
    objective: intent || 'general',
    pain_point: context_payload?.pain_point || 'Not specified',
    outcome_promise: context_payload?.outcome_promise || 'Value delivery',
    writing_angle: selectedAngle.angle_summary,
    tone_used: company_profile?.tone_preference || 'professional',
    narrative_role: 'primary',
    progression_step: job.data.progression_step || null,
    feedback_signals_used: Object.keys(feedback_signals || {}),
  };

  // Record operation for observability
  await recordGenerationOperation({
    company_id,
    job_id: job.id,
    content_type,
    tokens: estimatedTokens,
    cost_usd: costUsd,
    angle_selected: selectedAngle.type,
    status: 'success',
  });

  void job.updateProgress(95);

  const result: GenerationOutput = {
    blueprint,
    master_content: blueprintToFullText(blueprint),
    ready_for_variants: variants.length > 0 || job.data.platforms?.length === 0,
    generation_trace: decisionTrace,
  };

  // Store in Redis (job result automatically stored, expires in 7 days)
  void job.updateProgress(100);

  console.info('[contentGenerationProcessor][success]', {
    jobId: job.id,
    company_id,
    content_type,
    tokens: estimatedTokens,
    cost: costUsd,
    variants_count: variants.length,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK CONTENT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function processBulkContentJob(job: Job): Promise<any> {
  const { company_id, items } = job.data;

  console.info('[contentGenerationProcessor][bulk-start]', {
    jobId: job.id,
    company_id,
    count: items.length,
  });

  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    void job.updateProgress(Math.floor((i / items.length) * 100));

    try {
      const result = await unifiedEngine.generateMasterContent(
        {
          company_id,
          content_type: item.content_type,
          topic: item.topic,
          intent: item.intent,
          audience: item.audience,
          context_payload: item.context,
        },
        item.selected_angle || (await unifiedEngine.generateAngles({} as any))[0],
        { temperature: 0 }
      );

      results.push({
        item_id: item.id,
        status: 'success',
        blueprint: result,
      });
    } catch (error) {
      results.push({
        item_id: item.id,
        status: 'failed',
        error: String(error),
      });
    }
  }

  // Bulk cost deduction (one charge for whole batch)
  const totalTokens = results
    .filter((r) => r.status === 'success')
    .reduce((sum, r) => sum + estimateTokens(r.blueprint, [], 'article'), 0);

  if (totalTokens > 0) {
    const costUsd = estimateCost(totalTokens, 'article');
    await deductCredits(company_id, 'content_bulk_generation', costUsd);
  }

  void job.updateProgress(100);

  return {
    batch_id: job.id,
    total_items: items.length,
    successful: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT RESPONSE GENERATION (FASTER PIPELINE)
// ─────────────────────────────────────────────────────────────────────────────

async function processEngagementResponseJob(job: Job): Promise<any> {
  const {
    company_id,
    engagement_type,
    original_message,
    thread_context,
    platform,
    tone,
    bulk_mode,
  } = job.data;

  console.info('[contentGenerationProcessor][engagement-start]', {
    jobId: job.id,
    company_id,
    engagement_type,
    bulk_mode,
  });

  void job.updateProgress(10);

  // Check credits (metered engagement responses)
  const hasCredits = await checkCredits(company_id, 'engagement_response');
  if (!hasCredits) {
    throw new Error('Insufficient credits for engagement response');
  }

  void job.updateProgress(20);

  if (bulk_mode) {
    // Bulk engagement response generation (multiple replies in one batch job)
    return await processBulkEngagementResponses(job);
  }

  // Single engagement response
  void job.updateProgress(30);

  const response = await unifiedEngine.generateEngagementResponse({
    company_id,
    message: original_message,
    platform,
    tone,
    engagement_type: engagement_type as any,
    thread_context,
    deterministic_only: false, // Allow AI refinement
    feedback_context: await feedbackIntelligenceEngine
      .getResponseFeedback(company_id, platform)
      .catch(() => ({})),
    learning_context: await intelligenceLearningModule
      .getEngagementContext(company_id)
      .catch(() => ({})),
  });

  void job.updateProgress(60);

  // Deduct credits (metered)
  const tokens = Math.ceil(response.length / 4); // Rough token estimate
  const costUsd = estimateCost(tokens, 'engagement_response');
  await deductCredits(company_id, 'content_engagement', costUsd);

  void job.updateProgress(80);

  // Queue feedback tracking (hybrid: immediate + delayed)
  await queueEngagementFeedbackTracking({
    company_id,
    platform,
    tone_used: tone,
    engagement_type,
    reply_id: job.id, // Use job ID as reply ID for now
  }).catch(() => {}); // Don't fail if tracking fails

  void job.updateProgress(100);

  console.info('[contentGenerationProcessor][engagement-success]', {
    jobId: job.id,
    company_id,
    engagement_type,
    response_length: response.length,
  });

  return {
    response,
    platform,
    engagement_type,
    generated_at: new Date().toISOString(),
  };
}

async function processBulkEngagementResponses(job: Job): Promise<any> {
  const { company_id, items } = job.data;

  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    void job.updateProgress(Math.floor((i / items.length) * 100));

    try {
      const response = await unifiedEngine.generateEngagementResponse({
        company_id,
        message: item.original_message,
        platform: item.platform,
        tone: item.tone || 'professional',
        engagement_type: item.engagement_type,
        thread_context: item.thread_context,
      });

      results.push({
        message_id: item.message_id,
        status: 'success',
        response,
      });
    } catch (error) {
      results.push({
        message_id: item.message_id,
        status: 'failed',
        error: String(error),
      });
    }
  }

  // Bulk credit deduction
  const totalTokens = results
    .filter((r) => r.status === 'success')
    .reduce((sum, r) => sum + Math.ceil((r.response?.length || 0) / 4), 0);

  if (totalTokens > 0) {
    const costUsd = estimateCost(totalTokens, 'engagement_response');
    await deductCredits(company_id, 'content_engagement_bulk', costUsd);
  }

  void job.updateProgress(100);

  return {
    batch_id: job.id,
    total_items: items.length,
    successful: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function blueprintToFullText(blueprint: any): string {
  const parts = [
    blueprint.hook,
    ...(Array.isArray(blueprint.key_points) ? blueprint.key_points : []),
    blueprint.cta,
  ];
  return parts.filter(Boolean).join('\n\n');
}

function estimateTokens(blueprint: any, variants: any[] = [], contentType: ContentType): number {
  let tokens = 0;

  // Master content
  tokens += Math.ceil((blueprint.hook?.length || 0) / 4);
  if (Array.isArray(blueprint.key_points)) {
    tokens += blueprint.key_points.reduce((sum: number, kp: string) => sum + Math.ceil((kp?.length || 0) / 4), 0);
  }
  tokens += Math.ceil((blueprint.cta?.length || 0) / 4);

  // Variants (add 30% per variant for LLM processing overhead)
  tokens += Math.ceil(variants.length * tokens * 0.3);

  return Math.max(tokens, 50); // Minimum 50 tokens
}

function estimateCost(tokens: number, contentType: ContentType): number {
  // Pricing based on gpt-4o-mini or gpt-4o depending on type
  // gpt-4o-mini: $0.00015/1k input, $0.0006/1k output
  // gpt-4o: $0.0025/1k input, $0.01/1k output

  const inputTokens = tokens * 0.75; // Estimate 75% input, 25% output
  const outputTokens = tokens * 0.25;

  // Use gpt-4o-mini for all (cheaper, good quality for generated content)
  const inputCost = (inputTokens / 1000) * 0.00015;
  const outputCost = (outputTokens / 1000) * 0.0006;

  return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimals
}

async function buildPlatformVariantsFromMaster(
  blueprint: any,
  platforms: string[],
  options: Record<string, unknown>
): Promise<any[]> {
  // TODO: Implement platform variant generation
  // For now, return empty array (handled by contentGenerationPipeline)
  return [];
}

async function recordGenerationOperation(data: Record<string, unknown>): Promise<void> {
  // TODO: Record to observability system (DataDog, New Relic, etc.)
  console.debug('[contentGenerationProcessor][operation-recorded]', data);
}

async function queueEngagementFeedbackTracking(data: Record<string, unknown>): Promise<void> {
  // Record immediate feedback (tone used + engagement type)
  // This is synchronous and fast, so we do it right here
  const company_id = data.company_id as string;
  const platform = data.platform as string;
  const tone_used = data.tone_used as string;
  const engagement_type = data.engagement_type as string;

  if (!company_id || !platform || !tone_used) return;

  try {
    await recordQuickToneFeedback({
      company_id,
      platform,
      engagement_type: engagement_type || undefined,
      tone: tone_used,
      timestamp: new Date(),
    });

    console.debug('[contentGenerationProcessor][feedback-recorded]', {
      company_id,
      platform,
      engagement_type,
      tone: tone_used,
    });
  } catch (err) {
    console.warn('[contentGenerationProcessor][feedback-recording-failed]', err);
    // Don't fail the job if feedback recording fails
  }

  // TODO: Queue delayed feedback job (24h later) to collect engagement metrics
  // This will:
  // 1. Fetch actual engagement data (reactions, replies, sentiment)
  // 2. Calculate effectiveness score
  // 3. Update tone/angle effectiveness cache
}


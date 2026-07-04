/**
 * UNIFIED CONTENT GENERATION JOB PROCESSOR
 *
 * DEPRECATED FOR LONG-FORM CONTENT:
 * Long-form jobs are redirected to lib/content/unifiedLongFormEngine.ts.
 * This processor remains active for short-form, bulk legacy, and engagement
 * response workloads.
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
import { estimateLlmCostUsd } from '../../services/pricingService';
import { runUnifiedLongFormGeneration } from '../../../lib/content/unifiedLongFormEngine';
import { buildContentContext } from '../../../lib/content/buildContentContext';
import { isLongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import { renderPlatformVariantsFromBlueprint } from '../../services/contentGeneration/platformVariantGenerator';

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
  // ── Defensive guard against worker-collision routing ────────────────────
  // The `longform-unified` queue has a dedicated processor
  // (`processLongFormUnifiedJob` in startWorkers.ts). If a stale worker
  // process — started before `QUEUES_WITH_DEDICATED_WORKER` was added
  // to contentGenerationQueues.ts — registered the generic processor
  // for `longform-unified`, jobs land here with the long-form payload
  // shape `{input, meta}` instead of the short-form shape
  // `{company_id, content_type, ...}`. Without this guard, the routing
  // falls through to `generateMasterContent` which does
  // `CONTENT_TYPE_CONFIG[input.content_type].target_words` and crashes
  // with the unhelpful "Cannot read properties of undefined (reading
  // 'target_words')". Fail clean here instead, with a diagnostic that
  // tells the user exactly what to do (restart workers).
  const queueName = (job as { queueName?: string }).queueName;
  if (queueName === 'longform-unified') {
    throw new Error(
      `[contentGenerationProcessor] Routing error: a generic worker received a job from the 'longform-unified' queue. The QUEUES_WITH_DEDICATED_WORKER fix is in the working tree but this worker process is stale. Restart your dev workers (npm run dev:full) so the new worker registration takes effect. Job id: ${job.id}.`,
    );
  }
  const looksLikeLongFormUnifiedPayload =
    job.data
    && typeof job.data === 'object'
    && (job.data as { input?: unknown; meta?: unknown }).input
    && (job.data as { input?: unknown; meta?: unknown }).meta
    && (job.data as { company_id?: unknown; content_type?: unknown }).company_id === undefined
    && (job.data as { company_id?: unknown; content_type?: unknown }).content_type === undefined;
  if (looksLikeLongFormUnifiedPayload) {
    throw new Error(
      `[contentGenerationProcessor] Payload shape mismatch: this job has the long-form unified shape ({input, meta}) but landed in the generic content-generation processor. The 'longform-unified' queue must be processed by processLongFormUnifiedJob. Restart your dev workers (npm run dev:full). Job id: ${job.id}.`,
    );
  }

  const { company_id, content_type, bulk_mode, user_id } = job.data;

  console.info('[contentGenerationProcessor][start]', {
    jobId: job.id,
    company_id,
    content_type,
    bulk_mode,
  });

  // Pre-flight checks
  void job.updateProgress(5);

  // Phase 8G-A — credit-economy shadow (dark, fire-and-forget; never blocks/mutates).
  void import('../../services/billing/creditEconomyShadow')
    .then((m) => m.emitCreditEconomyShadowEvaluation({ organizationId: String(company_id), activity: bulk_mode ? 'content_basic' : 'content_generation', surface: 'queue.content-generation', dedupeKey: `${job.id ?? content_type}` }))
    .catch(() => {});

  // Phase 11D — admission boundary (single call; dark by default → passthrough,
  // no wallet read; shadow-observes / enforce-blocks once configured).
  await (await import('../../services/billing/admissionControl')).evaluateActivityAdmission({
    organizationId: String(company_id),
    activity:       bulk_mode ? 'content_basic' : 'content_generation',
    surface:        'queue.content-generation',
    referenceId:    `${job.id ?? content_type}`,
  });

  // Phase 2 C-1 closure: when `billing.reservations_required` is enabled for
  // the org, route the job through the enterprise billing middleware so the
  // credit reservation lifecycle is exactly-once across Bull MQ retries.
  // The legacy in-job `deductCredits()` calls are stubs today (no-ops), so
  // turning the flag ON for the first time activates real billing.
  const { isBillingFlagEnabled, BILLING_FLAGS } = await import('../../services/billing/billingFeatureFlags');
  const flag = await isBillingFlagEnabled({
    organizationId: company_id,
    flag:           BILLING_FLAGS.RESERVATIONS_REQUIRED,
  });

  // Phase 10C — token-actual entry-consumption when enabled
  // (PHASE2_ENTRY_CONSUMPTION, default OFF → existing path, byte-identical).
  // Actual provider tokens are collected via AsyncLocalStorage across the
  // generation pipeline and settled token-actual; entry kept + exposure released
  // on abandonment (orphan reaper). Replay-safe via deterministic idem key.
  const { executeWithEntryConsumption, makeIdempotencyKey } =
    await import('../../services/creditExecutionService');
  const { getCreditEconomyExecutionMode } = await import('../../services/billing/creditEconomyActivation');
  if ((await getCreditEconomyExecutionMode({ organizationId: String(company_id), surface: 'queue.content-generation' })) === 'enforce') {
    const ecAction: 'content_generation' | 'content_basic' = bulk_mode ? 'content_basic' : 'content_generation';
    const referenceId = `${job.id ?? content_type}`;
    // Phase 12E — the engine owns the usage scope and consumes ENTRY at the first
    // provider call inside the executor; usage is collected from that scope.
    const r = await executeWithEntryConsumption<unknown>({
      userId:              String(user_id ?? company_id),
      orgId:               String(company_id),
      action:              ecAction,
      referenceType:       'content_job',
      referenceId,
      idempotencyKey:      makeIdempotencyKey(String(company_id), ecAction, referenceId),
      validateMembership:  false,
      llmPricing:          { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', actionKey: ecAction, maxInputTokens: 8000, maxOutputTokens: 4000 },
      collectViaCollector: true,
      executor:            () => processContentGenerationJobInner(job),
    });
    return r.status === 'executed' ? (r.result as unknown) : { skipped: true, reason: r.status };
  }

  if (flag.enabled) {
    const { withQueueBilling } = await import('../../services/billing/queueBillingMiddleware');
    const action: 'content_generation' | 'content_basic' = bulk_mode
      ? 'content_basic'
      : 'content_generation';
    const wrapped = await withQueueBilling(
      {
        queueName:      'content-generation',
        jobId:          String(job.id ?? `inline-${Date.now()}`),
        payload:        { company_id, content_type, bulk_mode, ts: job.data?.run_token ?? null },
        organizationId: String(company_id),
        userId:         String(user_id ?? company_id),
        action,
        referenceType: 'content_job',
        referenceId:   `${job.id ?? content_type}`,
      },
      () => processContentGenerationJobInner(job),
    );
    if (wrapped.kind === 'duplicate_blocked') {
      return { skipped: true, reason: wrapped.reason };
    }
    return wrapped.orchestrator.result.status === 'executed'
      ? (wrapped.orchestrator.result.result as unknown)
      : { skipped: true, reason: wrapped.orchestrator.result.status };
  }

  return processContentGenerationJobInner(job);
}

async function processContentGenerationJobInner(job: Job): Promise<any> {
  const { company_id, content_type, bulk_mode } = job.data;
  try {
    if (!bulk_mode && typeof content_type === 'string' && isLongFormContentType(content_type)) {
      return await processLongFormRedirectJob(job);
    }

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

async function processLongFormRedirectJob(job: Job): Promise<any> {
  const {
    company_id,
    content_type,
    topic,
    intent,
    audience,
    writing_style_instructions,
    target_word_count,
    context_payload,
    company_profile,
  } = job.data;

  void job.updateProgress(10);

  const builtContext = await buildContentContext(company_id).catch(() => null);
  const companyContext = builtContext?.companyContext || {
    audience,
    writingStyleInstructions: writing_style_instructions,
    companyName: typeof company_profile?.name === 'string' ? company_profile.name : undefined,
    industry: typeof company_profile?.industry === 'string' ? company_profile.industry : undefined,
  };

  const answers: Record<string, string> = {};
  if (target_word_count) answers.target_word_count = String(target_word_count);
  if (context_payload && typeof context_payload === 'object') {
    answers.company_context = JSON.stringify(context_payload);
  }

  void job.updateProgress(35);

  const result = await runUnifiedLongFormGeneration({
    company_id,
    contentType: content_type,
    mode: 'full',
    topic,
    intent,
    answers: Object.keys(answers).length > 0 ? answers : undefined,
    tone: typeof company_profile?.tone_preference === 'string' ? company_profile.tone_preference : undefined,
    companyContext,
    targetWordCount: typeof target_word_count === 'number' ? target_word_count : undefined,
  });

  void job.updateProgress(100);

  return {
    redirected: true,
    deprecated_processor: 'contentGenerationProcessor',
    unified_engine: 'unifiedLongFormEngine',
    result,
  };
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
    throw new Error(`Content validation failed: ${(validation.issues || []).join('; ')}`);
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
  const costUsd = await estimateCost(estimatedTokens, content_type as ContentType);

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
    const costUsd = await estimateCost(totalTokens, 'article');
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
  const costUsd = await estimateCost(tokens, 'engagement_response');
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
    const costUsd = await estimateCost(totalTokens, 'engagement_response');
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

/**
 * Advisory pre-flight USD estimator — DB-backed via pricingService. Returns
 * BASE model cost (no multiplier, no floor, no ceiling, no credit conversion).
 *
 * Real billing must flow through resolveLlmCost + executeWithCredits (Phase 4).
 * Reads llm_model_pricing so this stays consistent when the DB row changes.
 */
async function estimateCost(tokens: number, _contentType: ContentType): Promise<number> {
  const inputTokens = tokens * 0.75;
  const outputTokens = tokens * 0.25;
  const baseUsd = await estimateLlmCostUsd('openai', 'gpt-4o-mini', inputTokens, outputTokens);
  return Math.round(baseUsd * 10000) / 10000;
}

async function buildPlatformVariantsFromMaster(
  blueprint: any,
  platforms: string[],
  options: Record<string, unknown>
): Promise<any[]> {
  if (!blueprint || !Array.isArray(platforms) || platforms.length === 0) return [];
  // Reuse the canonical platform-adaptation logic (deterministic rules + AI
  // fallback) rather than a second formatter. `renderPlatformVariantsFromBlueprint`
  // reads the target platforms from the item's `selected_platforms`.
  const item = {
    execution_id: String((options as { execution_id?: unknown }).execution_id
      || (options as { company_id?: unknown }).company_id
      || 'content-job'),
    content_type: String((blueprint as { content_type?: unknown }).content_type
      || (options as { content_type?: unknown }).content_type
      || 'post'),
    selected_platforms: platforms,
  };
  return renderPlatformVariantsFromBlueprint(blueprint, item as never);
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

/**
 * CREATOR CONTENT GENERATION PROCESSOR
 *
 * Handles the full lifecycle for video scripts, carousels, and visual stories:
 * - Angle generation (3-angle system optimized for visual content)
 * - Master script/carousel/story generation
 * - Platform-specific repurposing (TikTok, Instagram, YouTube, LinkedIn)
 * - Quality validation with creator-specific rules
 * - Cost estimation and credit deduction
 * - Feedback tracking for visual content effectiveness
 *
 * Differs from text processor:
 * - Uses creatorContentPromptsV1 instead of contentGenerationPromptsV3
 * - Enriches prompts with activity workspace context (theme, campaign, brand visual)
 * - Outputs include platform variants and visual specifications
 * - Feedback tracks visual engagement metrics (hook passthrough, completion, shares)
 */

import { Job } from 'bullmq';
import { unifiedEngine } from '../../services/unifiedContentGenerationEngine';
import { getCreatorSystemPrompt, CREATOR_VALIDATION_RULES } from '../../prompts/creatorContentPromptsV1';
import {
  repurposeVideoScriptForPlatforms,
  repurposeCarouselForPlatforms,
} from '../../services/creatorContentRepurposingEngine';
import { validateCreatorContentQuality } from '../../services/creatorContentValidation';
import { recordCreatorFeedback } from '../../services/contentFeedbackLoop';
import { runCompletionWithOperation } from '../../services/aiGateway';
import { estimateLlmCostUsd } from '../../services/pricingService';
import type { ContentAngle, ContentBlueprint } from '../../services/unifiedContentGenerationEngine';
import { createCreatorExecutionEngine } from '../../services/executionEngines/creatorExecutionEngine';
import { runCreatorOrchestration } from '../../services/creator/creatorOrchestrator';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function processCreatorContentJob(job: Job): Promise<any> {
  const {
    company_id,
    content_type,
    topic,
    audience,
    creator_context,
    angle_preference,
    company_profile,
    activity_workspace,
    user_id,
  } = job.data;

  // Phase 2 C-1 closure: same wrap-on-flag pattern as content generation.
  // The internal `deductCredits()` is a stub; turning the flag ON activates
  // real billing through the orchestrator with exactly-once semantics.
  const { isBillingFlagEnabled, BILLING_FLAGS } = await import('../../services/billing/billingFeatureFlags');
  const flag = await isBillingFlagEnabled({
    organizationId: company_id,
    flag:           BILLING_FLAGS.RESERVATIONS_REQUIRED,
  });
  if (flag.enabled) {
    const { withQueueBilling } = await import('../../services/billing/queueBillingMiddleware');
    const wrapped = await withQueueBilling(
      {
        queueName:      'creator-content',
        jobId:          String(job.id ?? `inline-${Date.now()}`),
        payload:        { company_id, content_type, topic, audience },
        organizationId: String(company_id),
        userId:         String(user_id ?? company_id),
        action:         'content_generation',
        referenceType:  'creator_content_job',
        referenceId:    `${job.id ?? content_type}`,
      },
      () => processCreatorContentJobInner(job),
    );
    if (wrapped.kind === 'duplicate_blocked') {
      return { skipped: true, reason: wrapped.reason };
    }
    return wrapped.orchestrator.result.status === 'executed'
      ? (wrapped.orchestrator.result.result as unknown)
      : { skipped: true, reason: wrapped.orchestrator.result.status };
  }

  return processCreatorContentJobInner(job);
}

async function processCreatorContentJobInner(job: Job): Promise<any> {
  const {
    company_id,
    content_type,
    topic,
    audience,
    creator_context,
    angle_preference,
    company_profile,
    activity_workspace,
    bolt_payload,
  } = job.data;

  // Phase 2 unification — BOLT-row execution branch. Pipeline worker
  // enqueues each renderable row here; this branch owns the
  // orchestrator call + daily_content_plans row mutation that used to
  // run inline inside `creatorAssetGenerationRuntime`. BullMQ retries
  // replace the prior in-loop max_retries semantic.
  if (bolt_payload) {
    return processBoltCreatorRowJob(job, bolt_payload as BoltCreatorRowJobData);
  }

  try {
    console.log(`[creatorContentProcessor] Processing ${content_type} for company ${company_id}`);

    // Step 1: Validate input
    void job.updateProgress(5);
    if (!creator_context || !creator_context.target_platforms?.length) {
      throw new Error('Creator context missing: need target_platforms, campaign_description, content_theme');
    }
    // Phase 2 unification — primary-platform generate+adapt+render+persist+FSM
    // routed through the shared orchestrator. The N-platform variant
    // adaptation that this worker has historically produced is preserved
    // via direct engine.adaptForPlatform calls for the secondary
    // platforms (the orchestrator only adapts/renders for the primary).
    const targetPlatformsArr: string[] = Array.from(creator_context.target_platforms);
    const primaryPlatform = String(targetPlatformsArr[0] || 'linkedin').toLowerCase();
    const orchestrationContentType = content_type === 'carousel' ? 'carousel' : content_type === 'story' ? 'story' : 'video';

    void job.updateProgress(35);
    const orchestrated = await runCreatorOrchestration({
      campaignId: String((activity_workspace as any)?.campaign_id || `creator-${company_id}`),
      companyId: company_id,
      userId: String((activity_workspace as any)?.user_id || '') || null,
      topic,
      contentType: orchestrationContentType,
      targetPlatforms: targetPlatformsArr,
      audience,
      objective: String(creator_context.campaign_description || ''),
      summary: String((activity_workspace as any)?.summary || ''),
      creatorCard: creator_context,
      enrichedIntent: activity_workspace && typeof activity_workspace === 'object' ? activity_workspace as Record<string, unknown> : null,
      existingContent: null,
      origin: 'queue',
    });
    const canonicalOutput = orchestrated.output;

    void job.updateProgress(55);
    const validationResult = safeObject(canonicalOutput.metadata.validation_result);
    const platformVariants: Record<string, any> = {};
    // Primary platform is already adapted+rendered by the orchestrator.
    platformVariants[primaryPlatform] = {
      asset_payload: safeObject((canonicalOutput.asset_payload as Record<string, unknown>).platform_payload) || canonicalOutput.asset_payload,
      packaging: canonicalOutput.packaging.platform_variants[primaryPlatform] ?? {
        caption: canonicalOutput.packaging.caption,
        hashtags: canonicalOutput.packaging.hashtags,
      },
      asset_type: canonicalOutput.asset_type,
    };
    // Secondary platforms: adapt only (no re-render — the orchestrator
    // owns the canonical render for the primary platform, and the queue
    // processor's contract is variant adaptation, not re-rendering).
    if (targetPlatformsArr.length > 1) {
      const engine = createCreatorExecutionEngine();
      for (const platform of targetPlatformsArr.slice(1)) {
        const adapted = await engine.adaptForPlatform(canonicalOutput, platform);
        platformVariants[platform] = {
          asset_payload: safeObject((adapted.asset_payload as Record<string, unknown>).platform_payload) || adapted.asset_payload,
          packaging: adapted.packaging.platform_variants[platform] ?? {
            caption: adapted.packaging.caption,
            hashtags: adapted.packaging.hashtags,
          },
          asset_type: adapted.asset_type,
        };
      }
    }

    // Step 7: Estimate cost & deduct credits
    void job.updateProgress(75);
    const estimatedTokens = estimateCreatorTokens(canonicalOutput.asset_instruction.blueprint, content_type);
    const costUsd = await estimateCost(estimatedTokens, content_type);
    await deductCredits(company_id, `content_${content_type}`, costUsd);

    // Step 8: Build decision trace
    void job.updateProgress(85);
    const decisionTrace = {
      source_topic: topic,
      objective: creator_context.campaign_description,
      content_theme: creator_context.content_theme,
      selected_angle: 'creator_execution_engine',
      platform_targets: creator_context.target_platforms,
      platforms_generated: Object.keys(platformVariants),
    };

    // Step 9: Record feedback tracking (immediate for creator content)
    void job.updateProgress(90);
    await recordCreatorContentFeedback({
      company_id,
      content_type,
      platforms: creator_context.target_platforms,
      theme_used: creator_context.content_theme,
      angle_used: 'creator_execution_engine',
      timestamp: new Date(),
    });

    // Step 10: Return complete generation output
    void job.updateProgress(100);
    return {
      success: true,
      content_type,
      master_content: canonicalOutput.asset_instruction.blueprint,
      platform_variants: platformVariants,
      generation_trace: decisionTrace,
      estimated_cost_usd: costUsd,
      validation_result: validationResult,
      target_platforms: creator_context.target_platforms,
      canonical_output: canonicalOutput,
      // Phase 5 parity — queue worker now exposes the persisted asset
      // id so downstream consumers can reference creator_assets.
      creator_asset_id: orchestrated.persistedAssetId,
      render_strategy: orchestrated.renderStrategy,
    };
  } catch (error) {
    console.error(`[creatorContentProcessor] Error processing ${content_type}:`, error);
    throw error;
  }
}

/**
 * Generate 3 narrative angles for visual content
 * Tailored to visual storytelling, platform-native hooks, engagement psychology
 */
async function generateCreatorAngles(
  topic: string,
  audience: string | undefined,
  creatorContext: any,
  contentType: string
): Promise<ContentAngle[]> {
  const systemPrompt = getCreatorSystemPrompt(contentType as any, creatorContext);

  // Create 3 angle generation prompt
  const anglesPrompt = `Given the topic "${topic}" for ${contentType} content targeting ${audience || 'general audience'}, and with the campaign context "${creatorContext.campaign_description}", generate 3 distinct narrative angles optimized for visual storytelling on ${creatorContext.target_platforms?.join(', ')}.

Each angle should be fundamentally different in:
1. **Hook approach** - How to grab attention in first 1-2 seconds
2. **Visual narrative** - The visual progression that tells the story
3. **Emotional resonance** - What feeling/reaction drives engagement

Format as JSON array with: type (analytical/contrarian/strategic), label, title, angle_summary (50 words), and hook (one sentence that appears on-screen)`;

  const response = await runCompletionWithOperation({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: anglesPrompt },
    ],
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    operation: 'creator_angles_generation',
  });

  try {
    const parsed = JSON.parse(response.output || '{}');
    const angles = Array.isArray(parsed) ? parsed : parsed.angles || [];
    console.log(`[generateCreatorAngles] Parsed ${angles.length} angles from AI response`);
    return angles;
  } catch (error) {
    console.warn(`[generateCreatorAngles] AI parsing failed, using fallback:`, error instanceof Error ? error.message : error);
    return buildFallbackCreatorAngles(topic, contentType);
  }
}

/**
 * Select optimal angle based on feedback + creator context
 */
async function selectOptimalCreatorAngle(
  angles: ContentAngle[],
  preference: string | undefined,
  company_id: string
): Promise<ContentAngle> {
  if (preference && angles.some(a => a.type === preference)) {
    return angles.find(a => a.type === preference)!;
  }

  // TODO: Query feedback effectiveness for this company
  // For now, default to strategic (most versatile for visual content)
  return angles.find(a => a.type === 'strategic') || angles[0];
}

/**
 * Generate master creator content (video script / carousel / story)
 */
async function generateCreatorMasterContent(
  topic: string,
  audience: string | undefined,
  angle: ContentAngle,
  creatorContext: any,
  contentType: string
): Promise<any> {
  const systemPrompt = getCreatorSystemPrompt(contentType as any, creatorContext);

  const contentPrompt = `Generate a ${contentType} for the topic "${topic}" targeting ${audience || 'general audience'}.

Angle: ${angle.label} (${angle.angle_summary})
Campaign: ${creatorContext.campaign_description}
Theme: ${creatorContext.content_theme}
Target Platforms: ${creatorContext.target_platforms?.join(', ')}
Brand Visual Tone: ${creatorContext.brand_visual_tone || 'professional'}
Audio Guidance: ${creatorContext.audio_guidance || 'platform-native'}

Requirements:
- Hook must follow the pattern of the ${angle.type} angle
- Visual descriptions must be specific and actionable
- Each platform variant must respect the platform's native constraints
- The narrative must drive the campaign objective

Output ONLY valid JSON matching the ${contentType} format.`;

  const response = await runCompletionWithOperation({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contentPrompt },
    ],
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: `creator_content_generation_${contentType}`,
  });

  try {
    const content = JSON.parse(response.output || '{}');
    return {
      ...content,
      metadata: {
        selected_angle: angle,
        campaign_context: creatorContext.campaign_description,
        theme: creatorContext.content_theme,
      },
    };
  } catch {
    throw new Error(`Failed to parse ${contentType} content generation response`);
  }
}

/**
 * Fallback angles for creator content when AI generation fails
 */
function buildFallbackCreatorAngles(topic: string, contentType: string): ContentAngle[] {
  return [
    {
      type: 'analytical',
      label: 'Deep Dive',
      title: `Analyzing ${topic}: The Data Behind It`,
      angle_summary: `Educational angle that breaks down ${topic} into key insights with data, statistics, and framework. Appeals to audiences seeking understanding.`,
      hook: `The real reason ${topic} matters (and the data proves it)`,
    },
    {
      type: 'contrarian',
      label: 'Counterintuitive',
      title: `Everyone's Wrong About ${topic}`,
      angle_summary: `Challenge conventional wisdom on ${topic}. Presents counter-narrative with evidence. High engagement through controversy/surprise.`,
      hook: `What everyone gets wrong about ${topic}`,
    },
    {
      type: 'strategic',
      label: 'Actionable',
      title: `How to Win at ${topic}`,
      angle_summary: `Practical, outcome-focused narrative. Provides specific steps/framework to achieve results with ${topic}. Appeals to doers/builders.`,
      hook: `Here's exactly how to leverage ${topic} for results`,
    },
  ];
}

/**
 * Estimate tokens for creator content (accounts for multiple platforms)
 */
function estimateCreatorTokens(blueprint: any, contentType: string): number {
  let tokens = 0;

  if (contentType === 'video_script') {
    // Estimate from scenes
    const scenesText = blueprint.scenes?.reduce((sum: number, s: any) => {
      return sum + (s.visual?.length || 0) + (s.dialogue?.length || 0) + (s.audio_cue?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(scenesText / 4); // ~4 chars per token
  } else if (contentType === 'carousel') {
    // Estimate from slides
    const slidesText = blueprint.slides?.reduce((sum: number, s: any) => {
      return sum + (s.headline?.length || 0) + (s.body_text?.length || 0) + (s.visual_description?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(slidesText / 4);
  } else if (contentType === 'story') {
    // Estimate from frames
    const framesText = blueprint.frames?.reduce((sum: number, f: any) => {
      return sum + (f.story_text?.length || 0) + (f.visual_cue?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(framesText / 4);
  }

  return Math.max(tokens, 100); // Minimum 100 tokens for creator content
}

/**
 * Advisory pre-flight USD estimator — DB-backed via pricingService. Returns
 * BASE model cost only (no multiplier); applies a creator-type scaling factor
 * to account for the heavier prompt/output shape of video/carousel scripts.
 *
 * Real billing must flow through resolveLlmCost + executeWithCredits (Phase 4).
 */
async function estimateCost(tokens: number, contentType: string): Promise<number> {
  const creatorMultiplier = contentType === 'video_script' ? 1.5 : 1.2;
  const inputTokens = tokens * 0.75;
  const outputTokens = tokens * 0.25;
  const baseUsd = await estimateLlmCostUsd('openai', 'gpt-4o-mini', inputTokens, outputTokens);
  return Math.round(baseUsd * creatorMultiplier * 10000) / 10000;
}

/**
 * TODO: Integrate with credit system
 */
async function deductCredits(
  company_id: string,
  operation: string,
  costUsd: number
): Promise<void> {
  console.log(
    `[creatorContentProcessor] Deducting $${costUsd} from ${company_id} for ${operation}`
  );
  // Actual credit deduction via creditSystemService
}

/**
 * Record creator content feedback for learning
 * Tracks: theme effectiveness, platform performance, angle resonance
 */
async function recordCreatorContentFeedback(data: Record<string, unknown>): Promise<void> {
  try {
    await recordCreatorFeedback(data as any);
    console.debug('[creatorContentProcessor] Feedback recorded:', data);
  } catch (error) {
    console.warn('[creatorContentProcessor] Feedback recording failed (non-blocking):', error);
  }
}

/* ── Phase 2 — BOLT-row execution branch ────────────────────────────── */

import { ownedDbTable } from '../../db/writeOwner';
import { CREATOR_LIFECYCLE_STATES } from '../../../lib/shared/creatorGovernanceRegistry';
import { extractCreatorMediaUrls } from '../../../lib/preview/previewUtils';

type BoltCreatorRowJobData = {
  run_id?: string | null;
  campaign_id: string;
  company_id: string;
  user_id: string | null;
  daily_plan_id: string;
  parsed_content: Record<string, unknown>;
  topic: string;
  content_type: string;
  platform: string;
  audience: string;
  objective: string;
  summary: string;
  template_id: string | null;
  max_retries: number;
};

// Phase 4 — local `extractMediaUrlsLocal` consolidated into the shared
// `extractCreatorMediaUrls` in lib/preview/previewUtils.

/**
 * Process a BOLT daily-plan row as an isolated queue job. Mirrors the
 * legacy in-process logic from `creatorAssetGenerationRuntime`'s
 * autonomous-renderable branch — engine + render + persist via the
 * orchestrator, then the daily_content_plans row mutation BOLT was
 * doing inline. BullMQ retries replace the in-loop max_retries.
 */
async function processBoltCreatorRowJob(job: Job, payload: BoltCreatorRowJobData): Promise<any> {
  const { runCreatorOrchestration } = await import('../../services/creator/creatorOrchestrator');
  const attempt = job.attemptsMade ?? 0;
  const parsed = payload.parsed_content && typeof payload.parsed_content === 'object'
    ? payload.parsed_content
    : {};
  const creatorCard = (parsed && typeof (parsed as any).creator_card === 'object')
    ? (parsed as any).creator_card as Record<string, unknown>
    : {};

  try {
    void job.updateProgress(20);
    const orchestrated = await runCreatorOrchestration({
      campaignId: payload.campaign_id,
      companyId: payload.company_id,
      userId: payload.user_id,
      topic: payload.topic,
      contentType: payload.content_type,
      targetPlatforms: [payload.platform],
      audience: payload.audience,
      objective: payload.objective,
      summary: payload.summary,
      creatorCard,
      enrichedIntent: parsed as Record<string, unknown>,
      templateId: payload.template_id,
      existingContent: parsed as Record<string, unknown>,
      origin: 'bolt',
      dailyPlanId: payload.daily_plan_id,
    });

    void job.updateProgress(80);
    const renderedOutput = orchestrated.output;
    const readiness = orchestrated.readiness ?? { ready: true };
    const creatorAssetId = orchestrated.persistedAssetId;
    const transitionContent = orchestrated.lifecycleTransition?.content ?? null;
    const finalLifecycleState = orchestrated.lifecycleTransition?.to
      ?? (readiness.ready ? CREATOR_LIFECYCLE_STATES.RENDER_READY : CREATOR_LIFECYCLE_STATES.RENDER_FAILED);

    const mergedContent = {
      ...parsed,
      ...(transitionContent ?? {}),
      ...renderedOutput,
      creator_lifecycle_state: finalLifecycleState,
      creator_lifecycle_history: (transitionContent && Array.isArray((transitionContent as any).creator_lifecycle_history))
        ? (transitionContent as any).creator_lifecycle_history
        : ((parsed as any).creator_lifecycle_history ?? []),
      render_policy: (transitionContent as any)?.render_policy ?? { mode: 'render_only' },
      creator_asset_id: creatorAssetId,
      rendered_asset: {
        creator_asset_id: creatorAssetId,
        urls: extractCreatorMediaUrls(renderedOutput),
        readiness,
        rendered_at: new Date().toISOString(),
        export_ready: !!readiness.ready,
      },
      content_status: readiness.ready ? 'render_ready' : 'render_failed',
    };

    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify(mergedContent),
        intent_type: 'creator',
        asset_type: renderedOutput.asset_type,
        template_id: renderedOutput.asset_instruction.template_id ?? payload.template_id ?? null,
        retry_count: attempt,
        max_retries: payload.max_retries,
        failure_reason: readiness.ready ? null : (readiness.failure_reason ?? null),
        failure_type: readiness.ready ? null : 'permanent',
        content_status: readiness.ready ? 'render_ready' : 'render_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.daily_plan_id);

    void job.updateProgress(100);
    return {
      ok: true,
      rendered: !!readiness.ready,
      awaiting_upload: false,
      failed: !readiness.ready,
      failure_reason: readiness.ready ? null : (readiness.failure_reason ?? null),
      persisted_asset_id: creatorAssetId,
      lifecycle_state: finalLifecycleState,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isFinalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? payload.max_retries);
    if (isFinalAttempt) {
      await ownedDbTable('daily_content_plans')
        .update({
          retry_count: payload.max_retries,
          max_retries: payload.max_retries,
          failure_reason: message,
          failure_type: 'transient',
          content_status: 'render_failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.daily_plan_id);
    }
    // Rethrow so BullMQ records the attempt + applies backoff.
    throw error;
  }
}

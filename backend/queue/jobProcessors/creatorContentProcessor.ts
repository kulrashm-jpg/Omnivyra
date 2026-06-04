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

  // Phase 8G-A — credit-economy shadow (dark, fire-and-forget; never blocks/mutates).
  void import('../../services/billing/creditEconomyShadow')
    .then((m) => m.emitCreditEconomyShadowEvaluation({ organizationId: String(company_id), activity: 'content_generation', surface: 'queue.creator-content', dedupeKey: `${job.id ?? content_type}` }))
    .catch(() => {});

  // Phase 11D — admission boundary (single call; dark by default → passthrough,
  // no wallet read; shadow-observes / enforce-blocks once configured).
  await (await import('../../services/billing/admissionControl')).evaluateActivityAdmission({
    organizationId: String(company_id),
    activity:       'content_generation',
    surface:        'queue.creator-content',
    referenceId:    `${job.id ?? content_type}`,
  });

  // Phase 2 C-1 closure: same wrap-on-flag pattern as content generation.
  // The internal `deductCredits()` is a stub; turning the flag ON activates
  // real billing through the orchestrator with exactly-once semantics.
  const { isBillingFlagEnabled, BILLING_FLAGS } = await import('../../services/billing/billingFeatureFlags');
  const flag = await isBillingFlagEnabled({
    organizationId: company_id,
    flag:           BILLING_FLAGS.RESERVATIONS_REQUIRED,
  });

  // Phase 10C — token-actual entry-consumption when enabled (default OFF →
  // existing path). Actual tokens collected via AsyncLocalStorage across
  // runCreatorOrchestration; settled token-actual; entry kept + exposure
  // released on abandonment. Replay-safe via deterministic idem key.
  const { executeWithEntryConsumption, makeIdempotencyKey } =
    await import('../../services/creditExecutionService');
  const { getCreditEconomyExecutionMode } = await import('../../services/billing/creditEconomyActivation');
  if ((await getCreditEconomyExecutionMode({ organizationId: String(company_id), surface: 'queue.creator-content' })) === 'enforce') {
    const referenceId = `${job.id ?? content_type}`;
    const { runWithUsageCollection } = await import('../../services/aiUsageCollector');
    let collected = { inputTokens: 0, outputTokens: 0, assetCredits: 0 };
    const r = await executeWithEntryConsumption<unknown>({
      userId:             String(user_id ?? company_id),
      orgId:              String(company_id),
      action:             'content_generation',
      referenceType:      'creator_content_job',
      referenceId,
      idempotencyKey:     makeIdempotencyKey(String(company_id), 'content_generation', referenceId),
      validateMembership: false,
      llmPricing:         { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', actionKey: 'content_generation', maxInputTokens: 8000, maxOutputTokens: 4000 },
      executor:           async () => {
        const { result, usage } = await runWithUsageCollection(() => processCreatorContentJobInner(job));
        collected = usage;
        return result;
      },
      collectActualUsage: () => ({ inputTokens: collected.inputTokens, outputTokens: collected.outputTokens, additionalCredits: collected.assetCredits }),
    });
    return r.status === 'executed' ? (r.result as unknown) : { skipped: true, reason: r.status };
  }

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

    // Campaign Multi-Variant Execution Completion — Phase 2. Resolve
    // FULL campaign variant plan (best-effort). Absence preserves prior
    // single-asset behavior.
    let variantPlan: import('../../services/creator/campaignVariantApplier').CampaignVariantPlan | null = null;
    const campaignIdForVariant = (activity_workspace as any)?.campaign_id
      ? String((activity_workspace as any).campaign_id)
      : null;
    if (campaignIdForVariant) {
      try {
        const { supabase } = await import('../../db/supabaseClient');
        const { data: campaignRow } = await supabase
          .from('campaign_versions')
          .select('campaign_snapshot')
          .eq('campaign_id', campaignIdForVariant)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (campaignRow) {
          const { resolveCampaignVariantPlan } = await import('../../services/creator/campaignVariantApplier');
          variantPlan = resolveCampaignVariantPlan({
            campaign: campaignRow,
            companyId: company_id,
            campaignId: campaignIdForVariant,
            platform: primaryPlatform,
            creatorId: String((activity_workspace as any)?.user_id || '') || null,
          });
        }
      } catch (error) {
        console.warn('[creator-content-processor][campaign-variant-resolve-failed]', {
          campaign_id: campaignIdForVariant,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const isFanOut = variantPlan !== null && variantPlan.decisions.length > 1;
    const singleAppliedVariant = variantPlan && variantPlan.decisions[0]
      ? {
          strategy_id: variantPlan.strategy_id,
          variant_id: variantPlan.decisions[0].variant_id,
          variant_family: variantPlan.decisions[0].variant_family,
        }
      : null;

    void job.updateProgress(35);
    const baseOrchestratorInput = {
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
      origin: 'queue' as const,
    };
    let fanOutResult: import('../../services/creator/campaignVariantFanOut').CampaignFanOutResult | null = null;
    let orchestrated;
    if (isFanOut && variantPlan) {
      const { runCampaignVariantFanOut } = await import('../../services/creator/campaignVariantFanOut');
      fanOutResult = await runCampaignVariantFanOut({
        plan: variantPlan,
        orchestratorInput: baseOrchestratorInput,
      });
      const first = fanOutResult.generated_asset;
      if (!first || !first.result) {
        throw new Error(`fan-out produced no successful assets (${fanOutResult.generated_assets.length} attempted)`);
      }
      orchestrated = first.result;
    } else {
      orchestrated = await runCreatorOrchestration({
        ...baseOrchestratorInput,
        appliedVariant: singleAppliedVariant,
      });
    }
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
    // Fan-Out Completion — Phase 1+2+3. Secondary-platform adaptation
    // is now applied to every successful fan-out asset (was: only the
    // first asset's canonicalOutput). Each per-asset adaptation:
    //   - reuses the existing engine.adaptForPlatform pipeline (no new
    //     adaptation architecture)
    //   - is wrapped in try/catch so a single adaptation failure does
    //     NOT abort the campaign (Phase 2 — partial failure safety)
    //   - inherits the variant envelope from the per-asset orchestrator
    //     output via media_bundle.metadata, so attribution survives
    //     unchanged (Phase 3 — preserves strategy_id / variant_id /
    //     variant_family / experiment_id)
    //
    // `perAssetAdaptations` is shaped as
    //   { variant_id → { platform → { ok, asset_payload?, packaging?, error? } } }
    // The legacy `platform_variants` map is preserved (mirrors the
    // PRIMARY successful asset) so single-asset callers see no change.
    const perAssetAdaptations: Record<string, Record<string, {
      ok: boolean;
      asset_payload?: Record<string, unknown>;
      packaging?: Record<string, unknown>;
      asset_type?: string;
      error?: string;
    }>> = {};
    if (targetPlatformsArr.length > 1) {
      const engine = createCreatorExecutionEngine();
      // Build the list of outputs to adapt. Fan-out → all successful
      // results; single-asset → just the primary orchestrator output.
      type AdaptTarget = {
        variantKey: string;
        output: typeof canonicalOutput;
      };
      const adaptTargets: AdaptTarget[] = fanOutResult
        ? fanOutResult.generated_assets
            .filter((a) => a.ok && a.result)
            .map((a) => ({
              variantKey: a.variant_id,
              output: a.result!.output,
            }))
        : [{ variantKey: 'primary', output: canonicalOutput }];

      for (const { variantKey, output } of adaptTargets) {
        perAssetAdaptations[variantKey] = perAssetAdaptations[variantKey] ?? {};
        // Mark the primary platform as already-adapted (the
        // orchestrator already adapted+rendered it for this asset).
        perAssetAdaptations[variantKey][primaryPlatform] = {
          ok: true,
          asset_payload: safeObject((output.asset_payload as Record<string, unknown>).platform_payload) || output.asset_payload,
          packaging: output.packaging.platform_variants[primaryPlatform] ?? {
            caption: output.packaging.caption,
            hashtags: output.packaging.hashtags,
          },
          asset_type: output.asset_type,
        };
        for (const platform of targetPlatformsArr.slice(1)) {
          try {
            const adapted = await engine.adaptForPlatform(output, platform);
            perAssetAdaptations[variantKey][platform] = {
              ok: true,
              asset_payload: safeObject((adapted.asset_payload as Record<string, unknown>).platform_payload) || adapted.asset_payload,
              packaging: adapted.packaging.platform_variants[platform] ?? {
                caption: adapted.packaging.caption,
                hashtags: adapted.packaging.hashtags,
              },
              asset_type: adapted.asset_type,
            };
            // Legacy single-platform map mirrors the FIRST successful
            // (primary asset's) secondary-platform adaptation so
            // existing callers see the same shape they always did.
            if (!fanOutResult && !platformVariants[platform]) {
              platformVariants[platform] = perAssetAdaptations[variantKey][platform];
            }
          } catch (error) {
            perAssetAdaptations[variantKey][platform] = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
            console.warn('[creatorContentProcessor][secondary-adapt-failed]', {
              variant_id: variantKey,
              platform,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      // Fan-out case: legacy `platform_variants` mirrors the FIRST
      // successful asset's adaptation map so single-asset callers
      // continue to see the canonical shape.
      if (fanOutResult) {
        const firstVariantKey = fanOutResult.generated_asset?.variant_id ?? null;
        if (firstVariantKey && perAssetAdaptations[firstVariantKey]) {
          for (const [platform, entry] of Object.entries(perAssetAdaptations[firstVariantKey])) {
            if (entry.ok && !platformVariants[platform]) {
              platformVariants[platform] = {
                asset_payload: entry.asset_payload,
                packaging: entry.packaging,
                asset_type: entry.asset_type,
              };
            }
          }
        }
      }
    }

    // Step 7: Estimate cost & deduct credits.
    // Fan-Out Completion — Phase 4/6. Cost is computed per generated
    // asset so the post-execution report can surface the real (not
    // estimated) credit usage of a multi-asset run.
    void job.updateProgress(75);
    const successfulOutputs = fanOutResult
      ? fanOutResult.generated_assets
          .filter((a) => a.ok && a.result)
          .map((a) => a.result!.output)
      : [canonicalOutput];
    let aggregatedCostUsd = 0;
    const perAssetCostUsd: Array<{ variant_id: string | null; cost_usd: number }> = [];
    for (let i = 0; i < successfulOutputs.length; i++) {
      const out = successfulOutputs[i];
      const tokens = estimateCreatorTokens(out.asset_instruction.blueprint, content_type);
      const c = await estimateCost(tokens, content_type);
      aggregatedCostUsd += c;
      const variantId = fanOutResult
        ? fanOutResult.generated_assets.filter((a) => a.ok)[i]?.variant_id ?? null
        : null;
      perAssetCostUsd.push({ variant_id: variantId, cost_usd: c });
    }
    const costUsd = aggregatedCostUsd;
    await deductCredits(company_id, `content_${content_type}`, costUsd);

    // Cost Estimate Accuracy — Phase 5. Record the (estimated vs actual)
    // observation against the historical store so the calibration
    // surface can compute mean variance per (content_type × mode).
    // Best-effort — never blocks generation.
    try {
      const { estimateCampaignVariantBilling } =
        await import('../../services/creator/campaignVariantBillingEstimator');
      const { recordCostObservation } =
        await import('../../services/creator/costObservationStore');
      const variantMode = (variantPlan?.mode ?? 'no_variant') as
        | 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment' | 'no_variant';
      // Re-compute the estimate the operator would have seen so the
      // observation pairs against the SAME assumption set the UI
      // showed. (We don't have the UI's payload here; reproducing
      // the estimate locally is the canonical record.)
      let estimatedUsd = 0;
      if (campaignIdForVariant) {
        try {
          const { supabase: sb } = await import('../../db/supabaseClient');
          const { data: campaignRow } = await sb
            .from('campaign_versions')
            .select('campaign_snapshot')
            .eq('campaign_id', campaignIdForVariant)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (campaignRow) {
            const estimate = estimateCampaignVariantBilling({
              campaign: campaignRow,
              companyId: company_id,
              campaignId: campaignIdForVariant,
              platform: primaryPlatform,
              creatorId: String((activity_workspace as any)?.user_id || '') || null,
              contentType: content_type,
              targetPlatforms: targetPlatformsArr,
            });
            estimatedUsd = estimate.total_estimated_usd;
          }
        } catch {
          // No-op; fall through to estimated=0 → variance reported as null.
        }
      }
      recordCostObservation({
        companyId: company_id,
        contentType: String(content_type ?? ''),
        variantMode,
        assetCount: successfulOutputs.length,
        estimatedUsd,
        actualUsd: costUsd,
      });
    } catch {
      // Best-effort.
    }

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
      // Fan-Out Completion — Phase 1+2+3. Per-asset secondary-platform
      // adaptation status. Single-asset callers ignore this field.
      per_asset_adaptations: perAssetAdaptations,
      // Fan-Out Completion — Phase 6. Per-asset cost rollup for the
      // post-execution report. Single-asset callers see one entry.
      per_asset_cost_usd: perAssetCostUsd,
      // Cost Estimate Accuracy — Phase 5. Surface (estimated, actual,
      // variance) so the post-execution UI can render the comparison.
      cost_observation: (() => {
        const { listRecentObservations } =
          require('../../services/creator/costObservationStore') as typeof import('../../services/creator/costObservationStore');
        const recent = listRecentObservations({ companyId: company_id, limit: 1 });
        return recent[0] ?? null;
      })(),
      // Campaign Multi-Variant Execution Completion — Phase 6.
      // Multi-asset response payload (additive — single-asset callers
      // ignore these fields).
      ...(fanOutResult ? {
        generated_assets: fanOutResult.generated_assets.map((a) => ({
          rank: a.rank,
          variant_id: a.variant_id,
          variant_family: a.variant_family,
          strategy_id: a.strategy_id,
          experiment_id: a.experiment_id,
          persisted_asset_id: a.result?.persistedAssetId ?? null,
          ok: a.ok,
          ...(a.error ? { error: a.error } : {}),
        })),
        variant_mode: fanOutResult.mode,
        variant_strategy_id: fanOutResult.strategy_id,
        experiment_id: fanOutResult.experiment_id,
      } : {}),
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
  /** Auto-schedule an autonomous row on render completion (Schedule outcomes). */
  auto_schedule_on_render?: boolean;
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

    // Calendar unification: when this autonomous asset finished rendering in a
    // SCHEDULE outcome, auto-create its scheduled_post immediately (reusing the
    // just-rendered media) so it lands on the Schedule calendar without a
    // pipeline re-run. Best-effort + idempotent (creator-render:<id> key +
    // lifecycle guard); the BOLT schedule stage remains the backstop. Gated on
    // the run flag so Daily-Plan (RENDER_ONLY) stays plan-only.
    if (readiness.ready && payload.auto_schedule_on_render) {
      const renderedUrls = Array.isArray((mergedContent.rendered_asset as any)?.urls)
        ? ((mergedContent.rendered_asset as any).urls as unknown[]).filter((u) => typeof u === 'string' && u.trim())
        : [];
      if (renderedUrls.length > 0) {
        try {
          const { scheduleRenderedAutonomousRowById } = await import('../../services/creator/creatorRowScheduler');
          await scheduleRenderedAutonomousRowById(payload.daily_plan_id);
        } catch (scheduleErr: any) {
          console.warn('[bolt-creator-row][autonomous-auto-schedule-failed]', payload.daily_plan_id, scheduleErr?.message);
        }
      }
    }

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

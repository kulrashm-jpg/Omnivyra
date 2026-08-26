/** Part 4/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { config } from '../../config';
import {
  buildCreatorBrandKitMetadata,
  normalizeBrandMark,
  resolveCreatorBrandKit,
  type CreatorBrandKit,
} from './creatorBrandKit';
import { resolveBrand } from './brand/brandRuntime';
import { brandRuntimeToCreatorBrandKit } from './brand/brandRuntimeAdapter';
import { captureImageProviderCost } from './billing/blackHoleCostCapture';
import { recordAssetCredits } from './aiUsageCollector';
import { resolveCostProfile } from './creator/costProfiles';
import { fitSlideArcToCount } from './creator/purposeStrategyRegistry';
import { resolveTemplateStyle } from '../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { isBetaAiRenderMode, createBetaMockImage, BETA_MOCK_MODEL } from './creator/rendering/providers/betaMockRenderProvider';
import { creatorEvent } from './creatorObservation';
import { recordCreatorDuration } from './creatorRuntimeMetrics';
import { validateProviderImageTextSafety } from './creatorImageTextValidation';
import { runCreatorOcr, isLightweightSocialEmbeddedCopy } from './creatorOcrProvider';
import {
  autoCorrectVisualCopy,
  buildPreviewGovernanceWarnings,
  estimateTextAreaPercent,
  resolveAssetGovernanceProfile,
  resolvePlatformVisualProfile,
  scoreCreatorQuality,
  validateVisualGovernance,
} from './creatorAssetGovernance';
import { estimateTextBox, validateLayoutGeometry } from './creatorRenderGeometry';
import {
  assertRenderManifestExportable,
  createRenderManifest,
  synthesizeReadingOrderForOverlay,
  type GovernanceCompatibilityFlags,
} from './creatorRenderManifest';
import { detectSemanticThreadDuplication } from './creatorSemanticDuplication';
import { validateCreatorAccessibility } from './creatorAccessibilityValidation';
import { logPipelineEvent } from '../../lib/shared/observability';
import { persistCreatorValidationManifest } from './creatorRenderPersistence';
import { resolvePlatformGeometryProfile, platformTextBoxY } from './creatorPlatformGeometry';
import { getCreatorRendererRegistration } from './creatorRendererRegistry';
import { composeInfographicCopy } from './creator/infographicCopyComposer';
import {
  infographicChartsEnabled,
  infographicTablesEnabled,
  infographicBackgroundImagesEnabled,
  resolveStructuredCards,
  resolveBackgroundConfig,
  buildBackgroundLayerSvg,
  buildChartCardSvg,
  buildTableCardSvg,
  type InfographicCardBrand,
} from './creator/infographicDataCards';
// Canonical Template visual-language consumption (TEMPLATE-003). The renderer
// reads its visual constants from the resolved family style via the ONE
// canonical resolver. No template / unknown id → the canonical DEFAULT style,
// whose values equal the prior hardcoded constants → byte-identical output.
import {
  resolveTemplate,
  infographicStyleForBlueprint,
  infographicLayoutForBlueprint,
  infographicCompositionForBlueprint,
  semanticStructureForBlueprint,
  semanticSlotCountForBlueprint,
  DEFAULT_IMAGE_STYLE,
  DEFAULT_INFOGRAPHIC_STYLE,
  type InfographicStyleSchema,
  type InfographicEngineGeometry,
  type ImageStyleSchema,
  type CarouselStyleSchema,
  type PresetVariant,
  type CreatorTemplate,
} from '../../lib/creator-templates';
import { registerCuratedSystemTemplates } from '../../lib/creator-outcomes/curatedSystemTemplatesFull';
import { ensureRenderFonts } from './creatorRenderFonts';

// FONT PARITY (PHASE 14J): configure fontconfig to discover the vendored fonts
// BEFORE sharp loads. Every infographic render path — render-inline,
// generate-inline (orchestrator), and the worker — flows through this module,
// so initializing here (the single render chokepoint) gives them all the
// identical font contract render-inline previously had alone. Idempotent +
// never throws; a no-op where system fonts already exist (e.g. the worker).
ensureRenderFonts();
import { AI_IMAGE_TIMEOUT_MS, safeObject, compactText } from './creatorAssetRendererContracts';
import { buildOverlaySvg } from './creatorAssetRendererOverlay';
import { generateProviderImage, type ImageSubtypeHint } from './creatorAssetRendererMedia';
// Type-only: the composer itself stays lazily required below (import cycle), so
// this adds no runtime edge.
import type { ReferenceImage } from './creator/creatorPromptComposer';

export function buildAiImagePrompt(input: {
  title: string;
  body: string;
  eyebrow: string;
  metadata: Record<string, unknown>;
  assetPayload: Record<string, unknown>;
  attachmentMode?: string | null;
  subtypeHint?: ImageSubtypeHint | null;
  /** Used for brand visual memory lookup/update (Phase 9). */
  companyId?: string | null;
  /**
   * CONDITION-lane composition references, already resolved and routed by
   * `resolveCompositionAssets`. Passed straight through to the existing
   * `additionalReferences` parameter of `assembleMultimodalPayload` — no second
   * provider call, no reinterpretation, and provider capability remains
   * authoritative over what actually reaches the model.
   *
   * Omitted (every existing caller) → the payload is assembled exactly as before.
   */
  additionalReferences?: ReferenceImage[];
}): string {
  const brandContext = safeObject(input.metadata.brand_context);
  const selectedAssets = safeObject(input.metadata.selected_brand_assets);
  const productContextRaw = safeObject(input.metadata.product_context);
  const brandKit = safeObject(input.metadata.brand_kit ?? selectedAssets);
  const palette = Array.isArray(input.assetPayload.color_palette)
    ? input.assetPayload.color_palette.map((v) => String(v)).filter(Boolean).slice(0, 5)
    : Array.isArray(brandKit.palette)
      ? (brandKit.palette as unknown[]).map((v) => String(v)).filter(Boolean).slice(0, 5)
      : [];

  // Lazy require so the creative-intelligence modules are only loaded
  // when the renderer actually needs them.
  const { composeCreatorImagePrompt } =
    require('./creator/creatorPromptComposer') as typeof import('./creator/creatorPromptComposer');
  const { assembleMultimodalPayload } =
    require('./creator/creatorMultimodalReferences') as typeof import('./creator/creatorMultimodalReferences');
  const { scoreCreatorPromptQuality, computeRetryDirective } =
    require('./creator/creatorOutputQualityRanking') as typeof import('./creator/creatorOutputQualityRanking');
  const { getBrandVisualPreference, updateBrandVisualPreference } =
    require('./creator/creatorVisualBrandMemory') as typeof import('./creator/creatorVisualBrandMemory');
  const {
    sanitizeGuidedChoices, subjectEmphasisFor, getVisualDirection,
  } = require('../../lib/content/guidedCreativeDirection') as typeof import('../../lib/content/guidedCreativeDirection');
  type SubjectChoice = import('../../lib/content/guidedCreativeDirection').SubjectChoice;
  const { getVisualStyle } =
    require('../../lib/creator-outcomes/creatorVisualStyleRegistry') as typeof import('../../lib/creator-outcomes/creatorVisualStyleRegistry');
  const { planCreativeDirection } =
    require('./creator/creativeDirectorEngine') as typeof import('./creator/creativeDirectorEngine');
  const { orchestrateCreativeVariants } =
    require('./creator/creativeVariantOrchestrator') as typeof import('./creator/creativeVariantOrchestrator');
  const { rankCreativeAesthetic, pickWinningVariant } =
    require('./creator/creativeAestheticRanking') as typeof import('./creator/creativeAestheticRanking');
  const { planOrFetchCampaignDNA, projectAssetPlanFromDNA } =
    require('./creator/campaignCoherenceEngine') as typeof import('./creator/campaignCoherenceEngine');
  const { resolvePlatformAdaptation } =
    require('./creator/platformVisualAdaptation') as typeof import('./creator/platformVisualAdaptation');
  const { evaluateBrandGovernance } =
    require('./creator/brandGovernanceEngine') as typeof import('./creator/brandGovernanceEngine');
  const { computeOptimizationDirective, decideAutonomousOperation } =
    require('./creator/autonomousCreativeOptimizer') as typeof import('./creator/autonomousCreativeOptimizer');
  const { recordTelemetryEvent } =
    require('./creator/creatorPerformanceTelemetry') as typeof import('./creator/creatorPerformanceTelemetry');

  const composerInput: import('./creator/creatorPromptComposer').CreatorPromptInput & Record<string, unknown> = {
    title: input.title,
    body: input.body,
    eyebrow: input.eyebrow,
    attachmentMode: input.attachmentMode,
    subtypeHint: input.subtypeHint ? { promptLine: input.subtypeHint.promptLine } : null,
    brandKit: {
      companyName: typeof brandKit.companyName === 'string' ? brandKit.companyName : (typeof brandContext.companyName === 'string' ? brandContext.companyName : undefined),
      logoUrl: typeof brandKit.logoUrl === 'string' ? brandKit.logoUrl : (typeof brandContext.logoUrl === 'string' ? brandContext.logoUrl : undefined),
      faviconUrl: typeof brandKit.faviconUrl === 'string' ? brandKit.faviconUrl : (typeof brandContext.faviconUrl === 'string' ? brandContext.faviconUrl : undefined),
      palette,
      accentColor: typeof brandKit.accentColor === 'string' ? brandKit.accentColor : (typeof brandContext.accentColor === 'string' ? brandContext.accentColor : undefined),
      typography: typeof brandKit.typography === 'object' && brandKit.typography !== null ? brandKit.typography as { fontFamily?: string } : undefined,
      tone: typeof brandContext.tone === 'string' ? brandContext.tone : (typeof input.metadata.tone === 'string' ? input.metadata.tone : undefined),
      industry: typeof brandKit.industry === 'string' ? brandKit.industry : (typeof brandContext.industry === 'string' ? brandContext.industry : undefined),
      domain: typeof brandKit.domain === 'string' ? brandKit.domain : (typeof brandContext.domain === 'string' ? brandContext.domain : undefined),
    },
    productContext: {
      productName: typeof productContextRaw.productName === 'string' ? productContextRaw.productName : (typeof brandContext.productName === 'string' ? brandContext.productName : undefined),
      productCategory: typeof productContextRaw.productCategory === 'string' ? productContextRaw.productCategory : undefined,
      screenshotUrls: Array.isArray(productContextRaw.screenshotUrls) ? (productContextRaw.screenshotUrls as unknown[]).map(String) : undefined,
      dashboardDescription: typeof productContextRaw.dashboardDescription === 'string' ? productContextRaw.dashboardDescription : undefined,
      uiKeywords: Array.isArray(productContextRaw.uiKeywords) ? (productContextRaw.uiKeywords as unknown[]).map(String) : undefined,
    },
    audience: compactText(input.metadata.audience),
    platform: compactText(input.metadata.platform || input.metadata.primary_platform),
    objective: compactText(input.metadata.objective || input.metadata.summary),
    tagline: compactText(brandContext.tagline || selectedAssets.tagline),
    brandMode: typeof input.metadata.brand_generation_mode === 'string'
      ? input.metadata.brand_generation_mode
      : (typeof input.metadata.brand_mode === 'string' ? input.metadata.brand_mode : 'brand-aware'),
    contentType: typeof input.metadata.content_type === 'string' ? input.metadata.content_type : input.eyebrow,
    // Purpose-driven generation strategy. Resolved by the composer
    // against the PurposeStrategyRegistry — see purposeStrategyRegistry.ts.
    // The key flows from the form submission's creator_card:
    //   - image / banner: creator_card.subtype (e.g. 'promotional-image')
    //   - carousel / slider: creator_card.subtype (e.g. 'story-carousel')
    //   - infographic: creator_card.infographic_layout (e.g. 'stats')
    // We also accept top-level metadata.subtype / .purpose_key for
    // back-compat with any caller that flattens differently.
    purposeKey: (() => {
      const creatorCard = safeObject(input.metadata.creator_card);
      const direct = String(
        input.metadata.purpose_key
          || creatorCard.purpose_key
          || creatorCard.infographic_layout
          || creatorCard.subtype
          || input.metadata.subtype
          || ''
      ).trim();
      return direct || null;
    })(),
    // Creator Governance → Prompt Composer Integration — Phase 2.
    // Build the governance prompt context from the resolved industry
    // (sourced from brandKit.industry — the same field the prompt
    // composer already uses to annotate industry context). The
    // governance layer is a strict no-op for non-regulated industries.
    governance: (() => {
      const { buildGovernancePromptContext } =
        require('./creator/strategyGovernancePromptContext') as typeof import('./creator/strategyGovernancePromptContext');
      const industry = typeof brandKit.industry === 'string'
        ? brandKit.industry
        : (typeof brandContext.industry === 'string' ? brandContext.industry : null);
      const category = typeof input.metadata.category === 'string'
        ? input.metadata.category
        : null;
      // Resolve the content-type lane for the policy lookup. Banner /
      // brand_card collapse to image; slider / pdf collapse to carousel.
      const ctRaw = String(input.metadata.content_type ?? input.eyebrow ?? '')
        .trim()
        .toLowerCase();
      const lane: 'image' | 'carousel' | 'infographic' =
        ctRaw === 'banner' || ctRaw === 'brand_card' ? 'image'
          : ctRaw === 'slider' || ctRaw === 'pdf' ? 'carousel'
            : ctRaw === 'carousel' ? 'carousel'
              : ctRaw === 'infographic' ? 'infographic'
                : 'image';
      const selectedRaw = String(
        input.metadata.purpose_key
          || safeObject(input.metadata.creator_card).purpose_key
          || safeObject(input.metadata.creator_card).infographic_layout
          || safeObject(input.metadata.creator_card).subtype
          || input.metadata.subtype
          || ''
      ).trim() || null;
      return buildGovernancePromptContext({
        companyContext: industry || category ? { industry, category } : null,
        contentType: lane,
        selectedStrategy: selectedRaw,
      });
    })(),
  };

  // Pull the brand's preferred template + strategy if one is cached.
  const brandPreference = getBrandVisualPreference(input.companyId);
  const productContextExpected = Boolean(
    composerInput.productContext.productName
      || composerInput.productContext.dashboardDescription
      || (composerInput.productContext.screenshotUrls?.length ?? 0) > 0
  );

  // ── Enterprise creative-intelligence pipeline ──────────────────────
  // Phase 1 (campaign coherence) — plan-or-fetch the campaign visual
  // DNA. Subsequent assets for the same campaign id reuse the DNA so
  // cross-asset coherence is preserved.
  const campaignIdForDna =
    (typeof input.metadata.campaign_id === 'string' && input.metadata.campaign_id.trim()) ? input.metadata.campaign_id.trim()
    : (typeof input.metadata.campaignId === 'string' && input.metadata.campaignId.trim()) ? input.metadata.campaignId.trim()
    : null;
  const dnaResult = planOrFetchCampaignDNA({
    campaignId: campaignIdForDna,
    campaignIntent: composerInput.objective ?? null,
    audience: composerInput.audience ?? null,
    platform: composerInput.platform ?? null,
    contentType: composerInput.contentType ?? null,
    brandKit: composerInput.brandKit,
    productContext: composerInput.productContext,
  });
  const campaignDNA = dnaResult?.dna ?? null;

  // Phase 1 — plan creative direction. When campaign DNA exists,
  // project the per-asset plan FROM the DNA so emotional / realism /
  // composition / human presence are inherited. Otherwise plan from
  // brand-memory continuity (no campaign DNA case).
  /*
   * THE USER'S OWN CHOICES, read from the render metadata the form submitted.
   *
   * Sanitised against the asset family first, so a style chosen for an image
   * and then carried onto an infographic is dropped rather than forced — the
   * documented safe fallback is inference, not a style the renderer has no
   * expression for.
   */
  const guidedChoices = (() => {
    const card = safeObject(input.metadata.creator_card);
    const raw = safeObject(input.metadata.guided_creative ?? card.guided_creative);
    const family = String(input.metadata.asset_family || card.creator_content_asset_type || 'image');
    const assetFamily = (family === 'carousel' || family === 'infographic') ? family : 'image';
    return sanitizeGuidedChoices(
      {
        visualDirectionId: typeof raw.visual_direction_id === 'string' ? raw.visual_direction_id : null,
        subject: typeof raw.subject === 'string' ? (raw.subject as SubjectChoice) : null,
        visualInstruction: typeof raw.visual_instruction === 'string' ? raw.visual_instruction : null,
      },
      assetFamily as 'image' | 'carousel' | 'infographic',
    );
  })();
  const chosenDirection = getVisualDirection(guidedChoices.visualDirectionId ?? null);
  const chosenStyle = chosenDirection ? getVisualStyle(chosenDirection.id) : null;
  const userChoicesForPlanner = {
    visualDirectionId: guidedChoices.visualDirectionId ?? null,
    subjectEmphasis: subjectEmphasisFor(guidedChoices.subject ?? null),
    visualInstruction: guidedChoices.visualInstruction ?? null,
  };
  // The composer receives the registry's OWN prompt fragment — the style
  // vocabulary lives in one place and is quoted here, never restated.
  composerInput.userVisualDirection = (chosenStyle || guidedChoices.visualInstruction)
    ? {
        title: chosenStyle?.title ?? null,
        stylePrompt: chosenStyle?.stylePrompt ?? null,
        instruction: guidedChoices.visualInstruction ?? null,
      }
    : null;

  const plan = campaignDNA
    ? projectAssetPlanFromDNA({
        dna: campaignDNA,
        campaignIntent: composerInput.objective ?? null,
        audience: composerInput.audience ?? null,
        platform: composerInput.platform ?? null,
        contentType: composerInput.contentType ?? null,
        brandKit: composerInput.brandKit,
        productContext: composerInput.productContext,
      })
    : planCreativeDirection({
        campaignIntent: composerInput.objective ?? null,
        audience: composerInput.audience ?? null,
        platform: composerInput.platform ?? null,
        contentType: composerInput.contentType ?? null,
        brandKit: composerInput.brandKit,
        productContext: composerInput.productContext,
        brandMemory: brandPreference?.preferredStrategy
          ? { preferredStrategy: brandPreference.preferredStrategy as any }
          : null,
        // Outranks brand-memory continuity: a user who picks a look is
        // overriding the brand's habit deliberately.
        userChoices: userChoicesForPlanner,
      });

  // Phase 3 — platform-native adaptation resolved from the asset's
  // platform. Adaptation lines are appended to the composer input's
  // extra context (the composer itself emits the platform intent line;
  // adaptation extends it).
  const platformAdaptation = resolvePlatformAdaptation(composerInput.platform);

  // Phase 3 (autonomous optimizer) — derive optimizer directives from
  // the org's strategic memory + human feedback. The directives nudge
  // the composer toward strategies + emotional directions that have
  // performed well historically for this org. All directives are
  // bounded (Phase 11) — never auto-disable, only nudge weights.
  const optimization = computeOptimizationDirective({
    companyId: input.companyId,
    currentStrategy: null,
  });
  if (optimization.mutations.forceBrandAware) composerInput.brandMode = 'brand-aware';
  // Realism + suppression intensification is already baked into the
  // composer's premium variant templates; the optimizer signals this
  // by setting `promoteToPremium` which the variant orchestrator
  // honors via the existing premium-bias path.

  // Phase 2 + 6 — orchestrate 1-3 meaningfully different variants
  // based on grounding signals + cost governance. Grounding here is
  // the same threshold the composer uses (≥3 signals counted from
  // brand kit + product context).
  const brandSignalCount = [
    composerInput.brandKit?.companyName,
    composerInput.brandKit?.industry,
    composerInput.brandKit?.tone,
    Array.isArray(composerInput.brandKit?.palette) && (composerInput.brandKit!.palette!.length ?? 0) > 0 ? '1' : null,
    composerInput.brandKit?.accentColor,
    composerInput.brandKit?.logoUrl,
  ].filter(Boolean).length;
  const productSignalCount = [
    composerInput.productContext?.productName,
    composerInput.productContext?.productCategory,
    composerInput.productContext?.dashboardDescription,
    Array.isArray(composerInput.productContext?.screenshotUrls) && (composerInput.productContext!.screenshotUrls!.length ?? 0) > 0 ? '1' : null,
    Array.isArray(composerInput.productContext?.uiKeywords) && (composerInput.productContext!.uiKeywords!.length ?? 0) > 0 ? '1' : null,
  ].filter(Boolean).length;
  const orchestration = orchestrateCreativeVariants({
    plan,
    hasBrandGrounding: brandSignalCount >= 3,
    hasProductGrounding: productSignalCount >= 3,
    brandPreference: brandPreference?.preferredTemplate ?? null,
    // Phase 6 — DNA-constrained exploration. When the campaign has an
    // established DNA, variants are restricted to its approved templates.
    // Phase 9 — cost governance: max 3 variants always; renders driven
    // by stale DNA (assetCount > 24) hard-cap to one variant to avoid
    // exploration cost on mature campaigns.
    config: campaignDNA
      ? {
          campaignApprovedTemplates: campaignDNA.approvedTemplates,
          hardCapToOne: campaignDNA.assetCount > 24,
        }
      : undefined,
  });

  // Phase 3 — compose + score each variant.
  type Candidate = {
    spec: typeof orchestration.variants[number];
    composed: ReturnType<typeof composeCreatorImagePrompt>;
    rank: ReturnType<typeof rankCreativeAesthetic>;
    qualityScore: ReturnType<typeof scoreCreatorPromptQuality>;
  };
  const candidates: Candidate[] = orchestration.variants.map((spec) => {
    const variantInput = { ...composerInput, ...spec.inputMutations };
    const variantComposed = composeCreatorImagePrompt(variantInput, spec.composeOptions);
    const variantRank = rankCreativeAesthetic({
      composed: variantComposed,
      plan,
      productContextExpected,
    });
    const variantQuality = scoreCreatorPromptQuality({
      composed: variantComposed,
      productContextExpected,
    });
    return { spec, composed: variantComposed, rank: variantRank, qualityScore: variantQuality };
  });

  // Phase 7 — winner selection. Highest aesthetic total wins.
  const { winner, runners } = pickWinningVariant(
    candidates.map((c) => ({ variant: c, rank: c.rank })),
  );
  let composed = winner.variant.composed;
  let score = winner.variant.qualityScore;
  let retryApplied = false;
  let retryReason: string | null = null;

  // Phase 2 + 7 — enterprise brand governance + governance-aware retry.
  // The governance engine validates the winning variant against the
  // brand kit + campaign DNA. When violations exist, the renderer
  // applies the suggested retry strategy ONCE before falling back to
  // the original winner. Phase 9 cost governance caps the loop at a
  // single governance-driven re-compose attempt — no recursion.
  const governance = evaluateBrandGovernance({
    composed: winner.variant.composed,
    plan,
    rank: winner.variant.rank,
    brandKit: composerInput.brandKit,
    dna: campaignDNA,
  });
  let governanceRetryApplied = false;
  let governancePostRetry = governance;
  if ((governance.governanceViolations.length > 0 || governance.rejectGeneration)
      && governance.retryStrategy !== 'none') {
    // Construct a governance-driven mutation from the retry strategy.
    const govMutations: Partial<typeof composerInput> = {};
    const govOptions: { premium?: boolean; brandPreference?: any } = {};
    switch (governance.retryStrategy) {
      case 'tighten_brand_signals':
      case 'tighten_palette':
        govMutations.brandMode = 'brand-aware';
        break;
      case 'tighten_realism':
      case 'reduce_stock_bias':
        govOptions.premium = true;
        break;
      case 'increase_product_grounding':
        // No mutation possible from the renderer (product context is
        // upstream input); flag-only for the audit envelope.
        break;
      case 'switch_emotional_tone':
      case 'enforce_composition_family':
      case 'suppress_human_presence':
        // These mutations require re-projecting from DNA. When DNA
        // is present, the projected plan already inherited the DNA's
        // emotional tone / composition / human presence — re-running
        // through the composer with the current plan suffices.
        break;
      default:
        break;
    }
    const govRetryInput = { ...composerInput, ...govMutations };
    const govRetryComposed = composeCreatorImagePrompt(govRetryInput, {
      ...govOptions,
      brandPreference: brandPreference?.preferredTemplate ?? null,
    });
    const govRetryRank = rankCreativeAesthetic({
      composed: govRetryComposed,
      plan,
      productContextExpected,
    });
    const govRetryScore = scoreCreatorPromptQuality({
      composed: govRetryComposed,
      productContextExpected,
    });
    const govRetryEval = evaluateBrandGovernance({
      composed: govRetryComposed,
      plan,
      rank: govRetryRank,
      brandKit: composerInput.brandKit,
      dna: campaignDNA,
    });
    // Accept the retry when it improves governance OR aesthetic score.
    const govImproved = govRetryEval.governanceScore > governance.governanceScore
      || govRetryRank.totalScore > winner.variant.rank.totalScore;
    if (govImproved) {
      composed = govRetryComposed;
      score = govRetryScore;
      governanceRetryApplied = true;
      governancePostRetry = govRetryEval;
    }
  }

  // Single-variant safety net — when only 1 variant was orchestrated
  // (weak grounding / hard cap), preserve the prior adaptive-retry
  // behavior so the prompt still gets a second pass when score is low.
  if (orchestration.count === 1) {
    const retry = computeRetryDirective({ score, composed });
    if (retry.shouldRetry) {
      const retryInput = { ...composerInput, ...retry.inputMutations };
      const retryComposed = composeCreatorImagePrompt(retryInput, {
        ...retry.optionOverrides,
        brandPreference: brandPreference?.preferredTemplate ?? null,
      });
      const retryScore = scoreCreatorPromptQuality({ composed: retryComposed, productContextExpected });
      if (retryScore.score > score.score) {
        composed = retryComposed;
        score = retryScore;
        retryApplied = true;
        retryReason = retry.reason;
      }
    }
  }

  // Phase 1-2 — multimodal payload assembly. Provider id is hardcoded
  // here as the OpenAI standard because that's what generateProviderImage
  // calls; capability registry will handle future swaps without
  // touching this code.
  const multimodal = assembleMultimodalPayload({
    composed,
    providerId: 'openai-gpt-image-1',
    // The existing seam, finally carrying a user asset. Capability still
    // decides the outcome: with acceptsReferenceImages=false these degrade to
    // text descriptors rather than bytes, exactly as brand references already do.
    additionalReferences: input.additionalReferences,
  });

  // Phase 8 — record this attempt in brand visual memory so future
  // assets for the same company drift toward the same lane. Records
  // the FULL creative intelligence envelope (strategy + emotional
  // direction + composition + realism + subject priority + narrative).
  updateBrandVisualPreference({
    companyId: input.companyId,
    template: composed.creativeDirection,
    premium: composed.premium,
    score: score.score,
    surface: input.eyebrow || (typeof input.metadata.content_type === 'string' ? input.metadata.content_type : 'image'),
    strategy: plan.strategyProfile,
    emotionalDirection: plan.emotionalDirection,
    compositionStrategy: plan.compositionStrategy,
    realismProfile: plan.realismProfile,
    subjectPriority: plan.subjectPriority,
    visualNarrative: plan.visualNarrative,
  });

  // Resolve the render strategy ONCE here so both the metadata
  // explainability envelope AND the downstream buildOverlaySvg call
  // see the same strategy. Resolution is null-safe when no purpose
  // strategy attached (legacy callers).
  const { resolveRenderStrategy: _resolveRenderStrategyForBundle } =
    require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const renderStrategy = _resolveRenderStrategyForBundle(composed.purposeStrategy?.id ?? null);
  // Resolve the active variant (PHASE 4 — purpose-aware variant
  // exploration). The variant lookup checks (in order): explicit
  // `variant_id` on the asset metadata, then `variant_family` paired
  // with the strategy id. Returns null for legacy assets that did
  // not specify a variant — the renderer + analytics layer fall back
  // to strategy-only behavior in that case.
  const { resolveVariant: _resolveVariantForBundle, resolveVariantByFamily: _resolveVariantByFamilyForBundle } =
    require('./creator/variantRegistry') as typeof import('./creator/variantRegistry');
  const { resolveVariantStrategyProfile: _resolveVariantProfileForBundle } =
    require('./creator/variantStrategyProfiles') as typeof import('./creator/variantStrategyProfiles');
  const inputMeta = safeObject(safeObject(input.assetPayload.media_bundle).metadata);
  const inputVariantId = typeof inputMeta.variant_id === 'string' && inputMeta.variant_id.length > 0
    ? inputMeta.variant_id
    : null;
  const inputVariantFamily = typeof inputMeta.variant_family === 'string' && inputMeta.variant_family.length > 0
    ? inputMeta.variant_family
    : null;
  const variantForBundle =
    _resolveVariantForBundle(inputVariantId)
    ?? _resolveVariantByFamilyForBundle(composed.purposeStrategy?.id ?? null, inputVariantFamily);
  const variantProfileForBundle = _resolveVariantProfileForBundle(variantForBundle?.variant_id ?? null);

  // Stash the FULL creative-intelligence audit envelope on
  // assetPayload.media_bundle.metadata. This preserves variant
  // traceability + explainability + ranking metadata so dashboards
  // can pivot variant performance and audit the winner choice.
  const bundle = safeObject(input.assetPayload.media_bundle);
  const bundleMeta = safeObject(bundle.metadata);
  (bundle as Record<string, unknown>).metadata = {
    ...bundleMeta,
    // Winning variant + composer signals
    creative_direction: composed.creativeDirection,
    creative_direction_premium: composed.premium,
    brand_grounded: composed.brandGrounded,
    product_grounded: composed.productGrounded,
    // Creator Governance → Prompt Composer Integration — Phase 5.
    // Explainability metadata exposing which governance signals the
    // composer applied. Always present; carries industry='none' for
    // non-regulated companies. Downstream surfaces (post-execution
    // UI, audit trail) read this off creator_attachment_metadata to
    // render the compliance summary.
    governance: composed.governance,
    // Purpose-driven strategy envelope (PHASE 6 explainability).
    // Surfaced in preview as "Generated As" + rationale; null when
    // no purpose strategy resolved (legacy / direct-call paths).
    purpose_strategy: composed.purposeStrategy,
    generated_as_label: composed.purposeStrategy?.generatedAsLabel ?? null,
    purpose_why_chosen: composed.purposeStrategy?.whyChosen ?? null,
    purpose_density_bias: composed.purposeStrategy?.densityBias ?? null,
    purpose_branding_intensity: composed.purposeStrategy?.brandingIntensity ?? null,
    purpose_typography_weight: composed.purposeStrategy?.typographyWeight ?? null,
    purpose_cta_intensity: composed.purposeStrategy?.ctaIntensity ?? null,
    purpose_slide_arc: composed.purposeStrategy?.slideArcRoles ?? null,
    purpose_information_architecture: composed.purposeStrategy?.informationArchitecturePattern ?? null,
    // Strategy-aware rendering envelope (PHASE 9 explainability).
    // When a render strategy was applied to buildOverlaySvg, surface
    // the typography/branding/density/cta/visual-emphasis profile
    // strings so the preview can render an "Applied Render Strategy"
    // strip alongside the existing "Generated As" panel. Null when no
    // render strategy resolved.
    applied_render_strategy: renderStrategy
      ? {
          id: renderStrategy.id,
          typography_profile: renderStrategy.explainability.typographyProfile,
          branding_profile: renderStrategy.explainability.brandingProfile,
          density_profile: renderStrategy.explainability.densityProfile,
          cta_profile: renderStrategy.explainability.ctaProfile,
          visual_emphasis_profile: renderStrategy.explainability.visualEmphasisProfile,
          modifiers_applied: {
            headline_scale: renderStrategy.modifiers.headlineScale,
            hook_scale: renderStrategy.modifiers.hookScale,
            insight_scale: renderStrategy.modifiers.insightScale,
            support_scale: renderStrategy.modifiers.supportScale,
            max_headline_lines_delta: renderStrategy.modifiers.maxHeadlineLinesDelta,
            margin_scale: renderStrategy.modifiers.marginScale,
            text_block_top_ratio: renderStrategy.modifiers.textBlockTopRatio,
            scrim_intensity_multiplier: renderStrategy.modifiers.scrimIntensityMultiplier,
            logo_scale_multiplier: renderStrategy.modifiers.logoScaleMultiplier,
            logo_opacity: renderStrategy.modifiers.logoOpacity,
            cta_mode: renderStrategy.modifiers.ctaMode,
            focal_emphasis: renderStrategy.modifiers.focalEmphasis,
          },
        }
      : null,
    // Strategy analytics attribution envelope (PHASE 2 — Purpose
    // Strategy Analytics). Resolved from `purpose_strategy.id` so the
    // canonical analytics dimensions travel on every strategy-aware
    // asset. Null for legacy / non-strategy assets — analytics surfaces
    // MUST fall back gracefully (PHASE 12).
    strategy_analytics: (() => {
      const { buildStrategyAnalyticsAttribution: _attr } =
        require('./creator/strategyAnalyticsRecorder') as typeof import('./creator/strategyAnalyticsRecorder');
      const attribution = _attr({
        purpose_strategy: composed.purposeStrategy,
        applied_render_strategy: renderStrategy
          ? { id: renderStrategy.id }
          : null,
        applied_variant: variantForBundle ? {
          variant_id: variantForBundle.variant_id,
          variant_family: variantForBundle.variant_family,
        } : null,
      });
      // Carry the variant fields on the analytics envelope so the
      // recorder + leaderboards key off them downstream (PHASE 6).
      if (attribution && variantForBundle) {
        (attribution as Record<string, unknown>).variant_id = variantForBundle.variant_id;
        (attribution as Record<string, unknown>).variant_family = variantForBundle.variant_family;
      }
      return attribution;
    })(),
    // Applied Variant envelope (PHASE 12 — preview explainability).
    // Surfaces the variant identity + reasoning string so the preview
    // panel can render the "Applied Variant" strip alongside the
    // existing "Applied Render Strategy" strip. Null for legacy /
    // baseline assets with no variant.
    applied_variant: variantForBundle
      ? {
          variant_id: variantForBundle.variant_id,
          variant_family: variantForBundle.variant_family,
          display_name: variantForBundle.display_name,
          description: variantForBundle.description,
          exploration_dimensions: variantForBundle.exploration_dimensions,
          reasoning: variantProfileForBundle?.reasoning ?? null,
        }
      : null,
    // Strategic plan
    creative_strategy: plan.strategyProfile,
    creative_emotional_direction: plan.emotionalDirection,
    creative_composition_strategy: plan.compositionStrategy,
    creative_realism_profile: plan.realismProfile,
    creative_visual_narrative: plan.visualNarrative,
    creative_framing_strategy: plan.framingStrategy,
    creative_subject_priority: plan.subjectPriority,
    creative_human_presence_mode: plan.humanPresenceMode,
    creative_visual_density: plan.visualDensity,
    creative_premium_bias: plan.premiumBias,
    creative_plan_rationale: plan.rationale,
    // Variant exploration audit
    variant_count: orchestration.count,
    variant_rationale: orchestration.rationale,
    variants: candidates.map((c) => ({
      id: c.spec.id,
      label: c.spec.label,
      template: c.spec.audit.template,
      exploration_vector: c.spec.audit.explorationVector,
      rank_total: c.rank.totalScore,
      rank_bucket: c.rank.bucket,
      rank_reason: c.rank.rankingReason,
      strengths: c.rank.strengths,
      weaknesses: c.rank.weaknesses,
    })),
    winner_variant_id: winner.variant.spec.id,
    runner_up_count: runners.length,
    // Aesthetic ranking of the winner
    aesthetic_score: winner.rank.totalScore,
    aesthetic_bucket: winner.rank.bucket,
    aesthetic_dimensions: winner.rank.dimensionScores,
    aesthetic_strengths: winner.rank.strengths,
    aesthetic_weaknesses: winner.rank.weaknesses,
    // Prior-phase quality envelope (preserved for backward-compat with
    // dashboards that already track these fields).
    prompt_quality_score: score.score,
    prompt_quality_bucket: score.bucket,
    prompt_quality_flags: score.flags,
    prompt_quality_categories: score.categoryScores,
    prompt_retry_applied: retryApplied,
    prompt_retry_reason: retryReason,
    multimodal_references_present: multimodal.audit.referencesPresent,
    multimodal_references_accepted: multimodal.audit.referencesAccepted,
    multimodal_references_degraded_to_text: multimodal.audit.referencesDegradedToText,
    brand_visual_preference_used: Boolean(brandPreference),
    // Phase 1 + 8 — campaign coherence envelope.
    campaign_dna_established: dnaResult?.established ?? null,
    campaign_dna_reused: dnaResult ? !dnaResult.established : null,
    campaign_dna_strategy_family: campaignDNA?.strategyFamily ?? null,
    campaign_dna_emotional_tone: campaignDNA?.visualDNA.emotionalTone ?? null,
    campaign_dna_realism_profile: campaignDNA?.visualDNA.realismProfile ?? null,
    campaign_dna_composition_family: campaignDNA?.visualDNA.compositionFamily ?? null,
    campaign_dna_visual_density: campaignDNA?.visualDNA.visualDensity ?? null,
    campaign_dna_human_presence_policy: campaignDNA?.visualDNA.humanPresencePolicy ?? null,
    campaign_dna_product_presence_policy: campaignDNA?.visualDNA.productPresencePolicy ?? null,
    campaign_dna_palette_discipline: campaignDNA?.visualDNA.paletteDiscipline ?? [],
    campaign_dna_approved_templates: campaignDNA?.approvedTemplates ?? [],
    campaign_dna_asset_count: campaignDNA?.assetCount ?? null,
    campaign_dna_rationale: campaignDNA?.rationale ?? [],
    // Phase 3 — platform adaptation envelope.
    platform_adaptation: {
      platform: platformAdaptation.platform,
      density: platformAdaptation.densityAdjustment,
      whitespace: platformAdaptation.whitespaceDiscipline,
      energy: platformAdaptation.visualEnergy,
      human_nudge: platformAdaptation.humanPresenceNudge,
      cta_emphasis: platformAdaptation.ctaEmphasis,
    },
    // Phase 2 + 7 — governance envelope.
    governance_score: governancePostRetry.governanceScore,
    governance_violations: governancePostRetry.governanceViolations.map((v) => ({
      category: v.category, severity: v.severity, description: v.description,
    })),
    governance_warnings: governancePostRetry.governanceWarnings.map((v) => ({
      category: v.category, severity: v.severity, description: v.description,
    })),
    governance_brand_alignment_confidence: governancePostRetry.brandAlignmentConfidence,
    governance_reject_generation: governancePostRetry.rejectGeneration,
    governance_retry_strategy: governancePostRetry.retryStrategy,
    governance_retry_applied: governanceRetryApplied,
    governance_retry_rationale: governance.retryRationale,
    governance_pre_retry_score: governance.governanceScore,
    // Phase 3 + 5 + 7 — autonomous optimizer envelope.
    optimization_directive_strategy_weights: optimization.strategyWeights,
    optimization_directive_mutations: optimization.mutations,
    optimization_preferred_emotional: optimization.preferredEmotionalDirection,
    optimization_preferred_realism: optimization.preferredRealismProfile,
    optimization_rationale: optimization.rationale,
  };
  (input.assetPayload as Record<string, unknown>).media_bundle = bundle;

  // Phase 4 — telemetry event for this prompt-building attempt. The
  // renderer's actual provider call + QA evaluation happens AFTER
  // this function returns (the renderer scope tracks render outcome
  // for the QA telemetry). This first event records the "render
  // requested" signal so the strategic memory has continuous coverage
  // even when downstream stages fail.
  if (input.companyId) {
    try {
      const decision = decideAutonomousOperation({
        qaScore: 70, // placeholder — QA runs post-render in the renderer scope below
        qaSeverity: 'pass',
        governanceScore: governancePostRetry.governanceScore,
        governanceRejected: governancePostRetry.rejectGeneration,
        aestheticBucket: winner.variant.rank.bucket,
      });
      recordTelemetryEvent({
        type: 'variant_selected',
        companyId: input.companyId,
        campaignId: campaignIdForDna,
        strategy: plan.strategyProfile,
        template: composed.creativeDirection,
        platform: composerInput.platform ?? null,
        emotionalDirection: plan.emotionalDirection,
        realismProfile: plan.realismProfile,
        aestheticScore: winner.variant.rank.totalScore,
        governanceScore: governancePostRetry.governanceScore,
        payload: {
          autonomous_decision: decision.action,
          autonomous_reason: decision.reason,
          variant_count: orchestration.count,
        },
      });
    } catch { /* telemetry never throws */ }
  }

  return multimodal.textPrompt;
}

export function timeoutAfter<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}

export function getFirstImageResult(response: unknown): { b64_json?: string | null; url?: string | null } | null {
  const data = response && typeof response === 'object' && 'data' in response
    ? (response as { data?: unknown }).data
    : null;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  return first && typeof first === 'object'
    ? first as { b64_json?: string | null; url?: string | null }
    : null;
}

export async function bufferFromRemoteImage(url: string): Promise<Buffer> {
  // HARDEN-005: image URL is generated/creator-supplied — download via the
  // SSRF-safe fetcher (validated host, DNS-pinned, size-capped). Preserves the
  // timeout + "download failed with <status>" behavior.
  const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
  const response = await safeFetch(url, { method: 'GET' }, { timeoutMs: AI_IMAGE_TIMEOUT_MS });
  if (!response.ok) {
    throw new Error(`Image download failed with ${response.status}`);
  }
  return readCapped(response);
}

export async function resolveOpenAiImageKey(): Promise<string | null> {
  try {
    return config.OPENAI_API_KEY || null;
  } catch (error) {
    console.warn('[creator-asset-renderer][image-key-unavailable]', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}


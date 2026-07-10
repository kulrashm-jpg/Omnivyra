/** Creator execution — blueprint generation, render orchestration, entrypoints — split from creatorExecutionEngine.ts (barrel preserved; importers unchanged). */
import { supabase } from '../../db/supabaseClient';
import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import { createHash } from 'crypto';
import { config } from '@/config';
import { buildCreatorBlueprintPromptSpecification } from '../creator/creatorPromptSpecification';
import { assembleBlueprintPrompt } from '../creator/intelligence/blueprintPromptAssembler';
import {
  repurposeCarouselForPlatforms,
  repurposeVideoScriptForPlatforms,
} from '../creatorContentRepurposingEngine';
import { validateCreatorContentQuality } from '../creatorContentValidation';
import { runCompletionWithOperation } from '../aiGateway';
import { generateCreatorMarketingPackaging } from '../creatorPackagingService';
import { deriveCreatorAssetTypeFromIntent, getCreatorTemplate, getCreatorTemplateById } from '../creatorTemplateRegistryService';
import { validateCreatorExecutionOutput, validateCreatorSchedulingContract } from '../creatorExecutionContracts';
import { validateAssetReadiness } from '../creatorAssetValidationService';
import { checkCapability, normalizeCreatorPlatform } from '../creatorCapabilityMap';
import { renderAsset } from '../creatorAssetRenderer';
import { supportsAutonomousExecution, normalizeCreatorFormat } from '../../../lib/shared/creatorGovernanceRegistry';
import { resolvePurposeStrategy, type PurposeStrategy } from '../creator/purposeStrategyRegistry';
import { evaluateCarouselQuality } from '../creator/carouselQualityEvaluator';
import { recordCarouselQualitySample } from '../creator/carouselQualityTelemetry';
import {
  resolveCarouselQualityMode,
  assessCarouselQuality,
  decideCarouselQualityAction,
  buildQualityRetryDirective,
  type CarouselEnforcementMode,
} from '../creator/carouselQualityGate';
import type {

  CanonicalCreatorOutput,
  CreatorExecutionEngine,
  CreatorGenerationContext,
  CreatorScheduleResult,
  CreatorScheduledRow,
} from './types';
import { ownedDbTable } from '../../db/writeOwner';

import { inferBlueprintType, safeObject, deriveStructureFromTemplate, toArrayOfObjects, validateBlueprintAgainstTemplate, buildTemplateAlignmentInstruction, extractAnalyticsIntelligence, alignBlueprintToTemplate, normalizeCreatorAssetPayload, resolveTemplateForIntent, PLATFORM_RULES, adaptPackagingForPlatform, resolveContextPurposeKey, deriveArcStructureSchema, applyArcStructureToTemplate, MAX_CAROUSEL_COMPLETION_RETRIES, CarouselContentIncompleteError, CarouselQualityRejectedError, carouselBlueprintIsComplete, buildCompletionRetryDirective, buildReducedCarouselFromCompleteSlides, recordCarouselQualityOutcome, normalizeCarouselBlueprintShape } from './creatorExecutionEnginePrep';

async function generateCompleteCarouselDeck(
  context: CreatorGenerationContext,
  effectiveTemplate: { structure_schema?: Record<string, unknown>; [k: string]: unknown },
  qualityRetryHint: string | undefined,
  mode: CarouselEnforcementMode,
): Promise<{ blueprint: Record<string, unknown>; template: typeof effectiveTemplate; attempts: number; fallbackUsed: boolean }> {
  const structure = safeObject(effectiveTemplate.structure_schema);
  const expectedCount = structure.frame_count == null ? 0 : Number(structure.frame_count);
  const expectedRoles = Array.isArray(structure.frame_roles) ? structure.frame_roles.map(String) : [];

  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt <= MAX_CAROUSEL_COMPLETION_RETRIES; attempt += 1) {
    const completionRetryHint = attempt === 0
      ? undefined
      : buildCompletionRetryDirective(attempt, expectedRoles, expectedCount);
    last = normalizeCarouselBlueprintShape(await generateBlueprint(
      { ...context, template: effectiveTemplate as CreatorGenerationContext['template'] },
      { completionRetryHint, qualityRetryHint },
    ));
    if (carouselBlueprintIsComplete(last, effectiveTemplate)) {
      return { blueprint: last, template: effectiveTemplate, attempts: attempt + 1, fallbackUsed: false };
    }
  }

  // Completeness retries exhausted → real-content-only fallback (reduced deck).
  const reduced = buildReducedCarouselFromCompleteSlides(last, effectiveTemplate);
  if (reduced) {
    return { blueprint: reduced.blueprint, template: reduced.template, attempts: MAX_CAROUSEL_COMPLETION_RETRIES + 1, fallbackUsed: true };
  }

  // Fallback impossible → fail cleanly. No fabricated content ships.
  recordCarouselQualityOutcome(context, last, {
    attempts: MAX_CAROUSEL_COMPLETION_RETRIES + 1,
    fallbackUsed: false,
    failed: true,
    mode,
    qualityRetries: 0,
    qualityRejected: false,
    failingDimensions: [],
  });
  throw new CarouselContentIncompleteError(
    'creator carousel generation could not produce a complete, minimum-viable carousel from real content',
  );
}

/** Carousel Phase B — Commit B2 (acceptance gate + targeted regeneration).
 *  Wraps the completeness sub-routine with the editor-grade quality gate under
 *  the active enforcement mode (shadow | warn | strict). SHADOW/WARN add ZERO
 *  LLM calls (measure/annotate only); STRICT may regenerate within a bounded
 *  quality budget, then rejects cleanly. Returns the final blueprint + template
 *  (Phase A contract preserved). */
async function produceCompleteCarouselBlueprint(
  context: CreatorGenerationContext,
  effectiveTemplate: { structure_schema?: Record<string, unknown>; [k: string]: unknown },
): Promise<{ blueprint: Record<string, unknown>; template: typeof effectiveTemplate }> {
  const mode = resolveCarouselQualityMode();
  const purposeStrategy = resolvePurposeStrategy(context.contentType, resolveContextPurposeKey(context));
  const ctaIntensity = purposeStrategy?.ctaIntensity ?? null;
  const archetype = purposeStrategy?.purposeKey ?? null;

  let qualityRetries = 0;
  let totalAttempts = 0;
  let qualityRetryHint: string | undefined;

  for (;;) {
    const produced = await generateCompleteCarouselDeck(context, effectiveTemplate, qualityRetryHint, mode);
    totalAttempts += produced.attempts;

    const assessment = assessCarouselQuality({
      slides: toArrayOfObjects(produced.blueprint.slides),
      archetype,
      ctaIntensity,
      topic: context.topic ?? null,
    });
    const action = decideCarouselQualityAction({
      mode,
      status: assessment.status,
      qualityRetries,
      totalAttempts,
    });

    if (action === 'regenerate') {
      qualityRetryHint = buildQualityRetryDirective(assessment.failingChecks, ctaIntensity);
      qualityRetries += 1;
      continue;
    }

    // Terminal action → record once, then return / reject.
    recordCarouselQualityOutcome(context, produced.blueprint, {
      attempts: totalAttempts,
      fallbackUsed: produced.fallbackUsed,
      failed: false,
      mode,
      qualityRetries,
      qualityRejected: action === 'reject',
      failingDimensions: assessment.status === 'approved' ? [] : assessment.failingChecks,
    });

    if (action === 'reject') {
      throw new CarouselQualityRejectedError(
        `carousel rejected by editor-grade gate (score ${assessment.score}): ${assessment.failingChecks.join(', ') || 'below threshold'}`,
      );
    }

    let finalBlueprint = produced.blueprint;
    if (action === 'accept_with_warnings') {
      finalBlueprint = {
        ...produced.blueprint,
        metadata: {
          ...safeObject(produced.blueprint.metadata),
          quality_warnings: assessment.failingChecks,
          quality_recommended_actions: assessment.recommendedActions,
          quality_score: assessment.score,
        },
      };
    }
    return { blueprint: finalBlueprint, template: produced.template };
  }
}

async function generateBlueprint(
  context: CreatorGenerationContext,
  opts?: { completionRetryHint?: string; qualityRetryHint?: string },
): Promise<Record<string, unknown>> {
  const assetType = deriveCreatorAssetTypeFromIntent({
    contentType: context.contentType,
    targetPlatforms: context.targetPlatforms,
  });
  const blueprintType = inferBlueprintType(assetType, context.contentType);
  // Carousel Phase A — Commit 1 (wiring) + Commit 2 (activation). Resolve the
  // PurposeStrategy + arc schema. The arc-effective structure already reaches
  // this function via context.template (applied upstream in generateFromIntent);
  // here we additionally surface the arc roles+intents and CTA strategy to the
  // prompt (see creatorContext below). No-op when no PurposeStrategy resolves.
  const purposeKey = resolveContextPurposeKey(context);
  const purposeStrategy = resolvePurposeStrategy(context.contentType, purposeKey);
  const arcStructureSchema = deriveArcStructureSchema(purposeStrategy);
  const carouselArc = (assetType === 'carousel' && Array.isArray(purposeStrategy?.slideArc) && purposeStrategy!.slideArc!.length > 0)
    ? purposeStrategy!.slideArc!.map((s) => ({ role: s.role, intent: s.intent }))
    : null;
  const template = await resolveTemplateForIntent({
    assetType,
    templateId: context.templateId,
    companyId: context.companyId,
    providedTemplate: context.template,
  });
  const creatorPromptContext = {
    objective: context.creatorCard?.objective,
    tone: context.creatorCard?.tone,
    audience: context.creatorCard?.audience,
    visual_intent: context.creatorCard?.visual_intent,
    supporting_asset_type: context.creatorCard?.supporting_asset_type,
    constraints: context.creatorCard?.constraints,
  };
  const creatorContext = {
    content_theme: String(context.creatorCard?.theme || context.enrichedIntent?.campaign_theme || context.summary || 'engaging'),
    campaign_description: String(context.objective || context.summary || context.creatorCard?.objective || 'Creator campaign execution'),
    brand_visual_tone: String(context.creatorCard?.brand_visual_tone || context.enrichedIntent?.brand_voice || template.style_schema.preferred_layout || 'professional'),
    visual_style: String(template.style_schema.preferred_layout || 'modern professional'),
    target_platforms: context.targetPlatforms,
    supporting_asset_type: String(context.creatorCard?.supporting_asset_type || context.contentType || assetType),
    slide_count: Number((template.structure_schema.frame_count as number | undefined) || 5),
    narrative_arc: String(context.creatorCard?.narrative_arc || 'problem -> insight -> action'),
    // Carousel Phase A — Commit 2 (arc-aware prompt + CTA wiring). Present only
    // when a carousel PurposeStrategy resolves a slideArc; otherwise undefined
    // so the carousel prompt renders its legacy generic path (back-compatible).
    slide_arc: carouselArc ?? undefined,
    cta_intensity: carouselArc ? (purposeStrategy?.ctaIntensity ?? undefined) : undefined,
    cta_suggestions: carouselArc ? (purposeStrategy?.ctaSuggestions ?? undefined) : undefined,
    archetype_label: carouselArc ? (purposeStrategy?.displayLabel ?? undefined) : undefined,
    platform_specs: context.creatorCard?.platform_specs && typeof context.creatorCard.platform_specs === 'object'
      ? context.creatorCard.platform_specs
      : undefined,
  };
  // EXTERNALIZE MASTER PROMPT — the engine no longer constructs the blueprint
  // prompt. It gathers the structured inputs (context + template + intent) and
  // delegates composition to the canonical Prompt Specification layer, then
  // executes the returned spec unchanged. Byte-identical to the prior inline
  // construction (behavior preserved); a new asset family extends the spec
  // layer, never this engine.
  const analyticsIntelligence = extractAnalyticsIntelligence(context);
  const promptInput = {
    topic: context.topic,
    asset_type: assetType,
    content_type: context.contentType,
    objective: context.objective ?? '',
    audience: context.audience ?? '',
    summary: context.summary ?? '',
    platforms: context.targetPlatforms,
    creator_card: context.creatorCard ?? {},
    creator_context: creatorPromptContext,
    daily_intent: context.enrichedIntent ?? {},
    template_structure: template.structure_schema,
    template_style: template.style_schema,
    template_mapping_rules: template.mapping_rules,
  };
  // CREATOR-061: complete the single-asset blueprint thread. The wizard-selected
  // blueprint id rides on creator_card (CREATOR-059); the canonical
  // BlueprintPromptAssembler (CREATOR-060) translates it to visual directives that
  // reach the final prompt builder. Single source, additive: no blueprint ⇒ null
  // ⇒ byte-identical legacy prompt.
  const blueprintId = typeof context.creatorCard?.blueprint_id === 'string' ? context.creatorCard.blueprint_id : null;
  const blueprintDirectives = assembleBlueprintPrompt(blueprintId)?.directives ?? null;
  const promptSpec = buildCreatorBlueprintPromptSpecification({
    assetType,
    blueprintType,
    creatorContext,
    promptInput,
    analyticsPromptBlock: analyticsIntelligence.promptBlock,
    analyticsLowConfidenceNote: analyticsIntelligence.lowConfidenceNote,
    templateAlignmentInstruction: buildTemplateAlignmentInstruction({ assetType, template }),
    completionRetryHint: opts?.completionRetryHint,
    qualityRetryHint: opts?.qualityRetryHint,
    blueprintDirectives,
  });

  const result = await runCompletionWithOperation({
    companyId: context.companyId,
    campaignId: context.campaignId ?? null,
    referenceType: context.correlation?.referenceType ?? null,
    referenceId: context.correlation?.referenceId ?? null,
    parentActivityId: context.correlation?.parentActivityId ?? null,
    model: config.OPENAI_MODEL,
    operation: promptSpec.operation,
    temperature: promptSpec.temperature,
    response_format: promptSpec.response_format,
    messages: promptSpec.messages,
  });

  const parsed = JSON.parse(String(result?.output || '{}')) as Record<string, unknown>;
  const aligned = alignBlueprintToTemplate({
    assetType,
    blueprint: parsed,
    template,
  });
  return {
    ...aligned,
      metadata: {
        ...(safeObject(aligned.metadata)),
        template_id: template.id,
        asset_type: assetType,
        analytics_intelligence_applied: Boolean(analyticsIntelligence.promptBlock),
        analytics_intelligence_readiness: analyticsIntelligence.readiness,
        analytics_intelligence_primitive_count: analyticsIntelligence.primitiveCount,
        // Carousel Phase A — Commit 1 (arc wiring). Inert capability surface:
        // resolved PurposeStrategy + arc-derived structure_schema, available to
        // later commits. Does not affect copy, rendering, or publishing.
        carousel_arc_wiring: {
          purpose_key: purposeKey,
          purpose_strategy_id: purposeStrategy?.id ?? null,
          purpose_strategy_resolved: Boolean(purposeStrategy),
          slide_arc_roles: arcStructureSchema?.frame_roles ?? null,
          arc_structure_schema: arcStructureSchema,
        },
      },
  };
}

function normalizeMediaUrls(assetPayload: Record<string, unknown>): string[] {
  const mediaBundle = safeObject(assetPayload.media_bundle);
  const files = [
    ...(Array.isArray(assetPayload.files) ? assetPayload.files.map(String).filter(Boolean) : []),
    ...(Array.isArray(mediaBundle.files) ? mediaBundle.files.map(String).filter(Boolean) : []),
  ];
  const url = [
    ...(typeof assetPayload.url === 'string' && assetPayload.url.trim() ? [assetPayload.url.trim()] : []),
    ...(typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : []),
  ];
  const variantUrls = Array.isArray(assetPayload.media_urls) ? assetPayload.media_urls.map(String).filter(Boolean) : [];
  return [...new Set([...url, ...files, ...variantUrls])];
}

function buildScheduledPostInsertPayload(input: {
  output: CanonicalCreatorOutput;
  row: CreatorScheduledRow;
  createdAtIso: string;
}): {
  user_id: string;
  campaign_id: unknown;
  social_account_id: string;
  platform: string;
  content_type: string;
  title: string;
  content: string;
  hashtags: string[];
  media_urls: string[];
  scheduled_for: string;
  status: CreatorScheduledRow['status'];
  created_at: string;
  updated_at: string;
} {
  return {
    user_id: input.row.userId,
    campaign_id: input.output.metadata.campaign_id,
    social_account_id: input.row.socialAccountId,
    platform: input.row.dbPlatform,
    content_type: input.row.dbContentType,
    title: input.row.topic,
    content: input.output.packaging.caption,
    hashtags: input.output.packaging.hashtags.map(String),
    media_urls: normalizeMediaUrls(safeObject(input.output.asset_payload)),
    scheduled_for: input.row.scheduledForIso,
    status: input.row.status,
    created_at: input.createdAtIso,
    updated_at: input.createdAtIso,
  };
}

async function withRenderedMedia(output: CanonicalCreatorOutput): Promise<CanonicalCreatorOutput> {
  const existingMediaUrls = normalizeMediaUrls(safeObject(output.asset_payload));
  if (existingMediaUrls.length > 0) {
    return output;
  }

  // PART A — register a user template_id before render (canonical runtime flow).
  try {
    const { ensureUserTemplateRegisteredForAsset } = await import('../creator/userTemplateService');
    await ensureUserTemplateRegisteredForAsset(output.asset_payload);
  } catch { /* best-effort */ }

  // CAMPAIGN-007 — operational health events (best-effort, EXISTING audit store).
  const _opMd = safeObject(safeObject(safeObject(output.asset_payload).media_bundle).metadata);
  const _opCard = safeObject(_opMd.creator_card);
  const _opTplRaw = _opMd.template_id ?? _opMd.infographic_template_id ?? _opCard.template_id;
  const opTemplateId = typeof _opTplRaw === 'string' ? _opTplRaw.trim() : '';
  const opTemplateVersion = typeof _opMd.template_version === 'number' ? _opMd.template_version : 0;
  const emitTemplateEvent = (action: string) => {
    if (!opTemplateId) return;
    void import('../creator/userTemplateService')
      .then(({ recordTemplateEvent }) => recordTemplateEvent({ templateId: opTemplateId, templateVersion: opTemplateVersion, action: action as never }))
      .catch(() => { /* best-effort telemetry */ });
  };

  // CAMPAIGN-001 — deterministic content-contract gate: if a template was
  // selected, the generated content must satisfy its rendering contract +
  // form definition BEFORE we render. Reject (don't render) on violation.
  // Non-template payloads are a strict no-op (existing flows unaffected).
  {
    const { validateAssetPayloadAgainstTemplate } = await import('../../../lib/creator-templates');
    const gate = validateAssetPayloadAgainstTemplate(output.asset_payload);
    if (gate.matched && !gate.ok) {
      emitTemplateEvent('validation_failed');
      throw new Error(`Generated content violates the selected template contract: ${gate.errors.join(' ')}`);
    }
  }

  emitTemplateEvent('generation_started');
  let renderedMedia: Awaited<ReturnType<typeof renderAsset>>;
  try {
    renderedMedia = await renderAsset(safeObject(output.asset_payload), {
      campaignId: String(output.metadata.campaign_id || '') || null,
      userId: String(output.metadata.user_id || '') || null,
      companyId: String(output.metadata.company_id || '') || null,
    });
    emitTemplateEvent('render_succeeded');
    emitTemplateEvent('generation_succeeded');
  } catch (err) {
    emitTemplateEvent('render_failed');
    emitTemplateEvent('generation_failed');
    throw err;
  }

  const mediaBundle = safeObject(safeObject(output.asset_payload).media_bundle);
  const nextMediaBundle: Record<string, unknown> = {
    ...mediaBundle,
    ...(renderedMedia.url ? { url: renderedMedia.url } : {}),
    ...(Array.isArray(renderedMedia.files) && renderedMedia.files.length > 0 ? { files: renderedMedia.files } : {}),
    metadata: {
      ...safeObject(mediaBundle.metadata),
      ...safeObject(renderedMedia.metadata),
    },
  };

  return {
    ...output,
    asset_payload: {
      ...output.asset_payload,
      media_bundle: nextMediaBundle,
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildDeterministicPlatformId(input: {
  mediaUrls: string[];
  dailyPlanId: string;
  timestamp: string;
}): string {
  const base = `${input.mediaUrls.sort().join('|')}|${input.dailyPlanId}|${input.timestamp}`;
  return `creator_${sha256(base).slice(0, 24)}`;
}

function buildAssetHash(output: CanonicalCreatorOutput): string {
  return sha256(`${output.asset_type}|${stableStringify(output.asset_payload)}|${output.packaging.caption}`);
}

function classifyScheduleFailure(message: string): 'transient' | 'permanent' {
  const normalized = String(message || '').toLowerCase();
  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('temporar') ||
    normalized.includes('429') ||
    normalized.includes('5xx') ||
    normalized.includes('failed to schedule')
  ) {
    return 'transient';
  }
  return 'permanent';
}

function assertValidExecutionOutput(output: CanonicalCreatorOutput): void {
  const validation = validateCreatorExecutionOutput(output);
  if (!validation.ok) {
    throw new Error(`Invalid creator execution output: ${validation.issues.join('; ')}`);
  }
}

function assertCapability(input: { platforms: string[]; assetType: string }): void {
  for (const platform of input.platforms) {
    const capability = checkCapability(platform, input.assetType);
    if (!capability.ok) {
      const failureReason = 'reason' in capability ? capability.reason : `Unsupported capability for ${platform}`;
      throw new Error(failureReason);
    }
  }
}

export function createCreatorExecutionEngine(): CreatorExecutionEngine {
  return {
    async generateFromIntent(intent, _context, config) {
      const normalizedContentType = normalizeCreatorFormat(intent.contentType);
      if (!supportsAutonomousExecution(normalizedContentType)) {
        throw new Error(`Creator format "${normalizedContentType || intent.contentType}" is guidance-only or unsupported and cannot enter autonomous creator execution`);
      }
      const assetType = deriveCreatorAssetTypeFromIntent({
        contentType: intent.contentType,
        targetPlatforms: intent.targetPlatforms,
      });
      assertCapability({ platforms: intent.targetPlatforms, assetType });
      const baseTemplate = await resolveTemplateForIntent({
        assetType,
        templateId: intent.templateId,
        companyId: intent.companyId,
        providedTemplate: intent.template,
      });
      // Carousel Phase A — Commit 2 (arc activation). Resolve the arc-effective
      // template ONCE and thread it to generation, validation, and structure
      // derivation so all three stay in lockstep. Non-carousel / no-arc →
      // identical to baseTemplate (legacy behavior preserved).
      const effectiveTemplate = applyArcStructureToTemplate(assetType, intent, baseTemplate);
      // Carousel Phase A — Commit 3 (filler elimination + retry/fallback/fail).
      // Carousels run through the completeness orchestrator, which retries on
      // incomplete output, falls back to a smaller real-content-only deck, or
      // fails cleanly — never shipping fabricated slides. The orchestrator
      // returns the (possibly reduced) template so validation + structure
      // derivation stay in lockstep. Non-carousel assets are unchanged.
      const { blueprint, template } = (assetType === 'carousel'
        ? await produceCompleteCarouselBlueprint(intent, effectiveTemplate)
        : { blueprint: await generateBlueprint({ ...intent, template: effectiveTemplate }), template: effectiveTemplate }
      ) as { blueprint: Record<string, unknown>; template: typeof effectiveTemplate };
      validateBlueprintAgainstTemplate({ assetType, blueprint, template });
      const validation = await validateCreatorContentQuality(blueprint, inferBlueprintType(assetType, intent.contentType));
      const existing = safeObject(intent.existingContent);
      const assetOverride = safeObject(config?.assetOverride) || safeObject(existing.asset_payload);

      const packaging = await generateCreatorMarketingPackaging({
        topic: intent.topic,
        objective: intent.objective,
        summary: intent.summary,
        targetAudience: intent.audience,
        assetType,
        companyId: intent.companyId,
        campaignContext: {
          creator_card: intent.creatorCard ?? undefined,
          enriched_intent: intent.enrichedIntent ?? undefined,
        },
        blueprint,
      });
      const assetPayload = normalizeCreatorAssetPayload({
        assetType,
        blueprint,
        overrideAsset: assetOverride,
        creatorCard: intent.creatorCard ?? undefined,
        topic: intent.topic,
        objective: intent.objective,
        summary: intent.summary,
      });

      const output: CanonicalCreatorOutput = {
        intent_type: 'creator',
        asset_type: assetType,
        asset_instruction: {
          blueprint,
          structure: deriveStructureFromTemplate(template),
          visual_style: String((template.style_schema.visual_density as string | undefined) || (template.style_schema.preferred_layout as string | undefined) || 'creator-led'),
          template_id: template.id,
        },
        asset_payload: {
          ...assetPayload,
          validation_result: validation,
          media_bundle: {
            ...safeObject(assetPayload.media_bundle),
            metadata: {
              ...safeObject(safeObject(assetPayload.media_bundle).metadata),
              topic: intent.topic,
              summary: intent.summary ?? null,
              objective: intent.objective ?? null,
              content_type: intent.contentType,
              platform: intent.targetPlatforms[0] ?? null,
              tenant_id: intent.companyId ?? null,
              company_id: intent.companyId ?? null,
              user_id: intent.userId ?? null,
              attachment_mode: intent.creatorCard?.attachment_mode ?? null,
              writer_asset_type: intent.creatorCard?.writer_asset_type ?? null,
              creator_content_asset_type: intent.creatorCard?.creator_content_asset_type ?? intent.contentType,
              // Canonical lib/creator-templates template_id (the visual-language
              // template selected in the Campaign Creator). Threaded onto render
              // metadata so creatorAssetRenderer.templateIdForRender → resolveTemplate
              // resolves the selected family style. NOT the engine's internal
              // creatorTemplateRegistryService template (template.id) — a different system.
              template_id: typeof intent.creatorCard?.template_id === 'string' && intent.creatorCard.template_id.trim()
                ? intent.creatorCard.template_id.trim()
                : null,
              // CREATOR-106: thread the chosen Marketing Sample (blueprint_id) onto render
              // metadata — mirrors template_id above. Without this the infographic style
              // resolver never sees the sample and always renders the default variant.
              blueprint_id: typeof intent.creatorCard?.blueprint_id === 'string' && intent.creatorCard.blueprint_id.trim()
                ? intent.creatorCard.blueprint_id.trim()
                : null,
              // The sample's accent color (so renderers visibly align output to the pick).
              blueprint_color_primary: typeof intent.creatorCard?.blueprint_color_primary === 'string' && intent.creatorCard.blueprint_color_primary.trim()
                ? intent.creatorCard.blueprint_color_primary.trim()
                : null,
              asset_composition_intent: safeObject(intent.creatorCard?.asset_composition_intent),
              copy_policy: safeObject(intent.creatorCard?.copy_policy),
              source_text_transform: intent.creatorCard?.source_text_transform ?? null,
              infographic_layout: intent.creatorCard?.infographic_layout ?? null,
              renderer_text_policy: intent.creatorCard?.renderer_text_policy ?? null,
              thread_visual_transform: safeObject(intent.creatorCard?.thread_visual_transform),
              overlay_text: safeObject(intent.creatorCard?.overlay_text),
              selected_brand_assets: safeObject(safeObject(intent.creatorCard?.brand_context).overrides),
              brand_context: safeObject(intent.creatorCard?.brand_context),
            },
          },
        },
        packaging: {
          ...packaging,
          platform_variants: {},
        },
        generation_prompt: `creator:${assetType}:${intent.topic}`,
        metadata: {
          campaign_id: intent.campaignId,
          tenant_id: intent.companyId ?? null,
          company_id: intent.companyId ?? null,
          user_id: intent.userId ?? null,
          content_type: intent.contentType,
          target_platforms: intent.targetPlatforms,
          validation_result: validation,
          template_id: template.id,
          analytics_intelligence_applied: Boolean(safeObject(intent.enrichedIntent).analytics_intelligence),
        },
      };
      assertValidExecutionOutput(output);
      return output;
    },

    async adaptForPlatform(output, platform) {
      assertValidExecutionOutput(output);
      const normalizedPlatform = normalizeCreatorPlatform(platform);
      if (!normalizedPlatform) {
        throw new Error(`Unsupported platform taxonomy: ${platform}`);
      }
      const schedulingValidation = validateCreatorSchedulingContract({
        output,
        platform: normalizedPlatform,
      });
      if (!schedulingValidation.ok) {
        throw new Error(`Invalid creator scheduling contract: ${schedulingValidation.issues.join('; ')}`);
      }
      const assetType = output.asset_type;
      const baseBlueprint = safeObject(output.asset_instruction.blueprint);
      const baseAssetPayload = safeObject(output.asset_payload);
      let adaptedAssetPayload: Record<string, unknown> = {};

      if (assetType === 'carousel') {
        const variants = await repurposeCarouselForPlatforms(baseBlueprint, [normalizedPlatform]);
        const variant = safeObject(variants[normalizedPlatform]);
        const slides = toArrayOfObjects(variant.slides).length > 0 ? toArrayOfObjects(variant.slides) : toArrayOfObjects(baseAssetPayload.slides);
        adaptedAssetPayload = {
          ...baseAssetPayload,
          aspect_ratio: String(variant.aspect_ratio ?? PLATFORM_RULES[normalizedPlatform]?.aspectRatio ?? baseAssetPayload.aspect_ratio ?? '1:1'),
          slide_count: Number(variant.total_slides ?? baseAssetPayload.slide_count ?? slides.length),
          slides:
            PLATFORM_RULES[normalizedPlatform]?.slideLimit && slides.length > 0
              ? slides.slice(0, PLATFORM_RULES[normalizedPlatform]!.slideLimit)
              : slides,
          platform_metadata: safeObject(variant.platform_metadata),
        };
      } else if (assetType === 'video') {
        const variants = await repurposeVideoScriptForPlatforms(baseBlueprint, [normalizedPlatform]);
        const variant = safeObject(variants[normalizedPlatform]);
        adaptedAssetPayload = {
          ...baseAssetPayload,
          aspect_ratio: String(variant.aspect_ratio ?? PLATFORM_RULES[normalizedPlatform]?.aspectRatio ?? baseAssetPayload.aspect_ratio ?? '9:16'),
          duration_seconds: Number(variant.duration ?? baseAssetPayload.duration_seconds ?? 0),
          platform_payload: variant,
          platform_metadata: safeObject(variant.platform_metadata),
        };
      } else {
        adaptedAssetPayload = {
          ...baseAssetPayload,
          platform_payload: {
            platform: normalizedPlatform,
            visual_descriptor: safeObject(baseAssetPayload.visual_descriptor),
            aspect_ratio: PLATFORM_RULES[normalizedPlatform]?.aspectRatio ?? baseAssetPayload.aspect_ratio ?? '1:1',
          },
        };
      }

      const platformPackaging = adaptPackagingForPlatform(output.packaging, normalizedPlatform);

      const adaptedOutput: CanonicalCreatorOutput = {
        ...output,
        asset_payload: adaptedAssetPayload,
        packaging: {
          ...output.packaging,
          caption: platformPackaging.caption,
          hashtags: platformPackaging.hashtags,
          cta: platformPackaging.cta || output.packaging.cta,
          meta_description: platformPackaging.meta_description || output.packaging.meta_description,
          keywords: platformPackaging.keywords || output.packaging.keywords,
          platform_variants: {
            ...output.packaging.platform_variants,
            [normalizedPlatform]: platformPackaging,
          },
        },
        metadata: {
          ...output.metadata,
          platform_variant: normalizedPlatform,
        },
      };
      const postAdaptCapability = checkCapability(normalizedPlatform, adaptedOutput.asset_type, adaptedOutput.asset_payload);
      if (!postAdaptCapability.ok) {
        throw new Error(('reason' in postAdaptCapability ? postAdaptCapability.reason : 'Unsupported adapted payload'));
      }
      assertValidExecutionOutput(adaptedOutput);
      return adaptedOutput;
    },

    async schedule(output, row): Promise<CreatorScheduleResult> {
      const normalizedContentType = normalizeCreatorFormat(row.contentType || output.metadata.content_type);
      if (!supportsAutonomousExecution(normalizedContentType)) {
        return {
          scheduledPostId: null,
          status: 'failed',
          publish_source: 'unknown',
          platform_id: null,
          verified: false,
          published: false,
          failure_reason: `Creator format "${normalizedContentType || row.contentType}" is guidance-only or unsupported and cannot be scheduled`,
        };
      }
      const renderedOutput = await withRenderedMedia(output).catch(() => output);
      assertValidExecutionOutput(renderedOutput);
      const contractValidation = validateCreatorSchedulingContract({
        output: renderedOutput,
        platform: row.platform,
      });
      if (!contractValidation.ok) {
        return {
          scheduledPostId: null,
          status: 'failed',
          publish_source: 'unknown',
          platform_id: null,
          verified: false,
          published: false,
          failure_reason: contractValidation.issues.join('; '),
        };
      }

      const readiness = await validateAssetReadiness({
        output: renderedOutput,
        platform: row.platform,
      });
      if (!readiness.ready) {
        return {
          scheduledPostId: null,
          status: 'failed',
          publish_source: 'unknown',
          platform_id: null,
          verified: false,
          published: false,
          failure_reason: readiness.failure_reason,
        };
      }

      const now = new Date().toISOString();
      const builtPayload = buildScheduledPostInsertPayload({
        output: renderedOutput,
        row,
        createdAtIso: now,
      });
      const mediaUrls = builtPayload.media_urls;
      const assetHash = buildAssetHash(renderedOutput);
      const campaignId = String(renderedOutput.metadata.campaign_id || '');
      const idempotencyKey = `${row.dailyPlanId}:${campaignId}:${row.dbPlatform}:${assetHash}`;
      const platformId = buildDeterministicPlatformId({
        mediaUrls,
        dailyPlanId: row.dailyPlanId,
        timestamp: row.scheduledForIso,
      });
      // Activate the uniqueness guarantee from migration 20260725's
      // partial unique index uidx_scheduled_posts_idempotency_key. The
      // key was historically computed but never written to the row,
      // leaving idempotency_key NULL — the partial index (WHERE NOT
      // NULL) didn't enforce uniqueness on NULL rows, so retries
      // produced duplicate scheduled_posts. Wiring the key here closes
      // the duplicate path; the existing 23505 collision handler below
      // continues to recover from the now-real conflict.
      const insertPayload = { ...builtPayload, idempotency_key: idempotencyKey };

      const { data: inserted, error } = await ownedDbTable('scheduled_posts')
        .insert(insertPayload)
        .select('id, platform_post_id')
        .maybeSingle();

      if (error) {
        const failureType = classifyScheduleFailure(error.message);
        if ((error as any)?.code === '23505') {
          // 23505 from our partial unique index — recover by looking up
          // the existing row via idempotency_key (the actual colliding
          // value). The prior code looked up by `inserted.id`, but
          // `inserted` is null when the INSERT errored, so it always
          // resolved to .eq('id', '') and returned nothing. With the
          // idempotency_key now populated on every INSERT, this lookup
          // returns the previously-inserted row reliably.
          const { data: existing, error: existingError } = await ownedDbTable('scheduled_posts')
            .select('id, platform_post_id')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();
          if (existingError) {
            return {
              scheduledPostId: null,
              status: 'failed',
              publish_source: 'unknown',
              platform_id: platformId,
              verified: false,
              published: false,
              failure_reason: `Failed to load existing creator schedule after idempotency hit: ${existingError.message}`,
              idempotency_key: idempotencyKey,
            };
          }
          const published = Boolean((existing as any)?.platform_post_id);
          return {
            scheduledPostId: String((existing as any)?.id || ''),
            status: published ? 'published' : 'verified',
            publish_source: published ? 'platform_ack' : 'unknown',
            platform_id: String((existing as any)?.platform_post_id || platformId),
            verified: true,
            published,
            failure_reason: null,
            idempotency_key: idempotencyKey,
          };
        }
        return {
          scheduledPostId: null,
          status: 'failed',
          publish_source: 'unknown',
          platform_id: platformId,
          verified: false,
          published: false,
          failure_reason: `${failureType}:${error.message}`,
          idempotency_key: idempotencyKey,
        };
      }

      const scheduledPostId = String((inserted as any)?.id || '');
      if (scheduledPostId) {
        await enqueueScheduledPostAt(
          scheduledPostId,
          row.userId,
          row.socialAccountId,
          row.scheduledForIso,
        ).catch(() => undefined);
      }

      const confirmation = await validateAssetReadiness({
        output: renderedOutput,
        platform: row.platform,
      });

      return {
        scheduledPostId: scheduledPostId || null,
        status: confirmation.ready ? (String((inserted as any)?.platform_post_id || '').trim() ? 'published' : 'verified') : 'created',
        publish_source: String((inserted as any)?.platform_post_id || '').trim() ? 'platform_ack' : 'unknown',
        platform_id: String((inserted as any)?.platform_post_id || platformId),
        verified: confirmation.ready,
        published: Boolean((inserted as any)?.platform_post_id),
        failure_reason: confirmation.ready ? null : confirmation.failure_reason,
        idempotency_key: idempotencyKey,
      };
    },
  };
}


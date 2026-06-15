import { supabase } from '../../db/supabaseClient';
import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import { createHash } from 'crypto';
import { config } from '@/config';
import { getCreatorSystemPrompt } from '../../prompts/creatorContentPromptsV1';
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

type CreatorBlueprintType = 'video_script' | 'carousel' | 'story';

function inferBlueprintType(assetType: string, contentType: string): CreatorBlueprintType {
  if (assetType === 'carousel') return 'carousel';
  if (String(contentType || '').toLowerCase() === 'story') return 'story';
  return 'video_script';
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function deriveStructureFromTemplate(template: { structure_schema?: Record<string, unknown> }): Record<string, unknown> {
  const structure = safeObject(template.structure_schema);
  return {
    ...(structure.frame_count != null ? { frame_count: Number(structure.frame_count) } : {}),
    ...(Array.isArray(structure.frame_roles) ? { frame_roles: structure.frame_roles.map(String) } : {}),
    ...(structure.output_shape != null ? { output_shape: String(structure.output_shape) } : {}),
  };
}

function toArrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => item as Record<string, unknown>)
    : [];
}

function extractSequenceForTemplateValidation(assetType: string, blueprint: Record<string, unknown>): Record<string, unknown>[] {
  if (assetType === 'carousel') {
    return toArrayOfObjects(blueprint.slides);
  }
  if (assetType === 'video') {
    const scenes = toArrayOfObjects(blueprint.scenes);
    return scenes.length > 0 ? scenes : toArrayOfObjects(blueprint.frames);
  }
  return [];
}

function validateBlueprintAgainstTemplate(input: {
  assetType: string;
  blueprint: Record<string, unknown>;
  template: { structure_schema?: Record<string, unknown> };
}): void {
  if (input.assetType === 'image') {
    return;
  }

  const structure = safeObject(input.template.structure_schema);
  const sequence = extractSequenceForTemplateValidation(input.assetType, input.blueprint);
  const expectedFrameCount = structure.frame_count == null ? null : Number(structure.frame_count);
  const expectedRoles = Array.isArray(structure.frame_roles) ? structure.frame_roles.map(String) : [];

  if (expectedFrameCount != null && expectedFrameCount > 0) {
    if (sequence.length === 0 || sequence.length !== expectedFrameCount) {
      throw new Error('Blueprint does not match template structure');
    }
  }

  if (expectedRoles.length > 0) {
    if (sequence.length < expectedRoles.length) {
      throw new Error('Blueprint does not match template structure');
    }
    for (let index = 0; index < expectedRoles.length; index += 1) {
      const role = String(sequence[index]?.role ?? '');
      if (role !== expectedRoles[index]) {
        throw new Error('Blueprint does not match template structure');
      }
    }
  }
}

function buildTemplateAlignmentInstruction(input: {
  assetType: string;
  template: { structure_schema?: Record<string, unknown> };
}): string {
  const structure = safeObject(input.template.structure_schema);
  const expectedFrameCount = structure.frame_count == null ? null : Number(structure.frame_count);
  const expectedRoles = Array.isArray(structure.frame_roles) ? structure.frame_roles.map(String) : [];

  if (input.assetType === 'carousel') {
    return [
      'Template contract is mandatory.',
      expectedFrameCount ? `Return exactly ${expectedFrameCount} slides.` : '',
      expectedRoles.length > 0 ? `Slides must use this role order exactly: ${expectedRoles.join(', ')}.` : '',
      'Every slide must include: slide_number, role, headline, body_text, visual_description, design_note.',
      'Do not omit or merge slides.',
    ].filter(Boolean).join(' ');
  }

  if (input.assetType === 'video') {
    return [
      'Template contract is mandatory.',
      expectedFrameCount ? `Return exactly ${expectedFrameCount} scenes.` : '',
      expectedRoles.length > 0 ? `Scenes must use this role order exactly: ${expectedRoles.join(', ')}.` : '',
      'Every scene must include: role, visual, dialogue or text, and duration_seconds.',
    ].filter(Boolean).join(' ');
  }

  if (input.assetType === 'image') {
    return 'Template contract is mandatory. Return a single-frame visual blueprint with clear headline or visual_description.';
  }

  return 'Template contract is mandatory. Return a blueprint that matches the provided structure_schema exactly.';
}

function extractAnalyticsIntelligence(input: CreatorGenerationContext): {
  promptBlock: string | null;
  readiness: string | null;
  primitiveCount: number;
  lowConfidenceNote: string | null;
} {
  const analytics = safeObject(safeObject(input.enrichedIntent).analytics_intelligence);
  const promptBlock = typeof analytics.prompt_block === 'string' && analytics.prompt_block.trim()
    ? analytics.prompt_block.trim()
    : null;
  const primitives = Array.isArray(analytics.primitives) ? analytics.primitives : [];
  return {
    promptBlock,
    readiness: typeof analytics.readiness === 'string' ? analytics.readiness : null,
    primitiveCount: primitives.length,
    lowConfidenceNote: typeof analytics.low_confidence_note === 'string' ? analytics.low_confidence_note : null,
  };
}

function alignCarouselBlueprintToTemplate(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown> }
): Record<string, unknown> {
  const structure = safeObject(template.structure_schema);
  const expectedFrameCount = structure.frame_count == null ? null : Number(structure.frame_count);
  const expectedRoles = Array.isArray(structure.frame_roles) ? structure.frame_roles.map(String) : [];
  const sourceSlides = toArrayOfObjects(blueprint.slides);

  if (!expectedFrameCount || expectedFrameCount <= 0) {
    return blueprint;
  }

  // Carousel Phase A — Commit 3 (filler elimination). REAL content only. Any
  // field the model did not supply is left EMPTY — never fabricated. Missing
  // slides are NOT padded by duplicating the last slide. Completeness is judged
  // afterward by carouselBlueprintIsComplete(), which drives retry/fallback/
  // failure. First/last may inherit real blueprint-level hook/cta copy; middle
  // slides get only their own real content.
  const hookScene = safeObject(blueprint.hook_scene);
  const ctaSlide = safeObject(blueprint.cta_slide);
  const hookHeadline = String(blueprint.headline ?? blueprint.title ?? hookScene.text ?? '').trim();
  const hookBody = String(blueprint.summary ?? blueprint.narrative_intent ?? '').trim();
  const ctaHeadline = String(ctaSlide.headline ?? blueprint.cta ?? '').trim();
  const ctaBody = String(ctaSlide.cta_text ?? safeObject(blueprint.cta_scene).text ?? '').trim();

  const slides = Array.from({ length: expectedFrameCount }, (_, index) => {
    const e = safeObject(sourceSlides[index]);
    const role = expectedRoles[index] ?? String(e.role ?? (index === 0 ? 'hook' : index === expectedFrameCount - 1 ? 'cta' : 'insight'));
    const isFirst = index === 0;
    const isLast = index === expectedFrameCount - 1;

    return {
      ...e,
      slide_number: index + 1,
      role,
      headline: String(
        e.headline ??
        (isFirst ? hookHeadline : isLast ? ctaHeadline : '')
      ).trim(),
      body_text: String(
        e.body_text ??
        (isFirst ? hookBody : isLast ? ctaBody : '')
      ).trim(),
      visual_description: String(e.visual_description ?? e.visual ?? '').trim(),
      design_note: String(e.design_note ?? blueprint.design_note ?? '').trim(),
      icon_suggestion: String(e.icon_suggestion ?? '').trim(),
    };
  });

  return {
    ...blueprint,
    total_slides: expectedFrameCount,
    slides,
  };
}

function alignVideoBlueprintToTemplate(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown> }
): Record<string, unknown> {
  const structure = safeObject(template.structure_schema);
  const expectedFrameCount = structure.frame_count == null ? null : Number(structure.frame_count);
  const expectedRoles = Array.isArray(structure.frame_roles) ? structure.frame_roles.map(String) : [];
  if (!expectedFrameCount || expectedFrameCount <= 0) {
    return blueprint;
  }

  const sourceScenes = toArrayOfObjects(blueprint.scenes);
  const sourceFrames = toArrayOfObjects(blueprint.frames);
  const existingSequence = sourceScenes.length > 0 ? sourceScenes : sourceFrames;
  const fallbackScene = existingSequence[existingSequence.length - 1] ?? {};
  const hookScene = safeObject(blueprint.hook_scene);
  const ctaScene = safeObject(blueprint.cta_scene || blueprint.resolution_frame);

  const scenes = Array.from({ length: expectedFrameCount }, (_, index) => {
    const existing = existingSequence[index] ?? fallbackScene;
    const role = expectedRoles[index] ?? String(existing.role ?? (index === 0 ? 'hook' : index === expectedFrameCount - 1 ? 'cta' : 'insight'));
    const isFirst = index === 0;
    const isLast = index === expectedFrameCount - 1;
    return {
      ...existing,
      scene_number: index + 1,
      role,
      visual: String(existing.visual ?? (isFirst ? hookScene.visual : isLast ? ctaScene.visual : fallbackScene.visual) ?? `Visual for ${role} scene ${index + 1}.`).trim(),
      dialogue: String(existing.dialogue ?? existing.text ?? (isFirst ? hookScene.text : isLast ? ctaScene.text : blueprint.summary) ?? '').trim(),
      duration_seconds: Number(existing.duration_seconds ?? 3) || 3,
    };
  });

  return {
    ...blueprint,
    scenes,
  };
}

function alignBlueprintToTemplate(input: {
  assetType: string;
  blueprint: Record<string, unknown>;
  template: { structure_schema?: Record<string, unknown> };
}): Record<string, unknown> {
  if (input.assetType === 'carousel') {
    return alignCarouselBlueprintToTemplate(input.blueprint, input.template);
  }
  if (input.assetType === 'video') {
    return alignVideoBlueprintToTemplate(input.blueprint, input.template);
  }
  return input.blueprint;
}

function normalizeCreatorAssetPayload(input: {
  assetType: string;
  blueprint: Record<string, unknown>;
  overrideAsset?: Record<string, unknown>;
  creatorCard?: Record<string, unknown>;
  topic?: string;
  objective?: string;
  summary?: string;
}): Record<string, unknown> {
  const { assetType, blueprint, overrideAsset } = input;
  const override = safeObject(overrideAsset);
  const attachmentMode = String(input.creatorCard?.attachment_mode || '').trim();
  const overlayText = attachmentMode === 'supporting_visual'
    ? {}
    : safeObject(input.creatorCard?.overlay_text);

  if (assetType === 'carousel') {
    const sourceSlides = toArrayOfObjects(blueprint.slides);
    const slides = sourceSlides.map((slide, index) => ({
      slide_number: Number(slide.slide_number ?? index + 1),
      role: String(slide.role ?? (index === 0 ? 'hook' : index === sourceSlides.length - 1 ? 'cta' : 'content')),
      headline: String(slide.headline ?? ''),
      body_text: String(slide.body_text ?? ''),
      visual_description: String(slide.visual_description ?? slide.visual ?? ''),
      design_note: String(slide.design_note ?? ''),
      icon_suggestion: String(slide.icon_suggestion ?? ''),
    }));
    return {
      asset_kind: 'carousel',
      slide_count: slides.length,
      slides,
      media_bundle: override,
    };
  }

  if (assetType === 'image') {
    const firstScene = toArrayOfObjects(blueprint.scenes)[0] ?? toArrayOfObjects(blueprint.frames)[0] ?? {};
    const hookScene = safeObject(blueprint.hook_scene);
    const fallbackHeadline = String(input.topic || blueprint.content_theme || blueprint.narrative_intent || 'Creator visual').trim();
    const fallbackBody = String(
      input.summary ||
      input.objective ||
      blueprint.summary ||
      blueprint.narrative_intent ||
      'A focused creator visual direction with clear hierarchy and platform-ready composition.'
    ).trim();
    return {
      asset_kind: 'image',
      visual_descriptor: {
        headline: attachmentMode === 'supporting_visual'
          ? fallbackHeadline
          : String(overlayText.headline ?? blueprint.headline ?? blueprint.title ?? blueprint.story_title ?? hookScene.text ?? firstScene.headline ?? firstScene.dialogue ?? fallbackHeadline),
        visual_description: String(
          blueprint.visual_description ??
          blueprint.visual ??
          hookScene.visual ??
          firstScene.visual_description ??
          firstScene.visual ??
          firstScene.text ??
          firstScene.dialogue ??
          fallbackBody
        ),
        color_palette: Array.isArray(blueprint.color_palette) ? blueprint.color_palette.map(String) : [],
        composition: String(blueprint.design_note ?? blueprint.layout ?? 'single focal composition'),
      },
      overlay_text: overlayText,
      attachment_mode: attachmentMode || undefined,
      asset_composition_intent: safeObject(input.creatorCard?.asset_composition_intent),
      copy_policy: safeObject(input.creatorCard?.copy_policy),
      media_bundle: override,
    };
  }

  const scenes = toArrayOfObjects(blueprint.scenes);
  const frames = toArrayOfObjects(blueprint.frames);
  return {
    asset_kind: 'video',
    hook_scene: safeObject(blueprint.hook_scene),
    scenes: scenes.length > 0 ? scenes : frames,
    cta_scene: safeObject(blueprint.cta_scene || blueprint.resolution_frame),
    duration_seconds:
      Number(blueprint.total_duration_seconds ?? 0) ||
      scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds ?? 0), Number(safeObject(blueprint.hook_scene).duration_seconds ?? 0)),
    aspect_ratio: String(safeObject(blueprint.platform_notes).optimal_aspect_ratio ?? blueprint.aspect_ratio ?? '9:16'),
    media_bundle: override,
  };
}

async function resolveTemplateForIntent(input: {
  assetType: string;
  templateId?: string | null;
  companyId?: string | null;
  providedTemplate?: CreatorGenerationContext['template'];
}) {
  if (input.providedTemplate) {
    return input.providedTemplate;
  }

  if (input.templateId) {
    const explicitTemplate = await getCreatorTemplateById({
      templateId: input.templateId,
      assetType: input.assetType as any,
      companyId: input.companyId,
    });
    if (!explicitTemplate) {
      throw new Error('Invalid template_id passed to creator');
    }
    return explicitTemplate;
  }

  return getCreatorTemplate({
    assetType: input.assetType as any,
    companyId: input.companyId,
  });
}

type PlatformRule = {
  captionPrefix?: string;
  hashtagLimit: number;
  aspectRatio?: string;
  pacing?: string;
  slideLimit?: number;
};

const PLATFORM_RULES: Record<string, PlatformRule> = {
  linkedin: { captionPrefix: 'Professional takeaway:', hashtagLimit: 5, aspectRatio: '16:9', pacing: 'measured' },
  instagram: { captionPrefix: 'Visual story:', hashtagLimit: 10, aspectRatio: '1:1', pacing: 'visual-first', slideLimit: 8 },
  instagram_reels: { captionPrefix: 'Reel concept:', hashtagLimit: 8, aspectRatio: '9:16', pacing: 'fast' },
  tiktok: { captionPrefix: 'TikTok angle:', hashtagLimit: 6, aspectRatio: '9:16', pacing: 'fast' },
  youtube_shorts: { captionPrefix: 'Shorts hook:', hashtagLimit: 5, aspectRatio: '9:16', pacing: 'steady' },
  youtube: { captionPrefix: 'Video breakdown:', hashtagLimit: 5, aspectRatio: '16:9', pacing: 'steady' },
  pinterest: { captionPrefix: 'Save-worthy idea:', hashtagLimit: 8, aspectRatio: '1000:1500', slideLimit: 6 },
  x: { captionPrefix: 'Quick take:', hashtagLimit: 3, pacing: 'tight' },
  twitter: { captionPrefix: 'Quick take:', hashtagLimit: 3, pacing: 'tight' },
  facebook: { captionPrefix: 'Community angle:', hashtagLimit: 5, aspectRatio: '1:1', slideLimit: 8 },
  threads: { captionPrefix: 'Thread-ready idea:', hashtagLimit: 3, aspectRatio: '1:1', pacing: 'tight' },
  reddit: { captionPrefix: 'Discussion starter:', hashtagLimit: 2, aspectRatio: '1:1', slideLimit: 8 },
};

function adaptPackagingForPlatform(
  packaging: CanonicalCreatorOutput['packaging'],
  platform: string
): CanonicalCreatorOutput['packaging']['platform_variants'][string] {
  const rules = PLATFORM_RULES[platform] ?? { hashtagLimit: 5 };
  const prefix = rules.captionPrefix ? `${rules.captionPrefix} ` : '';
  return {
    caption: `${prefix}${packaging.caption}`.trim(),
    hashtags: packaging.hashtags.slice(0, Math.max(1, rules.hashtagLimit)),
    cta: packaging.cta,
    meta_description: packaging.meta_description,
    keywords: packaging.keywords,
  };
}

/**
 * Carousel Phase A — Commit 1 (arc wiring).
 * Resolve the PurposeStrategy selector key for a generation context. Uses the
 * explicit context.purposeKey when threaded, else falls back to the canonical
 * creatorCard chain (purpose_key / infographic_layout / subtype) — the SAME
 * source the renderer + prompt composer already read from. Returns null when
 * no key is present (preserves legacy behavior).
 */
function resolveContextPurposeKey(context: CreatorGenerationContext): string | null {
  if (typeof context.purposeKey === 'string' && context.purposeKey.trim()) {
    return context.purposeKey.trim();
  }
  const card = safeObject(context.creatorCard);
  const fromCard = String(
    card.purpose_key
    || card.infographic_layout
    || card.subtype
    || ''
  ).trim();
  return fromCard || null;
}

/**
 * Carousel Phase A — Commit 1 (arc wiring).
 * Arc-derived structure_schema capability. Builds a template-compatible
 * structure_schema ({ frame_count, frame_roles }) from a resolved
 * PurposeStrategy's slideArc. This is a CAPABILITY ONLY in Commit 1 — it is
 * computed and surfaced in metadata for inspection/future commits, but is NOT
 * fed into template selection, the prompt, validation, or alignment yet (that
 * is Commit 2). Returns null when no slideArc is present (e.g. image/video).
 */
function deriveArcStructureSchema(
  purposeStrategy: PurposeStrategy | null,
): { frame_count: number; frame_roles: string[]; output_shape: 'slide_series' } | null {
  const arc = purposeStrategy?.slideArc;
  if (!Array.isArray(arc) || arc.length === 0) return null;
  const roles = arc.map((slide) => String(slide.role)).filter(Boolean);
  if (roles.length === 0) return null;
  return { frame_count: roles.length, frame_roles: roles, output_shape: 'slide_series' };
}

/**
 * Carousel Phase A — Commit 2 (arc activation).
 * Produce an arc-effective template: when the asset is a carousel AND a
 * PurposeStrategy with a slideArc resolves, override the template's
 * structure_schema with the arc-derived { frame_count, frame_roles }. All
 * other template fields (id, style_schema, mapping_rules) are preserved, so
 * every downstream contract (alignment, validateBlueprintAgainstTemplate,
 * deriveStructureFromTemplate) keeps working unchanged — it simply receives
 * the arc roles instead of the fixed hook/insight×3/proof/cta set. Returns the
 * template untouched for non-carousel assets or when no arc resolves (legacy
 * fallback — byte-identical behavior).
 */
function applyArcStructureToTemplate<T extends { structure_schema?: Record<string, unknown> }>(
  assetType: string,
  context: CreatorGenerationContext,
  template: T,
): T {
  if (assetType !== 'carousel') return template;
  const purposeStrategy = resolvePurposeStrategy(context.contentType, resolveContextPurposeKey(context));
  const arc = deriveArcStructureSchema(purposeStrategy);
  if (!arc) return template;
  return {
    ...template,
    structure_schema: {
      ...safeObject(template.structure_schema),
      frame_count: arc.frame_count,
      frame_roles: arc.frame_roles,
      output_shape: arc.output_shape,
    },
  };
}

/* ── Carousel Phase A — Commit 3: completeness, retry, fallback, failure ── */

const MIN_VIABLE_CAROUSEL_SLIDES = 3;
const MAX_CAROUSEL_COMPLETION_RETRIES = 2;

/** Thrown when a complete, minimum-viable carousel cannot be produced from real
 *  content. Propagates through runCreatorOrchestration's try/finally to the job
 *  processor as a clean generation failure — nothing fabricated is published. */
class CarouselContentIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarouselContentIncompleteError';
  }
}

/** Carousel Phase B — Commit B2. Thrown only in STRICT mode when an editor-grade
 *  quality failure cannot be repaired within budget. Propagates through
 *  runCreatorOrchestration's try/finally as a clean generation failure (same
 *  path as CarouselContentIncompleteError) — nothing sub-grade is published. */
class CarouselQualityRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarouselQualityRejectedError';
  }
}

/** A carousel slide may ship only if it carries real headline + body + visual. */
function isCarouselSlideComplete(slide: unknown): boolean {
  const s = safeObject(slide);
  const headline = String(s.headline ?? '').trim();
  const body = String(s.body_text ?? '').trim();
  const visual = String(s.visual_description ?? s.visual ?? '').trim();
  return Boolean(headline) && Boolean(body) && Boolean(visual);
}

/** Complete when slide count matches the template AND every slide is complete. */
function carouselBlueprintIsComplete(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown> },
): boolean {
  const structure = safeObject(template.structure_schema);
  const expected = structure.frame_count == null ? null : Number(structure.frame_count);
  const slides = toArrayOfObjects(blueprint.slides);
  if (!expected || expected <= 0) {
    return slides.length > 0 && slides.every(isCarouselSlideComplete);
  }
  if (slides.length !== expected) return false;
  return slides.every(isCarouselSlideComplete);
}

/** Corrective directive appended to the generation prompt on retry. A
 *  completion instruction (Commit 3), NOT a quality gate. */
function buildCompletionRetryDirective(attempt: number, expectedRoles: string[], expectedCount: number): string {
  const roleLine = expectedRoles.length > 0 ? ` in this exact role order: ${expectedRoles.join(', ')}` : '';
  return [
    `STRICT COMPLETION REQUIREMENT (retry ${attempt}):`,
    `Your previous response did not return ${expectedCount} fully-populated slides.`,
    `Return EXACTLY ${expectedCount} slides${roleLine}.`,
    'Every slide MUST have a non-empty, specific headline, body_text, and visual_description grounded in the topic.',
    'Do not return empty fields. Do not duplicate slides. Do not use placeholder text.',
  ].join(' ');
}

/** Fallback: rebuild a smaller but fully-real carousel from the complete slides
 *  ONLY. Real content is preserved; nothing is invented. Returns null when a
 *  coherent minimum-viable deck cannot be formed (→ clean failure). */
function buildReducedCarouselFromCompleteSlides(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown>; [k: string]: unknown },
): { blueprint: Record<string, unknown>; template: typeof template } | null {
  const sourceSlides = toArrayOfObjects(blueprint.slides);
  if (sourceSlides.length === 0) return null;
  // Require real hook + cta bookends so the reduced deck stays coherent.
  if (!isCarouselSlideComplete(sourceSlides[0])) return null;
  if (!isCarouselSlideComplete(sourceSlides[sourceSlides.length - 1])) return null;
  const complete = sourceSlides.filter(isCarouselSlideComplete);
  if (complete.length < MIN_VIABLE_CAROUSEL_SLIDES) return null;

  const reducedRoles = complete.map((s, i) =>
    String(safeObject(s).role || (i === 0 ? 'hook' : i === complete.length - 1 ? 'cta' : 'insight')),
  );
  const reducedTemplate = {
    ...template,
    structure_schema: {
      ...safeObject(template.structure_schema),
      frame_count: complete.length,
      frame_roles: reducedRoles,
    },
  };
  const reduced = alignCarouselBlueprintToTemplate({ ...blueprint, slides: complete }, reducedTemplate);
  // Defensive: the reduced deck must itself be fully complete (real content in).
  if (!carouselBlueprintIsComplete(reduced, reducedTemplate)) return null;
  return { blueprint: reduced, template: reducedTemplate };
}

/** Carousel Phase B — record a quality + completeness telemetry sample. Fully
 *  isolated and best-effort: any failure here is swallowed so generation
 *  behavior is never affected. */
function recordCarouselQualityOutcome(
  context: CreatorGenerationContext,
  blueprint: Record<string, unknown>,
  stats: {
    attempts: number;
    fallbackUsed: boolean;
    failed: boolean;
    mode: CarouselEnforcementMode;
    qualityRetries: number;
    qualityRejected: boolean;
    failingDimensions: string[];
  },
): void {
  try {
    const purposeStrategy = resolvePurposeStrategy(context.contentType, resolveContextPurposeKey(context));
    const result = evaluateCarouselQuality({
      slides: toArrayOfObjects(blueprint.slides),
      archetype: purposeStrategy?.purposeKey ?? null,
      ctaIntensity: purposeStrategy?.ctaIntensity ?? null,
      topic: context.topic ?? null,
    });
    const dimensionScores: Record<string, number | null> = {};
    for (const check of result.checks) {
      dimensionScores[check.id] = typeof check.score === 'number' ? check.score : null;
    }
    recordCarouselQualitySample({
      archetype: purposeStrategy?.purposeKey ?? 'unknown',
      generation_attempts: stats.attempts,
      retry_count: Math.max(0, stats.attempts - 1),
      fallback_used: stats.fallbackUsed,
      failed: stats.failed,
      overall_score: result.score,
      dimension_scores: dimensionScores,
      quality_mode: stats.mode,
      quality_retry_count: stats.qualityRetries,
      quality_rejected: stats.qualityRejected,
      quality_failing_dimensions: stats.failingDimensions,
    });
  } catch {
    // Telemetry must never affect generation.
  }
}

/** Completeness sub-routine (Phase A): generate → bounded completeness retry →
 *  real-content fallback → clean fail. Optionally threads a B2 quality-revision
 *  directive into EVERY attempt of this pass. Returns the produced deck + the
 *  attempts it consumed; records completeness-FAILURE telemetry on its throw. */
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
    last = await generateBlueprint(
      { ...context, template: effectiveTemplate as CreatorGenerationContext['template'] },
      { completionRetryHint, qualityRetryHint },
    );
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
  const systemPrompt = getCreatorSystemPrompt(blueprintType, creatorContext);
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
  const prompt = `Generate a creator asset blueprint.

Input:
${JSON.stringify(promptInput, null, 2)}

Analytics intelligence guidance:
${analyticsIntelligence.promptBlock ?? 'No analytics/search intelligence is available. Use only the supplied creator and campaign context.'}
${analyticsIntelligence.lowConfidenceNote ? `\nConfidence note: ${analyticsIntelligence.lowConfidenceNote}` : ''}

Template alignment rule:
${buildTemplateAlignmentInstruction({ assetType, template })}

${assetType === 'image' ? 'Single-image output rule: include top-level "headline" and "visual_description" fields. The visual_description must describe the actual preview composition, focal object, layout, palette, hierarchy, and intended viewer reaction. Do not return only generic placeholder language.' : ''}
${opts?.completionRetryHint ? `\n${opts.completionRetryHint}\n` : ''}${opts?.qualityRetryHint ? `\n${opts.qualityRetryHint}\n` : ''}
Return JSON only.`;

  const result = await runCompletionWithOperation({
    companyId: context.companyId,
    campaignId: context.campaignId ?? null,
    referenceType: context.correlation?.referenceType ?? null,
    referenceId: context.correlation?.referenceId ?? null,
    parentActivityId: context.correlation?.parentActivityId ?? null,
    model: config.OPENAI_MODEL,
    operation: `creator_execution_blueprint_${assetType}`,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
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

  const renderedMedia = await renderAsset(safeObject(output.asset_payload), {
    campaignId: String(output.metadata.campaign_id || '') || null,
    userId: String(output.metadata.user_id || '') || null,
    companyId: String(output.metadata.company_id || '') || null,
  });

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

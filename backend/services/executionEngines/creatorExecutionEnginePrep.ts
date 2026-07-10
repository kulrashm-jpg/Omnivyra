/** Creator execution — inputs, normalization, card/brief preparation — split from creatorExecutionEngine.ts (barrel preserved; importers unchanged). */
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


export type CreatorBlueprintType = 'video_script' | 'carousel' | 'story' | 'image';

/**
 * Map an asset/content type to the blueprint type that drives BOTH the
 * generation prompt and content-quality validation routing.
 *
 * IMAGE FIX: static single-visual assets (image / infographic / banner) are
 * NOT video scripts. Previously they fell through to the `video_script`
 * default, which ran the video validator against an image and emitted false
 * "Too few scenes / Missing hook_scene / Script too short / Missing CTA scene"
 * issues. They now resolve to `'image'` so validation routes to the image
 * validator. (carousel / story / video behaviour is unchanged.)
 */
export function inferBlueprintType(assetType: string, contentType: string): CreatorBlueprintType {
  if (assetType === 'carousel') return 'carousel';
  if (String(contentType || '').toLowerCase() === 'story') return 'story';
  const at = String(assetType || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (at === 'image' || at === 'infographic' || at === 'banner'
    || ct === 'image' || ct === 'infographic' || ct === 'banner') {
    return 'image';
  }
  return 'video_script';
}

export function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function deriveStructureFromTemplate(template: { structure_schema?: Record<string, unknown> }): Record<string, unknown> {
  const structure = safeObject(template.structure_schema);
  return {
    ...(structure.frame_count != null ? { frame_count: Number(structure.frame_count) } : {}),
    ...(Array.isArray(structure.frame_roles) ? { frame_roles: structure.frame_roles.map(String) } : {}),
    ...(structure.output_shape != null ? { output_shape: String(structure.output_shape) } : {}),
  };
}

export function toArrayOfObjects(value: unknown): Record<string, unknown>[] {
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

export function validateBlueprintAgainstTemplate(input: {
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

export function buildTemplateAlignmentInstruction(input: {
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

export function extractAnalyticsIntelligence(input: CreatorGenerationContext): {
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

export function alignBlueprintToTemplate(input: {
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

export function normalizeCreatorAssetPayload(input: {
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

export async function resolveTemplateForIntent(input: {
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

export const PLATFORM_RULES: Record<string, PlatformRule> = {
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

export function adaptPackagingForPlatform(
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
export function resolveContextPurposeKey(context: CreatorGenerationContext): string | null {
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
export function deriveArcStructureSchema(
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
export function applyArcStructureToTemplate<T extends { structure_schema?: Record<string, unknown> }>(
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
export const MAX_CAROUSEL_COMPLETION_RETRIES = 2;

/** Thrown when a complete, minimum-viable carousel cannot be produced from real
 *  content. Propagates through runCreatorOrchestration's try/finally to the job
 *  processor as a clean generation failure — nothing fabricated is published. */
export class CarouselContentIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarouselContentIncompleteError';
  }
}

/** Carousel Phase B — Commit B2. Thrown only in STRICT mode when an editor-grade
 *  quality failure cannot be repaired within budget. Propagates through
 *  runCreatorOrchestration's try/finally as a clean generation failure (same
 *  path as CarouselContentIncompleteError) — nothing sub-grade is published. */
export class CarouselQualityRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarouselQualityRejectedError';
  }
}

/** Normalize slide text to alphanumeric word tokens for distinctness scoring. */
function normalizeSlideText(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Word-overlap similarity (Jaccard) between two token strings. */
function slideBodyOverlap(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Two slides are near-duplicate when their headlines match OR their bodies
 *  overlap heavily — the generic filler the model emits for a thin brief
 *  ("Unlock Your Brand's Potential" twice) is caught here. */
export function slidesAreNearDuplicate(a: unknown, b: unknown): boolean {
  const sa = safeObject(a);
  const sb = safeObject(b);
  const ha = normalizeSlideText(sa.headline);
  const hb = normalizeSlideText(sb.headline);
  if (ha && ha === hb) return true;
  return slideBodyOverlap(normalizeSlideText(sa.body_text), normalizeSlideText(sb.body_text)) >= 0.8;
}

/** True when any two slides in the deck are near-duplicate. */
export function deckHasNearDuplicateSlides(slides: unknown[]): boolean {
  for (let i = 0; i < slides.length; i += 1) {
    for (let j = i + 1; j < slides.length; j += 1) {
      if (slidesAreNearDuplicate(slides[i], slides[j])) return true;
    }
  }
  return false;
}

/** Keep the first of each near-duplicate run; drop the rest. Order preserved. */
export function dedupeCarouselSlides<T>(slides: T[]): T[] {
  const kept: T[] = [];
  for (const slide of slides) {
    if (!kept.some((k) => slidesAreNearDuplicate(k, slide))) kept.push(slide);
  }
  return kept;
}

/** A carousel slide may ship only if it carries real headline + a substantive
 *  body (≥ 3 words, not a near-blank card) + visual. */
export function isCarouselSlideComplete(slide: unknown): boolean {
  const s = safeObject(slide);
  const headline = String(s.headline ?? '').trim();
  const body = String(s.body_text ?? '').trim();
  const visual = String(s.visual_description ?? s.visual ?? '').trim();
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  return Boolean(headline) && bodyWords >= 3 && Boolean(visual);
}

/**
 * Fold a legacy-shaped separate `cta_slide` object into the `slides` array
 * (incident 2026-07-10: the carousel OUTPUT FORMAT example instructed a
 * separate `cta_slide`, so the model returned N−1 inline slides + cta_slide —
 * failing the frame-count contract on EVERY attempt, and when retry-forced
 * inline, the cta_slide example had no `body_text` field so the final slide
 * arrived body-less and killed the reduced-deck fallback's bookend check.
 * All production carousels failed permanently as a result.)
 *
 * Uses ONLY model-authored content (headline / body_text / cta_text /
 * urgency_element / visual_description) — nothing is fabricated. When the
 * final inline slide is already the CTA but body-less, the cta_slide's text
 * backfills it; otherwise the cta_slide is appended as the closing slide.
 * No `cta_slide` present → returns the blueprint unchanged (idempotent).
 */
export function normalizeCarouselBlueprintShape(
  blueprint: Record<string, unknown>,
): Record<string, unknown> {
  const cta = safeObject(blueprint.cta_slide);
  if (Object.keys(cta).length === 0) return blueprint;
  const slides = toArrayOfObjects(blueprint.slides);
  const ctaBody = String(cta.body_text ?? cta.cta_text ?? cta.urgency_element ?? '').trim();
  const ctaHeadline = String(cta.headline ?? '').trim();

  const last = slides.length > 0 ? safeObject(slides[slides.length - 1]) : null;
  const lastIsCta = last != null && (
    String(last.role ?? '').toLowerCase() === 'cta' ||
    (ctaHeadline !== '' && normalizeSlideText(last.headline) === normalizeSlideText(ctaHeadline))
  );

  const { cta_slide: _dropped, ...rest } = blueprint;
  if (lastIsCta) {
    // Backfill missing fields on the existing inline CTA slide from cta_slide.
    const merged = { ...last } as Record<string, unknown>;
    if (!String(merged.body_text ?? '').trim() && ctaBody) merged.body_text = ctaBody;
    if (!String(merged.headline ?? '').trim() && ctaHeadline) merged.headline = ctaHeadline;
    if (!String(merged.visual_description ?? merged.visual ?? '').trim() && String(cta.visual_description ?? '').trim()) {
      merged.visual_description = cta.visual_description;
    }
    return { ...rest, slides: [...slides.slice(0, -1), merged] };
  }
  // Append the cta_slide as the closing slide (real content only).
  const appended: Record<string, unknown> = {
    slide_number: slides.length + 1,
    role: 'cta',
    headline: ctaHeadline,
    body_text: ctaBody,
    visual_description: cta.visual_description ?? cta.visual ?? '',
    ...(cta.cta_text != null ? { cta_text: cta.cta_text } : {}),
    ...(cta.color_accent != null ? { color_accent: cta.color_accent } : {}),
    ...(cta.design_note != null ? { design_note: cta.design_note } : {}),
  };
  return { ...rest, slides: [...slides, appended] };
}

/** Complete when slide count matches the template AND every slide is complete. */
export function carouselBlueprintIsComplete(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown> },
): boolean {
  const structure = safeObject(template.structure_schema);
  const expected = structure.frame_count == null ? null : Number(structure.frame_count);
  const slides = toArrayOfObjects(blueprint.slides);
  // A deck with near-duplicate slides is NOT complete — this routes duped output
  // back through the completion retry ("Do not duplicate slides"), then the
  // deduped reduced-deck fallback, so duplicates can never ship.
  if (deckHasNearDuplicateSlides(slides)) return false;
  if (!expected || expected <= 0) {
    return slides.length > 0 && slides.every(isCarouselSlideComplete);
  }
  if (slides.length !== expected) return false;
  return slides.every(isCarouselSlideComplete);
}

/** Corrective directive appended to the generation prompt on retry. A
 *  completion instruction (Commit 3), NOT a quality gate. */
export function buildCompletionRetryDirective(attempt: number, expectedRoles: string[], expectedCount: number): string {
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
export function buildReducedCarouselFromCompleteSlides(
  blueprint: Record<string, unknown>,
  template: { structure_schema?: Record<string, unknown>; [k: string]: unknown },
): { blueprint: Record<string, unknown>; template: typeof template } | null {
  const sourceSlides = toArrayOfObjects(blueprint.slides);
  if (sourceSlides.length === 0) return null;
  // Require real hook + cta bookends so the reduced deck stays coherent.
  if (!isCarouselSlideComplete(sourceSlides[0])) return null;
  if (!isCarouselSlideComplete(sourceSlides[sourceSlides.length - 1])) return null;
  // Keep only complete AND distinct slides — a duped hero slide is dropped here so
  // the reduced deck is both real and non-repeating.
  const complete = dedupeCarouselSlides(sourceSlides.filter(isCarouselSlideComplete));
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
export function recordCarouselQualityOutcome(
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

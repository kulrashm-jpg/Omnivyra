import { supabase } from '../../db/supabaseClient';
import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import { createHash } from 'crypto';
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
import type {

  CanonicalCreatorOutput,
  CreatorExecutionEngine,
  CreatorGenerationContext,
  CreatorScheduleResult,
  CreatorScheduledRow,
} from './types';
import { ownedDbTable } from '../../db/writeOwner';

type CreatorBlueprintType = 'video_script' | 'carousel' | 'story' | 'post_blueprint' | 'thread_blueprint';

function inferBlueprintType(assetType: string, contentType: string): CreatorBlueprintType {
  if (assetType === 'carousel') return 'carousel';
  if (assetType === 'post_with_asset') return 'post_blueprint';
  if (assetType === 'thread_with_asset') return 'thread_blueprint';
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

function toThreadSequenceItems(value: unknown): Array<{ index: number; role?: string; text: string }> {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item, index) => {
      if (typeof item === 'string') {
        return { index: index + 1, text: item };
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const objectItem = item as Record<string, unknown>;
        return {
          index: Number(objectItem.index ?? objectItem.tweet_number ?? objectItem.slide_number ?? index + 1),
          role: objectItem.role == null ? undefined : String(objectItem.role),
          text: String(objectItem.text ?? objectItem.body_text ?? objectItem.tweet ?? objectItem.headline ?? ''),
        };
      }
      return null;
    })
    .filter(Boolean);
  return items as Array<{ index: number; role?: string; text: string }>;
}

function extractSequenceForTemplateValidation(assetType: string, blueprint: Record<string, unknown>): Record<string, unknown>[] {
  if (assetType === 'carousel') {
    return toArrayOfObjects(blueprint.slides);
  }
  if (assetType === 'video') {
    const scenes = toArrayOfObjects(blueprint.scenes);
    return scenes.length > 0 ? scenes : toArrayOfObjects(blueprint.frames);
  }
  if (assetType === 'thread_with_asset') {
    const thread = toThreadSequenceItems(blueprint.thread);
    const tweets = toThreadSequenceItems(blueprint.tweets);
    const slides = toThreadSequenceItems(blueprint.slides);
    const sequence = thread.length > 0 ? thread : tweets.length > 0 ? tweets : slides;
    if (sequence.length === 0) {
      throw new Error('Blueprint does not match template structure');
    }
    return sequence.map((item) => ({ index: item.index, role: item.role ?? 'supporting_asset', text: item.text }));
  }
  return [];
}

function validateBlueprintAgainstTemplate(input: {
  assetType: string;
  blueprint: Record<string, unknown>;
  template: { structure_schema?: Record<string, unknown> };
}): void {
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

  const fallbackSlide = sourceSlides[sourceSlides.length - 1] ?? {};
  const hookScene = safeObject(blueprint.hook_scene);
  const ctaSlide = safeObject(blueprint.cta_slide);
  const hookHeadline = String(blueprint.headline ?? blueprint.title ?? hookScene.text ?? '').trim();
  const hookBody = String(blueprint.summary ?? blueprint.narrative_intent ?? '').trim();
  const ctaHeadline = String(ctaSlide.headline ?? blueprint.cta ?? 'Next Step').trim();
  const ctaBody = String(ctaSlide.cta_text ?? safeObject(blueprint.cta_scene).text ?? 'Learn more').trim();
  const defaultVisual = String(blueprint.visual_description ?? fallbackSlide.visual_description ?? fallbackSlide.visual ?? '').trim();

  const slides = Array.from({ length: expectedFrameCount }, (_, index) => {
    const existing = sourceSlides[index] ?? fallbackSlide;
    const role = expectedRoles[index] ?? String(existing.role ?? (index === 0 ? 'hook' : index === expectedFrameCount - 1 ? 'cta' : 'insight'));
    const isFirst = index === 0;
    const isLast = index === expectedFrameCount - 1;

    return {
      ...existing,
      slide_number: index + 1,
      role,
      headline: String(
        existing.headline ??
        (isFirst ? hookHeadline : isLast ? ctaHeadline : blueprint.topic ?? blueprint.carousel_theme ?? hookHeadline)
      ).trim(),
      body_text: String(
        existing.body_text ??
        (isFirst ? hookBody : isLast ? ctaBody : (hookBody || `Key ${role} point for slide ${index + 1}.`))
      ).trim(),
      visual_description: String((existing.visual_description ?? existing.visual ?? defaultVisual) || `Visual direction for ${role} slide ${index + 1}.`).trim(),
      design_note: String(existing.design_note ?? blueprint.design_note ?? `Match the ${role} role with clear visual hierarchy.`).trim(),
      icon_suggestion: String(existing.icon_suggestion ?? '').trim(),
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
}): Record<string, unknown> {
  const { assetType, blueprint, overrideAsset } = input;
  const override = safeObject(overrideAsset);

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
    return {
      asset_kind: 'image',
      visual_descriptor: {
        headline: String(blueprint.headline ?? blueprint.title ?? blueprint.story_title ?? ''),
        visual_description: String(blueprint.visual_description ?? blueprint.visual ?? safeObject(blueprint.hook_scene).visual ?? ''),
        color_palette: Array.isArray(blueprint.color_palette) ? blueprint.color_palette.map(String) : [],
        composition: String(blueprint.design_note ?? blueprint.layout ?? 'single focal composition'),
      },
      media_bundle: override,
    };
  }

  if (assetType === 'post_with_asset' || assetType === 'thread_with_asset') {
    const threadSequence = assetType === 'thread_with_asset'
      ? (() => {
          const sequence = toThreadSequenceItems(blueprint.thread);
          const tweets = toThreadSequenceItems(blueprint.tweets);
          const slides = toThreadSequenceItems(blueprint.slides);
          const normalizedSequence = sequence.length > 0 ? sequence : tweets.length > 0 ? tweets : slides;
          if (normalizedSequence.length === 0) {
            throw new Error('Blueprint does not match template structure');
          }
          return normalizedSequence.map((item, index) => ({
            index: Number(item.index ?? index + 1),
            text: String(item.text ?? ''),
          }));
        })()
      : undefined;
    return {
      asset_kind: assetType === 'post_with_asset' ? 'image' : 'carousel',
      media_bundle: override,
      caption_blueprint: {
        hook: String(safeObject(blueprint.hook_scene).text ?? blueprint.headline ?? blueprint.story_title ?? ''),
        body: String(blueprint.summary ?? blueprint.carousel_theme ?? blueprint.narrative_intent ?? ''),
        cta: String(safeObject(blueprint.cta_scene).text ?? safeObject(blueprint.cta_slide).cta_text ?? safeObject(blueprint.resolution_frame).cta_action ?? ''),
      },
      ...(threadSequence ? { thread_sequence: threadSequence } : {}),
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

async function generateBlueprint(context: CreatorGenerationContext): Promise<Record<string, unknown>> {
  const assetType = deriveCreatorAssetTypeFromIntent({
    contentType: context.contentType,
    targetPlatforms: context.targetPlatforms,
  });
  const blueprintType = inferBlueprintType(assetType, context.contentType);
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
    constraints: context.creatorCard?.constraints,
  };
  const creatorContext = {
    content_theme: String(context.creatorCard?.theme || context.enrichedIntent?.campaign_theme || context.summary || 'engaging'),
    campaign_description: String(context.objective || context.summary || context.creatorCard?.objective || 'Creator campaign execution'),
    brand_visual_tone: String(context.creatorCard?.brand_visual_tone || context.enrichedIntent?.brand_voice || template.style_schema.preferred_layout || 'professional'),
    visual_style: String(template.style_schema.preferred_layout || 'modern professional'),
    target_platforms: context.targetPlatforms,
    slide_count: Number((template.structure_schema.frame_count as number | undefined) || 5),
    narrative_arc: String(context.creatorCard?.narrative_arc || 'problem → insight → action'),
    platform_specs: context.creatorCard?.platform_specs && typeof context.creatorCard.platform_specs === 'object'
      ? context.creatorCard.platform_specs
      : undefined,
  };
  const systemPrompt = getCreatorSystemPrompt(blueprintType, creatorContext);
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

Template alignment rule:
${buildTemplateAlignmentInstruction({ assetType, template })}

Return JSON only.`;

  const result = await runCompletionWithOperation({
    companyId: context.companyId,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
      const assetType = deriveCreatorAssetTypeFromIntent({
        contentType: intent.contentType,
        targetPlatforms: intent.targetPlatforms,
      });
      assertCapability({ platforms: intent.targetPlatforms, assetType });
      const template = await resolveTemplateForIntent({
        assetType,
        templateId: intent.templateId,
        companyId: intent.companyId,
        providedTemplate: intent.template,
      });
      const blueprint = await generateBlueprint({ ...intent, template });
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
        },
        packaging: {
          ...packaging,
          platform_variants: {},
        },
        generation_prompt: `creator:${assetType}:${intent.topic}`,
        metadata: {
          campaign_id: intent.campaignId,
          company_id: intent.companyId ?? null,
          user_id: intent.userId ?? null,
          content_type: intent.contentType,
          target_platforms: intent.targetPlatforms,
          validation_result: validation,
          template_id: template.id,
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
      } else if (assetType === 'video' || assetType === 'post_with_asset' || assetType === 'thread_with_asset') {
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
      const insertPayload = buildScheduledPostInsertPayload({
        output: renderedOutput,
        row,
        createdAtIso: now,
      });
      const mediaUrls = insertPayload.media_urls;
      const assetHash = buildAssetHash(renderedOutput);
      const campaignId = String(renderedOutput.metadata.campaign_id || '');
      const idempotencyKey = `${row.dailyPlanId}:${campaignId}:${row.dbPlatform}:${assetHash}`;
      const platformId = buildDeterministicPlatformId({
        mediaUrls,
        dailyPlanId: row.dailyPlanId,
        timestamp: row.scheduledForIso,
      });

      const { data: inserted, error } = await ownedDbTable('scheduled_posts')
        .insert(insertPayload)
        .select('id, platform_post_id')
        .maybeSingle();

      if (error) {
        const failureType = classifyScheduleFailure(error.message);
        if ((error as any)?.code === '23505') {
          const { data: existing, error: existingError } = await ownedDbTable('scheduled_posts')
            .select('id, platform_post_id')
            .eq('id', String((inserted as any)?.id || ''))
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

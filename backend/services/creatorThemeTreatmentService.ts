/**
 * Creator Theme Treatment Service
 *
 * Builds the AI-generated guidance package for attachment-required
 * creator formats (video / reel / short / podcast). The output mirrors
 * the CanonicalCreatorOutput shape so the runtime, the standalone
 * Creator Content workflow, and the workspace UI consume one schema.
 *
 * Includes:
 *   - hook scene + scene-by-scene treatment
 *   - CTA scene + platform notes
 *   - marketing package (caption, hashtags, meta, keywords, CTA)
 *   - creator guidance (production notes, talking points, b-roll)
 *
 * Centralized here so:
 *   - `pages/api/command-center/creator-content/generate.ts` (standalone
 *     creator-content workflow) and
 *   - `backend/services/creatorAssetGenerationRuntime.ts` (BOLT pipeline)
 *   share the same blueprint structure for attachment-required rows.
 */

import { runCompletionWithOperation } from './aiGateway';
import { CREATOR_CONTENT_SYSTEM_PROMPTS } from '../prompts/creatorContentPromptsV1';
import { config as appConfig } from '@/config';
import { resolveCreatorBrandKit } from './creatorBrandKit';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function humanize(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export type CreatorThemeTreatmentInput = {
  companyId?: string | null;
  userId?: string | null;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard?: Record<string, unknown>;
};

export type CreatorThemeTreatmentOutput = {
  intent_type: 'creator';
  asset_type: 'video';
  asset_instruction: {
    blueprint: Record<string, unknown>;
    structure: { output_shape: 'theme_treatment' };
    visual_style: string;
    template_id: string;
  };
  asset_payload: {
    asset_kind: 'theme_treatment';
    content_type: string;
    hook_scene: Record<string, unknown>;
    scenes: unknown[];
    cta_scene: Record<string, unknown>;
    platform_notes: Record<string, unknown>;
    duration_seconds: number;
    aspect_ratio: string;
    /** Production / talking points / b-roll guidance for the human creator. */
    creator_guidance: {
      production_notes: string;
      production_checklist: string[];
      talking_points: string[];
      b_roll_ideas: string[];
    };
    /** Caption / hashtags / CTA / keywords ready-to-publish bundle. */
    marketing_package: {
      caption: string;
      hashtags: string[];
      cta: string;
      meta_description: string;
      keywords: string[];
      platform_variants: Record<string, unknown>;
    };
    media_bundle: {
      metadata: Record<string, unknown>;
    };
  };
  packaging: {
    caption: string;
    hashtags: string[];
    cta: string;
    meta_description: string;
    keywords: string[];
    platform_variants: Record<string, unknown>;
  };
  generation_prompt: string;
  metadata: Record<string, unknown>;
};

const DURATION_BY_FORMAT: Record<string, number> = {
  video: 180,
  reel: 60,
  short: 60,
  podcast: 600,
};

export async function generateCreatorThemeTreatment(input: CreatorThemeTreatmentInput): Promise<CreatorThemeTreatmentOutput> {
  const platform = (input.targetPlatforms[0] || 'instagram_reels').toLowerCase();
  const normalizedContentType = String(input.contentType || '').toLowerCase();
  const isPodcast = normalizedContentType === 'podcast';
  const isLongForm = normalizedContentType === 'video';
  const targetDuration = DURATION_BY_FORMAT[normalizedContentType] ?? 60;
  const creatorCard = safeObject(input.creatorCard);

  const creatorContext = {
    content_theme: input.summary || input.objective || input.topic,
    campaign_description: input.objective || input.summary || `Creator ${input.contentType} on ${input.topic}`,
    target_platforms: input.targetPlatforms,
    brand_visual_tone: String(creatorCard.tone || ''),
    audio_guidance: isPodcast
      ? 'audio-first episode: lead with voice, sound design, and conversational cadence; no on-screen text'
      : (isLongForm ? 'cinematic music bed + voiceover; clear scene-level audio direction' : 'short-form trending audio + tight beat cuts'),
    platform_specs: {
      tiktok: { duration: 60 },
      instagram_reels: { duration: 90 },
      youtube_short: { duration: 60 },
      youtube: { duration: targetDuration },
      [platform]: { duration: targetDuration },
    },
  };

  const brandKit = resolveCreatorBrandKit({
    metadata: { platform, content_type: input.contentType, creator_card: creatorCard },
    companyId: input.companyId ?? null,
    tenantId: input.companyId ?? null,
    platform,
    assetType: input.contentType,
  });

  const systemPrompt = CREATOR_CONTENT_SYSTEM_PROMPTS.video_script(creatorContext);
  const userPrompt = `Generate a complete theme treatment for this creator brief.

Format: ${input.contentType}
Topic: ${input.topic}
Audience: ${input.audience || 'general'}
Objective: ${input.objective || 'awareness'}
Target platforms: ${input.targetPlatforms.join(', ')}
Target duration (seconds): ${targetDuration}
Brand context: ${brandKit.companyName || 'independent'} (${brandKit.tone || 'neutral'})
${isPodcast ? 'Treat scenes as audio chapters; describe sonic palette + speaker beats; omit camera direction.' : ''}

Return JSON only matching the script format in the system prompt.`;

  const result = await runCompletionWithOperation({
    companyId: String(input.companyId || ''),
    model: appConfig.OPENAI_MODEL,
    operation: `creator_theme_treatment_${input.contentType}`,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const blueprint = JSON.parse(String(result?.output || '{}')) as Record<string, unknown>;
  const hookScene = safeObject(blueprint.hook_scene);
  const ctaScene = safeObject(blueprint.cta_scene);
  const scenes = Array.isArray(blueprint.scenes) ? blueprint.scenes : [];
  const platformNotes = safeObject(blueprint.platform_notes);

  // ── Creator guidance extracted from the blueprint with sensible defaults ──
  const productionNotes = String(
    blueprint.production_notes ||
    blueprint.notes ||
    `Produce a ${input.contentType} on ${input.topic} for ${input.audience || 'the target audience'}. Match the scene direction and audio cues above.`,
  ).trim();
  const productionChecklist = Array.isArray(blueprint.production_checklist)
    ? (blueprint.production_checklist as unknown[]).map(String).filter(Boolean)
    : [
        'Confirm setting + lighting against the hook scene direction.',
        'Block out every scene before recording; respect duration budget.',
        'Capture B-roll for transitions and CTA scene.',
        'Match audio cues to scene pacing notes.',
      ];
  const talkingPoints = Array.isArray(blueprint.talking_points)
    ? (blueprint.talking_points as unknown[]).map(String).filter(Boolean)
    : scenes
        .map((scene) => String(safeObject(scene).dialogue || safeObject(scene).text || '').trim())
        .filter(Boolean);
  const bRollIdeas = Array.isArray(blueprint.b_roll_ideas)
    ? (blueprint.b_roll_ideas as unknown[]).map(String).filter(Boolean)
    : [];

  // ── Marketing package ────────────────────────────────────────────────────
  const captionLines = [
    String(hookScene.text || hookScene.dialogue || input.topic).trim(),
    String(ctaScene.text || ctaScene.platform_cta || creatorCard.cta || 'Watch the full treatment').trim(),
  ].filter(Boolean);
  const caption = captionLines.join('\n\n');
  const hashtags = Array.isArray(blueprint.hashtags) && (blueprint.hashtags as unknown[]).length > 0
    ? (blueprint.hashtags as unknown[]).map(String).filter(Boolean)
    : [humanize(input.contentType), humanize(platform), 'CreatorContent'].map((t) => `#${t.replace(/\s+/g, '')}`);
  const cta = String(ctaScene.platform_cta || ctaScene.text || creatorCard.cta || 'Watch');
  const metaDescription = `${humanize(input.contentType)} theme treatment for ${input.topic}`.slice(0, 160);
  const keywords = [input.topic, input.contentType, platform].filter(Boolean);
  const platformVariants = safeObject(blueprint.platform_variants);

  const marketingPackage = {
    caption,
    hashtags,
    cta,
    meta_description: metaDescription,
    keywords,
    platform_variants: platformVariants,
  };

  const creatorGuidance = {
    production_notes: productionNotes,
    production_checklist: productionChecklist,
    talking_points: talkingPoints,
    b_roll_ideas: bRollIdeas,
  };

  return {
    intent_type: 'creator',
    asset_type: 'video',
    asset_instruction: {
      blueprint,
      structure: { output_shape: 'theme_treatment' },
      visual_style: String(creatorCard.tone || 'creator-led'),
      template_id: `theme-treatment-${input.contentType}`,
    },
    asset_payload: {
      asset_kind: 'theme_treatment',
      content_type: input.contentType,
      hook_scene: hookScene,
      scenes,
      cta_scene: ctaScene,
      platform_notes: platformNotes,
      duration_seconds: Number(blueprint.duration_seconds ?? blueprint.total_duration_seconds ?? targetDuration),
      aspect_ratio: String(platformNotes.optimal_aspect_ratio || blueprint.aspect_ratio || '9:16'),
      creator_guidance: creatorGuidance,
      marketing_package: marketingPackage,
      media_bundle: {
        metadata: {
          preview_kind: 'theme_treatment',
          content_type: input.contentType,
          attachment_required: true,
          target_duration_seconds: targetDuration,
          platform,
          generated_by: 'creator_theme_treatment',
        },
      },
    },
    packaging: marketingPackage,
    generation_prompt: `creator-theme-treatment:${input.contentType}:${input.topic}`,
    metadata: {
      content_type: input.contentType,
      target_platforms: input.targetPlatforms,
      preview_kind: 'theme_treatment',
      attachment_required: true,
      target_duration_seconds: targetDuration,
    },
  };
}

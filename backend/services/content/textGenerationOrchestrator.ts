/**
 * Text Generation Orchestrator (Phase 1 unification).
 *
 * Single shared entry point for text-only content generation across:
 *   - Direct API generateTextContent (post / thread bespoke path)
 *   - runThreadGeneration (thread / post API)
 *   - any future caller that needs master + per-platform variants
 *
 * Delegates to the existing `contentGenerationPipeline` (the canonical
 * master + variant pipeline). Adds:
 *   - normalized input shape,
 *   - normalized output envelope,
 *   - single retry/validation extension point,
 *   - explicit "single platform variant" mode for surfaces that only
 *     need one platform's output (the Direct API surface).
 *
 * Does NOT touch billing, prompts, or provider logic — that all stays
 * inside the underlying pipeline modules.
 */

import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../contentGenerationPipeline';

export type TextGenerationOrigin =
  | 'direct-api'      // Direct API's post / thread text-only branch
  | 'thread-api'      // /api/threads/generate
  | 'queue'           // future text-content queue jobs
  | 'bolt';           // future BOLT text rows

export type TextGenerationInput = {
  origin: TextGenerationOrigin;
  companyId: string;
  topic: string;
  contentType: 'post' | 'thread';
  /** Primary target platform; first element drives the variant returned. */
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  intent?: string;
  tone?: string;
  cta?: string;
  templateName?: string;
  extraInstruction?: string;
  /** Free-form context (subtype/constraints/etc.) forwarded as enrichment. */
  creatorCard?: Record<string, unknown>;
};

export type TextGenerationResult = {
  success: true;
  origin: TextGenerationOrigin;
  contentType: 'post' | 'thread';
  templateUsed: string | null;
  masterContent: MasterContentPayload;
  /** Primary platform variant (one per call, by design). */
  platformVariant: PlatformVariantPayload;
  /** Resolved primary platform (normalized lowercase). */
  primaryPlatform: string;
};

/**
 * Build the pipeline's `item` envelope from the normalized orchestrator
 * input. Mirrors the construction inside `runThreadGeneration` so both
 * callers feed the pipeline the same shape.
 */
function buildPipelineItem(input: TextGenerationInput, primaryPlatform: string): Record<string, unknown> {
  const isThread = input.contentType === 'thread';
  const item: Record<string, unknown> = {
    execution_id: `${input.contentType}-${Date.now()}`,
    company_id: input.companyId,
    platform: primaryPlatform,
    content_type: input.contentType,
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      objective: input.objective || input.intent || (isThread
        ? 'Create a high-retention educational thread.'
        : 'Engage the audience with a platform-native post.'),
      target_audience: input.audience || 'Audience aligned to the topic and company context',
      tone: input.tone || (isThread
        ? 'Punchy, clear, and momentum-building'
        : 'Direct and platform-native'),
      cta_type: input.cta || 'Engagement CTA',
    },
    active_platform_targets: [
      {
        platform: primaryPlatform,
        content_type: input.contentType,
      },
    ],
  };
  if (input.extraInstruction && input.extraInstruction.trim()) {
    item.extra_instruction = input.extraInstruction.trim();
  }
  if (input.creatorCard && Object.keys(input.creatorCard).length > 0) {
    item.creator_card = input.creatorCard;
  }
  return item;
}

export async function runTextGeneration(input: TextGenerationInput): Promise<TextGenerationResult> {
  if (!input.companyId) throw new Error('text orchestrator: companyId required');
  if (!input.topic || !input.topic.trim()) throw new Error('text orchestrator: topic required');
  if (input.contentType !== 'post' && input.contentType !== 'thread') {
    throw new Error(`text orchestrator: unsupported contentType "${input.contentType}"`);
  }
  if (!Array.isArray(input.targetPlatforms) || input.targetPlatforms.length === 0) {
    throw new Error('text orchestrator: targetPlatforms required');
  }
  const primaryPlatform = String(input.targetPlatforms[0] || 'linkedin').toLowerCase();
  const item = buildPipelineItem(input, primaryPlatform);

  const masterContent = await generateMasterContentFromIntent(item);
  const variants = await buildPlatformVariantsFromMaster({
    ...item,
    master_content: masterContent,
  });
  const platformVariant = variants[0];
  if (!platformVariant) {
    throw new Error(`text orchestrator: failed to produce variant for platform "${primaryPlatform}"`);
  }

  return {
    success: true,
    origin: input.origin,
    contentType: input.contentType,
    templateUsed: input.templateName?.trim() || null,
    masterContent,
    platformVariant,
    primaryPlatform,
  };
}

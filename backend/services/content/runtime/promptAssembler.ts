/**
 * Writer Wave 3 — AI Runtime Consolidation: PROMPT ASSEMBLER.
 *
 * THE single prompt-assembly path. `assemble(ctx, policy)` composes ONE PromptSet
 * from the pieces that already exist, in a fixed order:
 *
 *   system instructions  → getContentTypeSystemPrompt (existing per-type prompt)
 *   + brand memory       → the Wave-2 brand rollup (voice hooks / terminology / messaging)
 *   + campaign context   → the canonical company-context block (buildContextBlock)
 *   + canonical objective→ ctx.objective (per-request, never sourced from profile)
 *   + audience           → ctx.audience
 *   + platform profile   → the canonical per-platform styleDirective
 *   + originality context→ recent-history excerpts threaded so generation avoids repeats
 *
 * IMPORTANT — NO NEW PROMPT WORDING. Every block is an EXISTING builder's output
 * or resolved context data; this module only concatenates/serializes them. It
 * does not invent instruction text.
 *
 * BEHAVIOR-PRESERVING GENERATION SEAM — the generation primitives
 * (generateMasterContentFromIntent) build their own internal prompt from a
 * DailyExecutionItemLike `item`. To keep a delegating caller byte-identical to
 * runTextGeneration today, this assembler ALSO constructs that `item` exactly the
 * way runTextGeneration.buildPipelineItem does (objective omitted when genuinely
 * absent; governance/creator_card threaded) and returns it in `PromptSet.meta.item`.
 * The system/user strings are the canonical, observable composition of the same
 * inputs.
 */

import type { GenerationContext, PromptAssembler, PromptSet, TaskPolicy } from './contracts';
import {
  getContentTypeCategory,
  getContentTypeSystemPrompt,
  nonEmpty,
} from '../../contentGeneration/contentTypeHelpers';
import type { DailyExecutionItemLike } from '../../contentGeneration/types';
import type { NormalizedContentContext } from '../../context/canonicalContentContextResolver';
import type { BrandMemory, ContentMemoryRecord } from '../contentMemoryService';
import type { LearningMemory } from '../learningMemoryService';
import type { PlatformAdaptationProfile } from '../../../../lib/content/platformAdaptationProfiles';

/** Excerpt budget for the originality-avoidance context block. */
const ORIGINALITY_CONTEXT_LIMIT = 8;
const ORIGINALITY_EXCERPT_LEN = 160;

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The resolver's normalized context, if the resolver stashed it under `brand`. */
function normalizedOf(ctx: GenerationContext): NormalizedContentContext | null {
  const brand = ctx.brand as { normalized?: NormalizedContentContext } | undefined;
  return brand?.normalized ?? null;
}

function brandMemoryOf(ctx: GenerationContext): BrandMemory | null {
  const brand = ctx.brand as { brandMemory?: BrandMemory | null } | undefined;
  return brand?.brandMemory ?? null;
}

/**
 * The Wave-5 learning rollup, if the resolver stashed it under `brand.learningMemory`
 * (mirrors how brandMemory is threaded). Absent ⇒ null ⇒ prompt stays byte-identical
 * to Wave 3.
 */
function learningMemoryOf(ctx: GenerationContext): LearningMemory | null {
  const brand = ctx.brand as { learningMemory?: LearningMemory | null } | undefined;
  return brand?.learningMemory ?? null;
}

function platformProfileOf(ctx: GenerationContext): PlatformAdaptationProfile | null {
  return (ctx.platformProfile as PlatformAdaptationProfile | undefined) ?? null;
}

function relevantHistoryOf(ctx: GenerationContext): ContentMemoryRecord[] {
  const oc = ctx.originalityContext;
  return Array.isArray(oc) ? (oc as ContentMemoryRecord[]) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Compose the brand-memory block from the Wave-2 rollup (existing data only). */
function buildBrandMemoryBlock(brand: BrandMemory | null): string {
  if (!brand) return '';
  const lines: string[] = [];
  const hooks = asStringArray(brand.voice?.['hooks']).slice(0, 5);
  const terms = asStringArray(brand.terminology?.['terms']).slice(0, 12);
  const messages = (brand.messagingHistory ?? []).slice(-5);
  if (hooks.length) lines.push(`Established voice hooks: ${hooks.join(' | ')}`);
  if (terms.length) lines.push(`Brand terminology: ${terms.join(', ')}`);
  if (messages.length) lines.push(`Recent messaging: ${messages.join(' | ')}`);
  return lines.join('\n');
}

/**
 * Compose the compact Wave-5 "what has worked before" block from the learning
 * rollup (winning structures / effective per-platform adaptations / successful
 * messaging). ADDITIVE: absent learning ⇒ '' ⇒ filtered out ⇒ prompt byte-identical
 * to Wave 3. Sources existing rollup data only — invents NO instruction wording.
 */
function learningMemoryStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (value && typeof value === 'object') {
    for (const key of ['items', 'structures', 'styles', 'messages', 'values', 'top']) {
      const arr = (value as Record<string, unknown>)[key];
      if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === 'string');
    }
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

function buildLearningMemoryBlock(learning: LearningMemory | null): string {
  if (!learning) return '';
  const lines: string[] = [];
  const structures = learningMemoryStrings(learning.winningStructures).slice(0, 4);
  const adaptations = learningMemoryStrings(learning.platformAdaptations).slice(0, 6);
  const messaging = learningMemoryStrings(learning.successfulMessaging).slice(0, 4);
  if (structures.length) lines.push(`Winning structures: ${structures.join(' | ')}`);
  if (adaptations.length) lines.push(`Effective platform adaptations: ${adaptations.join(', ')}`);
  if (messaging.length) lines.push(`Messaging that has worked: ${messaging.join(' | ')}`);
  if (!lines.length) return '';
  return `What has worked before for this company:\n${lines.join('\n')}`;
}

/** Compose the originality-avoidance block from recent-history excerpts. */
function buildOriginalityContextBlock(history: ContentMemoryRecord[]): string {
  if (history.length === 0) return '';
  const excerpts = history
    .slice(0, ORIGINALITY_CONTEXT_LIMIT)
    .map((r) => trimmed(r.textExcerpt).slice(0, ORIGINALITY_EXCERPT_LEN))
    .filter(Boolean);
  if (excerpts.length === 0) return '';
  return `Recently published (do not repeat these):\n${excerpts.map((e) => `- ${e}`).join('\n')}`;
}

/**
 * Build the DailyExecutionItemLike the generation primitives consume. Mirrors
 * runTextGeneration.buildPipelineItem so a delegating caller stays behavior
 * -identical: objective is OMITTED when genuinely absent, governance /
 * creator_card / extra_instruction are threaded, and ALL target platforms are
 * enumerated in active_platform_targets (the runtime is the general pipeline,
 * not the single-platform Direct API surface).
 */
function buildGenerationItem(
  ctx: GenerationContext,
  norm: NormalizedContentContext | null,
): DailyExecutionItemLike {
  const raw = (ctx.raw ?? {}) as Record<string, unknown>;
  const contentType = String(ctx.contentType || 'post');
  const topic = trimmed(raw.topic) || trimmed((ctx.brief ?? {}).topic as unknown);
  const platformsRaw = raw.targetPlatforms;
  const platforms = Array.isArray(platformsRaw) && platformsRaw.length
    ? platformsRaw.map((p) => String(p ?? '').toLowerCase()).filter(Boolean)
    : [String(ctx.platform ?? 'linkedin').toLowerCase()];

  const objective = trimmed(ctx.objective) || trimmed(raw.objective) || trimmed(raw.intent && (raw.intent as any).objective);
  const audience = trimmed(ctx.audience) || trimmed(norm?.audience) || 'Audience aligned to the topic and company context';
  const tone = trimmed(ctx.tone) || trimmed(norm?.tone) || 'Direct and platform-native';
  const cta = trimmed(raw.cta) || 'Engagement CTA';

  const item: DailyExecutionItemLike = {
    execution_id: `${contentType}-${Date.now()}`,
    topic,
    title: topic,
    content_type: contentType,
    platform: platforms[0],
    intent: {
      ...(objective ? { objective } : {}),
      target_audience: audience,
      tone,
      cta_type: cta,
    },
    active_platform_targets: platforms.map((platform) => ({
      platform,
      content_type: contentType,
    })),
  } as DailyExecutionItemLike;

  // company_id is read via `(item as any).company_id` by the primitives.
  (item as Record<string, unknown>).company_id = ctx.companyId;
  if (ctx.campaignId) (item as Record<string, unknown>).campaign_id = ctx.campaignId;

  // writer_content_brief passthrough (mirrors the pipeline's brief consumption).
  if (ctx.brief && Object.keys(ctx.brief).length > 0) {
    (item as Record<string, unknown>).writer_content_brief = ctx.brief;
  }

  const extraInstruction = trimmed(raw.extraInstruction);
  if (extraInstruction) (item as Record<string, unknown>).extra_instruction = extraInstruction;

  const creatorCard = raw.creatorCard;
  if (creatorCard && typeof creatorCard === 'object' && Object.keys(creatorCard as object).length > 0) {
    (item as Record<string, unknown>).creator_card = creatorCard;
  }

  // Governance is threaded verbatim so blueprintGenerator / variant generator can
  // read `item.governance` (null → strict no-op, byte-identical to legacy callers).
  if (raw.governance) (item as Record<string, unknown>).governance = raw.governance;

  return item;
}

/**
 * assemble — the ONE prompt-assembly entry point. Composes the canonical
 * PromptSet (system + user + meta) from existing pieces and attaches the
 * generation `item` that the primitives consume.
 */
export function assembleGenerationPrompt(ctx: GenerationContext, policy: TaskPolicy): PromptSet {
  const norm = normalizedOf(ctx);
  const brandMemory = brandMemoryOf(ctx);
  const learningMemory = learningMemoryOf(ctx);
  const platformProfile = platformProfileOf(ctx);
  const history = relevantHistoryOf(ctx);

  const category = getContentTypeCategory(String(ctx.contentType || 'post'));

  // ── system: existing per-type system prompt + existing context/brand/platform blocks
  const systemInstructions = getContentTypeSystemPrompt(category);
  const campaignContextBlock = trimmed(norm?.contextBlock);
  const brandMemoryBlock = buildBrandMemoryBlock(brandMemory);
  // Wave-5: additive learning-memory block, ALONGSIDE brand memory. Empty when no
  // learning is available ⇒ filtered out ⇒ system prompt byte-identical to Wave 3.
  const learningMemoryBlock = buildLearningMemoryBlock(learningMemory);
  const platformProfileBlock = platformProfile
    ? `Platform (${platformProfile.platform}) style: ${platformProfile.styleDirective}`
    : '';
  const system = [
    systemInstructions,
    campaignContextBlock,
    brandMemoryBlock,
    learningMemoryBlock,
    platformProfileBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  // ── user: the resolved objective / audience / originality context, serialized.
  const objectiveBlock = trimmed(ctx.objective);
  const audienceBlock = trimmed(ctx.audience) || trimmed(norm?.audience);
  const originalityContextBlock = buildOriginalityContextBlock(history);
  const userPayload: Record<string, unknown> = {
    content_type: String(ctx.contentType || 'post'),
    ...(trimmed((ctx.raw as any)?.topic) ? { topic: trimmed((ctx.raw as any).topic) } : {}),
    ...(objectiveBlock ? { objective: objectiveBlock } : {}),
    ...(audienceBlock ? { target_audience: audienceBlock } : {}),
    ...(trimmed(ctx.tone) ? { tone: trimmed(ctx.tone) } : {}),
    ...(originalityContextBlock ? { originality_context: originalityContextBlock } : {}),
  };
  const user = JSON.stringify(userPayload);

  const item = buildGenerationItem(ctx, norm);

  return {
    system,
    user,
    meta: {
      item,
      model: policy.model,
      temperature: policy.temperature,
      primaryPlatform: item.platform ?? null,
      blocks: {
        systemInstructions,
        campaignContextBlock,
        brandMemoryBlock,
        learningMemoryBlock,
        platformProfileBlock,
        objectiveBlock,
        audienceBlock,
        originalityContextBlock,
      },
    },
  };
}

/** The canonical PromptAssembler instance. */
export const promptAssembler: PromptAssembler = {
  assemble(ctx: GenerationContext, policy: TaskPolicy): PromptSet {
    return assembleGenerationPrompt(ctx, policy);
  },
};

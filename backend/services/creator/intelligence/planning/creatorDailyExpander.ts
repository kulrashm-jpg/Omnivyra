/**
 * Creator Planning — Phase-4/5/6 Daily-Plan expansion (pure).
 * ──────────────────────────────────────────────────────────────────────────
 * Expands ONE strategic `CreatorBlueprintCard` into execution-ready
 * per-platform `CreatorDailyTask`s.
 *
 *   Phase-4  scene/adaptation/packaging/workflow planning
 *   Phase-5  adapter integration via `creatorAdapterRegistry`
 *            — STILL feature-flagged (`ENABLE_CREATOR_BLUEPRINT_ADAPTERS`,
 *              the same Step-4 flag). OFF ⇒ no blueprint, but the
 *              scheduler_row is still constraint-valid (backward compat).
 *   Phase-6  per-platform variation (CTA / pacing / hook / metadata /
 *            hashtag) layered on the shared core.
 *   Phase-7  emits `scheduler_row` — the ONLY thing a future scheduler
 *            consumes (flat + DB-constraint-shaped, no strategic nesting).
 *
 * Purity: no DB, no scheduler, no rendering, no queue, no mutation,
 * deterministic. Runtime-inert: nothing in pages/ or backend/queue/
 * imports this. NO scheduler/runtime cutover here.
 */

import { isCreatorBlueprintAdapterEnabled } from '../applyCreatorBlueprint';
import { creatorAdapterRegistry } from '../adapters/creatorAdapterRegistry';
import { resolveCreatorContext } from '../creatorIntelligenceEngine';
import type { CreatorPackaging } from '../packagingTypes';
import type { ContentBlueprint } from '../blueprintTypes';
import { getPlatformVariation, withPlatformHashtag } from './platformVariation';
import type {
  CreatorBlueprintCard,
  CreatorDailyTask,
  CreatorDailyExpansion,
  CreatorSchedulerRow,
} from './creatorCardTypes';

function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/** Constraint-valid empty asset_payload skeleton per DB asset_type. The
 *  deployed `is_valid_creator_daily_content_payload` only checks the key
 *  is present with the right JSON type — empty object/array passes. */
function emptyPayloadFor(assetType: string): Record<string, unknown> {
  switch (assetType) {
    case 'carousel':
      return { slides: [] };
    case 'image':
      return { visual_descriptor: {} };
    case 'video':
      return { scenes: [] };
    case 'post_with_asset':
    case 'thread_with_asset':
      return { caption_blueprint: {} };
    default:
      return {};
  }
}

/**
 * Resolve final per-platform packaging with precedence:
 *   explicit per-platform override  >  platform variation  >  core base
 * `core` is the adapter blueprint packaging (flag ON) or the card's
 * shared base (flag OFF). Always returns the 5 constraint keys with
 * hashtags/keywords as arrays.
 */
function resolvePackaging(
  card: CreatorBlueprintCard,
  platform: string,
  core: {
    caption: string;
    hashtags: string[];
    keywords: string[];
    meta_description: string;
    cta: string;
    [k: string]: unknown;
  },
): CreatorPackaging {
  const variation = getPlatformVariation(platform);
  const override = card.packaging_strategy.per_platform_overrides[platform] ?? {};

  const caption =
    (typeof override.caption === 'string' && override.caption.trim()) ||
    core.caption ||
    card.packaging_strategy.base.caption;

  const baseHashtags =
    Array.isArray(override.hashtags) && override.hashtags.length > 0
      ? override.hashtags
      : core.hashtags;
  const hashtags = withPlatformHashtag(baseHashtags, platform);

  const keywords =
    Array.isArray(override.keywords) && override.keywords.length > 0
      ? override.keywords
      : core.keywords;

  const meta_description =
    (typeof override.meta_description === 'string' &&
      override.meta_description.trim()) ||
    core.meta_description ||
    card.packaging_strategy.base.meta_description;

  // CTA: explicit override wins, else the platform-reframed shared CTA.
  const cta =
    (typeof override.cta === 'string' && override.cta.trim()) ||
    variation.ctaFraming(core.cta || card.packaging_strategy.base.cta);

  // Preserve any opaque extras the adapter packaging carried.
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(core)) {
    if (!['caption', 'hashtags', 'keywords', 'meta_description', 'cta'].includes(k)) {
      extras[k] = v;
    }
  }

  return {
    ...extras,
    caption,
    hashtags,
    keywords,
    meta_description,
    cta,
  } as CreatorPackaging;
}

/** Per-platform engine input derived from the card (continuity passed
 *  through, never fetched). distributionMode is 'unique' for a
 *  platform-scoped build, 'shared' for the shared creative core. */
function engineInputFor(
  card: CreatorBlueprintCard,
  platform: string | undefined,
) {
  return {
    topic: card.topic,
    objective: card.creative_objective,
    contentType: card.format,
    platforms: platform ? [platform] : card.target_platforms,
    campaignTheme: card.topic,
    creativeObjective: card.creative_objective,
    audienceIntent: card.audience_intent,
    coreMessage: card.core_message,
    tone: card.emotional_goal.tone,
    cta: card.cta_strategy.primary,
    distributionMode: (platform ? 'unique' : 'shared') as 'unique' | 'shared',
    brandGrounding: card.brand_grounding,
    continuityContext: card.continuity_context,
  };
}

function buildBlueprint(
  card: CreatorBlueprintCard,
  platform: string | undefined,
  weekIndex: number,
  variationSeed: number | undefined,
): ContentBlueprint | null {
  if (!isCreatorBlueprintAdapterEnabled()) return null;
  const adapter = creatorAdapterRegistry.get(card.format);
  if (!adapter) return null;
  const ctx = resolveCreatorContext(engineInputFor(card, platform));
  return adapter.build(ctx, {
    platform,
    weekIndex,
    ...(Number.isFinite(variationSeed) ? { variationSeed } : {}),
  });
}

function workflowNotes(
  card: CreatorBlueprintCard,
  platform: string,
  adapterApplied: boolean,
): string[] {
  const v = getPlatformVariation(platform);
  return [
    `Platform: ${platform}. Pacing: ${v.pacing}`,
    `Hook angle: ${v.hookAngle}`,
    `Metadata strategy: ${v.metadataStrategy}`,
    `Classification: ${card.reuse_classification} (${card.distribution_mode}).`,
    adapterApplied
      ? 'Adapter blueprint attached (flag ON) — see task.blueprint for the production package.'
      : 'No adapter blueprint (flag OFF / unsupported format) — scheduler_row is still constraint-valid; produce the asset from the card guidance.',
    'Production intelligence only — no rendering performed (render_ready stays false).',
  ];
}

export interface ExpandCardOptions {
  /** Stable seed for any deterministic adapter variation. */
  variationSeed?: number;
}

/**
 * Expand a card into per-platform executable tasks per its Phase-3
 * classification:
 *   - platform_native_content → one blueprint built PER platform (unique)
 *   - shared_content          → ONE shared creative core, reused across
 *                               platforms; only packaging/notes vary
 *   - hybrid_content          → shared core + per-platform override layer
 */
export function expandCardToDailyTasks(
  card: CreatorBlueprintCard,
  opts: ExpandCardOptions = {},
): CreatorDailyExpansion {
  const platforms =
    card.target_platforms.length > 0 ? card.target_platforms : ['default'];
  const assetType = card.asset_family ?? slug(card.format);

  // Shared/hybrid build the creative core ONCE (platform-agnostic);
  // platform_native builds a distinct blueprint per platform.
  const sharedCore =
    card.reuse_classification === 'platform_native_content'
      ? null
      : buildBlueprint(card, undefined, card.week_index, opts.variationSeed);

  const tasks: CreatorDailyTask[] = platforms.map((platform) => {
    const blueprint =
      card.reuse_classification === 'platform_native_content'
        ? buildBlueprint(card, platform, card.week_index, opts.variationSeed)
        : sharedCore;

    const adapterApplied = blueprint !== null;

    // Core packaging: adapter blueprint (flag ON) else card shared base.
    const corePackaging = blueprint
      ? (blueprint.packaging as CreatorPackaging)
      : {
          ...card.packaging_strategy.base,
        };

    const packaging = resolvePackaging(card, platform, {
      // Spread opaque extras FIRST; the normalized 5 keys MUST win, so
      // they are written after the spread (fixes TS2783 / value loss).
      ...corePackaging,
      caption: String(corePackaging.caption ?? ''),
      hashtags: Array.isArray(corePackaging.hashtags)
        ? (corePackaging.hashtags as string[])
        : [],
      keywords: Array.isArray(corePackaging.keywords)
        ? (corePackaging.keywords as string[])
        : [],
      meta_description: String(corePackaging.meta_description ?? ''),
      cta: String(corePackaging.cta ?? ''),
    });

    const asset_payload =
      blueprint && blueprint.asset_payload &&
      typeof blueprint.asset_payload === 'object'
        ? (blueprint.asset_payload as Record<string, unknown>)
        : emptyPayloadFor(assetType);

    const asset_instruction =
      blueprint &&
      blueprint.asset_instruction &&
      typeof blueprint.asset_instruction === 'object'
        ? (blueprint.asset_instruction as Record<string, unknown>)
        : {
            creative_objective: card.creative_objective,
            core_message: card.core_message,
            audience_intent: card.audience_intent,
            emotional_goal: card.emotional_goal,
            platform_strategy: card.platform_strategy[platform] ?? '',
            classification: card.reuse_classification,
            production_note:
              'Card-derived guidance (no adapter). Constraint-valid; not a render manifest.',
          };

    const scheduler_row: CreatorSchedulerRow = {
      intent_type: 'creator',
      asset_type: assetType,
      packaging,
      asset_payload,
      asset_instruction,
    };

    return {
      task_id: `task:${card.card_id}:${slug(platform)}`,
      card_id: card.card_id,
      week_index: card.week_index,
      platform,
      format: card.format,
      asset_type: card.asset_family ?? null,
      reuse_classification: card.reuse_classification,
      blueprint,
      scheduler_row,
      workflow_notes: workflowNotes(card, platform, adapterApplied),
      adapter_applied: adapterApplied,
    };
  });

  return { week_index: card.week_index, card_id: card.card_id, tasks };
}

/**
 * Phase-7 boundary projection. The ONLY thing a future scheduler should
 * be handed — strips the strategic card + rich blueprint, leaving the
 * flat constraint-shaped row. Enforces the contract in code, not just by
 * convention.
 */
export function toSchedulerRow(task: CreatorDailyTask): CreatorSchedulerRow {
  return task.scheduler_row;
}

/**
 * Creator Planning — Phase-2/3 Week-Plan blueprint generation (pure).
 * ──────────────────────────────────────────────────────────────────────────
 * The Week Plan now emits strategic `CreatorBlueprintCard`s instead of
 * shallow topic strings. This module REUSES the Step-2 engine
 * (`resolveCreatorContext`) for all strategic derivation — it does NOT
 * re-implement intelligence — and the Step-3/5 adapter registry only to
 * resolve a format's DB asset family.
 *
 * Purity: no DB, no scheduler, no rendering, no mutation, deterministic.
 * Runtime-inert: nothing in pages/ or backend/queue/ imports this. No
 * cutover — this is the planning hierarchy, built in isolation.
 */

import { resolveCreatorContext } from '../creatorIntelligenceEngine';
import type { ResolveCreatorContextInput } from '../creatorIntelligenceEngine';
import { creatorAdapterRegistry } from '../adapters/creatorAdapterRegistry';
import type { CreatorDistributionMode } from '../packagingTypes';
import { getPlatformVariation } from './platformVariation';
import type {
  CreatorBlueprintCard,
  CreatorReuseClassification,
  CreatorWeekPlan,
  CreatorCTAStrategy,
  CreatorPackagingStrategy,
} from './creatorCardTypes';

function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/**
 * Phase-3 classification. Explicit input wins; otherwise derived:
 *   unique distribution      → platform_native_content
 *   shared distribution      → shared_content
 *   shared + per-platform
 *     packaging overrides    → hybrid_content
 */
export function classifyReuse(opts: {
  distributionMode: CreatorDistributionMode;
  hasPerPlatformOverrides?: boolean;
  explicit?: CreatorReuseClassification;
}): CreatorReuseClassification {
  if (opts.explicit) return opts.explicit;
  if (opts.distributionMode === 'unique') return 'platform_native_content';
  return opts.hasPerPlatformOverrides ? 'hybrid_content' : 'shared_content';
}

export interface BuildCreatorCardInput extends ResolveCreatorContextInput {
  /** Raw creator format (image | carousel | reel | …). */
  format: string;
  weekIndex?: number;
  campaignId?: string | null;
  /** Optional explicit Phase-3 classification override. */
  reuseClassification?: CreatorReuseClassification;
  /** Optional per-platform packaging overrides (→ hybrid classification
   *  when present and distribution is shared). Keyed by platform key. */
  perPlatformPackaging?: CreatorPackagingStrategy['per_platform_overrides'];
}

/**
 * Build ONE strategic Creator Blueprint Card. Pure wrapper over the
 * Step-2 engine; adds planning-layer fields (classification, CTA
 * strategy, packaging strategy, adaptation notes) without duplicating
 * strategic logic.
 */
export function buildCreatorBlueprintCard(
  input: BuildCreatorCardInput,
): CreatorBlueprintCard {
  const ctx = resolveCreatorContext(input);

  const adapter = creatorAdapterRegistry.get(input.format);
  const assetFamily = adapter ? adapter.assetFamily : null;

  const distributionMode: CreatorDistributionMode =
    input.distributionMode ?? 'shared';
  const perPlatformOverrides = input.perPlatformPackaging ?? {};
  const reuseClassification = classifyReuse({
    distributionMode,
    hasPerPlatformOverrides: Object.keys(perPlatformOverrides).length > 0,
    explicit: input.reuseClassification,
  });

  const targetPlatforms = Object.keys(ctx.platform_strategy);

  // ── CTA strategy: shared primary + per-platform reframing ───────────
  const ctaStrategy: CreatorCTAStrategy = {
    primary: ctx.packaging.cta,
    per_platform: Object.fromEntries(
      targetPlatforms.map((p) => [
        p,
        getPlatformVariation(p).ctaFraming(ctx.packaging.cta),
      ]),
    ),
  };

  // ── Packaging strategy: shared base + override layer ────────────────
  const packagingStrategy: CreatorPackagingStrategy = {
    base: {
      caption: ctx.packaging.caption,
      hashtags: ctx.packaging.hashtags,
      keywords: ctx.packaging.keywords,
      meta_description: ctx.packaging.meta_description,
      cta: ctx.packaging.cta,
    },
    per_platform_overrides: perPlatformOverrides,
  };

  // ── Adaptation notes: strategy + platform-variation note ────────────
  const adaptationNotes: Record<string, string> = {};
  for (const p of targetPlatforms) {
    const strategic = ctx.platform_strategy[p] ?? '';
    const variation = getPlatformVariation(p).note;
    adaptationNotes[p] = strategic ? `${strategic} — ${variation}` : variation;
  }

  const topic = String(input.topic ?? '').trim();
  const cardId = `card:${slug(input.campaignId || ctx.campaign_theme)}:w${
    Number.isFinite(input.weekIndex) ? Number(input.weekIndex) : 0
  }:${slug(topic)}:${slug(input.format)}`;

  return {
    card_id: cardId,
    week_index: Number.isFinite(input.weekIndex) ? Number(input.weekIndex) : 0,
    topic,
    format: String(input.format ?? '').trim(),
    asset_family: assetFamily,
    distribution_mode: distributionMode,
    reuse_classification: reuseClassification,

    creative_objective: ctx.creative_objective,
    audience_intent: ctx.audience_intent,
    emotional_goal: ctx.emotional_goal,
    hook_strategy: ctx.hook_strategy,
    core_message: ctx.core_message,
    visual_direction: ctx.visual_direction,

    target_platforms: targetPlatforms,
    platform_strategy: ctx.platform_strategy,
    cta_strategy: ctaStrategy,
    packaging_strategy: packagingStrategy,
    production_notes: [
      `Format: ${input.format}. Asset family: ${assetFamily ?? 'unmapped'}.`,
      `Classification: ${reuseClassification}.`,
      `Emotional arc: ${ctx.emotional_goal.pain_point} → ${ctx.emotional_goal.outcome_promise} (tone: ${ctx.emotional_goal.tone}).`,
      'Production intelligence only — no rendering implied (render_ready stays false downstream).',
    ],
    adaptation_notes: adaptationNotes,

    continuity_context: ctx.continuity_context,
    brand_grounding: ctx.brand_grounding,
  };
}

/**
 * Build a full week of strategic cards. Each entry is one topic/format
 * slot; continuity is PASSED IN (never fetched) per the engine contract.
 */
export function buildCreatorWeekPlan(input: {
  campaignId?: string | null;
  weekIndex: number;
  slots: BuildCreatorCardInput[];
}): CreatorWeekPlan {
  return {
    campaign_id: input.campaignId ?? null,
    week_index: input.weekIndex,
    cards: input.slots.map((slot) =>
      buildCreatorBlueprintCard({
        ...slot,
        campaignId: slot.campaignId ?? input.campaignId ?? null,
        weekIndex: slot.weekIndex ?? input.weekIndex,
      }),
    ),
  };
}

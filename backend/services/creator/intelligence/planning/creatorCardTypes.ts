/**
 * Creator Planning Architecture — Phase-1 + Phase-7 contracts.
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no DB, no scheduler, no rendering.
 *
 * This is the planning hierarchy's type spine:
 *
 *     Week Plan   →  CreatorBlueprintCard   (strategic, platform-agnostic)
 *        │
 *        ▼
 *     Daily Plan  →  CreatorDailyTask[]     (executable, per-platform)
 *        │
 *        ├─ blueprint        → future Creator Workspace (rich, strategic)
 *        └─ scheduler_row    → future Scheduler  (constraint-shaped ONLY)
 *
 * Phase-7 boundary rule (hard): the future scheduler consumes ONLY
 * `CreatorDailyTask.scheduler_row` — a flat, DB-constraint-shaped object.
 * It NEVER receives the strategic card or the rich blueprint. The
 * `scheduler_row` is exactly the `{ intent_type, asset_type, packaging,
 * asset_payload, asset_instruction }` projection the deployed
 * `is_valid_creator_daily_content_payload` validates.
 */

import type {
  CreatorPackaging,
  CreatorDistributionMode,
} from '../packagingTypes';
import type {
  CreatorAssetFamily,
  CreatorContinuityContext,
  CreatorBrandGrounding,
} from '../types';
import type { ContentBlueprint } from '../blueprintTypes';

/**
 * Phase-3 classification. Drives how a card fans out into daily tasks:
 *   - shared_content          → one shared creative core, N platform
 *                               adaptation notes (blueprint built once).
 *   - platform_native_content → a unique card/blueprint per platform.
 *   - hybrid_content          → shared base blueprint + per-platform
 *                               override layer.
 */
export type CreatorReuseClassification =
  | 'shared_content'
  | 'platform_native_content'
  | 'hybrid_content';

export interface CreatorCardEmotionalGoal {
  pain_point: string;
  outcome_promise: string;
  tone: string;
}

export interface CreatorCardHookStrategy {
  verbal: string;
  visual: string;
}

export interface CreatorCardVisualDirection {
  image_prompt: string;
  video_prompt: string;
  scene_direction: string;
}

/** CTA framing differs per platform (Phase-6). `primary` is the shared
 *  ask; `per_platform` carries the platform-native reframing. */
export interface CreatorCTAStrategy {
  primary: string;
  per_platform: Record<string, string>;
}

/** Packaging is planned as a shared base + per-platform override layer
 *  so shared/hybrid content keeps continuity while still differing per
 *  destination. Adapters/expanders resolve this into final packaging. */
export interface CreatorPackagingStrategyBase {
  caption: string;
  hashtags: string[];
  keywords: string[];
  meta_description: string;
  cta: string;
}
export interface CreatorPackagingStrategy {
  base: CreatorPackagingStrategyBase;
  per_platform_overrides: Record<string, Partial<CreatorPackagingStrategyBase>>;
}

/**
 * PHASE-1 canonical Creator Blueprint Card. Strategic, platform-agnostic
 * production direction — detailed enough for a human creator, agency,
 * editor, OR a future AI renderer to understand the intent. This is what
 * the Week Plan now emits instead of a shallow topic.
 */
export interface CreatorBlueprintCard {
  /** Deterministic identity (slug of campaign/topic/week/format). */
  card_id: string;
  week_index: number;
  topic: string;
  /** Raw creator format string (image | carousel | reel | …). */
  format: string;
  /** Resolved DB asset family via the adapter registry; null when the
   *  format has no registered adapter (planning still succeeds). */
  asset_family: CreatorAssetFamily | null;
  distribution_mode: CreatorDistributionMode;
  reuse_classification: CreatorReuseClassification;

  creative_objective: string;
  audience_intent: string;
  emotional_goal: CreatorCardEmotionalGoal;
  hook_strategy: CreatorCardHookStrategy;
  core_message: string;
  visual_direction: CreatorCardVisualDirection;

  /** Normalized platform keys this card targets. */
  target_platforms: string[];
  platform_strategy: Record<string, string>;
  cta_strategy: CreatorCTAStrategy;
  packaging_strategy: CreatorPackagingStrategy;
  production_notes: string[];
  adaptation_notes: Record<string, string>;

  /** Passed through, never fetched (engine purity contract). */
  continuity_context: CreatorContinuityContext;
  brand_grounding: CreatorBrandGrounding;
}

/**
 * PHASE-7 scheduler hand-off. The ONLY object a future scheduler should
 * receive. Flat, constraint-shaped, zero strategic nesting. Mirrors the
 * persisted `daily_content_plans.content` creator projection exactly.
 */
export interface CreatorSchedulerRow {
  intent_type: 'creator';
  asset_type: string;
  packaging: CreatorPackaging;
  asset_payload: Record<string, unknown>;
  asset_instruction: Record<string, unknown>;
}

/**
 * PHASE-4 executable Creator task — one per (card × platform) after
 * daily expansion. Carries BOTH the rich `blueprint` (for the future
 * workspace) and the flat `scheduler_row` (for the future scheduler).
 * The two consumers are deliberately separated here so the Phase-7
 * boundary cannot be violated downstream.
 */
export interface CreatorDailyTask {
  task_id: string;
  card_id: string;
  week_index: number;
  /** Normalized platform key. */
  platform: string;
  format: string;
  asset_type: string | null;
  reuse_classification: CreatorReuseClassification;

  /** Rich production package — workspace-bound, NOT scheduler-bound.
   *  null when no adapter handled it (flag OFF / unsupported format);
   *  the scheduler_row is still constraint-valid in that case. */
  blueprint: ContentBlueprint | null;

  /** Scheduler-bound projection (Phase-7). Always constraint-shaped. */
  scheduler_row: CreatorSchedulerRow;

  /** Creator/editor workflow checklist for this platform. */
  workflow_notes: string[];
  /** True when the adapter path produced the blueprint (flag ON). */
  adapter_applied: boolean;
}

/** A planned week: the strategic cards the Week Plan now emits. */
export interface CreatorWeekPlan {
  campaign_id: string | null;
  week_index: number;
  cards: CreatorBlueprintCard[];
}

/** A fully expanded week: cards → executable per-platform tasks. */
export interface CreatorDailyExpansion {
  week_index: number;
  card_id: string;
  tasks: CreatorDailyTask[];
}

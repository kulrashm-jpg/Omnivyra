/**
 * Creator Architecture — CreatorContext (normalized strategic context)
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no logic, no DB, no scheduler awareness.
 *
 * `CreatorContext` is the content-type-AGNOSTIC output of the future
 * `creatorIntelligenceEngine.resolveCreatorContext(...)`. It is the single
 * normalized object every blueprint adapter consumes. It is intentionally
 * a superset/formalization of today's `CreatorCard`
 * (pages/api/campaigns/weekly-structure-helpers.ts) — the engine will be
 * built by WRAPPING the existing `buildCreatorCard` + `derive*` helpers,
 * not rewriting them, so this contract is deliberately shaped to be
 * populate-able from data that already exists.
 *
 * Purity contract (enforced by convention, documented here):
 *   - The engine that produces this MUST be pure: no DB reads, no
 *     scheduler calls, no rendering. Anything stateful (e.g. prior-week
 *     continuity) is passed IN via `continuity_context`, never fetched.
 */

import type { CreatorPackaging, CreatorSharedCoreContract } from './packagingTypes';

/** Canonical asset families. Matches `CreatorAssetType` in
 *  backend/services/creatorTemplateRegistryService.ts plus the
 *  `post_with_asset` / `thread_with_asset` families the DB capability
 *  constraint recognizes. Declared independently so this module has
 *  ZERO runtime imports. */
export type CreatorAssetFamily =
  | 'image'
  | 'carousel'
  | 'video'
  | 'audio'
  | 'post_with_asset'
  | 'thread_with_asset';

/** Hook delivered two ways so adapters can pick the track they need
 *  (visual-first formats use `visual`; caption/post formats use
 *  `verbal`). Mirrors today's `deriveVisualHook` / `deriveTextHook`
 *  split inside `buildCreatorCard`. */
export interface CreatorHookStrategy {
  verbal: string;        // spoken / written opening line
  visual: string;        // first-frame / first-slide visual hook
}

/** Emotional arc — formalizes `deriveSynthPainPoint` →
 *  `deriveSynthOutcomePromise`. */
export interface CreatorEmotionalGoal {
  pain_point: string;
  outcome_promise: string;
  tone: string;          // e.g. "urgent-but-reassuring"
}

/** Per-platform strategy notes. Keyed by normalized platform key
 *  (linkedin / instagram / facebook / x / …). Values are guidance
 *  strings, NOT rendering instructions. */
export type CreatorPlatformStrategy = Record<string, string>;

/** Visual direction the creator (human or future render engine) needs.
 *  Content-type-agnostic at this level; adapters specialize it. */
export interface CreatorVisualDirection {
  image_prompt: string;
  video_prompt: string;
  scene_direction: string;
}

/** Reuse / repurpose classification. Formalizes
 *  `deriveRepurposeAngles` + the shared-vs-unique decision. */
export interface CreatorReuseStrategy {
  distribution: CreatorSharedCoreContract;
  repurpose_angles: string[];
}

/** Optional, caller-supplied continuity. The engine stays pure — the
 *  PIPELINE passes prior-week summaries in (it already has
 *  `feedbackHistory` / `weekly_content_refinements`). The engine never
 *  reads the DB to populate this. */
export interface CreatorContinuityContext {
  campaign_id?: string | null;
  week_index?: number;
  prior_week_summaries?: Array<{ week_number: number; summary: string }>;
}

/** Brand grounding distilled from the company profile (the same fields
 *  /api/bolt/campaign-chat already pulls). Passed IN, never fetched
 *  by the engine. */
export interface CreatorBrandGrounding {
  company_name?: string | null;
  industry?: string | null;
  products_services?: string | null;
  unique_value?: string | null;
  default_audience?: string | null;
}

/**
 * The normalized strategic creator context. One object, content-type
 * agnostic, consumed by every adapter.
 */
export interface CreatorContext {
  /** Campaign-level understanding. */
  campaign_theme: string;
  creative_objective: string;
  core_message: string;

  /** Audience. */
  audience_intent: string;

  /** Strategy layers. */
  emotional_goal: CreatorEmotionalGoal;
  hook_strategy: CreatorHookStrategy;
  visual_direction: CreatorVisualDirection;
  platform_strategy: CreatorPlatformStrategy;
  reuse_strategy: CreatorReuseStrategy;

  /** Marketing package — engine produces ONCE, every adapter reuses
   *  verbatim so the DB constraint is satisfied identically across
   *  content types. */
  packaging: CreatorPackaging;

  /** Searchable / SEO surface. `keywords` duplicated into packaging
   *  for the constraint; kept here too for non-packaging consumers. */
  metadata: {
    keywords: string[];
    seo_focus: string;
    meta_description: string;
  };

  /** Caller-supplied, never fetched by the engine. */
  brand_grounding: CreatorBrandGrounding;
  continuity_context: CreatorContinuityContext;
}

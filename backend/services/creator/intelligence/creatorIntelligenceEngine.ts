/**
 * Creator Intelligence Engine — pure wrapper / normalizer.
 * ──────────────────────────────────────────────────────────────────────────
 * Step 2 of the Creator architecture. This module:
 *
 *   - REUSES the existing `derive*` intelligence primitives (no parallel
 *     implementations — they are imported, not rewritten).
 *   - NORMALIZES their scattered outputs into the canonical
 *     `CreatorContext` contract from `./types`.
 *   - Produces the canonical `CreatorPackaging` ONCE, centrally, so
 *     future blueprint adapters reuse the identical object that satisfies
 *     `daily_content_plans_creator_payload_check`.
 *
 * Purity contract:
 *   - The engine's OWN code performs no DB writes/reads, no scheduler
 *     access, no rendering, no governance writes, no mutation of inputs.
 *   - It only calls the pure string-transform `derive*` helpers.
 *   - Continuity + brand grounding are PASSED IN, never fetched.
 *
 * Runtime-inert: nothing in the pipeline imports this yet. No cutover.
 *
 * NOTE ON IMPORT WEIGHT (documented cutover risk #1):
 *   The `derive*` primitives live in
 *   `pages/api/campaigns/weekly-structure-helpers.ts`, a module that also
 *   imports the (lazily-initialised) supabase client and several runtime
 *   services at top level. Importing the primitives transitively pulls
 *   that graph in. No top-level side-effect fires from the import
 *   (supabase is a lazy Proxy), and the engine itself never touches any
 *   of it — but a future refactor should hoist the pure `derive*` set
 *   into a dependency-free module so the engine can be unit-tested
 *   without the runtime graph. Tracked in OUTPUT §6.
 */

import {
  deriveKeywords,
  deriveHashtags,
  deriveSEOFocus,
  deriveTextHook,
  deriveVisualHook,
  deriveRepurposeAngles,
  deriveSynthPainPoint,
  deriveSynthOutcomePromise,
  deriveImagePrompt,
  deriveVideoPrompt,
  deriveSceneDirection,
  normalizePlatformKey,
} from '../../../../pages/api/campaigns/weekly-structure-helpers';

import type {
  CreatorContext,
  CreatorBrandGrounding,
  CreatorContinuityContext,
  CreatorPlatformStrategy,
} from './types';
import type {
  CreatorPackaging,
  CreatorDistributionMode,
  CreatorSharedCoreContract,
} from './packagingTypes';

/**
 * Pipeline-agnostic input. Deliberately NOT the pipeline's
 * `DailyPlanItem` / week-blueprint shape — coupling to those would
 * break "testable in isolation". Callers (future cutover) map their
 * own structures into this.
 */
export interface ResolveCreatorContextInput {
  /** Required. The campaign/topic subject. */
  topic: string;
  /** Daily/weekly objective. Defaults to '' (helpers accept empty). */
  objective?: string;
  /** Creator format string (e.g. 'reel' | 'image' | 'carousel' |
   *  'infographic' | 'story'). Passed through to format-aware helpers
   *  exactly as the pipeline passes `normalizedContentType`. */
  contentType: string;
  /** Target platforms (raw or normalized — normalized internally). */
  platforms?: string[];

  /** Optional strategic overrides. Fall back to topic/objective. */
  campaignTheme?: string;
  creativeObjective?: string;
  audienceIntent?: string;
  coreMessage?: string;
  tone?: string;
  cta?: string;

  /** Shared vs unique. Defaults to 'shared'. */
  distributionMode?: CreatorDistributionMode;

  /** PASSED IN — never fetched by the engine. */
  brandGrounding?: CreatorBrandGrounding;
  continuityContext?: CreatorContinuityContext;
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Resolve the normalized, content-type-agnostic creator context.
 *
 * Pure + deterministic: identical input → byte-identical output. No
 * side effects. Inputs are never mutated.
 */
export function resolveCreatorContext(input: ResolveCreatorContextInput): CreatorContext {
  const topic = clean(input.topic);
  const objective = clean(input.objective);
  const contentType = clean(input.contentType) || 'post';
  const platforms = Array.isArray(input.platforms)
    ? input.platforms.map((p) => normalizePlatformKey(String(p))).filter(Boolean)
    : [];

  // ── Strategy primitives (reused, not reimplemented) ──────────────────────
  const painPoint = deriveSynthPainPoint(topic);
  const outcomePromise = deriveSynthOutcomePromise(topic, contentType);
  const verbalHook = deriveTextHook(topic, contentType);
  const visualHook = deriveVisualHook(topic, contentType);
  // NOTE: deriveKeyPoints is intentionally NOT called here. Its output
  // is content-STRUCTURE (carousel slide bodies, infographic data
  // blocks), not strategic context. It belongs to the Step-3 blueprint
  // adapters that need it, keeping CreatorContext free of content-shape
  // leakage. See OUTPUT §5.
  const repurposeAngles = deriveRepurposeAngles(topic, contentType);
  const keywords = deriveKeywords(topic, objective);
  const hashtags = deriveHashtags(topic, contentType, objective);
  const seoFocus = deriveSEOFocus(topic, objective);
  const imagePrompt = deriveImagePrompt(topic, contentType, platforms);
  const videoPrompt = deriveVideoPrompt(topic, contentType, platforms);
  const sceneDirection = deriveSceneDirection(topic, contentType);

  // ── Platform strategy (deterministic, content-type-aware) ────────────────
  const platformStrategy: CreatorPlatformStrategy = {};
  for (const p of platforms) {
    platformStrategy[p] =
      `Adapt "${topic}" for ${p}: lead with the hook, keep one concrete proof point, end on the CTA.`;
  }

  // ── Centralized packaging (the single source future adapters reuse) ──────
  // Mirrors EXACTLY the inline stub currently in
  // generate-weekly-structure.ts so a future cutover is a drop-in:
  //   caption  ← core message / brief / topic
  //   hashtags ← deriveHashtags (constraint requires array)
  //   keywords ← deriveKeywords (constraint requires array)
  //   meta     ← brief / seo_focus / topic
  //   cta      ← explicit cta → "Learn more"
  const captionSeed = clean(input.coreMessage) || clean(input.creativeObjective) || topic;
  const metaSeed = clean(input.creativeObjective) || seoFocus || topic;
  const ctaSeed = clean(input.cta) || 'Learn more';

  const packaging: CreatorPackaging = {
    caption: captionSeed,
    hashtags,
    meta_description: metaSeed,
    keywords,
    cta: ctaSeed,
  };

  const distributionMode: CreatorDistributionMode = input.distributionMode ?? 'shared';
  const distribution: CreatorSharedCoreContract = {
    mode: distributionMode,
    platform_overrides: {},
  };

  const continuity: CreatorContinuityContext = input.continuityContext ?? {};
  const brand: CreatorBrandGrounding = input.brandGrounding ?? {};

  return {
    campaign_theme: clean(input.campaignTheme) || topic,
    creative_objective: clean(input.creativeObjective) || objective || topic,
    core_message: clean(input.coreMessage) || topic,

    audience_intent:
      clean(input.audienceIntent) || clean(brand.default_audience) || 'general audience',

    emotional_goal: {
      pain_point: painPoint,
      outcome_promise: outcomePromise,
      tone: clean(input.tone) || 'professional',
    },
    hook_strategy: {
      verbal: verbalHook,
      visual: visualHook,
    },
    visual_direction: {
      image_prompt: imagePrompt,
      video_prompt: videoPrompt,
      scene_direction: sceneDirection,
    },
    platform_strategy: platformStrategy,
    reuse_strategy: {
      distribution,
      repurpose_angles: repurposeAngles,
    },

    packaging,
    metadata: {
      keywords,
      seo_focus: seoFocus,
      meta_description: metaSeed,
    },

    brand_grounding: brand,
    continuity_context: continuity,
  };
}

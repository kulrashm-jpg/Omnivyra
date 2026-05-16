/**
 * Carousel Blueprint Adapter — Step 3 (isolated, runtime-inert)
 * ──────────────────────────────────────────────────────────────────────────
 * Pure transform:  CreatorContext  →  CarouselBlueprint
 *
 * REUSE, not reimplementation:
 *   - slide bodies     ← deriveKeyPoints (the content-STRUCTURE primitive
 *                         the Step-2 engine deliberately did NOT call,
 *                         because it belongs to the adapter, per
 *                         creatorIntelligenceEngine.ts §"NOTE")
 *   - opening hook     ← ctx.hook_strategy.verbal / .visual  (these ARE
 *                         the deriveTextHook / deriveVisualHook outputs
 *                         the engine already computed — re-deriving here
 *                         would duplicate work and widen the import
 *                         surface for no behavior gain)
 *   - emotional arc    ← ctx.emotional_goal
 *   - per-platform     ← ctx.platform_strategy
 *   - marketing copy   ← ctx.packaging  (copied VERBATIM)
 *
 * Purity contract (enforced by review + the adapter unit tests):
 *   - deriveKeyPoints is a pure string transform (no clock, no random,
 *     no DB) — determinism is preserved.
 *   - No DB / scheduler / queue / rendering / orchestration / mutation.
 *
 * IMPORT-WEIGHT NOTE (same documented cutover risk as the Step-2 engine):
 *   `deriveKeyPoints` lives in `pages/api/campaigns/weekly-structure-helpers`,
 *   a module that also top-level-imports the lazy supabase Proxy. The
 *   import pulls that graph in transitively but fires no side effect
 *   (supabase is a lazy Proxy) and this adapter never touches it. A
 *   future refactor should hoist the pure derive* set into a
 *   dependency-free module.
 *
 * Runtime-inert: nothing in pages/ or backend/queue/ imports this.
 */

import { deriveKeyPoints } from '../../../../../pages/api/campaigns/weekly-structure-helpers';

import type { CreatorContext } from '../types';
import type { CarouselBlueprint, CarouselSlide } from '../blueprintTypes';
import type { CreatorBlueprintAdapter, AdapterBuildOptions } from '../adapterTypes';
import type { CreatorPackaging } from '../packagingTypes';

function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

function deterministicId(ctx: CreatorContext, opts?: AdapterBuildOptions): string {
  const scope = opts?.platform ? slug(opts.platform) : 'shared';
  const wk = Number.isFinite(opts?.weekIndex) ? Number(opts!.weekIndex) : 0;
  const seed = Number.isFinite(opts?.variationSeed) ? Number(opts!.variationSeed) : 0;
  return `carousel:${slug(ctx.campaign_theme)}:${scope}:w${wk}:v${seed}`;
}

function adaptationNotes(
  ctx: CreatorContext,
  opts?: AdapterBuildOptions,
): Record<string, string> {
  const all = ctx.platform_strategy ?? {};
  if (opts?.platform) {
    const key = String(opts.platform).toLowerCase();
    return key in all ? { [key]: all[key]! } : {};
  }
  return { ...all };
}

/**
 * Deterministic slide sequence: hook → key-point insights → CTA.
 * Roles mirror the CarouselSlide contract ('hook' | 'insight' | 'proof'
 * | 'cta'). The last key point is treated as the proof/example beat.
 */
function buildSlides(ctx: CreatorContext): CarouselSlide[] {
  const keyPoints = deriveKeyPoints(
    ctx.campaign_theme,
    ctx.creative_objective,
    'carousel',
  );

  const slides: CarouselSlide[] = [];

  slides.push({
    index: 0,
    role: 'hook',
    headline: ctx.hook_strategy.verbal,
    body: ctx.core_message,
    visual_note: ctx.hook_strategy.visual,
  });

  const lastIdx = keyPoints.length - 1;
  keyPoints.forEach((point, i) => {
    slides.push({
      index: slides.length,
      role: i === lastIdx ? 'proof' : 'insight',
      headline: point,
      body:
        i === lastIdx
          ? `Concrete proof: ${ctx.emotional_goal.outcome_promise}`
          : `Why it matters: ${ctx.emotional_goal.pain_point}`,
    });
  });

  slides.push({
    index: slides.length,
    role: 'cta',
    headline: ctx.packaging.cta,
    body: ctx.packaging.caption,
  });

  return slides;
}

export const carouselBlueprintAdapter: CreatorBlueprintAdapter<CarouselBlueprint> = {
  assetFamily: 'carousel',

  /** Governance aliases (slides/slide) normalize to 'carousel' upstream;
   *  this adapter claims only the exact normalized family. */
  supports(format: string): boolean {
    return String(format ?? '').trim().toLowerCase() === 'carousel';
  },

  build(ctx: CreatorContext, opts?: AdapterBuildOptions): CarouselBlueprint {
    const packaging: CreatorPackaging = { ...ctx.packaging };
    const slides = buildSlides(ctx);

    return {
      blueprint_id: deterministicId(ctx, opts),
      blueprint_version: 1,
      asset_family: 'carousel',
      render_ready: false,

      packaging,

      // DB constraint (carousel): asset_payload.slides must be an array.
      // It is.
      asset_payload: {
        slides,
      },

      asset_instruction: {
        creative_objective: ctx.creative_objective,
        core_message: ctx.core_message,
        audience_intent: ctx.audience_intent,
        emotional_goal: ctx.emotional_goal,
        production_note:
          'Swipeable deck. Slide 1 must earn the swipe; every middle slide delivers one idea; the last slide is the only ask.',
      },

      platform_adaptation_notes: adaptationNotes(ctx, opts),

      slide_objectives: slides.map((s) => `${s.role}: ${s.headline}`),
      sequencing_strategy:
        'Hook first to win the swipe, one insight per slide to sustain it, a single CTA last to convert it.',
    };
  },
};

export default carouselBlueprintAdapter;

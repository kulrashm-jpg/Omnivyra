/**
 * Variant Strategy Profiles.
 *
 * Per-variant prompt directives + render-modifier overlays that
 * compose ON TOP of the parent strategy's resolved RenderStrategy.
 *
 * Composition model:
 *
 *     final.headlineScale = renderStrategy.headlineScale × variantProfile.headlineScale
 *     final.scrimIntensity = renderStrategy.scrimIntensity × variantProfile.scrimIntensity
 *     ...
 *
 * Variant profile fields default to 1.0 (no change). The renderer's
 * existing `applyScale` clamps the product to safe bounds so a
 * malformed multiplier cannot produce off-canvas sizes.
 *
 * Prompt directives are APPENDED to the strategy's promptDirectives
 * — they do not replace anything (PHASE 11 + governance preservation).
 *
 * Pure data + thin resolver. No side effects.
 */

import {
  MAX_VARIANTS_PER_STRATEGY,
  resolveVariant,
  type VariantDefinition,
} from './variantRegistry';
import {
  type CtaMode,
  type RenderStrategyModifiers,
} from './renderStrategyRegistry';

/* ── Profile shape ────────────────────────────────────────────── */

/**
 * Variant-level multiplier deltas over the parent strategy's
 * RenderStrategyModifiers. All scale fields default to 1.0 = no
 * change. `ctaModeOverride` is an absolute override — set null to
 * keep the strategy's choice.
 */
export type VariantRenderModifierOverlay = {
  headlineScale: number;
  hookScale: number;
  insightScale: number;
  supportScale: number;
  maxHeadlineLinesDelta: number;
  marginScale: number;
  /** When set, OVERRIDES the strategy's textBlockTopRatio. Null keeps it. */
  textBlockTopRatioOverride: number | null;
  scrimIntensityMultiplier: number;
  logoScaleMultiplier: number;
  logoOpacityMultiplier: number;
  /** When set to a CtaMode, OVERRIDES the strategy's ctaMode. */
  ctaModeOverride: CtaMode | null;
};

export type VariantStrategyProfile = {
  /** Variant id (matches variantRegistry). */
  variant_id: string;
  /** Prompt directives APPENDED to the strategy's prompt directives. */
  prompt_directives: string[];
  /** Render-modifier overlays (multiplied with strategy modifiers). */
  modifier_overlay: VariantRenderModifierOverlay;
  /** Operator-readable reasoning string surfaced in preview. */
  reasoning: string;
};

/* ── Helpers ──────────────────────────────────────────────────── */

function baselineOverlay(): VariantRenderModifierOverlay {
  return {
    headlineScale: 1.0,
    hookScale: 1.0,
    insightScale: 1.0,
    supportScale: 1.0,
    maxHeadlineLinesDelta: 0,
    marginScale: 1.0,
    textBlockTopRatioOverride: null,
    scrimIntensityMultiplier: 1.0,
    logoScaleMultiplier: 1.0,
    logoOpacityMultiplier: 1.0,
    ctaModeOverride: null,
  };
}

/* ── 48 profiles ───────────────────────────────────────────────── */

const PROFILES: ReadonlyArray<VariantStrategyProfile> = [
  /* ── IMAGE — Promotional ─────────────────────────────────────── */
  {
    variant_id: 'image:promotional-image:v1',
    prompt_directives: [
      'Render with a moderate headline weight that lets the offer language read clearly.',
      'Standard CTA pill — accent-coloured but not oversized.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Baseline promotional treatment; lean on the offer.',
  },
  {
    variant_id: 'image:promotional-image:v2',
    prompt_directives: [
      'Render the headline at maximum impact — display weight, edge-to-edge.',
      'Use a strong accent-coloured CTA pill that is unmistakable at thumbnail size.',
      'Deepen scrim contrast under the headline for high-impact reading.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.10,
      scrimIntensityMultiplier: 1.10,
      ctaModeOverride: 'strong',
    },
    reasoning: 'High-impact CTA — larger headline, brighter scrim, strong CTA.',
  },
  {
    variant_id: 'image:promotional-image:v3',
    prompt_directives: [
      'Render the product imagery as the focal element; place the headline + CTA in the lower third.',
      'Maintain ample negative space around the product subject.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      textBlockTopRatioOverride: 0.62,
      marginScale: 1.10,
    },
    reasoning: 'Product-forward composition; text drops to lower third.',
  },

  /* ── IMAGE — Educational ─────────────────────────────────────── */
  {
    variant_id: 'image:educational-image:v1',
    prompt_directives: [
      'Maintain a quiet, editorial typographic treatment.',
      'Keep supporting text legible without competing for emphasis.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Minimal — clarity over emphasis.',
  },
  {
    variant_id: 'image:educational-image:v2',
    prompt_directives: [
      'Scale up the headline so the lesson reads at a glance.',
      'Treat the insight line as a strong anchor that completes the lesson.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.15,
      insightScale: 1.05,
    },
    reasoning: 'Strong headline emphasis; insight anchors the lesson.',
  },
  {
    variant_id: 'image:educational-image:v3',
    prompt_directives: [
      'Borrow infographic-style information hierarchy — clearer structural rhythm.',
      'Tighten margins to admit more structured content without becoming dense.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.92,
      insightScale: 1.08,
      supportScale: 1.05,
    },
    reasoning: 'Infographic-style information hierarchy; tighter margins for readability.',
  },

  /* ── IMAGE — Quote ───────────────────────────────────────────── */
  {
    variant_id: 'image:quote-image:v1',
    prompt_directives: [
      'Render the quotation in oversized, editorial display type.',
      'Brand mark stays understated; the words carry the visual.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Editorial typographic statement; quiet branding.',
  },
  {
    variant_id: 'image:quote-image:v2',
    prompt_directives: [
      'Push the headline even larger; widen letter spacing to feel like a display poster.',
      'Keep the brand mark small but legible.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.10,
      maxHeadlineLinesDelta: 1,
    },
    reasoning: 'Display-typeface poster aesthetic.',
  },
  {
    variant_id: 'image:quote-image:v3',
    prompt_directives: [
      'Restore the brand mark to standard intensity so attribution + author stays clearly visible.',
      'Headline remains large; treat brand mark as second-order focal element.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      logoScaleMultiplier: 1.35,
      logoOpacityMultiplier: 1.10,
    },
    reasoning: 'Attribution-forward — brand mark + author legible alongside the quote.',
  },

  /* ── IMAGE — Product Showcase ─────────────────────────────────── */
  {
    variant_id: 'image:product-showcase-image:v1',
    prompt_directives: [
      'Render product photography as the dominant element.',
      'Standard CTA pill in the lower third.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Hero photo carries the composition.',
  },
  {
    variant_id: 'image:product-showcase-image:v2',
    prompt_directives: [
      'Scale the headline so the caption competes harder for attention.',
      'Use a strong CTA pill on the close.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
      scrimIntensityMultiplier: 1.10,
      ctaModeOverride: 'strong',
    },
    reasoning: 'Caption punch — stronger headline + strong CTA.',
  },
  {
    variant_id: 'image:product-showcase-image:v3',
    prompt_directives: [
      'Tight crop on the product subject; product fills the frame edge-to-edge.',
      'Deepen scrim so caption stays legible over a denser product photo.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.88,
      scrimIntensityMultiplier: 1.15,
    },
    reasoning: 'Tight crop; product fills the frame.',
  },

  /* ── IMAGE — Brand Focus ─────────────────────────────────────── */
  {
    variant_id: 'image:brand-focus-image:v1',
    prompt_directives: [
      'Brand mark is the primary focal element; headline plays supporting role.',
      'Generous margin around the brand mark.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Logo prominent; headline supporting.',
  },
  {
    variant_id: 'image:brand-focus-image:v2',
    prompt_directives: [
      'Scale up the headline so wordmark + tagline compete at parity.',
      'Brand mark stays at brand-focus default.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.15,
    },
    reasoning: 'Wordmark + tagline parity.',
  },
  {
    variant_id: 'image:brand-focus-image:v3',
    prompt_directives: [
      'Push accent colour saturation — brand identity reinforced through palette.',
      'Use the strong CTA mode to surface the accent colour in the call-to-action.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      scrimIntensityMultiplier: 1.12,
      ctaModeOverride: 'strong',
    },
    reasoning: 'Color-forward — accent palette reinforces brand identity.',
  },

  /* ── CAROUSEL — Educational ──────────────────────────────────── */
  {
    variant_id: 'carousel:educational-carousel:v1',
    prompt_directives: [
      'Balanced slide deck with subtle CTAs; comfortable pace.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Lesson sequence — comfortable read-through.',
  },
  {
    variant_id: 'carousel:educational-carousel:v2',
    prompt_directives: [
      'Scale up slide headlines; the opening slide reads as a strong promise.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
    },
    reasoning: 'Headline lead — slides scale up the promise.',
  },
  {
    variant_id: 'carousel:educational-carousel:v3',
    prompt_directives: [
      'Tighter density per slide + clearer information hierarchy; borrow from the framework deck.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.92,
      insightScale: 1.06,
    },
    reasoning: 'Stepped outline — denser slides borrowing framework readability.',
  },

  /* ── CAROUSEL — Framework ─────────────────────────────────────── */
  {
    variant_id: 'carousel:framework-carousel:v1',
    prompt_directives: [
      'Treat each pillar slide equally; measured composition across the deck.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Pillar parity — measured framework.',
  },
  {
    variant_id: 'carousel:framework-carousel:v2',
    prompt_directives: [
      'Open and close slides carry outsized headlines; interior slides stay at parity.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.10,
    },
    reasoning: 'Headline anchor — open + close emphasised.',
  },
  {
    variant_id: 'carousel:framework-carousel:v3',
    prompt_directives: [
      'Brand mark sized up across slides; accent colour intensifies — branded methodology.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      logoScaleMultiplier: 1.20,
      scrimIntensityMultiplier: 1.08,
    },
    reasoning: 'Branded pillars — branded methodology framing.',
  },

  /* ── CAROUSEL — Story ─────────────────────────────────────────── */
  {
    variant_id: 'carousel:story-carousel:v1',
    prompt_directives: [
      'Upper-third text framing across slides; CTA suppressed — narrative carries the close.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Cinematic — upper-third framing.',
  },
  {
    variant_id: 'carousel:story-carousel:v2',
    prompt_directives: [
      'Scale up headlines per beat; insight lines heavier; captions carry more weight.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
      insightScale: 1.08,
    },
    reasoning: 'Caption-forward — heavier captions per beat.',
  },
  {
    variant_id: 'carousel:story-carousel:v3',
    prompt_directives: [
      'Restore a subtle CTA on the final slide; brand mark slightly elevated — gentle close.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      ctaModeOverride: 'subtle',
      logoScaleMultiplier: 1.10,
    },
    reasoning: 'Sober closing — gentle CTA + brand mark on the close.',
  },

  /* ── CAROUSEL — Product Showcase ───────────────────────────── */
  {
    variant_id: 'carousel:product-showcase-carousel:v1',
    prompt_directives: [
      'Standard product tour — each slide highlights one feature; close has a strong CTA.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Feature tour — one feature per slide.',
  },
  {
    variant_id: 'carousel:product-showcase-carousel:v2',
    prompt_directives: [
      'Scale up each slide headline to surface the benefit, not just the feature name.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
    },
    reasoning: 'Benefit headlines — surface the benefit, not the feature.',
  },
  {
    variant_id: 'carousel:product-showcase-carousel:v3',
    prompt_directives: [
      'Tighten margins across slides; denser catalogue-like presentation.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.90,
    },
    reasoning: 'Tight frame — denser catalogue.',
  },

  /* ── CAROUSEL — Presentation ─────────────────────────────────── */
  {
    variant_id: 'carousel:presentation-carousel:v1',
    prompt_directives: [
      'Deck-style typography — large per-slide headlines; standard CTA on close.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Deck style — large headlines per slide.',
  },
  {
    variant_id: 'carousel:presentation-carousel:v2',
    prompt_directives: [
      'Insight + support lines scale up alongside headline; denser slide content.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      insightScale: 1.10,
      supportScale: 1.08,
    },
    reasoning: 'Insight lead — denser slide content.',
  },
  {
    variant_id: 'carousel:presentation-carousel:v3',
    prompt_directives: [
      'Brand mark sized up + accent colour intensifies — feels like a branded deck.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      logoScaleMultiplier: 1.18,
      scrimIntensityMultiplier: 1.06,
    },
    reasoning: 'Branded deck — brand mark + palette emphasis.',
  },

  /* ── INFOGRAPHIC — Statistics ────────────────────────────────── */
  {
    variant_id: 'infographic:stats:v1',
    prompt_directives: [
      'Headline numerals dominate; supporting labels stay compact.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Numeral lead — figures dominate.',
  },
  {
    variant_id: 'infographic:stats:v2',
    prompt_directives: [
      'Scale up insight + support lines alongside the headline numerals; pair each metric with a clearer label.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      insightScale: 1.10,
      supportScale: 1.08,
    },
    reasoning: 'Labelled numerals — figures + labels read together.',
  },
  {
    variant_id: 'infographic:stats:v3',
    prompt_directives: [
      'Push accent colour saturation across data points; scrim warms — colour drives data emphasis.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      scrimIntensityMultiplier: 1.12,
    },
    reasoning: 'Color-coded — accent palette drives data emphasis.',
  },

  /* ── INFOGRAPHIC — Process ───────────────────────────────────── */
  {
    variant_id: 'infographic:process:v1',
    prompt_directives: [
      'Balanced step layout; subtle CTAs; comfortable read-through.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Step list — balanced layout.',
  },
  {
    variant_id: 'infographic:process:v2',
    prompt_directives: [
      'Scale up each step headline; faster scan of the sequence.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.10,
    },
    reasoning: 'Step headlines — fast scan of the sequence.',
  },
  {
    variant_id: 'infographic:process:v3',
    prompt_directives: [
      'Tighten margins + emphasise insight lines — denser flow-chart presentation.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.92,
      insightScale: 1.08,
    },
    reasoning: 'Tight flow — denser flow-chart.',
  },

  /* ── INFOGRAPHIC — Timeline ───────────────────────────────────── */
  {
    variant_id: 'infographic:timeline:v1',
    prompt_directives: [
      'Standard chronological emphasis; balanced typography.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Chronology — balanced.',
  },
  {
    variant_id: 'infographic:timeline:v2',
    prompt_directives: [
      'Scale up milestone headlines; each beat reads as a marquee moment.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
    },
    reasoning: 'Milestone-forward — marquee beats.',
  },
  {
    variant_id: 'infographic:timeline:v3',
    prompt_directives: [
      'Emphasise insight + support lines; interior annotations carry more context.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      insightScale: 1.10,
      supportScale: 1.08,
    },
    reasoning: 'Annotated — interior context per milestone.',
  },

  /* ── INFOGRAPHIC — Comparison ─────────────────────────────────── */
  {
    variant_id: 'infographic:comparison:v1',
    prompt_directives: [
      'Tight side-by-side columns; head-to-head comparison.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Side-by-side — dense head-to-head.',
  },
  {
    variant_id: 'infographic:comparison:v2',
    prompt_directives: [
      'Scale up the headline to frame the comparison as a clear decision; CTA pill remains strong.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
      ctaModeOverride: 'strong',
    },
    reasoning: 'Headline decision — comparison frames a clear call.',
  },
  {
    variant_id: 'infographic:comparison:v3',
    prompt_directives: [
      'Intensify accent colour to differentiate the two sides; colour carries the comparison signal.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      scrimIntensityMultiplier: 1.12,
    },
    reasoning: 'Color-coded sides — palette carries the comparison.',
  },

  /* ── INFOGRAPHIC — Framework ──────────────────────────────────── */
  {
    variant_id: 'infographic:framework:v1',
    prompt_directives: [
      'Balanced quadrant / pillar layout; standard framework readability.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Quadrant balance.',
  },
  {
    variant_id: 'infographic:framework:v2',
    prompt_directives: [
      'Scale up pillar headlines; labels read at a glance.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.10,
    },
    reasoning: 'Pillar headlines — labels at a glance.',
  },
  {
    variant_id: 'infographic:framework:v3',
    prompt_directives: [
      'Tighten margins + emphasise insight lines; matrix presentation reads analytical.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      marginScale: 0.92,
      insightScale: 1.06,
    },
    reasoning: 'Tight matrix — analytical density.',
  },

  /* ── INFOGRAPHIC — Roadmap ────────────────────────────────────── */
  {
    variant_id: 'infographic:roadmap:v1',
    prompt_directives: [
      'Standard phased progression; balanced milestone typography.',
    ],
    modifier_overlay: { ...baselineOverlay() },
    reasoning: 'Phased progress — balanced.',
  },
  {
    variant_id: 'infographic:roadmap:v2',
    prompt_directives: [
      'Scale up milestone headlines; each phase reads as a major marker.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      headlineScale: 1.12,
    },
    reasoning: 'Headline milestones — major markers.',
  },
  {
    variant_id: 'infographic:roadmap:v3',
    prompt_directives: [
      'Scale up brand mark + intensify accent colour across phases — branded vision framing.',
    ],
    modifier_overlay: {
      ...baselineOverlay(),
      logoScaleMultiplier: 1.18,
      scrimIntensityMultiplier: 1.08,
    },
    reasoning: 'Branded phases — branded vision framing.',
  },
];

/* ── Cap enforcement (mirrors registry) ───────────────────────── */

const PROFILES_BY_ID = new Map<string, VariantStrategyProfile>(PROFILES.map((p) => [p.variant_id, p]));

(function enforceParity(): void {
  for (const profile of PROFILES) {
    const variant = resolveVariant(profile.variant_id);
    if (!variant) {
      throw new Error(`[variantStrategyProfiles] profile '${profile.variant_id}' has no matching variant in variantRegistry.`);
    }
  }
  // Every variant must have a profile (1:1 parity).
  const { listAllVariants } = require('./variantRegistry') as typeof import('./variantRegistry');
  for (const variant of listAllVariants()) {
    if (!PROFILES_BY_ID.has(variant.variant_id)) {
      throw new Error(`[variantStrategyProfiles] variant '${variant.variant_id}' has no profile.`);
    }
  }
})();

/* ── Resolver ─────────────────────────────────────────────────── */

/**
 * Resolve a variant strategy profile by variant id. Returns null
 * when unknown — callers MUST treat null as "no variant overlay"
 * and fall back to the strategy baseline.
 */
export function resolveVariantStrategyProfile(
  variantId: string | null | undefined,
): VariantStrategyProfile | null {
  if (!variantId) return null;
  return PROFILES_BY_ID.get(String(variantId).trim()) ?? null;
}

/* ── Composition ──────────────────────────────────────────────── */

/**
 * Compose a variant overlay ON TOP of a resolved RenderStrategyModifiers
 * vector. Strategy modifiers are kept as-is when no variant resolves.
 *
 * Multiplication is bounded — the renderer's own `applyScale` clamps
 * the final product when consumed; this helper just produces the raw
 * product so the renderer remains the single source of truth on
 * clamp ranges.
 */
export function composeVariantOntoStrategyModifiers(
  strategyMods: RenderStrategyModifiers,
  variantProfile: VariantStrategyProfile | null,
): RenderStrategyModifiers {
  if (!variantProfile) return strategyMods;
  const overlay = variantProfile.modifier_overlay;
  return {
    headlineScale:               strategyMods.headlineScale * overlay.headlineScale,
    hookScale:                   strategyMods.hookScale * overlay.hookScale,
    insightScale:                strategyMods.insightScale * overlay.insightScale,
    supportScale:                strategyMods.supportScale * overlay.supportScale,
    maxHeadlineLinesDelta:       strategyMods.maxHeadlineLinesDelta + overlay.maxHeadlineLinesDelta,
    marginScale:                 strategyMods.marginScale * overlay.marginScale,
    textBlockTopRatio:           overlay.textBlockTopRatioOverride ?? strategyMods.textBlockTopRatio,
    scrimIntensityMultiplier:    strategyMods.scrimIntensityMultiplier * overlay.scrimIntensityMultiplier,
    logoScaleMultiplier:         strategyMods.logoScaleMultiplier * overlay.logoScaleMultiplier,
    logoOpacity:                 strategyMods.logoOpacity * overlay.logoOpacityMultiplier,
    ctaMode:                     overlay.ctaModeOverride ?? strategyMods.ctaMode,
    focalEmphasis:               strategyMods.focalEmphasis,
  };
}

/* ── Diagnostics ──────────────────────────────────────────────── */

export function listAllVariantStrategyProfiles(): ReadonlyArray<VariantStrategyProfile> {
  return PROFILES;
}

export { MAX_VARIANTS_PER_STRATEGY };
export type { VariantDefinition };

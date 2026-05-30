/**
 * Render Strategy Registry.
 *
 * Translates the abstract Purpose Strategy (resolved by
 * `purposeStrategyRegistry.ts`) into concrete renderer-level modifiers
 * that shape the FINAL rendered asset — not just the prompt sent to the
 * image model.
 *
 * Purpose Strategy → influences PROMPT.
 * Render Strategy  → influences PRESET applied to `buildOverlaySvg`.
 *
 * The renderer reads a resolved RenderStrategy and applies its
 * modifiers to the existing overlay preset (scale typography, adjust
 * margins, change logo size, alter scrim intensity, choose a CTA
 * treatment, etc.). NO new renderer is added. Existing presets remain
 * the baseline; strategy modifiers are MULTIPLIERS or BOUNDED
 * OVERRIDES applied on top.
 *
 * Legacy callers that do not supply a render strategy receive
 * byte-identical output to the pre-phase renderer. Strategy effects
 * are gated entirely on the presence of `renderStrategy`.
 *
 * Pure data + a thin resolver. No side effects.
 */

/* ── Modifier surface ────────────────────────────────────────────── */

export type CtaMode = 'absent' | 'subtle' | 'standard' | 'strong';
export type FocalEmphasis = 'standard' | 'high' | 'maximum';

/**
 * RenderStrategyModifiers — the leverage points the renderer reads.
 * All scale fields are MULTIPLIERS over the existing preset value.
 * 1.0 means "no change". The renderer clamps to safe bounds so a
 * malformed entry can't produce off-canvas sizes.
 */
export type RenderStrategyModifiers = {
  /* Typography scales — multipliers over `preset.<name>Size`. */
  headlineScale: number;
  hookScale: number;
  insightScale: number;
  supportScale: number;
  /** Headline-line cap delta — +1 lets the strategy allow an extra line for explanatory content. */
  maxHeadlineLinesDelta: number;

  /* Layout scales. */
  /** Margin multiplier over the computed safeMargin. */
  marginScale: number;
  /** When set, vertical placement of the text block — 0..1 fraction of canvas height. */
  textBlockTopRatio: number | null;
  /** Scrim intensity multiplier over the computed bottom-scrim opacity. */
  scrimIntensityMultiplier: number;

  /* Branding intensity. */
  /** Logo width multiplier over preset-derived logoMaxWidth. */
  logoScaleMultiplier: number;
  /** Logo opacity (0..1) — strategy can dim or brighten brand mark. */
  logoOpacity: number;

  /* CTA treatment — how the renderer emits a CTA element on overlays. */
  ctaMode: CtaMode;

  /* Focal emphasis — informs scrim contrast + headline shadow weight. */
  focalEmphasis: FocalEmphasis;
};

/* ── Strategy entries ────────────────────────────────────────────── */

export type RenderStrategy = {
  /** Matches the corresponding PurposeStrategy id (e.g. 'image:promotional-image'). */
  id: string;
  modifiers: RenderStrategyModifiers;
  /** Operator-readable profiles surfaced in preview metadata. */
  explainability: {
    typographyProfile: string;
    brandingProfile: string;
    densityProfile: string;
    ctaProfile: string;
    visualEmphasisProfile: string;
  };
};

function baseModifiers(): RenderStrategyModifiers {
  return {
    headlineScale: 1.0,
    hookScale: 1.0,
    insightScale: 1.0,
    supportScale: 1.0,
    maxHeadlineLinesDelta: 0,
    marginScale: 1.0,
    textBlockTopRatio: null,
    scrimIntensityMultiplier: 1.0,
    logoScaleMultiplier: 1.0,
    logoOpacity: 1.0,
    ctaMode: 'standard',
    focalEmphasis: 'standard',
  };
}

/* ── Image render strategies ──────────────────────────────────────── */

const IMAGE_PROMOTIONAL: RenderStrategy = {
  id: 'image:promotional-image',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.15,
    hookScale: 1.05,
    marginScale: 0.9,
    scrimIntensityMultiplier: 1.15,
    ctaMode: 'strong',
    focalEmphasis: 'high',
  },
  explainability: {
    typographyProfile: 'Larger headline (+15%) + tighter eyebrow — attention-first hierarchy.',
    brandingProfile: 'Standard brand mark — focal subject dominates.',
    densityProfile: 'Balanced — tightened margins (90%) for conversion-oriented impact.',
    ctaProfile: 'Strong — prominent CTA pill rendered when CTA copy present.',
    visualEmphasisProfile: 'High focal emphasis — stronger bottom scrim (+15%) increases legibility over hero subject.',
  },
};

const IMAGE_EDUCATIONAL: RenderStrategy = {
  id: 'image:educational-image',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.0,
    insightScale: 1.05,
    supportScale: 1.05,
    maxHeadlineLinesDelta: 1,
    marginScale: 1.15,
    scrimIntensityMultiplier: 0.9,
    logoScaleMultiplier: 0.85,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Concept-first — extra headline line allowed (+1) for clearer explanation.',
    brandingProfile: 'Subtle brand mark (-15%) — defers visual weight to the concept being taught.',
    densityProfile: 'Minimal — generous margins (+15%) and lighter scrim for cleaner spacing.',
    ctaProfile: 'Subtle — soft, low-contrast CTA framing.',
    visualEmphasisProfile: 'Standard — concept owns the frame; brand defers.',
  },
};

const IMAGE_QUOTE: RenderStrategy = {
  id: 'image:quote-image',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.35,
    hookScale: 0.85,
    supportScale: 0.95,
    maxHeadlineLinesDelta: 1,
    marginScale: 1.2,
    textBlockTopRatio: 0.35,
    scrimIntensityMultiplier: 0.95,
    logoScaleMultiplier: 0.7,
    logoOpacity: 0.85,
    ctaMode: 'absent',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Feature typography — headline +35%, eyebrow -15% so the quote dominates.',
    brandingProfile: 'Quiet brand mark (-30%, 85% opacity) — image is supporting atmosphere.',
    densityProfile: 'Minimal — generous margins (+20%) and text block raised to upper third for quote prominence.',
    ctaProfile: 'Absent — quote stands alone, no CTA pill rendered.',
    visualEmphasisProfile: 'Standard — typography carries primary weight; image is backdrop.',
  },
};

const IMAGE_PRODUCT_SHOWCASE: RenderStrategy = {
  id: 'image:product-showcase-image',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 0.92,
    insightScale: 0.95,
    supportScale: 0.95,
    marginScale: 1.05,
    textBlockTopRatio: 0.68,
    scrimIntensityMultiplier: 1.05,
    logoScaleMultiplier: 1.0,
    ctaMode: 'standard',
    focalEmphasis: 'high',
  },
  explainability: {
    typographyProfile: 'Reduced text footprint (-8% headline) — leaves more canvas for product hero.',
    brandingProfile: 'Standard brand mark — product owns hierarchy.',
    densityProfile: 'Balanced — text block lowered to bottom-third so product surface dominates the upper canvas.',
    ctaProfile: 'Standard — CTA pill rendered when CTA copy present.',
    visualEmphasisProfile: 'High focal emphasis on product — slightly stronger scrim (+5%) ensures CTA legibility over product imagery.',
  },
};

const IMAGE_BRAND_FOCUS: RenderStrategy = {
  id: 'image:brand-focus-image',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.0,
    insightScale: 1.0,
    marginScale: 1.25,
    scrimIntensityMultiplier: 0.82,
    logoScaleMultiplier: 1.35,
    logoOpacity: 1.0,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Standard scale with editorial restraint.',
    brandingProfile: 'Strong brand mark (+35%, full opacity) — premium logo treatment.',
    densityProfile: 'Premium editorial — wide margins (+25%) and lighter scrim for atmospheric breathing room.',
    ctaProfile: 'Subtle — soft, restrained CTA framing.',
    visualEmphasisProfile: 'Standard — palette + lighting carry brand stewardship; mark is prominent but not dominant.',
  },
};

/* ── Carousel render strategies ──────────────────────────────────── */

const CAROUSEL_EDUCATIONAL: RenderStrategy = {
  id: 'carousel:educational-carousel',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.05,
    insightScale: 1.08,
    maxHeadlineLinesDelta: 1,
    marginScale: 1.1,
    logoScaleMultiplier: 0.9,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Lead headline (+5%) and slightly larger insight (+8%) — supports concept→explanation per slide.',
    brandingProfile: 'Subtle brand mark — slides defer to teaching content.',
    densityProfile: 'Balanced — wider margins (+10%) for clearer per-slide hierarchy.',
    ctaProfile: 'Subtle — last slide closes with soft CTA pointing to summary.',
    visualEmphasisProfile: 'Standard — each slide is a teaching unit.',
  },
};

const CAROUSEL_FRAMEWORK: RenderStrategy = {
  id: 'carousel:framework-carousel',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.1,
    insightScale: 1.0,
    marginScale: 1.0,
    logoScaleMultiplier: 1.0,
    ctaMode: 'standard',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Lead headline (+10%) — parallel-shape pillar reveal across slides.',
    brandingProfile: 'Balanced brand mark — consistent corner anchor across pillars.',
    densityProfile: 'Balanced — standard margins for parallel pillar layout.',
    ctaProfile: 'Standard — conclusion slide closes with a synthesizing CTA.',
    visualEmphasisProfile: 'Standard — pillars share grid + brand-anchor placement.',
  },
};

const CAROUSEL_STORY: RenderStrategy = {
  id: 'carousel:story-carousel',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.25,
    hookScale: 0.9,
    insightScale: 0.95,
    maxHeadlineLinesDelta: 1,
    marginScale: 1.15,
    textBlockTopRatio: 0.42,
    scrimIntensityMultiplier: 1.05,
    logoScaleMultiplier: 0.85,
    logoOpacity: 0.9,
    ctaMode: 'subtle',
    focalEmphasis: 'high',
  },
  explainability: {
    typographyProfile: 'Feature headline (+25%) + reduced eyebrow — cinematic narrative typography per beat.',
    brandingProfile: 'Quiet brand mark (-15%, 90% opacity) — story owns the frame.',
    densityProfile: 'Minimal — wider margins (+15%) and elevated text block produce cinematic framing per slide.',
    ctaProfile: 'Subtle — outcome slide closes with quiet reflection rather than action push.',
    visualEmphasisProfile: 'High focal emphasis — stronger scrim supports stronger narrative typography.',
  },
};

const CAROUSEL_PRODUCT_SHOWCASE: RenderStrategy = {
  id: 'carousel:product-showcase-carousel',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 0.95,
    insightScale: 1.0,
    marginScale: 1.0,
    textBlockTopRatio: 0.7,
    scrimIntensityMultiplier: 1.1,
    logoScaleMultiplier: 1.1,
    ctaMode: 'strong',
    focalEmphasis: 'high',
  },
  explainability: {
    typographyProfile: 'Slightly reduced headline (-5%) — product surface dominates each feature slide.',
    brandingProfile: 'Stronger brand mark (+10%) — consistent corner anchor as feature slides progress.',
    densityProfile: 'Balanced — text block bottom-anchored (70% from top) so product hero owns upper canvas.',
    ctaProfile: 'Strong — final slide closes with prominent CTA pill.',
    visualEmphasisProfile: 'High — stronger scrim (+10%) keeps overlay legible over varied product imagery.',
  },
};

const CAROUSEL_PRESENTATION: RenderStrategy = {
  id: 'carousel:presentation-carousel',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.4,
    hookScale: 0.85,
    insightScale: 1.15,
    supportScale: 1.1,
    maxHeadlineLinesDelta: 1,
    marginScale: 0.95,
    textBlockTopRatio: 0.32,
    scrimIntensityMultiplier: 0.95,
    logoScaleMultiplier: 1.05,
    ctaMode: 'standard',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Deck-style — feature headline (+40%), larger insight (+15%) and support (+10%) for presentation typography hierarchy.',
    brandingProfile: 'Standard brand mark — deck title slide foregrounds the presenter brand.',
    densityProfile: 'Dense — tighter margins (-5%) and elevated text block fit deck-grade content per slide.',
    ctaProfile: 'Standard — next-steps slide closes with deliberate action framing.',
    visualEmphasisProfile: 'Standard — typography carries the deck weight.',
  },
};

/* ── Infographic render strategies ───────────────────────────────── */

const INFOGRAPHIC_STATISTICS: RenderStrategy = {
  id: 'infographic:stats',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.5,
    insightScale: 1.1,
    supportScale: 0.95,
    marginScale: 1.0,
    logoScaleMultiplier: 0.95,
    ctaMode: 'subtle',
    focalEmphasis: 'high',
  },
  explainability: {
    typographyProfile: 'Feature numerals — headline scaled +50% so metric blocks own the hierarchy.',
    brandingProfile: 'Subtle brand mark — data dominates.',
    densityProfile: 'Balanced — metric-block grid as primary scaffold.',
    ctaProfile: 'Subtle — context line replaces traditional CTA.',
    visualEmphasisProfile: 'High focal emphasis on numerals — typography hierarchy dominates layout.',
  },
};

const INFOGRAPHIC_PROCESS: RenderStrategy = {
  id: 'infographic:process',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.1,
    insightScale: 1.0,
    supportScale: 1.0,
    marginScale: 1.05,
    logoScaleMultiplier: 1.0,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Lead headline (+10%) — step numerals carry sequential hierarchy per row.',
    brandingProfile: 'Standard brand mark — consistent across steps.',
    densityProfile: 'Balanced — slight margin expansion for legible step cards.',
    ctaProfile: 'Subtle — outcome step doubles as the action close.',
    visualEmphasisProfile: 'Standard — sequence-first reading order.',
  },
};

const INFOGRAPHIC_TIMELINE: RenderStrategy = {
  id: 'infographic:timeline',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.2,
    insightScale: 1.0,
    marginScale: 1.1,
    logoScaleMultiplier: 0.95,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Feature headline (+20%) — date markers + event labels carry visual weight.',
    brandingProfile: 'Subtle brand mark — timeline spine + markers dominate.',
    densityProfile: 'Balanced — wider margins (+10%) accommodate the spine + marker spacing.',
    ctaProfile: 'Subtle — horizon note replaces traditional CTA.',
    visualEmphasisProfile: 'Standard — chronological spine carries the reading order.',
  },
};

const INFOGRAPHIC_COMPARISON: RenderStrategy = {
  id: 'infographic:comparison',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.15,
    insightScale: 1.0,
    supportScale: 0.95,
    marginScale: 0.95,
    logoScaleMultiplier: 1.0,
    ctaMode: 'standard',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Lead headline (+15%) — column labels carry parallel typographic weight.',
    brandingProfile: 'Standard brand mark — neutral between the two compared sides.',
    densityProfile: 'Dense — tighter margins (-5%) fit the side-by-side column structure.',
    ctaProfile: 'Standard — verdict line acts as the comparison\'s action close.',
    visualEmphasisProfile: 'Standard — parallel two-column structure dictates hierarchy.',
  },
};

const INFOGRAPHIC_FRAMEWORK: RenderStrategy = {
  id: 'infographic:framework',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.1,
    insightScale: 1.05,
    marginScale: 1.0,
    logoScaleMultiplier: 1.0,
    ctaMode: 'subtle',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Lead headline (+10%) — framework parent label feature; pillar labels lead.',
    brandingProfile: 'Standard brand mark — consistent above the pillar grid.',
    densityProfile: 'Balanced — pillar modules sit in parallel grid.',
    ctaProfile: 'Subtle — synthesis note ties pillars without a hard CTA.',
    visualEmphasisProfile: 'Standard — pillars carry equal weight per the framework structure.',
  },
};

const INFOGRAPHIC_ROADMAP: RenderStrategy = {
  id: 'infographic:roadmap',
  modifiers: {
    ...baseModifiers(),
    headlineScale: 1.25,
    insightScale: 1.05,
    supportScale: 1.0,
    marginScale: 1.05,
    logoScaleMultiplier: 1.0,
    ctaMode: 'standard',
    focalEmphasis: 'standard',
  },
  explainability: {
    typographyProfile: 'Feature headline (+25%) — phase labels span the spine in feature weight.',
    brandingProfile: 'Standard brand mark — visible above the phased progression.',
    densityProfile: 'Balanced — slight margin expansion to accommodate phase bands + milestone clusters.',
    ctaProfile: 'Standard — horizon note pairs with a deliberate next-action close.',
    visualEmphasisProfile: 'Standard — phased progression carries the visual narrative.',
  },
};

/* ── Registry + resolver ──────────────────────────────────────────── */

const REGISTRY: ReadonlyArray<RenderStrategy> = [
  IMAGE_PROMOTIONAL,
  IMAGE_EDUCATIONAL,
  IMAGE_QUOTE,
  IMAGE_PRODUCT_SHOWCASE,
  IMAGE_BRAND_FOCUS,
  CAROUSEL_EDUCATIONAL,
  CAROUSEL_FRAMEWORK,
  CAROUSEL_STORY,
  CAROUSEL_PRODUCT_SHOWCASE,
  CAROUSEL_PRESENTATION,
  INFOGRAPHIC_STATISTICS,
  INFOGRAPHIC_PROCESS,
  INFOGRAPHIC_TIMELINE,
  INFOGRAPHIC_COMPARISON,
  INFOGRAPHIC_FRAMEWORK,
  INFOGRAPHIC_ROADMAP,
];

const REGISTRY_BY_ID = new Map<string, RenderStrategy>(REGISTRY.map((s) => [s.id, s]));

/**
 * Resolve a render strategy by purpose-strategy id. Returns null when
 * no strategy matches — callers should fall back to the existing
 * preset path (legacy / direct-call paths preserved byte-identical).
 */
export function resolveRenderStrategy(purposeStrategyId: string | null | undefined): RenderStrategy | null {
  if (!purposeStrategyId) return null;
  const trimmed = String(purposeStrategyId).trim();
  if (!trimmed) return null;
  return REGISTRY_BY_ID.get(trimmed) ?? null;
}

/**
 * Apply a render strategy's modifiers to a numeric preset value with
 * deterministic clamping. Used by `buildOverlaySvg` so a malformed
 * registry entry can't produce out-of-bounds sizes.
 */
export function applyScale(base: number, multiplier: number, minBound = 0.5, maxBound = 1.75): number {
  if (!Number.isFinite(base) || !Number.isFinite(multiplier)) return base;
  const clamped = Math.max(minBound, Math.min(maxBound, multiplier));
  return base * clamped;
}

/** Diagnostics — used by tests + admin tooling. */
export function listRenderStrategies(): ReadonlyArray<RenderStrategy> {
  return REGISTRY;
}

/**
 * Variant Registry.
 *
 * Declares the controlled exploration variants that sit ON TOP of a
 * resolved Purpose Strategy. Every strategy supports exactly three
 * variants — V1 (baseline), V2 (amplified emphasis), V3 (alternate
 * composition). The cap is enforced at the registry layer (PHASE 11
 * exploration safety) so callers cannot introduce a fourth variant
 * without explicitly declaring it here.
 *
 * Distinct from:
 *   - `purposeStrategyRegistry` → which STRATEGY (image:quote vs image:promotional)
 *   - `renderStrategyRegistry`  → render-level modifier vector per STRATEGY
 *   - `variantStrategyProfiles` → per-VARIANT prompt directives + render-modifier overrides
 *
 * This file is PURE METADATA — what each variant IS. The behavior
 * (prompt directives + modifier vectors) lives in
 * `variantStrategyProfiles.ts`.
 *
 * Pure data + thin resolvers. No side effects.
 */

import { listAllStrategyAnalyticsDimensions, type AnalyticsContentType } from './strategyAnalyticsRegistry';

/* ── Shared enums ─────────────────────────────────────────────── */

export type VariantFamily = 'v1' | 'v2' | 'v3';

/**
 * Exploration dimensions a variant is allowed to vary. Must match
 * the PHASE 2 allowed-dimensions vocabulary — any new dimension must
 * be added here AND in variantStrategyProfiles before it can
 * influence generation (PHASE 11 governance bypass prevention).
 */
export type VariantExplorationDimension =
  | 'typography'
  | 'cta_treatment'
  | 'branding_intensity'
  | 'visual_density'
  | 'composition_hierarchy'
  | 'spacing'
  | 'headline_emphasis'
  | 'color_intensity'
  | 'information_hierarchy'
  | 'visual_framing';

export const ALLOWED_VARIANT_EXPLORATION_DIMENSIONS: ReadonlyArray<VariantExplorationDimension> = [
  'typography',
  'cta_treatment',
  'branding_intensity',
  'visual_density',
  'composition_hierarchy',
  'spacing',
  'headline_emphasis',
  'color_intensity',
  'information_hierarchy',
  'visual_framing',
];

/* ── Definition shape ──────────────────────────────────────────── */

export type VariantDefinition = {
  /** Unique id — `<strategy_id>:<variant_family>` (e.g. 'image:quote-image:v1'). */
  variant_id: string;
  /** Stable family token — 'v1' | 'v2' | 'v3'. */
  variant_family: VariantFamily;
  /** Parent strategy id (matches purposeStrategyRegistry / renderStrategyRegistry / strategyAnalyticsRegistry). */
  strategy_id: string;
  /** Content type lane — kept here for fast filter queries. */
  content_type: AnalyticsContentType;
  /** Operator-readable label shown in preview + dashboard. */
  display_name: string;
  /** Operator-readable rationale shown in the "Applied Variant" panel. */
  description: string;
  /** Dimensions this variant deliberately explores — drives the
   *  exploration audit + the dashboard "what is this variant trying" tooltip. */
  exploration_dimensions: ReadonlyArray<VariantExplorationDimension>;
};

/* ── Cap enforcement (PHASE 11) ────────────────────────────────── */

/** Hard upper bound on variants per strategy. Increasing this requires
 *  intent — bumping it MUST be matched by a new VariantProfile entry. */
export const MAX_VARIANTS_PER_STRATEGY = 3;

/* ── 48-entry roster (16 strategies × 3 variants) ──────────────── */

const REGISTRY: ReadonlyArray<VariantDefinition> = [
  /* ── IMAGE LANE (5 strategies × 3 variants = 15) ─────────────── */

  // image:promotional-image
  {
    variant_id: 'image:promotional-image:v1',
    variant_family: 'v1',
    strategy_id: 'image:promotional-image',
    content_type: 'image',
    display_name: 'Promotional — Direct Offer',
    description: 'Baseline promotional treatment with a moderate headline and a standard CTA pill — leans on the offer itself.',
    exploration_dimensions: ['headline_emphasis', 'cta_treatment'],
  },
  {
    variant_id: 'image:promotional-image:v2',
    variant_family: 'v2',
    strategy_id: 'image:promotional-image',
    content_type: 'image',
    display_name: 'Promotional — High-Impact CTA',
    description: 'Larger headline, brighter scrim, and a strong accent-coloured CTA — converts on first scan.',
    exploration_dimensions: ['headline_emphasis', 'cta_treatment', 'color_intensity', 'visual_density'],
  },
  {
    variant_id: 'image:promotional-image:v3',
    variant_family: 'v3',
    strategy_id: 'image:promotional-image',
    content_type: 'image',
    display_name: 'Promotional — Product-Forward',
    description: 'Text block drops to the lower third so the product photography carries the visual weight; CTA stays standard.',
    exploration_dimensions: ['composition_hierarchy', 'visual_framing', 'spacing'],
  },

  // image:educational-image
  {
    variant_id: 'image:educational-image:v1',
    variant_family: 'v1',
    strategy_id: 'image:educational-image',
    content_type: 'image',
    display_name: 'Educational — Minimal',
    description: 'Quiet editorial treatment with a balanced headline and subtle CTA — emphasises clarity over emphasis.',
    exploration_dimensions: ['typography', 'visual_density'],
  },
  {
    variant_id: 'image:educational-image:v2',
    variant_family: 'v2',
    strategy_id: 'image:educational-image',
    content_type: 'image',
    display_name: 'Educational — Strong Headline',
    description: 'Headline scaled up with a heavier weight; insight line emphasised to anchor the lesson.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'image:educational-image:v3',
    variant_family: 'v3',
    strategy_id: 'image:educational-image',
    content_type: 'image',
    display_name: 'Educational — Infographic-Style',
    description: 'Tighter margins + structured information hierarchy — borrows infographic readability cues without changing intent.',
    exploration_dimensions: ['information_hierarchy', 'visual_density', 'spacing'],
  },

  // image:quote-image
  {
    variant_id: 'image:quote-image:v1',
    variant_family: 'v1',
    strategy_id: 'image:quote-image',
    content_type: 'image',
    display_name: 'Quote — Editorial',
    description: 'Oversized typographic statement with brand mark de-emphasised — the words carry the visual.',
    exploration_dimensions: ['typography', 'branding_intensity'],
  },
  {
    variant_id: 'image:quote-image:v2',
    variant_family: 'v2',
    strategy_id: 'image:quote-image',
    content_type: 'image',
    display_name: 'Quote — Display Typeface',
    description: 'Even larger headline scale with widened spacing — display-typeface poster aesthetic.',
    exploration_dimensions: ['typography', 'spacing', 'headline_emphasis'],
  },
  {
    variant_id: 'image:quote-image:v3',
    variant_family: 'v3',
    strategy_id: 'image:quote-image',
    content_type: 'image',
    display_name: 'Quote — Attribution-Forward',
    description: 'Brand mark restored to standard intensity so attribution + author stay clearly visible; headline remains large.',
    exploration_dimensions: ['branding_intensity', 'composition_hierarchy'],
  },

  // image:product-showcase-image
  {
    variant_id: 'image:product-showcase-image:v1',
    variant_family: 'v1',
    strategy_id: 'image:product-showcase-image',
    content_type: 'image',
    display_name: 'Product Showcase — Hero Photo',
    description: 'Product photography dominates; text block drops to bottom third with a standard CTA.',
    exploration_dimensions: ['composition_hierarchy', 'visual_framing'],
  },
  {
    variant_id: 'image:product-showcase-image:v2',
    variant_family: 'v2',
    strategy_id: 'image:product-showcase-image',
    content_type: 'image',
    display_name: 'Product Showcase — Caption Punch',
    description: 'Stronger headline + strong CTA pill; product still hero but caption competes harder for attention.',
    exploration_dimensions: ['headline_emphasis', 'cta_treatment', 'color_intensity'],
  },
  {
    variant_id: 'image:product-showcase-image:v3',
    variant_family: 'v3',
    strategy_id: 'image:product-showcase-image',
    content_type: 'image',
    display_name: 'Product Showcase — Tight Crop',
    description: 'Margins tighten + scrim deepens so the product fills the frame edge-to-edge.',
    exploration_dimensions: ['spacing', 'visual_density', 'visual_framing'],
  },

  // image:brand-focus-image
  {
    variant_id: 'image:brand-focus-image:v1',
    variant_family: 'v1',
    strategy_id: 'image:brand-focus-image',
    content_type: 'image',
    display_name: 'Brand Focus — Logo Prominent',
    description: 'Brand mark scaled up with generous margin; headline plays a supporting role.',
    exploration_dimensions: ['branding_intensity', 'spacing'],
  },
  {
    variant_id: 'image:brand-focus-image:v2',
    variant_family: 'v2',
    strategy_id: 'image:brand-focus-image',
    content_type: 'image',
    display_name: 'Brand Focus — Wordmark + Tagline',
    description: 'Headline scaled up alongside the brand mark; both treated as parity composition.',
    exploration_dimensions: ['headline_emphasis', 'branding_intensity'],
  },
  {
    variant_id: 'image:brand-focus-image:v3',
    variant_family: 'v3',
    strategy_id: 'image:brand-focus-image',
    content_type: 'image',
    display_name: 'Brand Focus — Color-Forward',
    description: 'Accent colour intensifies in the scrim + CTA — brand identity reinforced through palette.',
    exploration_dimensions: ['color_intensity', 'branding_intensity'],
  },

  /* ── CAROUSEL LANE (5 strategies × 3 variants = 15) ──────────── */

  // carousel:educational-carousel
  {
    variant_id: 'carousel:educational-carousel:v1',
    variant_family: 'v1',
    strategy_id: 'carousel:educational-carousel',
    content_type: 'carousel',
    display_name: 'Educational Carousel — Lesson Sequence',
    description: 'Balanced slide deck with subtle CTAs — comfortable read-through pace.',
    exploration_dimensions: ['typography', 'visual_density'],
  },
  {
    variant_id: 'carousel:educational-carousel:v2',
    variant_family: 'v2',
    strategy_id: 'carousel:educational-carousel',
    content_type: 'carousel',
    display_name: 'Educational Carousel — Headline Lead',
    description: 'Slide headlines scaled up; the first slide functions as a strong promise.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'carousel:educational-carousel:v3',
    variant_family: 'v3',
    strategy_id: 'carousel:educational-carousel',
    content_type: 'carousel',
    display_name: 'Educational Carousel — Stepped Outline',
    description: 'Tightened density + clearer information hierarchy across slides — borrows from the framework deck.',
    exploration_dimensions: ['information_hierarchy', 'visual_density', 'spacing'],
  },

  // carousel:framework-carousel
  {
    variant_id: 'carousel:framework-carousel:v1',
    variant_family: 'v1',
    strategy_id: 'carousel:framework-carousel',
    content_type: 'carousel',
    display_name: 'Framework Carousel — Pillar Parity',
    description: 'Each pillar slide treated equally — measured composition across the deck.',
    exploration_dimensions: ['composition_hierarchy', 'spacing'],
  },
  {
    variant_id: 'carousel:framework-carousel:v2',
    variant_family: 'v2',
    strategy_id: 'carousel:framework-carousel',
    content_type: 'carousel',
    display_name: 'Framework Carousel — Headline Anchor',
    description: 'First slide and conclusion slide carry an outsized headline; interior slides keep parity.',
    exploration_dimensions: ['headline_emphasis', 'composition_hierarchy'],
  },
  {
    variant_id: 'carousel:framework-carousel:v3',
    variant_family: 'v3',
    strategy_id: 'carousel:framework-carousel',
    content_type: 'carousel',
    display_name: 'Framework Carousel — Branded Pillars',
    description: 'Brand mark sized up; accent colour intensifies — frames the framework as branded methodology.',
    exploration_dimensions: ['branding_intensity', 'color_intensity'],
  },

  // carousel:story-carousel
  {
    variant_id: 'carousel:story-carousel:v1',
    variant_family: 'v1',
    strategy_id: 'carousel:story-carousel',
    content_type: 'carousel',
    display_name: 'Story Carousel — Cinematic',
    description: 'Upper-third text framing across slides; CTA suppressed — the narrative carries the close.',
    exploration_dimensions: ['composition_hierarchy', 'visual_framing'],
  },
  {
    variant_id: 'carousel:story-carousel:v2',
    variant_family: 'v2',
    strategy_id: 'carousel:story-carousel',
    content_type: 'carousel',
    display_name: 'Story Carousel — Caption-Forward',
    description: 'Headlines scaled up; insight lines emphasised — heavier captions on each beat.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'carousel:story-carousel:v3',
    variant_family: 'v3',
    strategy_id: 'carousel:story-carousel',
    content_type: 'carousel',
    display_name: 'Story Carousel — Sober Closing',
    description: 'Final slide restores a subtle CTA; brand mark slightly elevated — gentle close on the narrative.',
    exploration_dimensions: ['cta_treatment', 'branding_intensity'],
  },

  // carousel:product-showcase-carousel
  {
    variant_id: 'carousel:product-showcase-carousel:v1',
    variant_family: 'v1',
    strategy_id: 'carousel:product-showcase-carousel',
    content_type: 'carousel',
    display_name: 'Product Showcase Carousel — Feature Tour',
    description: 'Standard product-tour deck — each slide highlights one feature; final slide carries a strong CTA.',
    exploration_dimensions: ['composition_hierarchy', 'cta_treatment'],
  },
  {
    variant_id: 'carousel:product-showcase-carousel:v2',
    variant_family: 'v2',
    strategy_id: 'carousel:product-showcase-carousel',
    content_type: 'carousel',
    display_name: 'Product Showcase Carousel — Benefit Headlines',
    description: 'Each slide headline scaled up to surface the benefit; CTA pill remains strong on the close.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'carousel:product-showcase-carousel:v3',
    variant_family: 'v3',
    strategy_id: 'carousel:product-showcase-carousel',
    content_type: 'carousel',
    display_name: 'Product Showcase Carousel — Tight Frame',
    description: 'Margins tighten across slides — denser, more catalogue-like presentation.',
    exploration_dimensions: ['spacing', 'visual_density'],
  },

  // carousel:presentation-carousel
  {
    variant_id: 'carousel:presentation-carousel:v1',
    variant_family: 'v1',
    strategy_id: 'carousel:presentation-carousel',
    content_type: 'carousel',
    display_name: 'Presentation Carousel — Deck Style',
    description: 'Large headlines per slide; deck-style typography with a standard CTA on close.',
    exploration_dimensions: ['typography', 'headline_emphasis'],
  },
  {
    variant_id: 'carousel:presentation-carousel:v2',
    variant_family: 'v2',
    strategy_id: 'carousel:presentation-carousel',
    content_type: 'carousel',
    display_name: 'Presentation Carousel — Insight Lead',
    description: 'Insight + support lines scaled up alongside headline — denser slide content.',
    exploration_dimensions: ['typography', 'visual_density', 'information_hierarchy'],
  },
  {
    variant_id: 'carousel:presentation-carousel:v3',
    variant_family: 'v3',
    strategy_id: 'carousel:presentation-carousel',
    content_type: 'carousel',
    display_name: 'Presentation Carousel — Branded Deck',
    description: 'Brand mark sized up + accent colour intensifies on each slide — feels like a branded deck.',
    exploration_dimensions: ['branding_intensity', 'color_intensity'],
  },

  /* ── INFOGRAPHIC LANE (6 strategies × 3 variants = 18) ──────── */

  // infographic:stats
  {
    variant_id: 'infographic:stats:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:stats',
    content_type: 'infographic',
    display_name: 'Statistics — Numeral Lead',
    description: 'Headline numerals dominate; supporting labels stay compact.',
    exploration_dimensions: ['typography', 'information_hierarchy'],
  },
  {
    variant_id: 'infographic:stats:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:stats',
    content_type: 'infographic',
    display_name: 'Statistics — Labelled Numerals',
    description: 'Insight + support lines scaled up alongside the headline numerals — pairs each metric with a clearer label.',
    exploration_dimensions: ['typography', 'information_hierarchy'],
  },
  {
    variant_id: 'infographic:stats:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:stats',
    content_type: 'infographic',
    display_name: 'Statistics — Color-Coded',
    description: 'Accent colour intensifies across data points; scrim warms — colour drives data emphasis.',
    exploration_dimensions: ['color_intensity', 'visual_framing'],
  },

  // infographic:process
  {
    variant_id: 'infographic:process:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:process',
    content_type: 'infographic',
    display_name: 'Process — Step List',
    description: 'Balanced step layout with subtle CTAs — comfortable read-through.',
    exploration_dimensions: ['composition_hierarchy', 'spacing'],
  },
  {
    variant_id: 'infographic:process:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:process',
    content_type: 'infographic',
    display_name: 'Process — Step Headlines',
    description: 'Each step headline scaled up; faster scan of the step sequence.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'infographic:process:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:process',
    content_type: 'infographic',
    display_name: 'Process — Tight Flow',
    description: 'Margins tighten + insight lines emphasised — denser flow-chart presentation.',
    exploration_dimensions: ['spacing', 'visual_density', 'information_hierarchy'],
  },

  // infographic:timeline
  {
    variant_id: 'infographic:timeline:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:timeline',
    content_type: 'infographic',
    display_name: 'Timeline — Chronology',
    description: 'Standard chronological emphasis; balanced headline and support typography.',
    exploration_dimensions: ['typography', 'information_hierarchy'],
  },
  {
    variant_id: 'infographic:timeline:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:timeline',
    content_type: 'infographic',
    display_name: 'Timeline — Milestone-Forward',
    description: 'Milestone headlines scaled up; each beat reads as a marquee moment.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'infographic:timeline:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:timeline',
    content_type: 'infographic',
    display_name: 'Timeline — Annotated',
    description: 'Insight + support lines emphasised — interior annotations carry more context per milestone.',
    exploration_dimensions: ['information_hierarchy', 'visual_density'],
  },

  // infographic:comparison
  {
    variant_id: 'infographic:comparison:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:comparison',
    content_type: 'infographic',
    display_name: 'Comparison — Side-by-Side',
    description: 'Tight margins with parallel columns — dense, head-to-head comparison.',
    exploration_dimensions: ['composition_hierarchy', 'spacing'],
  },
  {
    variant_id: 'infographic:comparison:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:comparison',
    content_type: 'infographic',
    display_name: 'Comparison — Headline Decision',
    description: 'Headline scaled up to frame the comparison as a clear decision; CTA pill remains strong.',
    exploration_dimensions: ['headline_emphasis', 'cta_treatment'],
  },
  {
    variant_id: 'infographic:comparison:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:comparison',
    content_type: 'infographic',
    display_name: 'Comparison — Color-Coded Sides',
    description: 'Accent colour intensifies to differentiate the two sides — colour carries the comparison signal.',
    exploration_dimensions: ['color_intensity', 'visual_framing'],
  },

  // infographic:framework
  {
    variant_id: 'infographic:framework:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:framework',
    content_type: 'infographic',
    display_name: 'Framework — Quadrant Balance',
    description: 'Balanced quadrant / pillar layout — standard framework readability.',
    exploration_dimensions: ['composition_hierarchy', 'information_hierarchy'],
  },
  {
    variant_id: 'infographic:framework:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:framework',
    content_type: 'infographic',
    display_name: 'Framework — Pillar Headlines',
    description: 'Pillar headlines scaled up; framework labels read at a glance.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'infographic:framework:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:framework',
    content_type: 'infographic',
    display_name: 'Framework — Tight Matrix',
    description: 'Tightened margins + denser insight emphasis — matrix presentation reads as analytical.',
    exploration_dimensions: ['spacing', 'visual_density'],
  },

  // infographic:roadmap
  {
    variant_id: 'infographic:roadmap:v1',
    variant_family: 'v1',
    strategy_id: 'infographic:roadmap',
    content_type: 'infographic',
    display_name: 'Roadmap — Phased Progress',
    description: 'Standard phased progression with balanced typography per milestone.',
    exploration_dimensions: ['composition_hierarchy', 'information_hierarchy'],
  },
  {
    variant_id: 'infographic:roadmap:v2',
    variant_family: 'v2',
    strategy_id: 'infographic:roadmap',
    content_type: 'infographic',
    display_name: 'Roadmap — Headline Milestones',
    description: 'Milestone headlines scaled up — each phase reads as a major marker.',
    exploration_dimensions: ['headline_emphasis', 'typography'],
  },
  {
    variant_id: 'infographic:roadmap:v3',
    variant_family: 'v3',
    strategy_id: 'infographic:roadmap',
    content_type: 'infographic',
    display_name: 'Roadmap — Branded Phases',
    description: 'Brand mark and accent colour scaled up across phases — frames the roadmap as branded vision.',
    exploration_dimensions: ['branding_intensity', 'color_intensity'],
  },
];

/* ── Lookup maps ──────────────────────────────────────────────── */

const REGISTRY_BY_ID = new Map<string, VariantDefinition>(REGISTRY.map((v) => [v.variant_id, v]));

const REGISTRY_BY_STRATEGY = new Map<string, VariantDefinition[]>();
for (const variant of REGISTRY) {
  const list = REGISTRY_BY_STRATEGY.get(variant.strategy_id) ?? [];
  list.push(variant);
  REGISTRY_BY_STRATEGY.set(variant.strategy_id, list);
}

/* ── PHASE 11: cap enforcement ─────────────────────────────────── */

(function enforceCap(): void {
  for (const [strategyId, variants] of REGISTRY_BY_STRATEGY.entries()) {
    if (variants.length > MAX_VARIANTS_PER_STRATEGY) {
      throw new Error(
        `[variantRegistry] strategy '${strategyId}' has ${variants.length} variants — exceeds MAX_VARIANTS_PER_STRATEGY (${MAX_VARIANTS_PER_STRATEGY}). Refusing to load.`,
      );
    }
    const seenFamilies = new Set<VariantFamily>();
    for (const v of variants) {
      if (seenFamilies.has(v.variant_family)) {
        throw new Error(
          `[variantRegistry] strategy '${strategyId}' has duplicate variant_family '${v.variant_family}'. Refusing to load.`,
        );
      }
      seenFamilies.add(v.variant_family);
      for (const dim of v.exploration_dimensions) {
        if (!ALLOWED_VARIANT_EXPLORATION_DIMENSIONS.includes(dim)) {
          throw new Error(
            `[variantRegistry] variant '${v.variant_id}' declares disallowed exploration dimension '${dim}'.`,
          );
        }
      }
    }
  }
  // Sanity: each strategy in the analytics registry has variants here.
  for (const strategy of listAllStrategyAnalyticsDimensions()) {
    const variants = REGISTRY_BY_STRATEGY.get(strategy.strategy_id) ?? [];
    if (variants.length !== MAX_VARIANTS_PER_STRATEGY) {
      throw new Error(
        `[variantRegistry] strategy '${strategy.strategy_id}' has ${variants.length} variants — expected exactly ${MAX_VARIANTS_PER_STRATEGY}.`,
      );
    }
  }
})();

/* ── Public resolvers ──────────────────────────────────────────── */

/**
 * Resolve a variant by id. Returns null for unknown id — caller
 * MUST treat null as "no variant — fall back to baseline strategy".
 */
export function resolveVariant(variantId: string | null | undefined): VariantDefinition | null {
  if (!variantId) return null;
  return REGISTRY_BY_ID.get(String(variantId).trim()) ?? null;
}

/**
 * Resolve a variant by (strategy id, variant family). Returns null
 * for unknown combinations — useful for callers who only have the
 * family token.
 */
export function resolveVariantByFamily(
  strategyId: string | null | undefined,
  variantFamily: VariantFamily | string | null | undefined,
): VariantDefinition | null {
  if (!strategyId || !variantFamily) return null;
  const id = `${String(strategyId).trim()}:${String(variantFamily).trim().toLowerCase()}`;
  return REGISTRY_BY_ID.get(id) ?? null;
}

/** List every declared variant — drives leaderboards + coverage tests. */
export function listAllVariants(): ReadonlyArray<VariantDefinition> {
  return REGISTRY;
}

/** List variants for a single strategy (always 3 for any known strategy). */
export function listVariantsForStrategy(strategyId: string | null | undefined): ReadonlyArray<VariantDefinition> {
  if (!strategyId) return [];
  return REGISTRY_BY_STRATEGY.get(String(strategyId).trim()) ?? [];
}

/** List variants filtered by content type lane. */
export function listVariantsForContentType(contentType: AnalyticsContentType): ReadonlyArray<VariantDefinition> {
  return REGISTRY.filter((v) => v.content_type === contentType);
}

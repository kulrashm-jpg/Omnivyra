/**
 * Competitor RELATION model (Phase 2).
 *
 * The competitor engine already produces nine evidence-derived dimensions
 * (`CompetitorDimensionScores`). Two problems followed from how they were consumed:
 *
 *  1. The nine dimensions were collapsed into ONE weighted number, so "competes on the
 *     same product" and "competes for the same customer" could not be distinguished.
 *     A tool that overlaps functionally but serves a different segment scored the same
 *     as one that does both.
 *  2. The score was emitted unconditionally. A competitor about which almost nothing was
 *     known still received an authoritative-looking number and a competitive category.
 *
 * This module fixes both WITHOUT touching the dimensions, the weights, or the engine.
 * It reads the existing dimensions and produces:
 *   • a PRODUCT axis  (Table A — who solves a substantially similar problem?)
 *   • a MARKET  axis  (Table B — who competes for the same customer decision?)
 * each wrapped in the canonical `ScoreEnvelope` so either can ABSTAIN, plus relation
 * labels derived from those axes rather than from array position.
 */
import type { CompetitorDimensionScores } from '../../types/competitor';
import {
  type ConfidenceBand,
  type ScoreEnvelope,
  type ScoreState,
  bandFromEvidence,
  emptyEnvelope,
} from './snapshotReport/canonicalScoreState';

// ── Relation vocabulary ───────────────────────────────────────────────────────

/** Table A — functional/product competition. */
export type ProductRelation =
  | 'direct'          // solves substantially the same problem in substantially the same way
  | 'adjacent'        // overlapping capability, different primary job
  | 'substitute'      // different approach, same underlying need
  | 'none'            // no material product overlap
  | 'unknown';        // insufficient evidence to say

/** Table B — market/segment competition. */
export type MarketRelation =
  | 'same_segment'
  | 'adjacent_segment'
  | 'different'
  | 'unknown';

/** The combined competitive judgement a CMO reads. */
export type CompositeRelation =
  | 'direct'
  | 'adjacent'
  | 'substitute'
  | 'strategic'         // credible future competitor: strong on one axis, not yet the other
  | 'not_competitive'
  | 'unclassified';     // discovered, but evidence is insufficient to classify

export interface CompetitorRelations {
  product: ScoreEnvelope;
  market: ScoreEnvelope;
  productRelation: ProductRelation;
  marketRelation: MarketRelation;
  compositeRelation: CompositeRelation;
  /** True when either axis abstained; the competitor is surfaced but not ranked as a rival. */
  abstained: boolean;
  /** Executive-readable reason when abstained. Null when both axes are scored. */
  abstainReason: string | null;
  /** Display label — "Discovered — Unclassified" when abstained. */
  label: string;
}

// ── Governance constants ──────────────────────────────────────────────────────

/**
 * Dimensions composing each axis, with weights RENORMALISED from the existing
 * `weightedCompetitorScore` blend so no weight is invented here.
 *
 * Product axis (original weights: 0.25 + 0.20 + 0.10 = 0.55 of the blend):
 *   productServiceFit .25 → .4545 · workflowFit .20 → .3636 · useCaseFit .10 → .1818
 * Market axis (original weights: 0.15 + 0.15 + 0.05 + 0.03 + 0.02 = 0.40 of the blend):
 *   icpFit .15 → .375 · customerEvaluationFit .15 → .375 · revenueScaleFit .05 → .125
 *   employeeScaleFit .03 → .075 · geographyFit .02 → .05
 *
 * `seoIntentFit` (0.05) belongs to NEITHER axis: it measures search-visibility overlap,
 * which is a discovery signal, not a statement about product or market. It is deliberately
 * excluded so a company that merely ranks for similar terms cannot be promoted into a
 * product or market competitor on that basis alone.
 */
const PRODUCT_WEIGHTS = {
  productServiceFit: 0.4545,
  workflowFit: 0.3636,
  useCaseFit: 0.1818,
} as const;

const MARKET_WEIGHTS = {
  icpFit: 0.375,
  customerEvaluationFit: 0.375,
  revenueScaleFit: 0.125,
  employeeScaleFit: 0.075,
  geographyFit: 0.05,
} as const;

/**
 * ABSTENTION THRESHOLD — the minimum number of independently-evidenced signals an axis
 * needs before it may publish a score.
 *
 * Set to 2, matching `CONFIDENCE_EVIDENCE.MEDIUM_COUNT` in the canonical scoring-governance
 * registry: below that count the existing model already refuses to call confidence anything
 * above 'low'. Publishing an authoritative competitive category from evidence the platform
 * itself grades 'low' is exactly the contradiction Phase 2 removes. The threshold is
 * therefore inherited, not invented — one signal is an anecdote, two is the platform's own
 * definition of the weakest publishable evidence.
 */
export const COMPETITOR_MIN_EVIDENCE = 2;

/**
 * Relation cutoffs on the 0..100 axis scores.
 *
 * These reuse the existing `competitorIntelligenceTier` ladder (core ≥85, strong ≥70,
 * adjacent ≥55) rather than introducing a second, conflicting set of bands: 70 is the
 * point at which the engine already calls a competitor "strong", and 55 the point at
 * which it already calls one "adjacent". Below 55 the engine's own vocabulary is
 * "strategic", i.e. not a present-tense competitor.
 */
export const RELATION_BANDS = { high: 70, moderate: 55 } as const;

// ── Derivation ────────────────────────────────────────────────────────────────

function weightedAxis(
  dimensions: CompetitorDimensionScores,
  weights: Record<string, number>,
): number {
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (Number((dimensions as unknown as Record<string, number>)[key]) || 0) * weight;
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

function axisEnvelope(params: {
  value: number;
  evidenceCount: number;
  sources: string[];
  hasStrongSource: boolean;
}): ScoreEnvelope {
  if (params.evidenceCount < COMPETITOR_MIN_EVIDENCE) {
    // Abstain: carry the evidence trace, but publish no value.
    return {
      ...emptyEnvelope('insufficient_signal'),
      evidence_count: params.evidenceCount,
      evidence_sources: params.sources,
    };
  }
  const state: ScoreState = params.hasStrongSource ? 'measured' : 'inferred';
  const confidence: ConfidenceBand = bandFromEvidence(params.evidenceCount, params.hasStrongSource);
  return {
    value: params.value,
    state,
    confidence,
    evidence_count: params.evidenceCount,
    evidence_sources: params.sources,
    freshness: { last_observed_at: null, age_hours: null },
  };
}

function productRelationFrom(envelope: ScoreEnvelope): ProductRelation {
  if (envelope.value === null) return 'unknown';
  if (envelope.value >= RELATION_BANDS.high) return 'direct';
  if (envelope.value >= RELATION_BANDS.moderate) return 'adjacent';
  if (envelope.value > 0) return 'substitute';
  return 'none';
}

function marketRelationFrom(envelope: ScoreEnvelope): MarketRelation {
  if (envelope.value === null) return 'unknown';
  if (envelope.value >= RELATION_BANDS.high) return 'same_segment';
  if (envelope.value >= RELATION_BANDS.moderate) return 'adjacent_segment';
  return 'different';
}

/**
 * Combine the two axes into the single label a CMO reads.
 *
 * The matrix is deliberately conservative: "direct" requires strength on BOTH axes —
 * a substantially similar product sold to substantially the same customer. Strength on
 * only one axis is "strategic" (a credible future competitor), which is precisely the
 * Semrush / HubSpot distinction the single blended score used to erase.
 */
function compositeRelationFrom(product: ProductRelation, market: MarketRelation): CompositeRelation {
  if (product === 'unknown' || market === 'unknown') return 'unclassified';
  if (product === 'none') return market === 'same_segment' ? 'strategic' : 'not_competitive';
  if (product === 'direct') {
    if (market === 'same_segment') return 'direct';
    if (market === 'adjacent_segment') return 'adjacent';
    return 'strategic'; // same product, different market — a future threat, not a present rival
  }
  if (product === 'adjacent') {
    return market === 'different' ? 'strategic' : 'adjacent';
  }
  // product === 'substitute'
  return market === 'different' ? 'not_competitive' : 'substitute';
}

const RELATION_LABEL: Record<CompositeRelation, string> = {
  direct: 'Direct competitor',
  adjacent: 'Adjacent competitor',
  substitute: 'Substitute',
  strategic: 'Strategic / future competitor',
  not_competitive: 'Not materially competitive',
  unclassified: 'Discovered — Unclassified',
};

/**
 * Derive both competitive views from the existing dimensions.
 *
 * `evidenceCount` / `sources` describe how much independent evidence backs THIS competitor
 * (discovery sources, enrichment, SERP co-occurrence). They are supplied by the caller
 * because the engine already tracks them; this module never invents evidence.
 */
export function deriveCompetitorRelations(params: {
  dimensions: CompetitorDimensionScores | null | undefined;
  evidenceCount: number;
  sources?: string[];
  /** True when at least one source is a direct public observation rather than an inference. */
  hasStrongSource?: boolean;
}): CompetitorRelations {
  const sources = params.sources ?? [];
  const evidenceCount = Math.max(0, Number(params.evidenceCount) || 0);

  if (!params.dimensions) {
    const empty = { ...emptyEnvelope('unavailable'), evidence_count: evidenceCount, evidence_sources: sources };
    return {
      product: empty,
      market: empty,
      productRelation: 'unknown',
      marketRelation: 'unknown',
      compositeRelation: 'unclassified',
      abstained: true,
      abstainReason: 'No competitor dimensions were computed for this candidate.',
      label: RELATION_LABEL.unclassified,
    };
  }

  const hasStrongSource = params.hasStrongSource ?? false;
  const product = axisEnvelope({
    value: weightedAxis(params.dimensions, PRODUCT_WEIGHTS),
    evidenceCount, sources, hasStrongSource,
  });
  const market = axisEnvelope({
    value: weightedAxis(params.dimensions, MARKET_WEIGHTS),
    evidenceCount, sources, hasStrongSource,
  });

  const productRelation = productRelationFrom(product);
  const marketRelation = marketRelationFrom(market);
  const compositeRelation = compositeRelationFrom(productRelation, marketRelation);
  const abstained = product.value === null || market.value === null;

  return {
    product,
    market,
    productRelation,
    marketRelation,
    compositeRelation,
    abstained,
    abstainReason: abstained
      ? `Only ${evidenceCount} independent evidence signal${evidenceCount === 1 ? '' : 's'} for this company — below the ${COMPETITOR_MIN_EVIDENCE}-signal minimum required to publish a competitive classification.`
      : null,
    label: RELATION_LABEL[compositeRelation],
  };
}

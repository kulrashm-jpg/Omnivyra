/**
 * contextQualityEngine.ts — CONTENT-INTELLIGENCE-002 Phase 3.
 *
 * Replaces the single "Context Strength" with an independent, multi-dimensional
 * Context Quality assessment. Deterministic. Every dimension gets a score,
 * confidence, and a plain reason — weak grounding is surfaced, never hidden.
 */
import {
  type CanonicalContext,
  type ContextQuality,
  type DimensionScore,
  type Fact,
  type QualityDimension,
  type QualityTier,
} from './canonicalContextTypes';
import { freshnessScore } from './contextMerge';

/** Score a single fact-backed field. Absent → 0 (with high confidence in the gap). */
function scoreField(fact: Fact<unknown> | null, label: string): DimensionScore {
  if (!fact) {
    return { score: 0, confidence: 0.9, reason: `No ${label} available.` };
  }
  const richness = Array.isArray(fact.value)
    ? Math.min(1, fact.value.length / 4) // 4+ items = full richness
    : 1;
  const base = 0.4 + 0.3 * fact.confidence + 0.2 * freshnessScore(fact.freshness) + 0.1 * richness;
  const score = Math.min(1, base);
  const fresh = fact.freshness.label === 'unknown' ? 'freshness unknown' : `${fact.freshness.label}`;
  return {
    score,
    confidence: 0.75,
    reason: `${label} present from ${fact.origin} (${fresh}).`,
  };
}

/** Combine several fields into one dimension (best-of presence + averaged richness). */
function scoreCombined(facts: Array<Fact<unknown> | null>, label: string): DimensionScore {
  const present = facts.filter(Boolean) as Fact<unknown>[];
  if (present.length === 0) return { score: 0, confidence: 0.9, reason: `No ${label} available.` };
  const parts = present.map((f) => scoreField(f, label).score);
  const score = Math.min(1, parts.reduce((a, b) => a + b, 0) / facts.length + 0.1 * (present.length - 1));
  return { score: Math.min(1, score), confidence: 0.75, reason: `${label} from ${present.map((f) => f.origin).join(', ')}.` };
}

const TIER_FROM_SCORE = (score: number): QualityTier =>
  score >= 0.85 ? 'excellent' :
  score >= 0.68 ? 'strong' :
  score >= 0.5 ? 'moderate' :
  score >= 0.3 ? 'weak' :
  'insufficient';

/** Relative weight of each dimension in the overall blend. */
const DIMENSION_WEIGHTS: Readonly<Record<QualityDimension, number>> = {
  website: 1.1,
  products: 1.2,
  services: 1.0,
  differentiation: 1.2,
  audience: 1.2,
  evidence: 1.0,
  proof: 1.0,
  brandPositioning: 0.8,
  contentHistory: 0.7,
  campaignHistory: 0.7,
  competitive: 0.6,
  market: 0.6,
  freshness: 0.6,
};

export function computeContextQuality(ctx: CanonicalContext): ContextQuality {
  const dimensions: Record<QualityDimension, DimensionScore> = {
    website: scoreField(ctx.websiteIntelligence, 'website intelligence'),
    products: scoreField(ctx.offerings, 'products'),
    services: scoreField(ctx.offerings, 'services'),
    differentiation: scoreField(ctx.differentiators, 'differentiation'),
    audience: scoreCombined([ctx.icp, ctx.personas, ctx.painPoints], 'audience/ICP'),
    evidence: scoreField(ctx.evidence, 'evidence'),
    proof: scoreCombined([ctx.evidence, ctx.offerings], 'proof'),
    brandPositioning: scoreField(ctx.brandPositioning, 'brand positioning'),
    contentHistory: scoreField(ctx.contentHistory, 'content history'),
    campaignHistory: scoreCombined([ctx.campaignHistory, ctx.performanceLearnings], 'campaign history'),
    competitive: scoreField(ctx.competitiveObservations, 'competitive intelligence'),
    market: scoreCombined([ctx.marketSignals, ctx.marketPosition], 'market intelligence'),
    freshness: freshnessDimension(ctx),
  };

  let weighted = 0;
  let weightSum = 0;
  (Object.keys(dimensions) as QualityDimension[]).forEach((dim) => {
    const w = DIMENSION_WEIGHTS[dim];
    weighted += dimensions[dim].score * w;
    weightSum += w;
  });
  const score = weightSum > 0 ? weighted / weightSum : 0;

  return { overall: TIER_FROM_SCORE(score), score, dimensions };
}

/** Freshness dimension: how recent the present signals are, on average. */
function freshnessDimension(ctx: CanonicalContext): DimensionScore {
  const facts: Array<Fact<unknown> | null> = [
    ctx.websiteIntelligence, ctx.offerings, ctx.differentiators, ctx.icp,
    ctx.evidence, ctx.contentHistory, ctx.campaignHistory, ctx.brandPositioning,
  ];
  const present = facts.filter(Boolean) as Fact<unknown>[];
  if (present.length === 0) return { score: 0, confidence: 0.9, reason: 'No dated signals to assess freshness.' };
  const avg = present.reduce((a, f) => a + freshnessScore(f.freshness), 0) / present.length;
  const known = present.filter((f) => f.freshness.label !== 'unknown').length;
  return {
    score: avg,
    confidence: known / present.length,
    reason: `${known}/${present.length} signals carry a known timestamp.`,
  };
}

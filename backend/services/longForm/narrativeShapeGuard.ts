/**
 * Phase 7 — Narrative shape diversity guard.
 *
 * Detects the structural shape of a recommendation title + framing and
 * enforces shape diversity within a batch. Without this, the engine can
 * produce six perfectly-scored recommendations that all read like
 * "Why X matters for Y" or "The ultimate guide to Z".
 *
 * Banned-by-default shapes (always penalized once they appear ≥ 2× per batch):
 *   • why_x_matters
 *   • ultimate_guide
 *   • best_practices
 *   • how_to_scale
 *   • future_of
 *
 * Other shapes (how_to, what_is, comparison, framework_first, case_proof,
 * opinion_take) are allowed but capped at MAX_PER_SHAPE per batch.
 */

import type {
  LongFormRecommendation,
  NarrativeShape,
  NarrativeShapeAudit,
} from './longFormRecommendationTypes';

const MAX_PER_SHAPE_DEFAULT = 2;

/** Per-occurrence penalty applied to overallStrength for repeats beyond MAX_PER_SHAPE. */
const PENALTY_PER_REPEAT_DEFAULT = 8;

const SHAPE_PATTERNS: Array<{ shape: NarrativeShape; test: (lower: string) => boolean; banned?: boolean }> = [
  // Banned-style first so they match before generic shapes.
  { shape: 'ultimate_guide', test: (s) => /\b(ultimate|complete|definitive|the only)\b.*\bguide\b/.test(s), banned: true },
  { shape: 'best_practices', test: (s) => /\bbest practices?\b/.test(s), banned: true },
  { shape: 'how_to_scale', test: (s) => /\bhow to scale\b/.test(s) || /\bscaling\b.*\b(team|company|org|business)\b/.test(s), banned: true },
  { shape: 'future_of', test: (s) => /\bthe future of\b/.test(s) || /\b\d{4} predictions?\b/.test(s), banned: true },
  { shape: 'why_x_matters', test: (s) => /^why\b.*\b(matters?|is important|you should care)\b/.test(s), banned: true },
  // Allowed shapes.
  { shape: 'how_to', test: (s) => /^how to\b/.test(s) },
  { shape: 'what_is', test: (s) => /^what is\b/.test(s) || /^introducing\b/.test(s) },
  { shape: 'comparison', test: (s) => /\bvs\.?\b/.test(s) || /\bversus\b/.test(s) || /\bcompar(e|ison)\b/.test(s) },
  { shape: 'framework_first', test: (s) => /\b(framework|playbook|model|system)\b/.test(s) },
  { shape: 'case_proof', test: (s) => /\b(case study|case proof|results|inside how)\b/.test(s) },
  { shape: 'opinion_take', test: (s) => /^why\b/.test(s) || /\b(most teams|common assumption|counterintuitive)\b/.test(s) },
];

export function detectNarrativeShape(recommendation: Pick<LongFormRecommendation, 'recommendationTitle' | 'editorialAngle'>): NarrativeShape {
  const haystack = `${recommendation.recommendationTitle} ${recommendation.editorialAngle}`.toLowerCase();
  for (const { shape, test } of SHAPE_PATTERNS) {
    if (test(haystack)) return shape;
  }
  return 'other';
}

export interface ShapeGuardResult {
  /** Recommendations with narrativeShape + narrativeShapeUniquenessScore attached, and overallRecommendationStrength penalty applied. */
  recommendations: LongFormRecommendation[];
  /** Per-shape audit including repeat counts and penalties applied. */
  audits: NarrativeShapeAudit[];
  /** Final shape histogram after enforcement. */
  shapeDistribution: Record<NarrativeShape, number>;
}

const SHAPE_KEYS: NarrativeShape[] = [
  'how_to', 'why_x_matters', 'ultimate_guide', 'best_practices', 'how_to_scale',
  'future_of', 'what_is', 'comparison', 'framework_first', 'case_proof',
  'opinion_take', 'other',
];

function emptyDistribution(): Record<NarrativeShape, number> {
  const dist = {} as Record<NarrativeShape, number>;
  for (const k of SHAPE_KEYS) dist[k] = 0;
  return dist;
}

/**
 * Walk recommendations in descending overallStrength order so the strongest
 * member of each shape keeps full score; weaker members of the same shape
 * absorb the penalty.
 */
export function applyNarrativeShapeGuard(
  recommendations: LongFormRecommendation[],
  options?: {
    maxPerShape?: number;
    penaltyPerRepeat?: number;
    bannedShapesMaxPerBatch?: number;
  },
): ShapeGuardResult {
  const maxPerShape = options?.maxPerShape ?? MAX_PER_SHAPE_DEFAULT;
  const penaltyPerRepeat = options?.penaltyPerRepeat ?? PENALTY_PER_REPEAT_DEFAULT;
  const bannedMax = options?.bannedShapesMaxPerBatch ?? 1;

  const bannedSet = new Set<NarrativeShape>(
    SHAPE_PATTERNS.filter((p) => p.banned).map((p) => p.shape),
  );

  // Tag every recommendation with its shape first.
  const tagged = recommendations.map((rec) => ({
    rec,
    shape: detectNarrativeShape(rec),
  }));

  // Sort descending by strength for stable leader survival.
  tagged.sort((a, b) => b.rec.overallRecommendationStrength - a.rec.overallRecommendationStrength);

  const seenCount = new Map<NarrativeShape, number>();
  const auditMap = new Map<NarrativeShape, NarrativeShapeAudit>();
  const distribution = emptyDistribution();

  const output: LongFormRecommendation[] = tagged.map(({ rec, shape }) => {
    const prevCount = seenCount.get(shape) ?? 0;
    const nextCount = prevCount + 1;
    seenCount.set(shape, nextCount);
    distribution[shape] = nextCount;

    const cap = bannedSet.has(shape) ? bannedMax : maxPerShape;
    const overage = Math.max(0, nextCount - cap);
    const penalty = overage * penaltyPerRepeat;

    const audit = auditMap.get(shape) ?? { shape, countInBatch: 0, penaltyApplied: 0 };
    audit.countInBatch = nextCount;
    audit.penaltyApplied += penalty;
    auditMap.set(shape, audit);

    // Uniqueness score: 100 if first occurrence, decays with each repeat.
    const uniquenessScore = Math.max(0, Math.round(100 - (nextCount - 1) * (bannedSet.has(shape) ? 40 : 20)));

    return {
      ...rec,
      narrativeShape: shape,
      narrativeShapeUniquenessScore: uniquenessScore,
      overallRecommendationStrength: Math.max(0, rec.overallRecommendationStrength - penalty),
    };
  });

  return {
    recommendations: output,
    audits: Array.from(auditMap.values()),
    shapeDistribution: distribution,
  };
}

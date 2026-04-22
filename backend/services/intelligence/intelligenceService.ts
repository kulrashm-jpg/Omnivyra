import {
  getPlatformActionStats,
  getSuggestionStats,
  getQueueState,
  getTargetContext,
  getLearnedPatterns,
} from './intelligenceQueries';
import {
  computeConfidence,
  computeInsight,
  computeHints,
  computeRecommendation,
  type Confidence,
  type Recommendation,
} from './intelligenceRules';
import {
  computeComparisons,
  computeLearnedInsight,
  computeLearnedRecommendation,
  type LearnedComparison,
} from './learnedIntelligenceRules';
import { cacheGet, cacheSet } from './intelligenceCache';

/**
 * Contextual intelligence service.
 *
 * Pipeline:
 *   1. Parallel bounded SELECTs: platform action stats, suggestion
 *      stats, queue state, target context, learned patterns.
 *   2. Learned patterns drive the top layer — insight, recommendation,
 *      and the `comparisons[]` response field. When the learner has
 *      not produced enough samples yet, the rule layer provides a
 *      static fallback so the UI never shows an empty panel.
 *   3. Confidence and hints continue to use the deterministic rules
 *      (learner can't beat the "reply within 5 min" heuristic yet).
 *   4. Cache per (org, platform, action_type, target_id) for 45s.
 */

export type IntelligenceRequest = {
  organization_id: string;
  platform: string;
  action_type: string;
  target_id: string;
};

export type IntelligenceResponse = {
  insight: string | null;
  hints: string[];
  confidence: Confidence;
  recommendation?: Recommendation;
  comparisons: Array<{
    type: 'length' | 'question' | 'emoji';
    winner: string;
    uplift: string;
    uplift_percent: number | null;
    sample_size: number;
  }>;
  signals: {
    platform_action_samples: number;
    suggestion_samples: number;
    prior_actions_on_target: number;
    queue_status: string | null;
    learned_patterns: number;
  };
  cache_hit?: boolean;
};

const CACHE_NS = 'intel:context:v2';

/**
 * Pick the best recommendation from the union of static + learned
 * candidates. Learned takes precedence WHEN the underlying comparison
 * has uplift ≥10% AND sample_size ≥10 (enforced inside
 * computeLearnedRecommendation via the comparison filter).
 */
function pickRecommendation(
  learned: ReturnType<typeof computeLearnedRecommendation>,
  staticRec: Recommendation | null,
): Recommendation | undefined {
  if (learned) {
    return { type: learned.type as Recommendation['type'], label: learned.label };
  }
  return staticRec ?? undefined;
}

function flattenComparisons(cmps: LearnedComparison[]): IntelligenceResponse['comparisons'] {
  return cmps.map((c) => ({
    type: c.type,
    winner: c.winner,
    uplift: c.uplift_label,
    uplift_percent: c.uplift_percent,
    sample_size: c.sample_size,
  }));
}

export async function getContextualIntelligence(
  input: IntelligenceRequest,
): Promise<IntelligenceResponse> {
  const cacheKey = [
    CACHE_NS,
    input.organization_id,
    input.platform.toLowerCase(),
    input.action_type.toLowerCase(),
    input.target_id,
  ];
  const cached = cacheGet<IntelligenceResponse>(cacheKey);
  if (cached) return { ...cached, cache_hit: true };

  const [stats, suggestions, queue, targetContext, learnedPatterns] = await Promise.all([
    getPlatformActionStats({
      organization_id: input.organization_id,
      platform: input.platform,
      action_type: input.action_type,
    }),
    getSuggestionStats({
      organization_id: input.organization_id,
      platform: input.platform,
      action_type: input.action_type,
    }),
    getQueueState(input.organization_id),
    getTargetContext({
      organization_id: input.organization_id,
      platform: input.platform,
      target_id: input.target_id,
    }),
    getLearnedPatterns({
      organization_id: input.organization_id,
      platform: input.platform,
      action_type: input.action_type,
    }),
  ]);

  const confidence = computeConfidence({ stats, queue });
  const comparisons = computeComparisons(learnedPatterns);

  // Insight: prefer a data-driven line over the static heuristic.
  const learnedInsight = computeLearnedInsight(comparisons);
  const insight = learnedInsight
    ?? computeInsight({
      platform: input.platform,
      action_type: input.action_type,
      stats,
      suggestions,
    });

  const hints = computeHints({
    platform: input.platform,
    action_type: input.action_type,
    stats,
    targetContext,
  });

  // Recommendation: learned winner first, then the rule-layer fallback.
  const learnedRec = computeLearnedRecommendation(comparisons);
  const staticRec = computeRecommendation({
    confidence,
    platform: input.platform,
    action_type: input.action_type,
    stats,
    targetContext,
  });
  // Learned recs ALWAYS show when strong enough (uplift/sample gates
  // inside the comparison filter). Static recs stay gated on high
  // confidence (phase-10 contract).
  const shouldSurfaceStatic = confidence.level === 'high';
  const recommendation = pickRecommendation(
    learnedRec,
    shouldSurfaceStatic ? staticRec : null,
  );

  const response: IntelligenceResponse = {
    insight,
    hints,
    confidence,
    ...(recommendation ? { recommendation } : {}),
    comparisons: flattenComparisons(comparisons),
    signals: {
      platform_action_samples: stats?.total_terminal ?? 0,
      suggestion_samples: suggestions?.shown_count ?? 0,
      prior_actions_on_target: targetContext?.prior_action_count ?? 0,
      queue_status: queue.status,
      learned_patterns: learnedPatterns.length,
    },
  };

  cacheSet(cacheKey, response);
  return response;
}

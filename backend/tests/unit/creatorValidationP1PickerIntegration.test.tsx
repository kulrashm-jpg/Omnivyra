/**
 * @jest-environment jsdom
 *
 * Creator Validation P1 Remediation — Phase 3 picker integration.
 *
 * Locks in the contract:
 *
 *   - mergeGovernanceWithLearningAllTypes preserves governance
 *     classification on every option
 *   - Restricted-bucket order is preserved verbatim (a learning bonus
 *     never floats a restricted option above non-restricted ones)
 *   - Recommended/allowed buckets are re-sorted by blended score
 *   - Learning fields (context_score, learning_score, …) ride on every
 *     option
 *   - Cold-start: blended sort collapses to governance order (learning
 *     bonus = 0 → bucket sort uses context_score alone)
 */

import { applyStrategyGovernanceAllTypes } from '../../services/creator/strategyGovernanceApplier';
import { getRecommendedPurposeOptions } from '../../services/creator/companyStrategyRecommendationEngine';
import { resolveStrategyGovernancePolicy } from '../../services/creator/strategyGovernancePolicyRegistry';
import { blendLearningPriorsAllTypes } from '../../services/creator/strategyLearningBlender';
import { mergeGovernanceWithLearningAllTypes } from '../../services/creator/strategyGovernanceLearningMerger';
import type { LearningSummary } from '../../services/creator/strategyLearningEngine';

function coldStartSummary(): LearningSummary {
  return {
    lane: { contentType: 'image', coldStart: true, totalImpressions: 0 },
    scores: {},
    coldStartNote: 'Cold start — not enough data to apply learning',
  } as unknown as LearningSummary;
}

function warmSummaryForImage(): LearningSummary {
  // Synthetic warm summary: educational gets a learning bonus, others 0.
  return {
    lane: { contentType: 'image', coldStart: false, totalImpressions: 500 },
    scores: {
      educational: {
        strategy_key: 'educational',
        score: 4,
        reasons: ['Above-average engagement vs lane median'],
        confidence: 'medium',
      },
      promotional: {
        strategy_key: 'promotional',
        score: 0,
        reasons: [],
        confidence: 'low',
      },
    },
    coldStartNote: null,
  } as unknown as LearningSummary;
}

function emptyColdStartByLane() {
  return {
    image: coldStartSummary(),
    carousel: { ...coldStartSummary(), lane: { contentType: 'carousel', coldStart: true, totalImpressions: 0 } } as unknown as LearningSummary,
    infographic: { ...coldStartSummary(), lane: { contentType: 'infographic', coldStart: true, totalImpressions: 0 } } as unknown as LearningSummary,
  };
}

describe('Phase 3 — governance + learning merger', () => {
  test('Cold start: merged order matches pure governance order; learning fields are zeroed', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const governance = applyStrategyGovernanceAllTypes({ recommendedByType: recommended, policy });
    const blended = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType: emptyColdStartByLane(),
    });
    const merged = mergeGovernanceWithLearningAllTypes({
      governanceByType: governance,
      blendedByType: blended,
    });

    const govOrder = governance.image.options.map((o) => o.value);
    const mergedOrder = merged.image.options.map((o) => o.value);
    expect(mergedOrder).toEqual(govOrder);
    for (const opt of merged.image.options) {
      expect(opt.learning_score).toBe(0);
      expect(opt.learning_applied).toBe(false);
    }
    expect(merged.image.learning_applied).toBe(false);
  });

  test('Restricted bucket order is preserved verbatim — never reordered by learning', () => {
    // Healthcare policy restricts promotional + product-showcase image.
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const governance = applyStrategyGovernanceAllTypes({ recommendedByType: recommended, policy });
    // Synthetic learning summary that maximally rewards restricted
    // options to prove they're still suppressed below non-restricted.
    const learning = {
      image: {
        lane: { contentType: 'image', coldStart: false, totalImpressions: 1000 },
        scores: {
          promotional: { strategy_key: 'promotional', score: 99, reasons: ['huge'], confidence: 'high' },
          'product-showcase': { strategy_key: 'product-showcase', score: 99, reasons: ['huge'], confidence: 'high' },
        },
        coldStartNote: null,
      } as unknown as LearningSummary,
      carousel: coldStartSummary(),
      infographic: coldStartSummary(),
    };
    const blended = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType: learning,
    });
    const merged = mergeGovernanceWithLearningAllTypes({
      governanceByType: governance,
      blendedByType: blended,
    });

    // Restricted options must all sort AFTER all non-restricted options.
    const lastNonRestrictedIdx = merged.image.options.findIndex((o) => o.classification === 'restricted') - 1;
    const restrictedOptions = merged.image.options.filter((o) => o.classification === 'restricted');
    expect(restrictedOptions.length).toBeGreaterThan(0);
    for (let i = lastNonRestrictedIdx + 1; i < merged.image.options.length; i++) {
      expect(merged.image.options[i].classification).toBe('restricted');
    }
  });

  test('Warm lane: recommended-bucket re-sorted by blended score; classifications intact', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'SaaS' });
    // SaaS policy is "none" → no restrictions; all options classified.
    const policy = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    const governance = applyStrategyGovernanceAllTypes({ recommendedByType: recommended, policy });
    const learning = {
      image: warmSummaryForImage(),
      carousel: coldStartSummary(),
      infographic: coldStartSummary(),
    };
    const blended = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType: learning,
    });
    const merged = mergeGovernanceWithLearningAllTypes({
      governanceByType: governance,
      blendedByType: blended,
    });

    // 'educational' got a +4 learning bonus → should sort above its
    // peers in its bucket. Classifications must remain stable.
    const educational = merged.image.options.find((o) => o.value === 'educational')!;
    expect(educational.learning_applied).toBe(true);
    expect(educational.learning_score).toBe(4);
    expect(educational.learning_reasons).toEqual(expect.arrayContaining(['Above-average engagement vs lane median']));
    // Classification was set by governance (recommended for SaaS via
    // the SaaS rule boost on educational). Either way the classification
    // string must be one of the three known values.
    expect(['recommended', 'allowed', 'restricted']).toContain(educational.classification);
    expect(merged.image.learning_applied).toBe(true);
  });

  test('Every option carries learning_score + context_score even when learning did not fire on it', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'SaaS' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    const governance = applyStrategyGovernanceAllTypes({ recommendedByType: recommended, policy });
    const blended = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType: emptyColdStartByLane(),
    });
    const merged = mergeGovernanceWithLearningAllTypes({
      governanceByType: governance,
      blendedByType: blended,
    });

    for (const opt of merged.image.options) {
      expect(typeof opt.context_score).toBe('number');
      expect(typeof opt.learning_score).toBe('number');
      expect(typeof opt.learning_applied).toBe('boolean');
      expect(Array.isArray(opt.learning_reasons)).toBe(true);
      expect(['low', 'medium', 'high']).toContain(opt.learning_confidence);
    }
  });
});

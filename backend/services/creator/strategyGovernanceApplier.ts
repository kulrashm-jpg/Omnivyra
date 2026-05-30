/**
 * Strategy Governance Applier (Creator Compliance-Aware Strategy
 * Governance — P3 + P4).
 *
 * Pure helper that takes the output of the Company Strategy
 * Recommendation Engine and classifies each option as
 * 'recommended' | 'allowed' | 'restricted' based on the resolved
 * governance policy.
 *
 * STRICT SCOPE:
 *   - DOES NOT remove any option (suppression = hidden by default,
 *     never deleted — operators can always reveal via the picker
 *     toggle).
 *   - DOES NOT mutate the recommendation engine output.
 *   - DOES NOT call any analytics / publishing / variant module.
 *   - GUIDANCE ONLY — selection of a restricted strategy is allowed;
 *     callers fire `auditRestrictedStrategySelected` separately.
 */

import type { RecommendedPurposeOption } from './companyStrategyRecommendationEngine';
import {
  type StrategyGovernancePolicy,
  suppressedStrategiesForContentType,
  deprioritizedStrategiesForContentType,
} from './strategyGovernancePolicyRegistry';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';

export type GovernedClassification = 'recommended' | 'allowed' | 'restricted';

export type GovernedPurposeOption = RecommendedPurposeOption & {
  /** Classification under the governance policy. */
  classification: GovernedClassification;
  /** Operator-readable reason when classification === 'restricted'
   *  OR when the option was deprioritized. Empty when classification
   *  === 'recommended' or 'allowed' with no rule. */
  restriction_reason: string | null;
  /** True when the option was hit by a deprioritization rule
   *  (still classified 'allowed' but sorted below other allowed
   *  options). */
  deprioritized: boolean;
};

export type ApplyStrategyGovernanceResult = {
  /** All options in their governance-resolved order:
   *  recommended → allowed → deprioritized → restricted. */
  options: GovernedPurposeOption[];
  /** Subset where classification === 'recommended'. */
  recommended: GovernedPurposeOption[];
  /** Subset where classification === 'allowed'. */
  allowed: GovernedPurposeOption[];
  /** Subset where classification === 'restricted'. */
  restricted: GovernedPurposeOption[];
  /** Default strategy slug for this content type per the policy
   *  override, or null when none. The picker should pre-select this
   *  value when the operator hasn't touched it. */
  defaultStrategyOverride: string | null;
  /** Required warning strings the picker MAY render alongside. */
  requiredWarnings: ReadonlyArray<string>;
};

/**
 * Apply the governance policy to a single content type's recommended
 * options. Pure. Stable ordering:
 *
 *   1. classification = 'recommended'
 *      (options NOT in suppressed AND NOT in deprioritized AND score > 0)
 *   2. classification = 'allowed' (no rule applies)
 *   3. classification = 'allowed' but deprioritized (rule applies)
 *   4. classification = 'restricted' (option in suppressedStrategies)
 *
 * Within each band, the input order is preserved (the recommendation
 * engine already applied score + native tiebreak).
 */
export function applyStrategyGovernance(input: {
  contentType: CreatorTypeForVariant;
  recommendedOptions: ReadonlyArray<RecommendedPurposeOption>;
  policy: StrategyGovernancePolicy;
}): ApplyStrategyGovernanceResult {
  const { contentType, recommendedOptions, policy } = input;

  // Build per-strategy rule maps for fast lookup.
  const suppressedByStrategy = new Map<string, string>(); // strategy → reason
  for (const rule of suppressedStrategiesForContentType(policy, contentType)) {
    suppressedByStrategy.set(rule.strategy, rule.reason);
  }
  const deprioritizedByStrategy = new Map<string, string>();
  for (const rule of deprioritizedStrategiesForContentType(policy, contentType)) {
    // Deprioritized rules are skipped when the strategy is ALSO
    // suppressed — suppression is the stricter classification.
    if (suppressedByStrategy.has(rule.strategy)) continue;
    deprioritizedByStrategy.set(rule.strategy, rule.reason);
  }

  const classified: GovernedPurposeOption[] = recommendedOptions.map((opt) => {
    const suppressedReason = suppressedByStrategy.get(opt.value);
    if (suppressedReason) {
      return {
        ...opt,
        classification: 'restricted',
        restriction_reason: suppressedReason,
        deprioritized: false,
      };
    }
    const deprReason = deprioritizedByStrategy.get(opt.value);
    if (deprReason) {
      return {
        ...opt,
        classification: 'allowed',
        restriction_reason: deprReason,
        deprioritized: true,
      };
    }
    // Recommended bucket: any non-restricted option WITH a positive
    // recommendation score. The recommendation engine has already
    // ordered these correctly.
    if (opt.score > 0) {
      return {
        ...opt,
        classification: 'recommended',
        restriction_reason: null,
        deprioritized: false,
      };
    }
    return {
      ...opt,
      classification: 'allowed',
      restriction_reason: null,
      deprioritized: false,
    };
  });

  // Stable bucket reordering — keep input order within each bucket so
  // the recommendation engine's tiebreak holds.
  const recommended: GovernedPurposeOption[] = [];
  const allowedClean: GovernedPurposeOption[] = [];
  const allowedDepr: GovernedPurposeOption[] = [];
  const restricted: GovernedPurposeOption[] = [];
  for (const opt of classified) {
    if (opt.classification === 'recommended') recommended.push(opt);
    else if (opt.classification === 'restricted') restricted.push(opt);
    else if (opt.deprioritized) allowedDepr.push(opt);
    else allowedClean.push(opt);
  }
  const allowed = [...allowedClean, ...allowedDepr];
  const options = [...recommended, ...allowed, ...restricted];

  const defaultStrategyOverride = policy.defaultStrategyOverrides[contentType] ?? null;

  return {
    options,
    recommended,
    allowed,
    restricted,
    defaultStrategyOverride,
    requiredWarnings: policy.requiredWarnings,
  };
}

/**
 * Apply the governance policy across all three content types in one
 * call. Convenience for callers that hold the full
 * `RecommendedPurposeOptionsByType` shape.
 */
export function applyStrategyGovernanceAllTypes(input: {
  recommendedByType: Record<CreatorTypeForVariant, ReadonlyArray<RecommendedPurposeOption>>;
  policy: StrategyGovernancePolicy;
}): Record<CreatorTypeForVariant, ApplyStrategyGovernanceResult> {
  const out: Record<CreatorTypeForVariant, ApplyStrategyGovernanceResult> = {
    image: applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: input.recommendedByType.image,
      policy: input.policy,
    }),
    carousel: applyStrategyGovernance({
      contentType: 'carousel',
      recommendedOptions: input.recommendedByType.carousel,
      policy: input.policy,
    }),
    infographic: applyStrategyGovernance({
      contentType: 'infographic',
      recommendedOptions: input.recommendedByType.infographic,
      policy: input.policy,
    }),
  };
  return out;
}

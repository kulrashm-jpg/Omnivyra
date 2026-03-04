/**
 * Momentum Recovery Advisor.
 * When momentum is WEAK, suggests fixes only (does not modify the plan).
 */

import {
  getWeakestContinuityPairIndex,
  type MomentumResult,
  type WeekPlanLike,
} from './executionMomentumTracker';

export type MomentumRecoveryAdvice = {
  suggestions: string[];
  recommendedActions?: {
    adjustWeeks?: number[];
    addBridgeContent?: boolean;
    increaseNarrativeDepth?: boolean;
  };
};

const MAX_SUGGESTIONS = 3;

/**
 * Generate recovery suggestions only when momentum.state === 'WEAK'.
 * Otherwise returns null.
 */
export function generateMomentumRecoverySuggestions(
  weeks: WeekPlanLike[],
  momentum: MomentumResult
): MomentumRecoveryAdvice | null {
  if (momentum.state !== 'WEAK') return null;

  const suggestions: string[] = [];
  const adjustWeeks: number[] = [];
  let addBridgeContent = false;
  let increaseNarrativeDepth = false;

  if (momentum.signals.continuity < 0.4) {
    const pairIndex = getWeakestContinuityPairIndex(weeks);
    const weekA = pairIndex + 1;
    const weekB = pairIndex + 2;
    suggestions.push(
      `Add a bridging topic between Week ${weekA} and Week ${weekB} to maintain narrative continuity.`
    );
    addBridgeContent = true;
    adjustWeeks.push(weekA, weekB);
  }

  if (momentum.signals.escalation < 0.45) {
    suggestions.push(
      'Introduce a proof-based week (case study or example) to strengthen narrative escalation.'
    );
    increaseNarrativeDepth = true;
  }

  if (momentum.signals.rhythm < 0.35) {
    suggestions.push(
      'Rebalance weekly content density to maintain campaign momentum.'
    );
    if (adjustWeeks.length === 0 && weeks.length > 0) {
      adjustWeeks.push(...weeks.map((_, i) => i + 1));
    }
  }

  const limited = suggestions.slice(0, MAX_SUGGESTIONS);
  return {
    suggestions: limited,
    recommendedActions: {
      adjustWeeks: adjustWeeks.length > 0 ? adjustWeeks.slice(0, 6) : undefined,
      addBridgeContent: addBridgeContent || undefined,
      increaseNarrativeDepth: increaseNarrativeDepth || undefined,
    },
  };
}

/**
 * Distribution Stability — read-only computation from decision timeline.
 * Evaluates week-to-week strategy change frequency (volatility). No DB, no side effects.
 */

export interface DistributionStabilityResult {
  total_weeks: number;
  strategy_switches: number;
  volatility_score: number;
  stability_level: 'STABLE' | 'MODERATE' | 'VOLATILE';
}

type TimelineItemLike = { week_number: number; resolved_strategy: string };

const STABLE_MAX = 25;
const MODERATE_MAX = 60;

/**
 * Computes stability from an ordered timeline (by week_number ASC).
 * If total_weeks < 2: returns switches=0, volatility_score=0, stability_level=STABLE.
 * Otherwise: counts strategy changes, volatility = (switches / (n-1)) * 100, level by bands.
 */
export function computeDistributionStability(
  decisions: TimelineItemLike[]
): DistributionStabilityResult {
  const fallback: DistributionStabilityResult = {
    total_weeks: 0,
    strategy_switches: 0,
    volatility_score: 0,
    stability_level: 'STABLE',
  };

  try {
    if (!Array.isArray(decisions) || decisions.length < 2) {
      return {
        ...fallback,
        total_weeks: decisions?.length ?? 0,
      };
    }

    const sorted = [...decisions].sort((a, b) => (a.week_number ?? 0) - (b.week_number ?? 0));
    const total_weeks = sorted.length;
    let strategy_switches = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = String(sorted[i - 1]?.resolved_strategy ?? '').trim();
      const curr = String(sorted[i]?.resolved_strategy ?? '').trim();
      if (prev !== curr) strategy_switches += 1;
    }

    const maxSwitches = total_weeks - 1;
    const volatility_score = maxSwitches > 0
      ? Math.round((strategy_switches / maxSwitches) * 100)
      : 0;

    let stability_level: DistributionStabilityResult['stability_level'] = 'STABLE';
    if (volatility_score > MODERATE_MAX) stability_level = 'VOLATILE';
    else if (volatility_score > STABLE_MAX) stability_level = 'MODERATE';

    return {
      total_weeks,
      strategy_switches,
      volatility_score: Math.max(0, Math.min(100, volatility_score)),
      stability_level,
    };
  } catch (_) {
    return fallback;
  }
}

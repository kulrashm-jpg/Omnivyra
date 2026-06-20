/**
 * Phase 6D-C — Adaptive platform prioritization for Intelligent Mix.
 *
 * Re-orders an ALREADY-ELIGIBLE platform list using historical performance
 * ranking. This is ORDERING ONLY: it never adds, removes, or filters platforms —
 * eligibility (connected / selected / capability / creator governance) is decided
 * upstream in boltPipelineService and is left byte-identical.
 *
 * The performance signal comes from the existing platformPerformanceRanker
 * (avg engagement). Platforms without a rank retain their original relative
 * order; static priority (the input order) is the tiebreaker. Stable sort.
 */

export type PlatformPriorityMode = 'off' | 'shadow' | 'advisory' | 'active';

/** Performance signal for one platform — higher score = better. */
export interface PlatformPerformanceRank {
  platform: string;
  score: number;
}

export interface PlatformOrderingResult {
  /** The order to USE downstream (input unless advisory/active reorders). */
  order: string[];
  /** The order the ranking WOULD produce (for shadow-mode logging). */
  proposedOrder: string[];
  /** Whether proposedOrder differs from the input order. */
  changed: boolean;
  /** How many eligible platforms had a usable rank. */
  rankingCount: number;
}

/** Normalize INTELLIGENT_MIX_PLATFORM_PRIORITY_MODE (default 'shadow'). */
export function normalizePlatformPriorityMode(raw: string | undefined | null): PlatformPriorityMode {
  const m = String(raw ?? 'shadow').toLowerCase().trim();
  return m === 'off' || m === 'shadow' || m === 'advisory' || m === 'active' ? m : 'shadow';
}

/** Prioritization runs ONLY for combined campaigns and when mode !== 'off'. */
export function shouldPrioritizePlatforms(mode: PlatformPriorityMode, isCombined: boolean): boolean {
  return isCombined && mode !== 'off';
}

function normPlatform(p: unknown): string {
  return String(p ?? '').toLowerCase().replace(/^twitter$/, 'x').trim();
}

/**
 * Order eligible platforms by performance, preserving membership exactly.
 *
 *   off      → input order unchanged (no ranking applied)
 *   shadow   → input order unchanged, but proposedOrder/changed computed for logs
 *   advisory → reordered by performance (input order is the tiebreaker)
 *   active   → same as advisory (reserved for future phases)
 *
 * Ranked platforms (those with a score) sort highest-score-first; ties and
 * unranked platforms fall back to the original (static-priority) order. The
 * result is always a permutation of `eligiblePlatforms` — nothing added or removed.
 */
export function orderPlatformsForIntelligentMix(
  eligiblePlatforms: string[],
  performanceRanks: PlatformPerformanceRank[],
  mode: PlatformPriorityMode,
): PlatformOrderingResult {
  const input = Array.isArray(eligiblePlatforms) ? [...eligiblePlatforms] : [];

  if (mode === 'off' || input.length === 0) {
    return { order: input, proposedOrder: input, changed: false, rankingCount: 0 };
  }

  // First score per platform wins (ranker already returns sorted/deduped).
  const scoreByPlatform = new Map<string, number>();
  for (const r of performanceRanks ?? []) {
    if (!r || typeof r.platform !== 'string') continue;
    const key = normPlatform(r.platform);
    if (key && !scoreByPlatform.has(key)) scoreByPlatform.set(key, Number(r.score) || 0);
  }

  const originalIndex = new Map<string, number>(input.map((p, i) => [p, i]));
  const rankingCount = input.filter((p) => scoreByPlatform.has(normPlatform(p))).length;

  const proposedOrder = [...input].sort((a, b) => {
    const sa = scoreByPlatform.get(normPlatform(a));
    const sb = scoreByPlatform.get(normPlatform(b));
    const aHas = sa !== undefined;
    const bHas = sb !== undefined;
    if (aHas && bHas) {
      if (sb !== sa) return (sb as number) - (sa as number); // higher score first
      return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0); // tiebreak: static order
    }
    if (aHas !== bHas) return aHas ? -1 : 1; // ranked before unranked
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0); // both unranked: original order
  });

  const changed = proposedOrder.some((p, i) => p !== input[i]);
  const applied = (mode === 'advisory' || mode === 'active') && rankingCount > 0 ? proposedOrder : input;

  return { order: applied, proposedOrder, changed, rankingCount };
}

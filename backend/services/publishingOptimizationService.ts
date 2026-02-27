export type ExecutionFeedbackSnapshot = {
  week_number: number;
  summary: {
    invalid_count: number;
    adjusted_count: number;
    invalid_by_platform: Record<string, number>;
    invalid_by_content_type: Record<string, number>;
    common_issues: Array<{ issue: string; count: number }>;
  };
};

export type PublishingOptimizationSummary = {
  stable_platforms: string[];
  unstable_platforms: string[];
  high_adjustment_content_types: string[];
  recommended_distribution_changes: string[];
};

function normalizeKey(s: any): string {
  return String(s || '').trim().toLowerCase();
}

function sumCounts(map: Record<string, number> | undefined | null): number {
  return Object.values(map || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function topKeys(map: Record<string, number>, limit = 3): string[] {
  return Object.entries(map || {})
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .slice(0, limit)
    .map(([k]) => k);
}

export function analyzeExecutionFeedback(feedbackHistory: ExecutionFeedbackSnapshot[]): PublishingOptimizationSummary {
  const history = Array.isArray(feedbackHistory) ? feedbackHistory.slice() : [];
  history.sort((a, b) => (a.week_number || 0) - (b.week_number || 0));

  // Consider last 3 weeks for stability heuristics.
  const recent = history.slice(-3);
  const platformInvalidTotals: Record<string, number> = {};
  const contentTypeInvalidTotals: Record<string, number> = {};
  const platformWeeksWithInvalid: Record<string, number> = {};
  let totalAdjustedRecent = 0;

  for (const snap of recent) {
    const byPlatform = snap?.summary?.invalid_by_platform || {};
    const byType = snap?.summary?.invalid_by_content_type || {};
    totalAdjustedRecent += Number(snap?.summary?.adjusted_count ?? 0) || 0;

    for (const [pRaw, countRaw] of Object.entries(byPlatform)) {
      const p = normalizeKey(pRaw);
      const c = Number(countRaw) || 0;
      if (!p) continue;
      platformInvalidTotals[p] = (platformInvalidTotals[p] ?? 0) + c;
      if (c > 0) platformWeeksWithInvalid[p] = (platformWeeksWithInvalid[p] ?? 0) + 1;
    }

    for (const [tRaw, countRaw] of Object.entries(byType)) {
      const t = normalizeKey(tRaw);
      const c = Number(countRaw) || 0;
      if (!t) continue;
      contentTypeInvalidTotals[t] = (contentTypeInvalidTotals[t] ?? 0) + c;
    }
  }

  // Stable: platforms with 0 invalids across recent snapshots.
  // Unstable: platforms that had invalids in >=2 of the recent weeks, or total invalids >=3.
  const allPlatforms = new Set<string>([
    ...Object.keys(platformInvalidTotals),
    ...Object.keys(platformWeeksWithInvalid),
  ]);

  const stable_platforms: string[] = [];
  const unstable_platforms: string[] = [];
  for (const p of allPlatforms) {
    const total = platformInvalidTotals[p] ?? 0;
    const weeks = platformWeeksWithInvalid[p] ?? 0;
    if (total === 0) stable_platforms.push(p);
    if (weeks >= 2 || total >= 3) unstable_platforms.push(p);
  }

  // High-adjustment content types: we only have invalid-by-type history in stored summary.
  // Use invalid frequency as a proxy for "needs format shift".
  const high_adjustment_content_types = topKeys(contentTypeInvalidTotals, 3);

  const recommended_distribution_changes: string[] = [];
  if (unstable_platforms.length > 0) {
    for (const p of unstable_platforms.slice(0, 3)) {
      recommended_distribution_changes.push(`Reduce allocation to "${p}" until platform rules/format mix stabilizes.`);
    }
  }

  if (totalAdjustedRecent >= 5) {
    recommended_distribution_changes.push(
      'Frequent execution adjustments detected recently; prefer shorter formats and tighter briefs to reduce trimming/placeholder debt.'
    );
  }

  if (stable_platforms.length > 0) {
    recommended_distribution_changes.push(
      `Stable validation on ${stable_platforms.slice(0, 3).join(', ')}; increase allocation confidence or move experimental formats there.`
    );
  }

  if (high_adjustment_content_types.length > 0) {
    recommended_distribution_changes.push(
      `Format shift recommended: reduce invalid-prone types (${high_adjustment_content_types.join(', ')}), prefer platform-native short formats.`
    );
  }

  return {
    stable_platforms: stable_platforms.sort(),
    unstable_platforms: Array.from(new Set(unstable_platforms)).sort(),
    high_adjustment_content_types,
    recommended_distribution_changes: Array.from(
      new Set(recommended_distribution_changes.map((s) => s.trim()).filter(Boolean))
    ).slice(0, 10),
  };
}

export function suggestPublishingStrategy(
  weeklyPlan: { weekNumber?: number; platform_allocation?: Record<string, number> } | null,
  optimizationSummary: PublishingOptimizationSummary
): {
  preferred_platforms: string[];
  reduced_platforms: string[];
  recommended_content_format_shifts: string[];
  distribution_balance_changes: string[];
} {
  const allocation = weeklyPlan?.platform_allocation || {};
  const reduced_platforms = optimizationSummary.unstable_platforms.slice(0, 5);

  // Prefer: platforms in allocation that are not unstable; fall back to stable list.
  const preferred_platforms = Object.keys(allocation)
    .map(normalizeKey)
    .filter(Boolean)
    .filter((p) => !reduced_platforms.includes(p))
    .slice(0, 5);

  const stableFallback = optimizationSummary.stable_platforms.filter((p) => !reduced_platforms.includes(p));
  const preferred = preferred_platforms.length > 0 ? preferred_platforms : stableFallback.slice(0, 5);

  const recommended_content_format_shifts: string[] = [];
  for (const t of optimizationSummary.high_adjustment_content_types) {
    recommended_content_format_shifts.push(`Prefer short-form alternatives over "${t}" when targeting constrained platforms.`);
  }

  const distribution_balance_changes: string[] = [];
  if (reduced_platforms.length > 0 && preferred.length > 0) {
    distribution_balance_changes.push(
      `Rebalance: shift some weekly volume from [${reduced_platforms.join(', ')}] to [${preferred.join(', ')}].`
    );
  }
  distribution_balance_changes.push(...optimizationSummary.recommended_distribution_changes);

  return {
    preferred_platforms: preferred,
    reduced_platforms,
    recommended_content_format_shifts: Array.from(new Set(recommended_content_format_shifts)).slice(0, 8),
    distribution_balance_changes: Array.from(new Set(distribution_balance_changes)).slice(0, 10),
  };
}


/**
 * Distribution engine — in-memory only. No persistence, no ID generation.
 * STAGGERED: spread units across the week.
 * ALL_AT_ONCE: group by topic → same day per group.
 * AUTO: when no strategy set, resolve from momentum + unit count.
 */

import type { UnifiedExecutionUnit } from './unifiedExecutionAdapter';

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/**
 * Spread units across Monday → Sunday evenly. Never overrides existing unit.day.
 * Does not change execution_id or reorder; only assigns day when missing.
 */
export function applyStaggeredDistribution(
  units: UnifiedExecutionUnit[]
): UnifiedExecutionUnit[] {
  if (!units?.length) return units;

  const result = units.map((u) => ({ ...u }));

  let dayIndex = 0;

  for (let i = 0; i < result.length; i++) {
    const unit = result[i];

    if (unit.day) continue;

    unit.day = WEEK_DAYS[dayIndex % WEEK_DAYS.length];
    dayIndex++;
  }

  return result;
}

/**
 * Group by topic (fallback: title → execution_id); assign same day to each group.
 * Never overrides existing unit.day. Preserves original order. No ID changes.
 */
export function applyAllAtOnceDistribution(
  units: UnifiedExecutionUnit[]
): UnifiedExecutionUnit[] {
  if (!units?.length) return units;

  const result = units.map((u) => ({ ...u }));

  const groups = new Map<string, UnifiedExecutionUnit[]>();

  for (const unit of result) {
    const key =
      (unit.topic && String(unit.topic).trim()) ||
      (unit.title && String(unit.title).trim()) ||
      unit.execution_id;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(unit);
  }

  let dayIndex = 0;

  for (const [, group] of groups) {
    const day = WEEK_DAYS[dayIndex % WEEK_DAYS.length];

    for (const unit of group) {
      if (!unit.day) {
        unit.day = day;
      }
    }

    dayIndex++;
  }

  return result;
}

function devLogDistribution(
  distributionStrategy: string,
  out: UnifiedExecutionUnit[],
  meta?: { explicit?: string; momentum?: string; unitCount: number }
): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log('[DistributionEngine]', {
    resolvedStrategy: distributionStrategy,
    explicit: meta?.explicit,
    momentum: meta?.momentum,
    unitCount: meta?.unitCount ?? out.length,
    units: out.map((u) => ({
      id: u.execution_id,
      topic: u.topic || u.title,
      day: u.day,
    })),
  });
}

/**
 * Resolve distribution strategy: explicit wins; else AUTO from momentum + unit count.
 */
export function resolveDistributionStrategy(
  units: UnifiedExecutionUnit[],
  week?: Record<string, unknown> | null
): 'STAGGERED' | 'ALL_AT_ONCE' {
  const explicit = week?.distribution_strategy;
  if (explicit === 'ALL_AT_ONCE') return 'ALL_AT_ONCE';
  if (explicit === 'STAGGERED') return 'STAGGERED';
  if (explicit && String(explicit).trim()) return 'STAGGERED';

  const momentum = (week?.momentum_adjustments as Record<string, unknown> | undefined)
    ?.momentum_transfer_strength;
  if (momentum === 'HIGH') return 'ALL_AT_ONCE';

  const pressureLabel = week?.pressureLabel;
  if (pressureLabel === 'HIGH') return 'ALL_AT_ONCE';

  if (units.length >= 5) return 'ALL_AT_ONCE';

  return 'STAGGERED';
}

/**
 * Apply week-level distribution strategy. Uses resolveDistributionStrategy when week is passed.
 */
export function applyDistributionForWeek(
  units: UnifiedExecutionUnit[],
  week?: Record<string, unknown> | null
): UnifiedExecutionUnit[] {
  const strategy = resolveDistributionStrategy(units, week);

  const momentum = (week?.momentum_adjustments as Record<string, unknown> | undefined)
    ?.momentum_transfer_strength;
  const meta = {
    explicit: week?.distribution_strategy as string | undefined,
    momentum: momentum as string | undefined,
    unitCount: units.length,
  };

  if (strategy === 'STAGGERED') {
    const out = applyStaggeredDistribution(units);
    devLogDistribution(strategy, out, meta);
    return out;
  }

  if (strategy === 'ALL_AT_ONCE') {
    const out = applyAllAtOnceDistribution(units);
    devLogDistribution(strategy, out, meta);
    return out;
  }

  return units;
}

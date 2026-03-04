/**
 * Distribution engine — in-memory only. No persistence, no ID generation.
 * STAGGERED: spread units across the week.
 * ALL_AT_ONCE: group by topic → same day per group.
 * AUTO: when no strategy set, resolve from momentum + unit count + optional platform quality bias.
 */

import type { UnifiedExecutionUnit } from './unifiedExecutionAdapter';
import type { StrategicMemoryProfile } from '../intelligence/strategicMemory';
import { deriveDistributionQualitySignal } from '../intelligence/distributionIntelligence';
import {
  deriveSlotAllocationAdjustments,
  deriveSlotCountAdjustment,
  getWeightForPlatform,
} from '../intelligence/slotAllocationIntelligence';

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

function uniquePlatforms(units: UnifiedExecutionUnit[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    const p = String(u?.platform ?? '').trim().toLowerCase();
    if (p) set.add(p);
  }
  return Array.from(set);
}

function normalizePlatform(p: string): string {
  return String(p ?? '').trim().toLowerCase();
}

/**
 * Reshuffle for slot-count dominance: first reduce_platform unit to end, one boost_platform unit to front if not already early.
 * Does not add/remove units; only reorders.
 */
function applySlotCountReshuffle(
  units: UnifiedExecutionUnit[],
  adjustment: { boost_platform?: string; reduce_platform?: string }
): UnifiedExecutionUnit[] {
  const boost = adjustment.boost_platform ? normalizePlatform(adjustment.boost_platform) : '';
  const reduce = adjustment.reduce_platform ? normalizePlatform(adjustment.reduce_platform) : '';
  if (!boost || !reduce) return units;

  const arr = [...units];
  const reduceIdx = arr.findIndex((u) => normalizePlatform(u.platform) === reduce);
  if (reduceIdx !== -1) {
    const [u] = arr.splice(reduceIdx, 1);
    arr.push(u);
  }
  const boostIdx = arr.findIndex((u) => normalizePlatform(u.platform) === boost);
  if (boostIdx > 0) {
    const [u] = arr.splice(boostIdx, 1);
    arr.unshift(u);
  }
  return arr;
}

export type DistributionStrategyResult = {
  strategy: 'STAGGERED' | 'ALL_AT_ONCE';
  qualityOverride: boolean;
};

/**
 * Resolve distribution strategy: explicit wins; else AUTO from momentum + unit count + optional platform quality.
 * Returns strategy and whether quality signal influenced the result (for logging).
 */
export function resolveDistributionStrategy(
  units: UnifiedExecutionUnit[],
  week?: Record<string, unknown> | null,
  memoryProfile?: StrategicMemoryProfile | null
): DistributionStrategyResult {
  const explicit = week?.distribution_strategy;
  if (explicit === 'ALL_AT_ONCE') return { strategy: 'ALL_AT_ONCE', qualityOverride: false };
  if (explicit === 'STAGGERED') return { strategy: 'STAGGERED', qualityOverride: false };
  if (explicit && String(explicit).trim()) return { strategy: 'STAGGERED', qualityOverride: false };

  const momentum = (week?.momentum_adjustments as Record<string, unknown> | undefined)
    ?.momentum_transfer_strength;
  if (momentum === 'HIGH') return { strategy: 'ALL_AT_ONCE', qualityOverride: false };

  const pressureLabel = week?.pressureLabel;
  if (pressureLabel === 'HIGH') return { strategy: 'ALL_AT_ONCE', qualityOverride: false };

  const qualitySignal = deriveDistributionQualitySignal(memoryProfile);
  const platforms = uniquePlatforms(units);
  const hasMultiplePlatforms = platforms.length >= 2;

  if (qualitySignal.strong_platforms.length >= 1 && hasMultiplePlatforms) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DistributionIntelligence]', {
        resolvedStrategy: 'STAGGERED',
        strongPlatforms: qualitySignal.strong_platforms,
        weakPlatforms: qualitySignal.weak_platforms,
        reason: 'strong_platforms + multiple platforms',
      });
    }
    return { strategy: 'STAGGERED', qualityOverride: true };
  }

  if (qualitySignal.weak_platforms.length >= 2 && units.length >= 5) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DistributionIntelligence]', {
        resolvedStrategy: 'ALL_AT_ONCE',
        strongPlatforms: qualitySignal.strong_platforms,
        weakPlatforms: qualitySignal.weak_platforms,
        reason: 'weak_platforms >= 2 + units >= 5',
      });
    }
    return { strategy: 'ALL_AT_ONCE', qualityOverride: true };
  }

  if (units.length >= 5) return { strategy: 'ALL_AT_ONCE', qualityOverride: false };

  if (process.env.NODE_ENV === 'development' && (qualitySignal.strong_platforms.length > 0 || qualitySignal.weak_platforms.length > 0)) {
    console.log('[DistributionIntelligence]', {
      resolvedStrategy: 'STAGGERED',
      strongPlatforms: qualitySignal.strong_platforms,
      weakPlatforms: qualitySignal.weak_platforms,
    });
  }
  return { strategy: 'STAGGERED', qualityOverride: false };
}

export type ApplyDistributionMeta = {
  resolvedStrategy: 'STAGGERED' | 'ALL_AT_ONCE';
  auto_detected: boolean;
  quality_override: boolean;
  slot_optimization_applied: boolean;
};

export type ApplyDistributionForWeekResult = {
  units: UnifiedExecutionUnit[];
  meta: ApplyDistributionMeta;
};

/**
 * Apply week-level distribution strategy. Uses resolveDistributionStrategy when week is passed.
 * memoryProfile optional: when set, AUTO can bias toward STAGGERED (strong platforms) or ALL_AT_ONCE (weak + many units).
 * Returns units and meta for optional logging (e.g. in daily-plans API).
 */
export function applyDistributionForWeek(
  units: UnifiedExecutionUnit[],
  week?: Record<string, unknown> | null,
  memoryProfile?: StrategicMemoryProfile | null
): ApplyDistributionForWeekResult {
  const resolved = resolveDistributionStrategy(units, week, memoryProfile);
  const strategy = resolved.strategy;

  const momentum = (week?.momentum_adjustments as Record<string, unknown> | undefined)
    ?.momentum_transfer_strength;
  const explicitStrategy = week?.distribution_strategy;
  const isAUTO = !explicitStrategy || String(explicitStrategy).trim() === '';
  const logMeta = {
    explicit: explicitStrategy as string | undefined,
    momentum: momentum as string | undefined,
    unitCount: units.length,
  };

  let slot_optimization_applied = false;

  if (strategy === 'STAGGERED') {
    let unitsToSpread = units;
    const platforms = uniquePlatforms(units);

    if (isAUTO && memoryProfile && platforms.length >= 2) {
      const adjustments = deriveSlotAllocationAdjustments(memoryProfile);
      if (adjustments.length > 0) {
        unitsToSpread = [...units].sort((a, b) => {
          const wA = getWeightForPlatform(a.platform, adjustments);
          const wB = getWeightForPlatform(b.platform, adjustments);
          return wB - wA;
        });
        if (process.env.NODE_ENV === 'development') {
          console.log('[SlotAllocationIntelligence]', { adjustments, applied: true });
        }
      }

      if (platforms.length === 2) {
        const countAdj = deriveSlotCountAdjustment(memoryProfile);
        if (countAdj?.boost_platform && countAdj?.reduce_platform) {
          unitsToSpread = applySlotCountReshuffle(unitsToSpread, countAdj);
          slot_optimization_applied = true;
          if (process.env.NODE_ENV === 'development') {
            console.log('[SlotCountOptimization]', { ...countAdj, applied: true });
          }
        }
      }
    }

    const out = applyStaggeredDistribution(unitsToSpread);
    devLogDistribution(strategy, out, logMeta);
    return {
      units: out,
      meta: {
        resolvedStrategy: strategy,
        auto_detected: isAUTO,
        quality_override: resolved.qualityOverride,
        slot_optimization_applied,
      },
    };
  }

  if (strategy === 'ALL_AT_ONCE') {
    const out = applyAllAtOnceDistribution(units);
    devLogDistribution(strategy, out, logMeta);
    return {
      units: out,
      meta: {
        resolvedStrategy: strategy,
        auto_detected: isAUTO,
        quality_override: resolved.qualityOverride,
        slot_optimization_applied: false,
      },
    };
  }

  return {
    units,
    meta: {
      resolvedStrategy: 'STAGGERED',
      auto_detected: isAUTO,
      quality_override: false,
      slot_optimization_applied: false,
    },
  };
}

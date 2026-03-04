/**
 * Slot Allocation Intelligence — re-weights units at read-time for STAGGERED distribution.
 * Phase 1: soft bias only. No DB, no blueprint mutation. Uses StrategicMemoryProfile.
 */

import type { StrategicMemoryProfile } from './strategicMemory';

export interface SlotAllocationAdjustment {
  platform: string;
  weight_multiplier: number;
}

export interface SlotCountAdjustment {
  boost_platform?: string;
  reduce_platform?: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 85;
const LOW_CONFIDENCE_THRESHOLD = 60;
const BOOST_MULTIPLIER = 1.2;
const DAMPEN_MULTIPLIER = 0.8;
const NEUTRAL_MULTIPLIER = 1.0;

/**
 * Derives per-platform weight multipliers from strategic memory (platform_confidence_average).
 * > 85 → 1.2, < 60 → 0.8, else 1.0. Used to softly bias unit ordering before day assignment.
 */
export function deriveSlotAllocationAdjustments(
  profile?: StrategicMemoryProfile | null
): SlotAllocationAdjustment[] {
  if (!profile?.platform_confidence_average || typeof profile.platform_confidence_average !== 'object') {
    return [];
  }

  const out: SlotAllocationAdjustment[] = [];

  for (const [platform, avg] of Object.entries(profile.platform_confidence_average)) {
    if (!Number.isFinite(avg)) continue;
    const v = Math.max(0, Math.min(100, avg));
    let weight_multiplier = NEUTRAL_MULTIPLIER;
    if (v > HIGH_CONFIDENCE_THRESHOLD) weight_multiplier = BOOST_MULTIPLIER;
    else if (v < LOW_CONFIDENCE_THRESHOLD) weight_multiplier = DAMPEN_MULTIPLIER;
    out.push({ platform: String(platform).trim().toLowerCase(), weight_multiplier });
  }

  return out;
}

/**
 * Returns weight for a platform from adjustments list. Default 1.0 if not in list.
 */
export function getWeightForPlatform(
  platform: string,
  adjustments: SlotAllocationAdjustment[]
): number {
  const key = String(platform ?? '').trim().toLowerCase();
  if (!key) return NEUTRAL_MULTIPLIER;
  const adj = adjustments.find((a) => a.platform === key);
  return adj?.weight_multiplier ?? NEUTRAL_MULTIPLIER;
}

const SLOT_COUNT_HIGH = 85;
const SLOT_COUNT_LOW = 60;
const SLOT_COUNT_MIN_DIFF = 25;

/**
 * When highest platform confidence > 85, lowest < 60, and difference > 25,
 * returns boost_platform (highest) and reduce_platform (lowest) for slot dominance reshuffle.
 * Else null. Conservative v1: no unit creation/removal.
 */
export function deriveSlotCountAdjustment(
  profile?: StrategicMemoryProfile | null
): SlotCountAdjustment | null {
  if (!profile?.platform_confidence_average || typeof profile.platform_confidence_average !== 'object') {
    return null;
  }

  const entries = Object.entries(profile.platform_confidence_average)
    .filter(([, v]) => Number.isFinite(v))
    .map(([p, v]) => ({ platform: String(p).trim().toLowerCase(), avg: Math.max(0, Math.min(100, v)) }));

  if (entries.length < 2) return null;

  const sorted = [...entries].sort((a, b) => b.avg - a.avg);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];
  const diff = highest.avg - lowest.avg;

  if (highest.avg <= SLOT_COUNT_HIGH || lowest.avg >= SLOT_COUNT_LOW || diff <= SLOT_COUNT_MIN_DIFF) {
    return null;
  }

  return {
    boost_platform: highest.platform,
    reduce_platform: lowest.platform,
  };
}

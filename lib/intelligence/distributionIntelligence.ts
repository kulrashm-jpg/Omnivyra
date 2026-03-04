/**
 * Distribution Intelligence — uses strategic memory (platform confidence) to bias AUTO distribution.
 * Phase 1: additive only. No DB, no schema. Explicit strategy and HIGH momentum always win.
 */

import type { StrategicMemoryProfile } from './strategicMemory';

export interface DistributionQualitySignal {
  strong_platforms: string[];
  weak_platforms: string[];
}

const STRONG_THRESHOLD = 80;
const WEAK_THRESHOLD = 60;

/**
 * Derives strong/weak platform lists from profile's platform_confidence_average (0–100).
 * Missing profile → empty arrays. Platforms with no data are omitted from profile already.
 */
export function deriveDistributionQualitySignal(
  profile?: StrategicMemoryProfile | null
): DistributionQualitySignal {
  const strong_platforms: string[] = [];
  const weak_platforms: string[] = [];

  if (!profile?.platform_confidence_average || typeof profile.platform_confidence_average !== 'object') {
    return { strong_platforms, weak_platforms };
  }

  for (const [platform, avg] of Object.entries(profile.platform_confidence_average)) {
    if (!Number.isFinite(avg)) continue;
    const v = Math.max(0, Math.min(100, avg));
    if (v > STRONG_THRESHOLD) strong_platforms.push(platform);
    else if (v < WEAK_THRESHOLD) weak_platforms.push(platform);
  }

  return { strong_platforms, weak_platforms };
}

/**
 * Planning Intelligence Layer (STAGE 3).
 * Decides distribution strategy (AI_OPTIMIZED | STAGGERED | QUICK_LAUNCH) from campaign context.
 * Additive; does not replace or alter existing planning logic.
 */

export type DistributionStrategy = 'AI_OPTIMIZED' | 'STAGGERED' | 'QUICK_LAUNCH';

export interface DistributionStrategyResult {
  strategy: DistributionStrategy;
  reason: string;
}

export interface DetermineDistributionStrategyInput {
  /** Campaign duration in weeks. */
  campaignDurationWeeks?: number | null;
  /** Weekly content production capacity (total pieces per week). */
  weekly_capacity_total?: number | null;
  /** Weekly capacity (alias). */
  weeklyCapacity?: number | null;
  /** Requested total (unique pieces per week from validation). */
  requested_total?: number | null;
  /** Posting demand (alias). */
  postingDemand?: number | null;
  /** Number of platforms (e.g. linkedin, facebook). */
  platformCount?: number | null;
  /** Whether cross-platform reuse is enabled. { enabled: boolean } or boolean. undefined → shared mode. */
  cross_platform_sharing?: { enabled?: boolean } | boolean | null;
  /** Alias. */
  crossPlatformReuse?: boolean | null;
  /** Content types (e.g. post, video, article). */
  contentTypes?: string[] | null;
  /** Campaign intent / objective (optional, for future rules). */
  campaignIntent?: string | null;
}

const DEFAULT_STRATEGY: DistributionStrategy = 'AI_OPTIMIZED';

function resolveCrossPlatformSharing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.enabled === 'boolean') return obj.enabled;
    if (obj.enabled === undefined && (obj as any).mode === 'unique') return false;
  }
  return true;
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function toPlatformCount(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return Object.keys(v as Record<string, unknown>).length;
  }
  return 0;
}

/**
 * Determines distribution strategy from campaign context (STAGE 3 rules).
 * Returns strategy plus a human-readable reason. No logic changes; explanation only.
 *
 * Decision order: QUICK_LAUNCH conditions first, then STAGGERED, then AI_OPTIMIZED.
 */
export function determineDistributionStrategy(
  input: DetermineDistributionStrategyInput
): DistributionStrategyResult {
  const durationWeeks = toNumber(input.campaignDurationWeeks);
  const weeklyCapacityTotal =
    toNumber(input.weekly_capacity_total) || toNumber(input.weeklyCapacity);
  const requestedTotal =
    toNumber(input.requested_total) || toNumber(input.postingDemand);
  const platformCount = toPlatformCount(input.platformCount);
  const crossPlatformSharing = resolveCrossPlatformSharing(
    input.cross_platform_sharing ?? input.crossPlatformReuse
  );

  // --- QUICK_LAUNCH ---
  if (durationWeeks <= 1) {
    return {
      strategy: 'QUICK_LAUNCH',
      reason: 'Short campaign duration detected → Quick Launch selected.',
    };
  }

  const capacityNum = weeklyCapacityTotal > 0 ? weeklyCapacityTotal : 1;
  if (requestedTotal > capacityNum * 1.5) {
    return {
      strategy: 'QUICK_LAUNCH',
      reason: 'Posting demand exceeds capacity threshold → Quick Launch selected.',
    };
  }

  // --- STAGGERED ---
  if (crossPlatformSharing && platformCount >= 2) {
    return {
      strategy: 'STAGGERED',
      reason: 'Cross-platform reuse across multiple platforms detected → Staggered distribution selected.',
    };
  }

  // --- AI_OPTIMIZED (default) ---
  return {
    strategy: DEFAULT_STRATEGY,
    reason: 'Standard campaign conditions detected → AI Optimized scheduling selected.',
  };
}

/**
 * Phase 2 — Deterministic credit-burn estimation for autonomous listening.
 *
 * Pure function. Same inputs always produce the same outputs. No I/O.
 *
 * The estimate is INTENTIONALLY a min–max range, never a single number, so
 * the UI cannot claim precision the model does not have. The activation
 * confirmation surface in Phase 2 displays both bounds plus a "per-run"
 * figure so the user can see how the bill scales with each frequency tick.
 *
 * Hashing: every estimate produces a stable `estimate_hash` that the
 * activation endpoint requires the client to echo back. This prevents a
 * stale dialog (e.g. user opened the modal yesterday) from confirming an
 * estimate that no longer reflects current platform/keyword/industry state.
 */

import { createHash } from 'crypto';
import { normalizePlatform } from '../constants/platforms';
import {
  FREQUENCY_RUNS_PER_MONTH,
  type IndustryVolatility,
  type ListeningMode,
} from '../types/listeningConfiguration';

// Per-platform per-execution base cost in credit units. Conservative defaults;
// tuning happens in a later phase against real execution data. Phase 2 just
// needs the relative ordering to be plausible so the UI guidance is sound.
const PLATFORM_BASE_COST: Record<string, number> = {
  linkedin: 8,
  x: 4,
  twitter: 4,
  reddit: 3,
  facebook: 6,
  instagram: 6,
  threads: 5,
  youtube: 5,
  tiktok: 5,
  pinterest: 4,
  hackernews: 2,
};

const PLATFORM_FALLBACK_COST = 4;

// Keyword count scales cost sublinearly: a config with 50 keywords costs
// noticeably more than 1, but not 50x more.
function keywordMultiplier(keywordCount: number): number {
  if (!Number.isFinite(keywordCount) || keywordCount <= 0) return 1.0;
  return 1 + Math.log10(keywordCount + 1) * 0.5;
}

// Industry volatility produces a min/max spread around the deterministic
// expected cost. High-volatility industries surface more matches per scan
// (and therefore more downstream credit consumption); low-volatility
// industries trend below the expected value.
const VOLATILITY_SPREAD: Record<IndustryVolatility, { min: number; max: number }> = {
  high: { min: 1.0, max: 1.4 },
  moderate: { min: 0.9, max: 1.15 },
  low: { min: 0.8, max: 1.0 },
};

const DEFAULT_VOLATILITY: IndustryVolatility = 'moderate';

export type CreditEstimateInput = {
  mode: ListeningMode;
  platforms: string[];
  keywordCount: number;
  industryVolatility?: IndustryVolatility | null;
  sourceCount?: number;
};

export type CreditEstimate = {
  per_run: number;
  runs_per_month: number;
  monthly_min: number;
  monthly_max: number;
  monthly_expected: number;
  industry_volatility: IndustryVolatility;
  high_activity_warning: boolean;
  estimate_hash: string;
  inputs_snapshot: {
    mode: ListeningMode;
    platforms: string[];
    keyword_count: number;
    industry_volatility: IndustryVolatility;
    source_count: number;
  };
};

/**
 * Estimate credits. Deterministic; bounds are intentionally explicit.
 */
export function estimateCredits(input: CreditEstimateInput): CreditEstimate {
  const mode = input.mode;
  const volatility = input.industryVolatility ?? DEFAULT_VOLATILITY;
  const keywordCount = Math.max(0, Math.floor(input.keywordCount ?? 0));
  const sourceCount = Math.max(0, Math.floor(input.sourceCount ?? 0));
  const platforms = [...new Set((input.platforms ?? []).map((p) => normalizePlatform(p)))].sort();

  const perRun = Math.round(
    platforms.reduce((sum, p) => sum + (PLATFORM_BASE_COST[p] ?? PLATFORM_FALLBACK_COST), 0)
      * keywordMultiplier(keywordCount),
  );

  const runsPerMonth = FREQUENCY_RUNS_PER_MONTH[mode];
  const spread = VOLATILITY_SPREAD[volatility];

  const monthlyExpected = perRun * runsPerMonth;
  const monthlyMin = Math.round(monthlyExpected * spread.min);
  const monthlyMax = Math.round(monthlyExpected * spread.max);

  const inputsSnapshot = {
    mode,
    platforms,
    keyword_count: keywordCount,
    industry_volatility: volatility,
    source_count: sourceCount,
  };
  const estimateHash = createHash('sha256')
    .update(JSON.stringify(inputsSnapshot))
    .digest('hex')
    .slice(0, 24);

  return {
    per_run: perRun,
    runs_per_month: runsPerMonth,
    monthly_min: monthlyMin,
    monthly_max: monthlyMax,
    monthly_expected: Math.round(monthlyExpected),
    industry_volatility: volatility,
    // The orchestration service will refuse to plan a run if the projected
    // monthly burn exceeds the user-set ceiling; the UI uses this flag to
    // warn at configuration time, before activation.
    high_activity_warning: volatility === 'high' && runsPerMonth >= 15,
    estimate_hash: estimateHash,
    inputs_snapshot: inputsSnapshot,
  };
}

/**
 * Convenience: verifies that the client-supplied `estimate_hash` was produced
 * by these exact inputs. The activation endpoint uses this to refuse stale
 * confirmation tokens.
 */
export function verifyEstimateHash(
  input: CreditEstimateInput,
  expectedHash: string,
): boolean {
  return estimateCredits(input).estimate_hash === expectedHash;
}

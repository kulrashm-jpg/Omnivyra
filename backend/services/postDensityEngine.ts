/**
 * Post Density Engine
 * Determines post frequency per week based on campaign signals.
 * Rule-based, deterministic, no LLM.
 */

export type MomentumLevel = 'low' | 'normal' | 'high';
export type PressureLevel = 'low' | 'normal' | 'high';

export type DensityInput = {
  campaignDurationWeeks: number;
  momentumLevel: MomentumLevel;
  pressureLevel: PressureLevel;
};

const MIN_POSTS = 2;
const MAX_POSTS = 7;

/**
 * Determine posts per week from campaign signals.
 * Base: low→2, normal→3, high→5. Pressure: low→-1, normal→0, high→+1.
 * Result clamped to 2–7.
 */
export function determinePostsPerWeek(input: DensityInput): number {
  const base =
    input.momentumLevel === 'high' ? 5 :
    input.momentumLevel === 'normal' ? 3 : 2;

  const pressureAdjust =
    input.pressureLevel === 'high' ? 1 :
    input.pressureLevel === 'low' ? -1 : 0;

  const posts = base + pressureAdjust;
  return Math.max(MIN_POSTS, Math.min(posts, MAX_POSTS));
}

/**
 * Derive momentum level from numeric score (e.g. from strategic_themes.momentum_score).
 * 0–0.4: low, 0.4–0.7: normal, 0.7–1: high.
 */
export function momentumScoreToLevel(score: number | null | undefined): MomentumLevel {
  if (score == null || typeof score !== 'number') return 'normal';
  if (score < 0.4) return 'low';
  if (score >= 0.7) return 'high';
  return 'normal';
}

/**
 * Derive pressure level from string or config. Default: normal.
 */
export function pressureConfigToLevel(config: string | undefined): PressureLevel {
  if (!config || typeof config !== 'string') return 'normal';
  const lower = config.toLowerCase().trim();
  if (lower === 'high' || lower === 'urgent') return 'high';
  if (lower === 'low' || lower === 'relaxed') return 'low';
  return 'normal';
}

/**
 * BOLT integration example:
 *
 * When generating weekly execution plans, derive signals and call:
 *
 * ```ts
 * import { determinePostsPerWeek, momentumScoreToLevel, pressureConfigToLevel } from './postDensityEngine';
 *
 * const momentumLevel = momentumScoreToLevel(sourceStrategicTheme?.momentum_score);
 * const pressureLevel = pressureConfigToLevel(executionConfig?.pressure);
 * const postsPerWeek = determinePostsPerWeek({
 *   campaignDurationWeeks: plan.weeks?.length ?? 12,
 *   momentumLevel,
 *   pressureLevel,
 * });
 * // Pass postsPerWeek to daily slot creation (e.g. spreadEvenlyAcrossDays(postsPerWeek, 7))
 * ```
 */

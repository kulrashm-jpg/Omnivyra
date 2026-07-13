/**
 * recommendationMigrationFlag.ts — reversible Recommendation Engine migration flag (PMF-007 §11).
 *
 * Follows the repo's env `*_RUNTIME` convention (CONTENT_WRITER_RUNTIME,
 * LONG_FORM_RUNTIME, CREATOR_RUNTIME, CAMPAIGN_PLANNER_RUNTIME, STRATEGIC_MIX_RUNTIME).
 * Selects which runtime serves recommendations; reversible with a single env change —
 * no code/schema change. DEFAULT is 'legacy'; the platform path becomes default only
 * after parity is validated.
 *
 *   legacy   — the existing recommendation engine only (unchanged behavior).
 *   platform — execute through the Recommendation AIA agent (AIA orchestration of the
 *              Recommendation Graph + AIC execution + CKC knowledge), the existing
 *              engine preserved as the backend.
 *   dual     — run the platform path; on ANY failure fall back to legacy (serve the
 *              legacy recommendations) for parity validation with zero risk.
 */

export type RecommendationRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<RecommendationRuntimeMode>(['legacy', 'platform', 'dual']);

export function getRecommendationRuntimeMode(): RecommendationRuntimeMode {
  const raw = String(process.env.RECOMMENDATION_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as RecommendationRuntimeMode) ? (raw as RecommendationRuntimeMode) : 'legacy';
}

/** Whether the platform (agent) path should execute for a mode. */
export function shouldRunPlatform(mode: RecommendationRuntimeMode = getRecommendationRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether legacy is the guaranteed served/fallback path (legacy + dual). */
export function legacyIsSafetyNet(mode: RecommendationRuntimeMode = getRecommendationRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}

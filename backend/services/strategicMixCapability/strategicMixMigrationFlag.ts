/**
 * strategicMixMigrationFlag.ts — reversible Strategic Mix migration flag (PMF-006 §10).
 *
 * Follows the repo's env `*_RUNTIME` convention (CONTENT_WRITER_RUNTIME,
 * LONG_FORM_RUNTIME, CREATOR_RUNTIME, CAMPAIGN_PLANNER_RUNTIME). Selects which
 * runtime serves the strategic mix; reversible with a single env change — no
 * code/schema change. DEFAULT is 'legacy'; the platform path becomes default only
 * after parity is validated.
 *
 *   legacy   — the existing strategic-mix engine only (unchanged behavior).
 *   platform — execute through the Strategic Mix AIA agent (AIA orchestration of the
 *              Decision Graph + AIC execution + CKC knowledge), the existing engine
 *              preserved as the backend.
 *   dual     — run the platform path; on ANY failure fall back to legacy (serve the
 *              legacy mix) for parity validation with zero risk.
 */

export type StrategicMixRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<StrategicMixRuntimeMode>(['legacy', 'platform', 'dual']);

export function getStrategicMixRuntimeMode(): StrategicMixRuntimeMode {
  const raw = String(process.env.STRATEGIC_MIX_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as StrategicMixRuntimeMode) ? (raw as StrategicMixRuntimeMode) : 'legacy';
}

/** Whether the platform (agent) path should execute for a mode. */
export function shouldRunPlatform(mode: StrategicMixRuntimeMode = getStrategicMixRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether legacy is the guaranteed served/fallback path (legacy + dual). */
export function legacyIsSafetyNet(mode: StrategicMixRuntimeMode = getStrategicMixRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}

/**
 * longFormMigrationFlag.ts — reversible Long-form migration flag (PMF-003 §10).
 *
 * Follows the repo's env `*_RUNTIME` convention (see CONTENT_WRITER_RUNTIME). Selects
 * which runtime serves long-form generation; reversible with a single env change.
 * DEFAULT is 'legacy' — the platform path becomes default only after parity is
 * validated.
 *
 *   legacy   — the existing engine path only (unchanged behavior).
 *   platform — execute through the platform runtime (AIC pipeline + PMF-002 + CKC),
 *              engine inference preserved as the backend.
 *   dual     — run the platform path; on ANY divergence/failure fall back to legacy
 *              (serve legacy result), for parity validation with zero risk.
 */

export type LongFormRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<LongFormRuntimeMode>(['legacy', 'platform', 'dual']);

export function getLongFormRuntimeMode(): LongFormRuntimeMode {
  const raw = String(process.env.LONG_FORM_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as LongFormRuntimeMode) ? (raw as LongFormRuntimeMode) : 'legacy';
}

/** Whether the platform runtime path should execute for a mode. */
export function shouldRunPlatform(mode: LongFormRuntimeMode = getLongFormRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether legacy is the guaranteed served/fallback path (legacy + dual). */
export function legacyIsSafetyNet(mode: LongFormRuntimeMode = getLongFormRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}

/**
 * creatorMigrationFlag.ts — reversible Content Creator migration flag (PMF-004 §10).
 *
 * Follows the repo's env `*_RUNTIME` convention (CONTENT_WRITER_RUNTIME,
 * LONG_FORM_RUNTIME). Selects which runtime serves Content Creator asset
 * generation; reversible with a single env change — no code/schema change. DEFAULT
 * is 'legacy'; the platform path becomes default only after parity is validated.
 *
 *   legacy   — the existing creator/asset path only (unchanged behavior).
 *   platform — execute through the platform runtime (AIC pipeline + CKC knowledge),
 *              the existing asset pipeline preserved as the generation backend.
 *   dual     — run the platform path; on ANY failure fall back to legacy (serve
 *              legacy result) for parity validation with zero risk.
 */

export type CreatorRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<CreatorRuntimeMode>(['legacy', 'platform', 'dual']);

export function getCreatorRuntimeMode(): CreatorRuntimeMode {
  const raw = String(process.env.CREATOR_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as CreatorRuntimeMode) ? (raw as CreatorRuntimeMode) : 'legacy';
}

/** Whether the platform runtime path should execute for a mode. */
export function shouldRunPlatform(mode: CreatorRuntimeMode = getCreatorRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether legacy is the guaranteed served/fallback path (legacy + dual). */
export function legacyIsSafetyNet(mode: CreatorRuntimeMode = getCreatorRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}

/**
 * contentWriterMigrationFlag.ts — reversible Content Writer migration flag (PMF-001 §11).
 *
 * Follows the repo's env `*_MODE` convention (e.g. PLANNER_CONTRACT_ENFORCEMENT_MODE).
 * The flag selects which runtime serves Content Writer, and is reversible with a
 * single env change — no code change, no schema change. DEFAULT is 'legacy' so the
 * new runtime only becomes the default after parity is confirmed.
 *
 *   legacy   — the existing inference path only (unchanged behavior).
 *   platform — the migrated CKC-01 + AIC-001 path only.
 *   dual     — run BOTH; SERVE legacy (zero regression) and shadow-compare the
 *              platform path for parity validation (dual-run validation).
 *
 * Safe rollback: set CONTENT_WRITER_RUNTIME=legacy (or unset) to fully revert.
 */

export type ContentWriterRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<ContentWriterRuntimeMode>(['legacy', 'platform', 'dual']);

/** Resolve the runtime mode from env. Unknown/absent → 'legacy' (safe default). */
export function getContentWriterRuntimeMode(): ContentWriterRuntimeMode {
  const raw = String(process.env.CONTENT_WRITER_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as ContentWriterRuntimeMode) ? (raw as ContentWriterRuntimeMode) : 'legacy';
}

/** Which path's result is SERVED to the user for a given mode. */
export function servedRuntime(mode: ContentWriterRuntimeMode = getContentWriterRuntimeMode()): 'legacy' | 'platform' {
  return mode === 'platform' ? 'platform' : 'legacy'; // dual serves legacy (zero regression)
}

/** Whether the platform (migrated) path should execute at all (served or shadow). */
export function shouldRunPlatform(mode: ContentWriterRuntimeMode = getContentWriterRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether the legacy path should execute (served or as the dual baseline). */
export function shouldRunLegacy(mode: ContentWriterRuntimeMode = getContentWriterRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}

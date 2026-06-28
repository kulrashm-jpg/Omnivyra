/**
 * Creator Runtime Feature Flag (CREATOR-PROD-001). One flag governs the live
 * cutover. Default OFF → legacy runtime, zero behaviour change. `shadow` → legacy
 * renders while the deterministic runtime runs silently for parity logging.
 * `on` → deterministic runtime. Rollback is instant: unset/`off` restores legacy.
 *   CREATOR_RUNTIME_V2 = off (default) | shadow | on
 */

export type CreatorRuntimeMode = 'off' | 'shadow' | 'on';

/** Resolve the runtime mode. `override` (dev/tests) wins; server reads
 * CREATOR_RUNTIME_V2, the browser reads NEXT_PUBLIC_CREATOR_RUNTIME_V2. */
export function creatorRuntimeMode(override?: string | null): CreatorRuntimeMode {
  const raw = (override ?? process.env.CREATOR_RUNTIME_V2 ?? process.env.NEXT_PUBLIC_CREATOR_RUNTIME_V2 ?? 'off').toString().trim().toLowerCase();
  if (raw === 'on' || raw === 'true' || raw === '1' || raw === 'enabled') return 'on';
  if (raw === 'shadow') return 'shadow';
  return 'off';
}

/** True when the deterministic runtime should run at all (shadow OR on). */
export function creatorRuntimeV2Enabled(override?: string | null): boolean {
  return creatorRuntimeMode(override) !== 'off';
}

/** True only when the deterministic runtime should drive the user-visible output. */
export function creatorRuntimeV2Live(override?: string | null): boolean {
  return creatorRuntimeMode(override) === 'on';
}

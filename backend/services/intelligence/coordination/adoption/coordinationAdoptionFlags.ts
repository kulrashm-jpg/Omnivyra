/**
 * Coordination Adoption — feature flags (OMNI-COORD / WS-2A, Zone A2).
 *
 * A three-state mode so a consumer (Engagement first) can adopt the certified
 * Coordination Platform WITHOUT any runtime behavior change:
 *
 *   off    (default) — the adoption hook is a complete no-op; nothing runs.
 *   shadow           — lookups + duplicate-intent detection run and are recorded,
 *                       but replies are NEVER modified, blocked, or delayed
 *                       (fire-and-forget). Transport + observability only.
 *   active           — RESERVED for a future wave where the reply generator may
 *                       consume the semantic context. It currently behaves exactly
 *                       like `shadow` (still no behavior change) so the flag can be
 *                       staged ahead of the consuming code.
 *
 * Matches the repo convention (strict env read, default-closed).
 */

export type CoordinationAdoptionMode = 'off' | 'shadow' | 'active';

export const COORDINATION_ADOPTION_MODE_ENV_VAR = 'COORDINATION_ADOPTION_MODE';

/** Resolve the adoption mode. Anything unrecognized (incl. unset) ⇒ 'off'. */
export function getCoordinationAdoptionMode(): CoordinationAdoptionMode {
  const raw = String(process.env[COORDINATION_ADOPTION_MODE_ENV_VAR] ?? '').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'active') return 'active';
  return 'off';
}

/** True when the adoption hook should run (shadow or active). OFF ⇒ false. */
export function isCoordinationAdoptionEnabled(): boolean {
  return getCoordinationAdoptionMode() !== 'off';
}

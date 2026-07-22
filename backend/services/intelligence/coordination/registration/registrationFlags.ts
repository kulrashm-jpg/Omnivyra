/**
 * Canonical Registration — feature flags (WS-2B, Zone A2).
 *
 *   off    (default) — `registerCommunication` performs NO write; it still derives
 *                       the semantic root id + idempotency key and returns a
 *                       `skipped` outcome, so a call site can be adopted safely
 *                       before the pipeline is enabled.
 *   shadow           — full pipeline runs (root ensure + idempotent registry write
 *                       + observability); durable persistence still depends on
 *                       COORDINATION_REGISTRY_PERSIST_ENABLED (in-memory otherwise).
 *   active           — reserved; identical to `shadow` today.
 *
 * Default-closed, strict env read (repo convention).
 */

export type RegistrationMode = 'off' | 'shadow' | 'active';

export const COORDINATION_REGISTRATION_MODE_ENV_VAR = 'COORDINATION_REGISTRATION_MODE';

export function getRegistrationMode(): RegistrationMode {
  const raw = String(process.env[COORDINATION_REGISTRATION_MODE_ENV_VAR] ?? '').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'active') return 'active';
  return 'off';
}

/** True when the pipeline should perform writes (shadow or active). */
export function isRegistrationEnabled(): boolean {
  return getRegistrationMode() !== 'off';
}

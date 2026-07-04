/**
 * Canonical Setup event channel.
 * ------------------------------
 * Every action that changes Workspace Setup state dispatches ONE canonical
 * window event (`setup:changed`) carrying a typed `reason`. The command-center
 * hook subscribes once and re-evaluates Setup immediately — window focus /
 * visibility are demoted to a recovery fallback, not the primary sync path.
 *
 * There is a single dispatcher and a single subscription helper here so there
 * are no duplicated/ad-hoc listeners scattered across the app.
 */

export const SETUP_CHANGED_EVENT = 'setup:changed';

/** Legacy event kept for back-compat; folded into the canonical channel. */
export const LEGACY_COMPANY_PROFILE_UPDATED = 'company-profile-updated';

export type SetupChangeReason =
  | 'company-updated'
  | 'website-connected'
  | 'social-connected'
  | 'social-disconnected'
  | 'integration-configured'
  | 'integration-removed'
  | 'extension-installed'
  | 'extension-removed'
  | 'api-key-updated'
  | 'team-changed'
  | 'organization-changed';

export interface SetupChangeDetail {
  reason: SetupChangeReason;
  [key: string]: unknown;
}

/** Emit a canonical Setup-changed event. No-op during SSR. */
export function emitSetupChanged(reason: SetupChangeReason, detail?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SetupChangeDetail>(SETUP_CHANGED_EVENT, { detail: { reason, ...detail } }),
  );
}

/**
 * Subscribe to canonical Setup changes. Returns an unsubscribe function.
 * Also bridges the pre-existing `company-profile-updated` event so older
 * emitters keep working through the single canonical path.
 */
export function onSetupChanged(handler: (reason: SetupChangeReason) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const canonical = (event: Event) => {
    const detail = (event as CustomEvent<SetupChangeDetail>).detail;
    handler(detail?.reason ?? 'company-updated');
  };
  const legacy = () => handler('company-updated');

  window.addEventListener(SETUP_CHANGED_EVENT, canonical as EventListener);
  window.addEventListener(LEGACY_COMPANY_PROFILE_UPDATED, legacy as EventListener);

  return () => {
    window.removeEventListener(SETUP_CHANGED_EVENT, canonical as EventListener);
    window.removeEventListener(LEGACY_COMPANY_PROFILE_UPDATED, legacy as EventListener);
  };
}

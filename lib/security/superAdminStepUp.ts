/**
 * superAdminStepUp — centralized step-up handler for the super-admin
 * surface.
 *
 * Phase 2 — Step-Up UX Foundation. Composes:
 *   1. classifyAuthFailure — already inspects the response.
 *   2. triggerWebAuthnStepUp — already mints the step-up session.
 *   3. retryAfterStepUp — re-fires the original request once and
 *      re-classifies the response.
 *
 * Caller pattern:
 *
 *   const initial = await fetchWithAuth(url, opts);
 *   const outcome = await runStepUpFlowIfNeeded(initial, () => fetchWithAuth(url, opts));
 *   if (outcome.kind === 'success') return outcome.response;
 *   if (outcome.kind === 'auth_banner') showBanner(outcome.failure);
 *   if (outcome.kind === 'session_lost') redirectToLogin();
 *
 * The handler preserves UI state — it does NOT log the operator out for
 * STEP_UP_REQUIRED, TRUSTED_DEVICE_REQUIRED, or PHISHING_RESISTANT
 * failures. It only proposes redirect when the underlying session is
 * truly lost (`not_authenticated`).
 *
 * It does NOT install global shortcuts, alter the page chrome, or change
 * the user's tab. The component owns the banner; this helper only
 * decides what kind to show.
 */

import {
  triggerWebAuthnStepUp,
  type WebAuthnStepUpResult,
} from './stepUpClient';

/**
 * Trust the current browser as a trusted_device. Idempotent (409
 * ALREADY_TRUSTED counts as success). The PHISHING_RESISTANT_TRUSTED_TENMIN
 * policy that gates SUPER_ADMIN platform-OAuth mutations requires BOTH a
 * fresh step-up session AND a trusted_devices row matching the request
 * fingerprint. Calling /api/auth/devices/trust immediately after a
 * successful passkey ceremony folds the second requirement into the same
 * gesture as the first.
 */
async function ensureCurrentDeviceTrusted(): Promise<void> {
  try {
    await fetch('/api/auth/devices/trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
  } catch {
    /* non-fatal — the retry below will surface the real issue if any */
  }
}
import {
  classifyAuthFailure,
  type AuthFailure,
} from './superAdminAuthFailure';

export type StepUpOutcome =
  | { kind: 'success'; response: Response }
  | { kind: 'auth_banner'; failure: AuthFailure; response: Response }
  | { kind: 'session_lost'; failure: AuthFailure; response: Response }
  | { kind: 'step_up_user_cancelled'; failure: AuthFailure; response: Response }
  | { kind: 'step_up_unavailable'; failure: AuthFailure; response: Response; reason: string };

export interface StepUpHookOptions {
  /**
   * Called immediately before the WebAuthn challenge so the page can
   * record it (telemetry, banner state). Synchronous to keep the
   * passkey prompt close to the user gesture.
   */
  onChallengeStart?: (failure: AuthFailure) => void;
  /** Called after a successful step-up + retry. */
  onElevated?: (result: WebAuthnStepUpResult) => void;
  /**
   * If true (default), retry the original request once after step-up
   * succeeds. Caller may want to re-fetch differently — pass false to
   * receive the StepUpOutcome and re-fire on its own.
   */
  retryOnce?: boolean;
}

/**
 * Inspect a fetch response. If it requires step-up AND the user can
 * complete it, run the WebAuthn challenge and retry once. Returns a
 * StepUpOutcome the caller can branch on without re-implementing
 * classify+retry.
 *
 * `retry` should re-issue the SAME request the caller just made — the
 * helper has no way to clone the original (Response body may already be
 * consumed for content-type peek).
 */
export async function runStepUpFlowIfNeeded(
  initial: Response,
  retry: () => Promise<Response>,
  options: StepUpHookOptions = {},
): Promise<StepUpOutcome> {
  const failure = await classifyAuthFailure(initial);

  if (failure.kind === 'ok') {
    return { kind: 'success', response: initial };
  }

  if (failure.kind === 'not_authenticated') {
    return { kind: 'session_lost', failure, response: initial };
  }

  // For step-up-eligible failures, attempt the WebAuthn flow.
  if (failure.kind === 'step_up_required' || failure.kind === 'trusted_device_required') {
    if (options.onChallengeStart) {
      try { options.onChallengeStart(failure); } catch { /* ignore */ }
    }

    let elevated: WebAuthnStepUpResult;
    try {
      // Mint an UNSCOPED step-up session (scopedCapability=null) so the
      // operator's next platform-admin operation within the
      // PHISHING_RESISTANT_TRUSTED_TENMIN policy's freshness window
      // proceeds without another passkey prompt. Server-side,
      // fetchStepUpState in IdentityResolver does not filter by
      // scoped_capability — any active step-up session for the user's
      // current auth_session satisfies decideCapabilityWithStepUp. The
      // capability surfaced on the 401 was useful for telemetry but
      // narrowing the elevation to that exact value produced the
      // repeated-prompt cycle every save+toggle+save was hitting.
      //
      // Mirrors the fix already shipped in withStepUp last turn. Both
      // helpers now mint unscoped sessions and share the same
      // in-flight-ceremony dedup at the triggerWebAuthnStepUp source.
      elevated = await triggerWebAuthnStepUp({ scopedCapability: null });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Distinguish user cancellation (normal) from infrastructure
      // failure (passkey absent / browser unsupported / verify endpoint
      // returned non-2xx).
      const lower = errMsg.toLowerCase();
      if (lower.includes('user cancel') || lower.includes('aborterror') || lower.includes('notallowederror')) {
        return { kind: 'step_up_user_cancelled', failure, response: initial };
      }
      return { kind: 'step_up_unavailable', failure, response: initial, reason: errMsg };
    }

    // After a successful passkey ceremony, also establish the current
    // browser as a trusted device. The platform-OAuth admin policy
    // requires BOTH step-up + trusted-device — without this call, the
    // retry would still 401 with TRUSTED_DEVICE_REQUIRED (which the
    // server collapses into STEP_UP_REQUIRED on the wire), producing
    // an unsolvable loop where each retry triggers another passkey
    // ceremony that never adds the trusted_devices row. The endpoint
    // itself requires step-up-active=true and audit-logs the
    // registration; the security property "operator physically proved
    // they're at this device" is preserved.
    await ensureCurrentDeviceTrusted();

    if (options.onElevated) {
      try { options.onElevated(elevated); } catch { /* ignore */ }
    }

    if (options.retryOnce === false) {
      return { kind: 'success', response: initial };
    }

    const retried = await retry();
    const retriedFailure = await classifyAuthFailure(retried);
    if (retriedFailure.kind === 'ok') return { kind: 'success', response: retried };
    if (retriedFailure.kind === 'not_authenticated') {
      return { kind: 'session_lost', failure: retriedFailure, response: retried };
    }
    // Step-up succeeded but the route still denies (e.g., capability not
    // held even with step-up). Surface as a banner so the operator
    // sees what's actually blocking them.
    return { kind: 'auth_banner', failure: retriedFailure, response: retried };
  }

  // capability_not_held / bridge_factor_insufficient / unknown_error
  return { kind: 'auth_banner', failure, response: initial };
}

/**
 * Operator-readable copy for non-success outcomes. Pages can display
 * this verbatim or build their own banner around it.
 */
export function describeStepUpOutcome(outcome: StepUpOutcome): string {
  switch (outcome.kind) {
    case 'success':
      return '';
    case 'session_lost':
      return 'Your session has expired. Sign in again to continue.';
    case 'auth_banner':
      return 'capability' in outcome.failure && outcome.failure.capability
        ? `Access denied: ${outcome.failure.capability}.`
        : 'Access denied for this action.';
    case 'step_up_user_cancelled':
      return 'Step-up was cancelled. Try again to confirm with a passkey.';
    case 'step_up_unavailable':
      return `Step-up is not available: ${outcome.reason}. Enroll a passkey at /settings/security and retry.`;
  }
}

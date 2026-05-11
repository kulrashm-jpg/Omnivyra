/**
 * Frontend step-up client.
 *
 * When a fetch returns 401 with `code: 'STEP_UP_REQUIRED'`, the caller
 * should run `triggerStepUpChallenge()` to launch a passkey or TOTP
 * challenge, then retry the original request.
 *
 * NO local step-up trust. NO local capability derivation. The frontend
 * only orchestrates the challenge; the server is the sole authority on
 * whether step-up is satisfied.
 */

import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';
import { safeFetchJson } from '@/lib/utils/safeFetchJson';

export interface StepUpRequiredError {
  /** True iff the response was a 401 with code STEP_UP_REQUIRED. */
  isStepUpRequired: true;
  /** The capability that triggered the requirement (when surfaced by the route). */
  capability: string | null;
}

/**
 * Inspect a fetch response. If it's a step-up trigger, returns a marker
 * the caller can branch on. Otherwise returns null (caller handles
 * normally).
 */
export async function detectStepUpFromResponse(res: Response): Promise<StepUpRequiredError | null> {
  if (res.status !== 401) return null;
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    return null;
  }
  if (body && typeof body === 'object' && (body as { code?: string }).code === 'STEP_UP_REQUIRED') {
    return {
      isStepUpRequired: true,
      capability: (body as { capability?: string }).capability ?? null,
    };
  }
  return null;
}

// ── WebAuthn step-up challenge ───────────────────────────────────────────────

export interface WebAuthnStepUpResult {
  ok: true;
  stepUp: {
    id: string;
    factor: 'webauthn' | 'totp' | 'recovery_code';
    expiresAt: string;
    scopedCapability: string | null;
  };
  authSessionRotated: boolean;
}

/**
 * In-flight elevation tracker — shared by every entry point that triggers
 * a WebAuthn ceremony so two parallel call sites (e.g. withStepUp from
 * useSocialPlatforms AND runStepUpFlowIfNeeded from SocialPlatformsSection
 * both reacting to the same 401) coalesce onto one OS dialog. Without
 * this, the second ceremony fails with "operation not allowed" because
 * the browser already has one passkey assertion in flight.
 *
 * Cleared on resolve OR reject — every caller starts fresh. NOT a result
 * cache; the server remains the authority on whether step-up is active.
 */
let _inflightTrigger: Promise<WebAuthnStepUpResult> | null = null;

/**
 * Run the WebAuthn step-up flow:
 *   1. POST /api/auth/passkeys/begin-authentication (scoped to the principal's user)
 *   2. navigator.credentials.get(...) via @simplewebauthn/browser
 *   3. POST /api/auth/step-up/verify with factor='webauthn' + the assertion.
 *
 * On success, the server has rotated the auth_session cookie and minted
 * the step-up session. The caller can then retry the original request.
 *
 * Throws on user cancellation (UserCancelled), expected by callers.
 *
 * Internally deduplicates concurrent calls — see `_inflightTrigger`.
 */
export async function triggerWebAuthnStepUp(opts: {
  scopedCapability?: string | null;
}): Promise<WebAuthnStepUpResult> {
  if (_inflightTrigger) return _inflightTrigger;
  _inflightTrigger = _runWebAuthnStepUp(opts).finally(() => { _inflightTrigger = null; });
  return _inflightTrigger;
}

async function _runWebAuthnStepUp(opts: {
  scopedCapability?: string | null;
}): Promise<WebAuthnStepUpResult> {
  // 1. Begin authentication.
  const beginResult = await safeFetchJson<PublicKeyCredentialRequestOptionsJSON>(
    '/api/auth/passkeys/begin-authentication',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    },
  );
  if (beginResult.ok !== true) {
    // The 500 response from /api/auth/passkeys/begin-authentication carries
    // the underlying exception text in `detail`. Without surfacing it here,
    // every begin failure looks identical ("Could not start passkey
    // authentication") and you have to read server logs to debug — which is
    // not always available in deployed environments.
    const detail = extractErrorDetail(beginResult.data);
    const tail = detail ? ` — ${detail}` : '';
    throw new Error(
      `step-up begin failed (${beginResult.status}, ${beginResult.reason}): ${beginResult.message}${tail}`,
    );
  }
  const options = beginResult.data;

  // 2. WebAuthn assertion (browser).
  const assertion = await startAuthentication({ optionsJSON: options });

  // 3. Mint step-up session via the orchestrator.
  const verifyResult = await safeFetchJson<WebAuthnStepUpResult>(
    '/api/auth/step-up/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        factor: 'webauthn',
        response: assertion,
        scopedCapability: opts.scopedCapability ?? null,
      }),
    },
  );
  if (verifyResult.ok !== true) {
    throw new Error(`step-up verify failed (${verifyResult.status}, ${verifyResult.reason}): ${verifyResult.message}`);
  }
  return verifyResult.data;
}

// ── TOTP step-up challenge ───────────────────────────────────────────────────

/**
 * Run the TOTP step-up flow. The caller is responsible for prompting the
 * user for the 6-digit code; this helper just submits it.
 *
 * NB: TOTP cannot satisfy step-up policies marked `phishingResistantOnly`.
 * Use `triggerWebAuthnStepUp` when the caller knows the policy demands
 * a phishing-resistant factor.
 */
export async function triggerTotpStepUp(opts: {
  token: string;
  scopedCapability?: string | null;
}): Promise<WebAuthnStepUpResult> {
  const result = await safeFetchJson<WebAuthnStepUpResult>(
    '/api/auth/step-up/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        factor: 'totp',
        token: opts.token,
        scopedCapability: opts.scopedCapability ?? null,
      }),
    },
  );
  if (result.ok !== true) {
    throw new Error(`step-up totp verify failed (${result.status}, ${result.reason}): ${result.message}`);
  }
  return result.data;
}

// ── withStepUp: orchestrated retry wrapper ────────────────────────────────────

/**
 * Run a fetch and, if the response is 401 STEP_UP_REQUIRED, launch
 * a WebAuthn step-up challenge and retry once.
 *
 * Caller pattern:
 *
 *   const r = await withStepUp(() => fetch('/api/super-admin/free-credits/grant', { ... }));
 *   if (!r.ok) handle(r);
 *   else await r.json();
 *
 * If the user cancels the WebAuthn prompt, the underlying error is
 * re-thrown so the caller can show a UX message.
 *
 * This helper does NOT cache or trust step-up state. Each retry hits
 * the server-authoritative gate; if step-up has expired between calls,
 * the caller will see another STEP_UP_REQUIRED.
 */
/**
 * Pull a server-provided `detail` field out of a JSON-error response body.
 * Tolerates any shape — returns null if no usable detail is present.
 */
function extractErrorDetail(body: unknown): string | null {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail?: unknown }).detail;
    if (typeof d === 'string' && d.length > 0) return d;
  }
  return null;
}

/**
 * Trust the current browser fingerprint as a trusted_device for the
 * authenticated principal. Idempotent — 409 ALREADY_TRUSTED is treated as
 * success because the device is already in the desired state.
 *
 * Called by `withStepUp` and `runStepUpFlowIfNeeded` immediately AFTER a
 * successful WebAuthn ceremony. Server-side `/api/auth/devices/trust`
 * gates on `principal.stepUp.active === true`, so it can only succeed
 * when a fresh step-up session exists. The result is: one passkey
 * ceremony on a previously-untrusted browser establishes both
 * `stepup_sessions` (proves identity now) AND `trusted_devices` (marks
 * this fingerprint operationally trusted), satisfying the
 * PHISHING_RESISTANT_TRUSTED_TENMIN policy that gates platform-OAuth
 * mutation. Without this auto-step the user hits an infinite loop:
 * every retry returns STEP_UP_REQUIRED because the server collapses
 * TRUSTED_DEVICE_REQUIRED into the same client-facing code, and re-doing
 * the passkey ceremony alone never adds the trusted_devices row.
 *
 * Returns true on success or already-trusted; false on any other
 * outcome (network error, 401, etc.). Caller may proceed regardless —
 * the subsequent retry of the original request will fail informatively
 * if the auto-trust didn't take.
 */
async function ensureCurrentDeviceTrusted(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/devices/trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    if (res.ok) return true;
    if (res.status === 409) return true; // ALREADY_TRUSTED — desired state
    return false;
  } catch {
    return false;
  }
}

/** Custom event name dispatched after successful step-up elevation. */
export const STEP_UP_ELEVATED_EVENT = 'omnivyra:step-up-elevated';

// Concurrent-ceremony deduplication is now baked into triggerWebAuthnStepUp
// itself (see `_inflightTrigger` above). withStepUp and runStepUpFlowIfNeeded
// both share the same singleton — fixes the previous bug where the two
// helpers had separate dedup state and could race each other.

export async function withStepUp<T extends Response>(
  doRequest: () => Promise<T>,
  opts: { retryOnce?: boolean; onElevated?: () => Promise<void> | void } = {},
): Promise<T> {
  const retryOnce = opts.retryOnce !== false; // default true

  const first = await doRequest();
  const stepUp = await detectStepUpFromResponse(first);
  if (!stepUp) return first;

  // Server rejected with STEP_UP_REQUIRED. Launch the challenge.
  //
  // Pass `scopedCapability: null` so the minted stepup_sessions row is
  // UNSCOPED — it covers every step-up-gated capability the user is
  // permitted to exercise within the policy's freshness window
  // (PHISHING_RESISTANT_TRUSTED_TENMIN → 10 min for platform-OAuth admin).
  // Previously we passed `stepUp.capability` from the 401 body, which
  // scoped each elevation narrowly: saving Facebook credentials, then
  // toggling LinkedIn enabled, then deleting an X config all minted three
  // separate scoped sessions and prompted three times. With null, the
  // operator authenticates once and the next ~10 minutes of platform
  // admin work proceeds without further prompts. Server-side authority
  // is unchanged — decideCapabilityWithStepUp treats an unscoped session
  // as satisfying any step-up policy the user's stepUp.policies includes.
  await triggerWebAuthnStepUp({ scopedCapability: null });

  // After successful passkey ceremony, also mark this browser as a
  // trusted device. The PHISHING_RESISTANT_TRUSTED_TENMIN policy that
  // gates platform-OAuth mutation requires BOTH step-up freshness AND
  // a trusted_devices row — without this call, the retry below would
  // re-hit STEP_UP_REQUIRED forever because the trusted-device gap is
  // independent of the passkey ceremony. No-op (idempotent) when the
  // device is already trusted.
  await ensureCurrentDeviceTrusted();

  // Notify subscribers so they can refresh capability + session
  // projections (the auth_session may have been rotated server-side).
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(STEP_UP_ELEVATED_EVENT, {
        detail: { capability: stepUp.capability },
      }));
    } catch {
      // CustomEvent unavailable in some test/SSR environments — ignore.
    }
  }
  if (opts.onElevated) {
    await opts.onElevated();
  }

  if (!retryOnce) return first;
  return await doRequest();
}

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
 * Run the WebAuthn step-up flow:
 *   1. POST /api/auth/passkeys/begin-authentication (scoped to the principal's user)
 *   2. navigator.credentials.get(...) via @simplewebauthn/browser
 *   3. POST /api/auth/step-up/verify with factor='webauthn' + the assertion.
 *
 * On success, the server has rotated the auth_session cookie and minted
 * the step-up session. The caller can then retry the original request.
 *
 * Throws on user cancellation (UserCancelled), expected by callers.
 */
export async function triggerWebAuthnStepUp(opts: {
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
    throw new Error(`step-up begin failed (${beginResult.status}, ${beginResult.reason}): ${beginResult.message}`);
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
/** Custom event name dispatched after successful step-up elevation. */
export const STEP_UP_ELEVATED_EVENT = 'omnivyra:step-up-elevated';

export async function withStepUp<T extends Response>(
  doRequest: () => Promise<T>,
  opts: { retryOnce?: boolean; onElevated?: () => Promise<void> | void } = {},
): Promise<T> {
  const retryOnce = opts.retryOnce !== false; // default true

  const first = await doRequest();
  const stepUp = await detectStepUpFromResponse(first);
  if (!stepUp) return first;

  // Server rejected with STEP_UP_REQUIRED. Launch the challenge.
  await triggerWebAuthnStepUp({ scopedCapability: stepUp.capability });

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

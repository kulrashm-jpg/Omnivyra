/**
 * superAdminAuthFailure — centralized parser + classifier for auth-failure
 * responses on the super-admin surface.
 *
 * Phase 1 — Frontend Auth Failure Differentiation. Every super-admin
 * fetch should funnel its response through `classifyAuthFailure(...)`
 * before deciding what to do. The classifier returns a discriminated
 * union; ONLY the `not_authenticated` branch warrants a redirect to
 * /super-admin/login. All other branches preserve page state and
 * surface a banner so the operator can see WHY they were denied.
 *
 * Backend contract: /backend/security/AuthorizationService.respondDenied
 * always emits `{ code, capability, correlationId, authMode, stepUpStatus }`
 * on auth-denial responses (status 401/403). This module parses that
 * shape; older routes that haven't migrated yet may emit shorter
 * bodies and are handled defensively.
 */

export type AuthFailure =
  | { kind: 'ok' }
  | {
      kind: 'not_authenticated';
      status: number;
      message: string;
      correlationId: string | null;
    }
  | {
      kind: 'step_up_required';
      status: 401;
      capability: string | null;
      message: string;
      correlationId: string | null;
      authMode: 'canonical' | 'bridge' | 'unauthenticated' | null;
    }
  | {
      kind: 'capability_not_held';
      status: 403;
      capability: string | null;
      message: string;
      correlationId: string | null;
      authMode: 'canonical' | 'bridge' | 'unauthenticated' | null;
    }
  | {
      kind: 'bridge_factor_insufficient';
      status: 403;
      capability: string | null;
      message: string;
      correlationId: string | null;
    }
  | {
      kind: 'trusted_device_required';
      status: 401;
      capability: string | null;
      message: string;
      correlationId: string | null;
    }
  | {
      kind: 'unknown_error';
      status: number;
      message: string;
      correlationId: string | null;
    };

/**
 * The structured deny shape emitted by `respondDenied`. Optional fields
 * exist because pre-migration routes may omit them.
 */
interface DeniedBody {
  error?: string;
  code?: string;
  capability?: string;
  correlationId?: string;
  authMode?: 'canonical' | 'bridge' | 'unauthenticated';
  stepUpStatus?: 'not_required' | 'required' | 'satisfied' | 'not_applicable';
}

/**
 * Inspect a Response (after the fetch completed). DOES NOT consume the
 * body for 2xx responses — caller can still read JSON normally.
 *
 * Returns:
 *   - { kind: 'ok' } when status is 2xx
 *   - a structured failure for 401/403 with parsed code
 *   - { kind: 'unknown_error' } for any other non-OK status
 */
export async function classifyAuthFailure(res: Response): Promise<AuthFailure> {
  if (res.ok) return { kind: 'ok' };

  const correlationId = res.headers.get('x-omnivyra-correlation-id');

  // Parse defensively. If the response is HTML or unparseable, fall
  // back to a generic unknown_error so the caller doesn't redirect on a
  // proxy-page response.
  let body: DeniedBody | null = null;
  try {
    const cloned = res.clone();
    body = (await cloned.json()) as DeniedBody;
  } catch {
    body = null;
  }

  const code = body?.code ?? null;
  const capability = body?.capability ?? null;
  const message = body?.error ?? `Request failed with status ${res.status}`;
  const corr = body?.correlationId ?? correlationId ?? null;
  const authMode = body?.authMode ?? null;

  if (code === 'STEP_UP_REQUIRED' && res.status === 401) {
    // Distinguish trusted-device subcase when surfaced by the backend.
    if ((body?.error ?? '').toLowerCase().includes('trusted device')) {
      return { kind: 'trusted_device_required', status: 401, capability, message, correlationId: corr };
    }
    return { kind: 'step_up_required', status: 401, capability, message, correlationId: corr, authMode };
  }

  if (code === 'NOT_AUTHENTICATED' || res.status === 401) {
    // 401 without a STEP_UP_REQUIRED marker = session truly missing/invalid.
    return { kind: 'not_authenticated', status: res.status, message, correlationId: corr };
  }

  if (code === 'BRIDGE_FACTOR_INSUFFICIENT' && res.status === 403) {
    return { kind: 'bridge_factor_insufficient', status: 403, capability, message, correlationId: corr };
  }

  if ((code === 'CAPABILITY_NOT_HELD' || code === 'NOT_ORG_MEMBER') && res.status === 403) {
    return { kind: 'capability_not_held', status: 403, capability, message, correlationId: corr, authMode };
  }

  // Bare 403 from a route that hasn't migrated to the structured shape:
  // treat as capability_not_held so we DO NOT redirect to login. The
  // pre-Phase-1 default of "redirect on any 403" was the source of the
  // bug this whole change is fixing.
  if (res.status === 403) {
    return { kind: 'capability_not_held', status: 403, capability, message, correlationId: corr, authMode };
  }

  return { kind: 'unknown_error', status: res.status, message, correlationId: corr };
}

/**
 * Human-readable banner copy for an auth failure — does NOT include
 * "session expired" wording for non-session causes. The copy is
 * deliberately neutral so it works for SocialPlatformsSection,
 * ApiCatalogSection, and any future super-admin tab.
 */
export function describeAuthFailure(failure: AuthFailure): string {
  switch (failure.kind) {
    case 'ok':
      return '';
    case 'not_authenticated':
      return 'Your super-admin session has expired. Please sign in again to continue.';
    case 'step_up_required':
      return failure.capability
        ? `This action requires step-up authentication (${failure.capability}). Confirm with a passkey to continue.`
        : 'This action requires step-up authentication. Confirm with a passkey to continue.';
    case 'trusted_device_required':
      return 'This action requires a trusted-device step-up. Confirm with a passkey on a trusted device to continue.';
    case 'capability_not_held':
      return failure.authMode === 'bridge'
        ? `Your current super-admin session is in bridge-cookie mode and cannot access ${failure.capability ?? 'this surface'}. A canonical SUPER_ADMIN identity must be provisioned (see runbook).`
        : `Your account does not hold the capability required for this action${failure.capability ? ` (${failure.capability})` : ''}.`;
    case 'bridge_factor_insufficient':
      return `The legacy bridge cookie cannot satisfy the security requirements for ${failure.capability ?? 'this action'}. Use a canonical SUPER_ADMIN session with passkey + trusted device.`;
    case 'unknown_error':
      return failure.message;
  }
}

/**
 * True iff the failure represents a recoverable state where the page
 * should preserve its local state (no logout). False ONLY for true
 * session-not-authenticated.
 */
export function isRecoverableAuthFailure(failure: AuthFailure): boolean {
  return failure.kind !== 'not_authenticated' && failure.kind !== 'ok';
}

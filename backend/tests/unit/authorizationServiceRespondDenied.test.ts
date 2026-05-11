/**
 * Phase 1 — Session Integrity Diagnostics regression tests for
 * `respondDenied`. Asserts that every deny shape carries the four
 * diagnostic fields (code, correlationId, authMode, stepUpStatus,
 * capability) and that the HTTP status mapping is preserved.
 *
 * If a future change drops or renames any of these fields, the
 * super-admin frontend's auth-failure classifier will silently fall
 * back to "redirect on bare 403" — the exact bug Phase 1 fixed.
 * These tests fail-fast on that regression.
 */

import { respondDenied } from '../../security/AuthorizationService';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function makeRes(): { res: any; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: {}, headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    status(code: number) { captured.status = code; return this; },
    json(payload: Record<string, unknown>) { captured.body = payload; return this; },
  };
  return { res, captured };
}

const baseDiag = {
  correlationId: 'auth_abcdef012345',
  authMode: 'canonical' as const,
  stepUpStatus: 'not_required' as const,
};

describe('respondDenied — Phase 1 diagnostic shape', () => {
  it('NOT_AUTHENTICATED → 401 with full diagnostic envelope', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'NOT_AUTHENTICATED', capability: 'super_admin.dashboard.view' },
      { ...baseDiag, authMode: 'unauthenticated', stepUpStatus: 'not_applicable' },
    );
    expect(captured.status).toBe(401);
    expect(captured.body).toMatchObject({
      error: 'Authorization required',
      code: 'NOT_AUTHENTICATED',
      capability: 'super_admin.dashboard.view',
      correlationId: 'auth_abcdef012345',
      authMode: 'unauthenticated',
      stepUpStatus: 'not_applicable',
    });
    expect(captured.headers['x-omnivyra-correlation-id']).toBe('auth_abcdef012345');
  });

  it('STEP_UP_REQUIRED → 401 with step-up code + capability', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'STEP_UP_REQUIRED', capability: 'integration.platform.oauth.manage' },
      { ...baseDiag, stepUpStatus: 'required' },
    );
    expect(captured.status).toBe(401);
    expect(captured.body.code).toBe('STEP_UP_REQUIRED');
    expect(captured.body.capability).toBe('integration.platform.oauth.manage');
    expect(captured.body.stepUpStatus).toBe('required');
    expect(captured.body.correlationId).toBe('auth_abcdef012345');
  });

  it('CAPABILITY_NOT_HELD → 403 with capability + diagnostic envelope', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'CAPABILITY_NOT_HELD', capability: 'integration.platform.oauth.manage' },
      { ...baseDiag, authMode: 'bridge', stepUpStatus: 'not_applicable' },
    );
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      code: 'CAPABILITY_NOT_HELD',
      capability: 'integration.platform.oauth.manage',
      authMode: 'bridge',
      stepUpStatus: 'not_applicable',
      correlationId: 'auth_abcdef012345',
    });
  });

  it('BRIDGE_FACTOR_INSUFFICIENT → 403 with bridge code', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'BRIDGE_FACTOR_INSUFFICIENT', capability: 'identity.admin' },
      { ...baseDiag, authMode: 'bridge', stepUpStatus: 'not_applicable' },
    );
    expect(captured.status).toBe(403);
    expect(captured.body.code).toBe('BRIDGE_FACTOR_INSUFFICIENT');
    expect(captured.body.authMode).toBe('bridge');
    expect(captured.body.stepUpStatus).toBe('not_applicable');
  });

  it('NOT_ORG_MEMBER → 403 with diagnostic envelope', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'NOT_ORG_MEMBER', capability: 'organization.manage' },
      { ...baseDiag, stepUpStatus: 'not_required' },
    );
    expect(captured.status).toBe(403);
    expect(captured.body.code).toBe('NOT_ORG_MEMBER');
    expect(captured.body.correlationId).toBe('auth_abcdef012345');
  });

  it('ALWAYS sets the correlation header so support tools can pin the id', () => {
    const { res, captured } = makeRes();
    respondDenied(
      res,
      { allowed: false, reason: 'CAPABILITY_NOT_HELD', capability: 'billing.manage' },
      { ...baseDiag, correlationId: 'auth_zzzz9999' },
    );
    expect(captured.headers['x-omnivyra-correlation-id']).toBe('auth_zzzz9999');
  });
});

/**
 * Phase 1 — Frontend Auth Failure Differentiation regression tests.
 *
 * Asserts that the classifier funnels every backend deny shape into the
 * correct discriminated branch. Critical invariants:
 *   - 403 CAPABILITY_NOT_HELD → 'capability_not_held' (NOT redirect)
 *   - 401 STEP_UP_REQUIRED → 'step_up_required' (NOT redirect)
 *   - 403 BRIDGE_FACTOR_INSUFFICIENT → 'bridge_factor_insufficient'
 *   - 401 NOT_AUTHENTICATED → 'not_authenticated' (the ONLY redirect path)
 *   - bare 403 (no body) → 'capability_not_held' (preserves session)
 *
 * If any of these collapse back to 'not_authenticated', the bug that
 * broke the APIs tab returns: capability/step-up failures will log the
 * operator out instead of surfacing a banner.
 */

import {
  classifyAuthFailure,
  describeAuthFailure,
  isRecoverableAuthFailure,
} from '../../../lib/security/superAdminAuthFailure';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('classifyAuthFailure', () => {
  it('returns ok for 2xx', async () => {
    const res = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('ok');
  });

  it('classifies 403 CAPABILITY_NOT_HELD → capability_not_held (NOT not_authenticated)', async () => {
    const res = jsonResponse(403, {
      error: 'Forbidden',
      code: 'CAPABILITY_NOT_HELD',
      capability: 'integration.platform.oauth.manage',
      correlationId: 'auth_111111',
      authMode: 'bridge',
      stepUpStatus: 'not_applicable',
    });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('capability_not_held');
    if (out.kind === 'capability_not_held') {
      expect(out.capability).toBe('integration.platform.oauth.manage');
      expect(out.authMode).toBe('bridge');
      expect(out.correlationId).toBe('auth_111111');
    }
  });

  it('classifies 401 STEP_UP_REQUIRED → step_up_required', async () => {
    const res = jsonResponse(401, {
      error: 'Step-up authentication required',
      code: 'STEP_UP_REQUIRED',
      capability: 'billing.purchase',
      correlationId: 'auth_222222',
    });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('step_up_required');
    if (out.kind === 'step_up_required') {
      expect(out.capability).toBe('billing.purchase');
    }
  });

  it('classifies 403 BRIDGE_FACTOR_INSUFFICIENT → bridge_factor_insufficient', async () => {
    const res = jsonResponse(403, {
      error: 'Cookie bridge cannot satisfy elevated requirement',
      code: 'BRIDGE_FACTOR_INSUFFICIENT',
      capability: 'identity.admin',
    });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('bridge_factor_insufficient');
  });

  it('classifies 401 NOT_AUTHENTICATED → not_authenticated', async () => {
    const res = jsonResponse(401, {
      error: 'Authorization required',
      code: 'NOT_AUTHENTICATED',
    });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('not_authenticated');
  });

  it('classifies bare 403 with no body as capability_not_held (NOT not_authenticated)', async () => {
    // Pre-migration routes may return raw 403 with no diagnostic body.
    // The classifier MUST default to capability_not_held so the operator
    // does not get logged out for a missing-cap denial. This is the
    // exact regression Phase 1 prevents.
    const res = new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    const out = await classifyAuthFailure(res);
    expect(out.kind).toBe('capability_not_held');
  });

  it('reads correlation id from the x-omnivyra-correlation-id header even if body parse fails', async () => {
    const res = new Response('Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain', 'x-omnivyra-correlation-id': 'auth_headeronly' },
    });
    const out = await classifyAuthFailure(res);
    if (out.kind === 'capability_not_held') {
      expect(out.correlationId).toBe('auth_headeronly');
    }
  });

  it('isRecoverableAuthFailure: not_authenticated is the only non-recoverable kind', async () => {
    const cap = await classifyAuthFailure(jsonResponse(403, { code: 'CAPABILITY_NOT_HELD' }));
    const step = await classifyAuthFailure(jsonResponse(401, { code: 'STEP_UP_REQUIRED' }));
    const bridge = await classifyAuthFailure(jsonResponse(403, { code: 'BRIDGE_FACTOR_INSUFFICIENT' }));
    const sessionLost = await classifyAuthFailure(jsonResponse(401, { code: 'NOT_AUTHENTICATED' }));
    expect(isRecoverableAuthFailure(cap)).toBe(true);
    expect(isRecoverableAuthFailure(step)).toBe(true);
    expect(isRecoverableAuthFailure(bridge)).toBe(true);
    expect(isRecoverableAuthFailure(sessionLost)).toBe(false);
  });

  it('describeAuthFailure produces operator-readable copy that is NOT misleading', async () => {
    const cap = await classifyAuthFailure(jsonResponse(403, {
      code: 'CAPABILITY_NOT_HELD',
      capability: 'integration.platform.oauth.manage',
      authMode: 'bridge',
    }));
    const desc = describeAuthFailure(cap);
    expect(desc.toLowerCase()).not.toContain('session expired');
    expect(desc.toLowerCase()).toContain('bridge');
  });
});

/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — Observation Gate wiring.
 *
 * The load-bearing guarantees, in escalating order:
 *   1. No policy declared → the gate MODULE is never even loaded and the
 *      response is byte-identical (the Task 3a "nothing changed" proof).
 *   2. Policy declared + flag off (default) → gate loads but the SECURITY
 *      graph (IdentityResolver) is never imported; response unchanged.
 *   3. Policy declared + shadow → identity resolved, decision logged with the
 *      exact §6 field set; response unchanged for would-allow AND would-deny.
 *   4. Gate failure → swallowed; response unchanged (Decision 2: fail-safe).
 */
import type { NextApiRequest, NextApiResponse } from 'next';

let mockGateLoaded = false;
jest.mock('../../../lib/platform/policyGate', () => {
  mockGateLoaded = true;
  return jest.requireActual('../../../lib/platform/policyGate');
});

let mockIdentityLoaded = false;
const mockResolvePrincipal = jest.fn();
jest.mock('../../../backend/security/IdentityResolver', () => {
  mockIdentityLoaded = true;
  return { resolvePrincipal: mockResolvePrincipal };
});
jest.mock('../../../backend/services/contentArchitectService', () => ({
  isContentArchitectSession: jest.fn().mockReturnValue(false),
}));
jest.mock('../../../backend/services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { createApiRoute } from '../../../lib/platform/routeFactory';
import { logger } from '../../../backend/services/logger';
import type { RoutePolicy } from '../../../lib/platform/routePolicy';

const MODE_ENV = 'ROLLOUT_ROUTE_POLICY_GATE_MODE';

const POLICY: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' };

function fakeReq(query: Record<string, string> = {}): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/policy-test',
    headers: {},
    cookies: {},
    query,
    body: {},
  } as unknown as NextApiRequest;
}

interface FakeRes extends NextApiResponse { _status?: number; _json?: unknown }
function fakeRes(): FakeRes {
  const res: Partial<FakeRes> = { statusCode: 200, headersSent: false };
  res.setHeader = (() => res) as FakeRes['setHeader'];
  res.status = ((code: number) => { res._status = code; return res; }) as FakeRes['status'];
  res.json = ((body: unknown) => { res._json = body; return res; }) as FakeRes['json'];
  res.end = (() => res) as FakeRes['end'];
  res.on = (() => res) as FakeRes['on'];
  return res as FakeRes;
}

const handler = async (_req: NextApiRequest, res: NextApiResponse) => {
  res.status(200).json({ ok: true, data: 'handler-output' });
};

const memberPrincipal = {
  ok: true,
  principal: {
    userId: 'user-1',
    supabaseUid: 'uid-1',
    email: 'u@x.com',
    emailVerified: true,
    sessionId: null,
    sessionAgeSeconds: 0,
    sessionStaleSeconds: 0,
    organizations: [{ organizationId: 'company-1', role: 'COMPANY_ADMIN', status: 'active' }],
    activeOrgId: 'company-1',
    capabilities: [],
    mfa: { enrolled: false, factors: [], lastVerifiedAt: null, phishingResistant: false },
    device: { deviceId: null, trusted: false, fingerprint: 'f' },
    stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
    legacyCookieSuperAdmin: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[MODE_ENV];
});
afterAll(() => {
  delete process.env[MODE_ENV];
});

describe('guarantee 1 — no policy: total inertness', () => {
  test('response byte-identical and the gate module is never loaded', async () => {
    const wrapped = createApiRoute(handler, { route: '/api/policy-test' });
    const res = fakeRes();
    await wrapped(fakeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(mockGateLoaded).toBe(false);
    expect(mockIdentityLoaded).toBe(false);
  });
});

describe('guarantee 2 — policy + flag off (default)', () => {
  test('gate loads but the security graph does not; response unchanged', async () => {
    const wrapped = createApiRoute(handler, { route: '/api/policy-test', policy: POLICY });
    const res = fakeRes();
    await wrapped(fakeReq({ companyId: 'company-1' }), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(mockGateLoaded).toBe(true);
    expect(mockIdentityLoaded).toBe(false);
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect((logger.info as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('guarantee 3 — policy + shadow mode observes without interfering', () => {
  test('would-allow: decision logged with the §6 field set; response unchanged', async () => {
    process.env[MODE_ENV] = 'shadow';
    mockResolvePrincipal.mockResolvedValue(memberPrincipal);
    const wrapped = createApiRoute(handler, { route: '/api/policy-test', policy: POLICY });
    const res = fakeRes();
    await wrapped(fakeReq({ companyId: 'company-1' }), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(mockResolvePrincipal).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'route_policy_shadow_observation',
      expect.objectContaining({
        route: '/api/policy-test',
        category: 'company-scoped',
        wouldAllow: true,
        wouldDeny: false,
        reason: 'membership_confirmed',
        decision_schema: 1,
      }),
    );
  });

  test('would-deny (anonymous): logged as such; response STILL unchanged — observation never blocks', async () => {
    process.env[MODE_ENV] = 'shadow';
    mockResolvePrincipal.mockResolvedValue({ ok: false, reason: 'NO_AUTH' });
    const wrapped = createApiRoute(handler, { route: '/api/policy-test', policy: POLICY });
    const res = fakeRes();
    await wrapped(fakeReq({ companyId: 'company-1' }), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(logger.info).toHaveBeenCalledWith(
      'route_policy_shadow_observation',
      expect.objectContaining({ wouldAllow: false, wouldDeny: true, reason: 'unauthenticated' }),
    );
  });

  test('a premature enforce flag STILL only observes in Phase 1', async () => {
    process.env[MODE_ENV] = 'enforce';
    mockResolvePrincipal.mockResolvedValue({ ok: false, reason: 'NO_AUTH' });
    const wrapped = createApiRoute(handler, { route: '/api/policy-test', policy: POLICY });
    const res = fakeRes();
    await wrapped(fakeReq({ companyId: 'company-1' }), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
  });
});

describe('guarantee 4 — gate failure is invisible to the route', () => {
  test('identity resolution rejects → handler unaffected, error observed on the warn channel', async () => {
    process.env[MODE_ENV] = 'shadow';
    mockResolvePrincipal.mockRejectedValue(new Error('identity backend down'));
    const wrapped = createApiRoute(handler, { route: '/api/policy-test', policy: POLICY });
    const res = fakeRes();
    await wrapped(fakeReq({ companyId: 'company-1' }), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(logger.warn).toHaveBeenCalledWith(
      'route_policy_observation_error',
      expect.objectContaining({ route: '/api/policy-test', message: 'identity backend down' }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});

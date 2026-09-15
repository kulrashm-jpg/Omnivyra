/**
 * SEC-91 W2-G (STEP 3AH-91, wave-2 residuals) — W2G-5: the route-policy gate's
 * principal reaches the handler (staged by the ai-guard-principal flag).
 *
 * lib/platform/policyGate.ts resolves the caller's identity and calls
 * setPrincipal() (lib/platform/requestContext.ts), documented as "Guards call
 * this once after authentication so downstream code can read it". setPrincipal
 * used mergeRequestContext() — AsyncLocalStorage.enterWith() — and the gate runs
 * inside an AWAITED callee, so the store it entered was gone when the route
 * factory went on to call the handler: the principal was invisible downstream
 * (the defect W2A-4 fixed for requireTenantAccess).
 *
 * setPrincipal now ALSO records the principal through W2-A's
 * attributeAuthenticatedPrincipal (in place on the LIVE store), staged by the
 * SAME rollout flag:
 *   shadow (default) — authPrincipal only; context userId/orgId unchanged, so
 *                      the AI guard, the AI cache, logs and billing see exactly
 *                      what they saw before;
 *   enforce          — context userId filled (never orgId);
 *   off / kill       — nothing.
 * mergeRequestContext keeps its semantics (same-frame callers are unchanged).
 * The gate forwards an org only when the principal is an ACTIVE member of it.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const mockResolvePrincipal = jest.fn();
jest.mock('../../../backend/security/IdentityResolver', () => ({ resolvePrincipal: (...a: unknown[]) => mockResolvePrincipal(...a) }));
jest.mock('../../../backend/services/contentArchitectService', () => ({ isContentArchitectSession: jest.fn().mockReturnValue(false) }));
jest.mock('../../../backend/services/logger', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { createApiRoute } from '../../../lib/platform/routeFactory';
import {
  runWithRequestExecutionContext,
  getRequestContext,
  getPrincipal,
  setPrincipal,
} from '../../../lib/platform/requestContext';
import type { RoutePolicy } from '../../../lib/platform/routePolicy';

const GATE = 'ROLLOUT_ROUTE_POLICY_GATE_MODE';
const MODE = 'ROLLOUT_AI_GUARD_PRINCIPAL_MODE';
const KILL = 'ROLLOUT_AI_GUARD_PRINCIPAL_KILL';
const ENV_KEYS = [GATE, MODE, KILL, 'ROLLOUT_AI_GUARD_PRINCIPAL_TENANTS', 'ROLLOUT_KILL_SWITCH'];
const saved: Record<string, string | undefined> = {};

const POLICY: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' };

function principal(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    principal: {
      userId: 'user-1',
      supabaseUid: 'uid-1',
      email: 'u@example.test',
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
      ...overrides,
    },
  };
}

function fakeReq(): NextApiRequest {
  return { method: 'GET', url: '/api/policy-test', headers: {}, cookies: {}, query: { companyId: 'company-1' }, body: {} } as unknown as NextApiRequest;
}
function fakeRes(): NextApiResponse & { _status?: number; _json?: unknown } {
  const res: any = { statusCode: 200, headersSent: false };
  res.setHeader = () => res;
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.end = () => res;
  res.on = () => res;
  return res;
}

/** What the HANDLER sees after the gate ran in the route factory. */
async function runRoute(): Promise<{ seen: { userId?: string; orgId?: string; authPrincipal?: Record<string, unknown> }; res: ReturnType<typeof fakeRes> }> {
  let seen: any = null;
  const handler = async (_req: NextApiRequest, r: NextApiResponse) => {
    const c = getRequestContext();
    seen = { userId: c.userId, orgId: c.orgId, authPrincipal: c.authPrincipal ? { ...c.authPrincipal } : undefined };
    r.status(200).json({ ok: true, data: 'handler-output' });
  };
  const res = fakeRes();
  await createApiRoute(handler, { route: '/api/policy-test', policy: POLICY })(fakeReq(), res);
  return { seen, res };
}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env[GATE] = 'shadow';
  mockResolvePrincipal.mockReset();
  mockResolvePrincipal.mockResolvedValue(principal());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('route-policy gate → handler (through the real route factory)', () => {
  it('default (shadow): the handler sees the recorded principal; context userId/orgId untouched', async () => {
    const { seen, res } = await runRoute();
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
    expect(seen.authPrincipal).toEqual({ userId: 'user-1', orgId: 'company-1', source: 'policyGate' });
    expect(seen.userId).toBeUndefined();
    expect(seen.orgId).toBeUndefined();
  });

  it('enforce: the handler sees context userId (never orgId)', async () => {
    process.env[MODE] = 'enforce';
    const { seen } = await runRoute();
    expect(seen.userId).toBe('user-1');
    expect(seen.orgId).toBeUndefined();
    expect(seen.authPrincipal).toMatchObject({ userId: 'user-1', source: 'policyGate' });
  });

  it('per-tenant promotion: tenant listed in _TENANTS → enforce for that org', async () => {
    process.env.ROLLOUT_AI_GUARD_PRINCIPAL_TENANTS = 'company-1';
    const { seen } = await runRoute();
    expect(seen.userId).toBe('user-1');
  });

  it('ai-guard-principal kill switch → nothing recorded (as before)', async () => {
    process.env[KILL] = '1';
    const { seen } = await runRoute();
    expect(seen.authPrincipal).toBeUndefined();
    expect(seen.userId).toBeUndefined();
  });

  it('route-policy gate off (its default) → identity never resolved, nothing recorded (unchanged)', async () => {
    delete process.env[GATE];
    const { seen } = await runRoute();
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect(seen.authPrincipal).toBeUndefined();
  });

  it('unauthenticated request → nothing recorded, response unchanged', async () => {
    mockResolvePrincipal.mockResolvedValue({ ok: false, reason: 'NO_AUTH' });
    const { seen, res } = await runRoute();
    expect(seen.authPrincipal).toBeUndefined();
    expect(res._json).toEqual({ ok: true, data: 'handler-output' });
  });

  it.each([
    ['an invited membership', { organizations: [{ organizationId: 'company-1', role: 'COMPANY_ADMIN', status: 'invited' }] }],
    ['no membership at all', { organizations: [{ organizationId: 'company-2', role: 'COMPANY_ADMIN', status: 'active' }] }],
  ])('activeOrgId backed by %s is NOT recorded as the principal org', async (_l, o) => {
    mockResolvePrincipal.mockResolvedValue(principal(o));
    const { seen } = await runRoute();
    expect(seen.authPrincipal).toEqual({ userId: 'user-1', source: 'policyGate' });
  });
});

describe('setPrincipal inside an awaited guard', () => {
  const guard = async (p: { userId?: string; orgId?: string }) => {
    await Promise.resolve();
    setPrincipal(p);
  };

  it('shadow: the caller sees authPrincipal after the guard returns; userId untouched', async () => {
    await runWithRequestExecutionContext({}, async () => {
      await guard({ userId: 'u-9', orgId: 'org-9' });
      expect(getRequestContext().authPrincipal).toEqual({ userId: 'u-9', orgId: 'org-9', source: 'setPrincipal' });
      expect(getPrincipal()).toEqual({ userId: undefined, orgId: undefined });
    });
  });

  it('enforce: the caller sees userId; orgId is never filled', async () => {
    process.env[MODE] = 'enforce';
    await runWithRequestExecutionContext({}, async () => {
      await guard({ userId: 'u-9', orgId: 'org-9' });
      expect(getPrincipal()).toEqual({ userId: 'u-9', orgId: undefined });
    });
  });

  it('a second, different user never re-attributes (first wins)', async () => {
    process.env[MODE] = 'enforce';
    await runWithRequestExecutionContext({}, async () => {
      await guard({ userId: 'u-1' });
      await guard({ userId: 'u-2' });
      expect(getRequestContext().authPrincipal?.userId).toBe('u-1');
      expect(getPrincipal().userId).toBe('u-1');
    });
  });

  it('synthetic principals are never attributed', async () => {
    process.env[MODE] = 'enforce';
    await runWithRequestExecutionContext({}, async () => {
      await guard({ userId: 'content_architect' });
      expect(getRequestContext().authPrincipal).toBeUndefined();
      expect(getPrincipal().userId).toBeUndefined();
    });
  });

  it('same-frame callers keep the merge semantics (mergeRequestContext unchanged)', () => {
    runWithRequestExecutionContext({}, () => {
      setPrincipal({ userId: 'u-1', orgId: 'org-1' });
      expect(getPrincipal()).toEqual({ userId: 'u-1', orgId: 'org-1' });
      setPrincipal({ userId: 'u-2' });
      expect(getPrincipal()).toEqual({ userId: 'u-2', orgId: 'org-1' });
    });
  });
});

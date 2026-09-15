/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-4 (from SEC-D D1d): authenticated
 * principal attribution for the AI request guard.
 *
 * guardAiRequest() keys its per-user / per-company / burst layers on the
 * request context's userId; with none (and no ip) a call is treated as
 * BACKGROUND and those layers are skipped. Before this change:
 *   - resolveUserContext / enforceCompanyAccess / requireCampaignAccess never
 *     recorded the principal;
 *   - requireTenantAccess recorded it with mergeRequestContext() — an
 *     AsyncLocalStorage.enterWith() inside an awaited callee, which the caller
 *     never sees after the callee returns (proved below).
 *
 * After: the seams record the principal on the LIVE context object. Default
 * rollout mode `shadow` is OBSERVE-only (authPrincipal + counter; the guard's
 * inputs are unchanged); `enforce` fills context userId so the guard applies
 * per-user + burst limits. The whole guard/limiter/request-context chain is
 * real; only the DB, the identity provider and the distributed limiter are fake.
 */
import { seed, invoke, CO_A, CO_B, CAMPAIGN_A, USER_A, USER_B } from '../helpers/routeAuthHarness';
import {
  runWithRequestExecutionContext,
  getRequestContext,
  mergeRequestContext,
} from '../../../lib/platform/requestContext';
import { enforceCompanyAccess, resolveUserContext } from '../../services/userContextService';
import { requireCampaignAccess } from '../../services/campaignAccessService';
import { requireTenantAccess } from '../../security/TenantGuard';
import {
  attributeAuthenticatedPrincipal,
  getAuthenticatedPrincipal,
} from '../../services/requestContextPrincipal';
import { guardAiRequest } from '../../services/ai/aiRequestGuard';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockCounter = jest.fn();
jest.mock('../../observability', () => ({
  recordRawCounter: (...a: unknown[]) => mockCounter(...a),
  recordRawHistogram: jest.fn(),
  withApiObservability: (h: unknown) => h,
}));

const mockCheckRateLimit = jest.fn();
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  resolveEffectiveRateLimitConfig: async (c: unknown) => c,
}));

const MODE = 'ROLLOUT_AI_GUARD_PRINCIPAL_MODE';
const KILL = 'ROLLOUT_AI_GUARD_PRINCIPAL_KILL';
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  seed();
  for (const k of [MODE, KILL, 'ROLLOUT_KILL_SWITCH']) { saved[k] = process.env[k]; delete process.env[k]; }
  mockCounter.mockClear();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 10, resetAt: Math.floor(Date.now() / 1000) + 60, bypassed: false });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  jest.restoreAllMocks();
});

function fakeReq(who: 'A' | 'B' | 'SUPER' | null): any {
  const tokens = { A: 'tok-user-a', B: 'tok-user-b', SUPER: 'tok-user-super' } as const;
  return { method: 'GET', query: {}, body: {}, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {}, cookies: {}, url: '/api/test', socket: { remoteAddress: '127.0.0.1' } };
}
function fakeRes(): any {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
/** Run `fn` inside a request scope exactly like the route factory does. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestExecutionContext({}, fn);
}
const attributionCounts = () => mockCounter.mock.calls.filter((c) => c[0] === 'ai.guard.principal_attribution');
const limiterKeys = () => mockCheckRateLimit.mock.calls.map((c) => `${(c[1] as { keyPrefix: string }).keyPrefix}:${c[0]}`);

describe('why: a store entered inside an awaited callee never reaches the caller', () => {
  it('mergeRequestContext() in a callee is invisible after `await` (the requireTenantAccess seeding pattern)', async () => {
    await inRequest(async () => {
      const callee = async () => { await Promise.resolve(); mergeRequestContext({ userId: 'seeded-in-callee' }); };
      await callee();
      expect(getRequestContext().userId).toBeUndefined();
    });
  });
});

describe('shadow (default) — observe only', () => {
  it('enforceCompanyAccess records {user, authorized company}; the guard input (userId/orgId) is untouched', async () => {
    await inRequest(async () => {
      const ok = await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      expect(ok).not.toBeNull();
      expect(getRequestContext().authPrincipal).toMatchObject({ userId: USER_A, orgId: CO_A });
      expect(getRequestContext().userId).toBeUndefined();
      expect(getRequestContext().orgId).toBeUndefined();
    });
    const counts = attributionCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0][2]).toMatchObject({ mode: 'shadow', outcome: 'would_attribute' });
  });

  it('the AI guard keeps treating the call as background in shadow (no per-user / burst key)', async () => {
    await inRequest(async () => {
      await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      await guardAiRequest({ operation: 'w2a.test', companyId: CO_A, messages: [{ role: 'user', content: 'hi' }] });
    });
    expect(limiterKeys().some((k) => k.startsWith('ai:burst:user'))).toBe(false);
    expect(limiterKeys().some((k) => k.startsWith('ai:rl:user'))).toBe(false);
  });

  it('a DENIED company is never recorded as the org (identity alone is)', async () => {
    await inRequest(async () => {
      const res = fakeRes();
      const out = await enforceCompanyAccess({ req: fakeReq('A'), res, companyId: CO_B });
      expect(out).toBeNull();
      expect(res.statusCode).toBe(403);
      expect(getRequestContext().authPrincipal?.userId).toBe(USER_A);
      expect(getRequestContext().authPrincipal?.orgId).toBeUndefined();
    });
  });

  it('unauthenticated → nothing recorded', async () => {
    await inRequest(async () => {
      const ctx = await resolveUserContext(fakeReq(null));
      expect(ctx.authenticated).toBe(false);
      expect(getRequestContext().authPrincipal).toBeUndefined();
    });
    expect(attributionCounts()).toEqual([]);
  });

  it('requireCampaignAccess records the campaign\'s owning company', async () => {
    await inRequest(async () => {
      const access = await requireCampaignAccess(fakeReq('A'), fakeRes(), CAMPAIGN_A);
      expect(access).not.toBeNull();
      expect(getAuthenticatedPrincipal()).toMatchObject({ userId: USER_A, orgId: CO_A });
    });
  });

  it('requireTenantAccess: the principal is now visible to the CALLER after it returns', async () => {
    await inRequest(async () => {
      const access = await requireTenantAccess(fakeReq('A'), fakeRes(), CO_A);
      expect(access).not.toBeNull();
      expect(getAuthenticatedPrincipal()).toMatchObject({ userId: USER_A, orgId: CO_A, source: 'requireTenantAccess' });
    });
  });
});

describe('enforce — the guard keys per-user limits on the authenticated principal', () => {
  beforeEach(() => { process.env[MODE] = 'enforce'; });

  it('context userId is filled (orgId is NOT — AI cache tenant scoping is unaffected)', async () => {
    await inRequest(async () => {
      await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      expect(getRequestContext().userId).toBe(USER_A);
      expect(getRequestContext().orgId).toBeUndefined();
    });
    expect(attributionCounts()[0][2]).toMatchObject({ mode: 'enforce', outcome: 'applied' });
  });

  it('the AI guard now applies the burst + per-user layers for that user', async () => {
    await inRequest(async () => {
      await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      await guardAiRequest({ operation: 'w2a.test', companyId: CO_A, messages: [{ role: 'user', content: 'hi' }] });
    });
    expect(limiterKeys()).toEqual(expect.arrayContaining([`ai:burst:user:${USER_A}`, `ai:rl:user:min:${USER_A}`, `ai:rl:co:min:${CO_A}`]));
  });

  it('the kill switch returns to no-op', async () => {
    process.env[KILL] = '1';
    await inRequest(async () => {
      await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      expect(getRequestContext().userId).toBeUndefined();
      expect(getRequestContext().authPrincipal).toBeUndefined();
    });
  });
});

describe('safety properties', () => {
  it('off → nothing recorded at all', async () => {
    process.env[MODE] = 'off';
    await inRequest(async () => {
      await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
      expect(getRequestContext().authPrincipal).toBeUndefined();
    });
    expect(attributionCounts()).toEqual([]);
  });

  it('outside a request scope it is a no-op and never creates a scope', async () => {
    expect(attributeAuthenticatedPrincipal({ userId: USER_A, orgId: CO_A, source: 'resolveUserContext' })).toBe('skipped');
    expect(getRequestContext()).toEqual({});
  });

  it('a second, different user in the same request never re-attributes it', async () => {
    process.env[MODE] = 'enforce';
    await inRequest(async () => {
      attributeAuthenticatedPrincipal({ userId: USER_A, source: 'resolveUserContext' });
      expect(attributeAuthenticatedPrincipal({ userId: USER_B, orgId: CO_B, source: 'enforceCompanyAccess' })).toBe('conflict');
      expect(getRequestContext().userId).toBe(USER_A);
      expect(getAuthenticatedPrincipal()?.userId).toBe(USER_A);
      expect(getAuthenticatedPrincipal()?.orgId).toBeUndefined();
    });
  });

  it('an explicit upstream userId is never overwritten', async () => {
    process.env[MODE] = 'enforce';
    await runWithRequestExecutionContext({ userId: 'upstream-user' }, async () => {
      expect(attributeAuthenticatedPrincipal({ userId: USER_A, source: 'resolveUserContext' })).toBe('conflict');
      expect(getRequestContext().userId).toBe('upstream-user');
    });
  });

  it('synthetic principals (content_architect) are never used as a rate-limit key', async () => {
    process.env[MODE] = 'enforce';
    await inRequest(async () => {
      expect(attributeAuthenticatedPrincipal({ userId: 'content_architect', source: 'enforceCompanyAccess' })).toBe('skipped');
      expect(getRequestContext().userId).toBeUndefined();
    });
  });

  it('requests stay isolated: attribution in one request is not visible in another', async () => {
    process.env[MODE] = 'enforce';
    await Promise.all([
      inRequest(async () => {
        await enforceCompanyAccess({ req: fakeReq('A'), res: fakeRes(), companyId: CO_A });
        await Promise.resolve();
        expect(getRequestContext().userId).toBe(USER_A);
      }),
      inRequest(async () => {
        await enforceCompanyAccess({ req: fakeReq('B'), res: fakeRes(), companyId: CO_B });
        await Promise.resolve();
        expect(getRequestContext().userId).toBe(USER_B);
      }),
    ]);
  });

  it('a route through the real route factory sees the principal after its guard', async () => {
    process.env[MODE] = 'enforce';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApiRoute } = require('../../../lib/platform/routeFactory');
    let seen: unknown = null;
    const handler = createApiRoute(async (req: any, res: any) => {
      const ok = await enforceCompanyAccess({ req, res, companyId: CO_A });
      if (!ok) return;
      seen = getRequestContext().userId;
      res.status(200).json({ ok: true });
    }, { route: '/api/w2a-test' });
    const r = await invoke(handler, { method: 'GET', as: 'A' });
    expect(r.status).toBe(200);
    expect(seen).toBe(USER_A);
  });
});

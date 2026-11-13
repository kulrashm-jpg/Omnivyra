/**
 * BLOCKING (money), 2026-11-13 - OWNER RULING (via e9): blog repurpose REQUIRES LOGIN and is CHARGED to the caller's
 * company; no anonymous free AI. source=public is just the blog SOURCE. Defence in depth: public-source requests are
 * still limited per trusted client IP and globally, FAIL-CLOSED, before the blog read and the model call.
 * REAL: the route handler, the trusted-IP helper, resolveRedisFailureMode. FAKED: the auth context (membership-
 * checking like the real enforceCompanyAccess), the Redis counters (per key, honouring each config's limit), the DB
 * read, the gateway, and wirePhase2Route (records each billed call and runs the work).
 */
const counters = new Map<string, number>();
const limiterCalls: Array<{ id: string; prefix: string }> = [];
jest.mock('../../../lib/auth/rateLimit', () => {
  const actual = jest.requireActual('../../../lib/auth/rateLimit');
  return {
    ...actual,
    checkRateLimit: async (id: string, cfg: { keyPrefix: string; limit: number }) => {
      limiterCalls.push({ id, prefix: cfg.keyPrefix });
      const k = `${cfg.keyPrefix}:${id}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return { allowed: n <= cfg.limit, remaining: Math.max(0, cfg.limit - n), resetAt: 0, bypassed: false };
    },
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const blogReads: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      blogReads.push(table);
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'b1', title: 'T', tags: [], content_blocks: [], excerpt: 'E', company_id: 'blog-owner-co' }, error: null }) };
      return q;
    },
  },
}));
const modelCalls: unknown[] = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: async (r: unknown) => { modelCalls.push(r); return { output: '{}' }; },
}));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({ resolveCompanyGroundingGuard: async () => ({ directive: '' }) }));

const CALLER_CO = 'caller-co';
const OTHER_CO = 'other-co';
const auth = { userId: 'u1' as string, memberships: new Set<string>([CALLER_CO]) };
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => (auth.userId
    ? { userId: auth.userId, defaultCompanyId: [...auth.memberships][0] ?? '', companyIds: [...auth.memberships], authenticated: true }
    : { userId: '', defaultCompanyId: '', companyIds: [], authenticated: false }),
  enforceCompanyAccess: async ({ res, companyId }: { res: any; companyId: string }) => {
    if (!auth.userId) { res.status(401).json({ error: 'unauthenticated' }); return null; }
    if (!auth.memberships.has(companyId)) { res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' }); return null; }
    return { userId: auth.userId };
  },
}));
const billed: Array<{ organizationId: string; referenceId: string }> = [];
jest.mock('../../services/billing/phase2RouteWiring', () => ({
  wirePhase2Route: async (o: { organizationId: string; referenceId: string; run: () => Promise<unknown> }) => {
    billed.push({ organizationId: o.organizationId, referenceId: o.referenceId });
    return o.run();
  },
}));

import handler, { PUBLIC_REPURPOSE_IP_LIMIT, PUBLIC_REPURPOSE_GLOBAL_LIMIT, PUBLIC_REPURPOSE_COMPANY_LIMIT } from '../../../pages/api/blogs/[id]/repurpose';
import { resolveRedisFailureMode } from '../../../lib/auth/rateLimit';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
async function post(opts: { ip?: string | null; source?: string; companyId?: string } = {}) {
  const res = mockRes();
  await (handler as any)({
    method: 'POST', query: { id: 'b1' },
    body: { source: opts.source ?? 'public', ...(opts.companyId ? { company_id: opts.companyId } : {}) },
    headers: {}, socket: { remoteAddress: opts.ip === undefined ? '203.0.113.7' : (opts.ip ?? 'not-an-ip') },
  }, res);
  return res;
}

beforeEach(() => {
  counters.clear(); limiterCalls.length = 0; blogReads.length = 0; modelCalls.length = 0; billed.length = 0;
  auth.userId = 'u1';
  auth.memberships = new Set([CALLER_CO]);
});

describe('public repurpose: login required, charged to the CALLER', () => {
  it('anonymous -> 401 AUTH_REQUIRED; no blog read, no model call, no charge', async () => {
    auth.userId = '';
    const res = await post();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(blogReads).toHaveLength(0);
    expect(modelCalls).toHaveLength(0);
    expect(billed).toHaveLength(0);
  });

  it("signed in -> ONE billed call for the caller's company (never the blog owner's)", async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(billed).toEqual([expect.objectContaining({ organizationId: CALLER_CO })]);
    expect(modelCalls).toHaveLength(1);
  });

  it('a named company the caller is NOT a member of -> 403, no charge', async () => {
    const res = await post({ companyId: OTHER_CO });
    expect(res.statusCode).toBe(403);
    expect(billed).toHaveLength(0);
  });

  it('TWO active memberships and no company named -> 400 COMPANY_REQUIRED (no charge); naming one charges that one', async () => {
    auth.memberships = new Set([CALLER_CO, OTHER_CO]);
    const res = await post();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('COMPANY_REQUIRED');
    expect(billed).toHaveLength(0);
    const named = await post({ companyId: OTHER_CO });
    expect(named.statusCode).toBe(200);
    expect(billed).toEqual([expect.objectContaining({ organizationId: OTHER_CO })]);
  });

  it('signed in with no active membership -> 403 NO_ACTIVE_COMPANY', async () => {
    auth.memberships = new Set();
    const res = await post();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('NO_ACTIVE_COMPANY');
  });

  it('public and company sources of the same blog id never share a billing reference', async () => {
    await post();
    const res = mockRes();
    await (handler as any)({ method: 'POST', query: { id: 'b1', company_id: CALLER_CO }, body: { source: 'company' }, headers: {}, socket: { remoteAddress: '203.0.113.9' } }, res);
    expect(billed).toHaveLength(2);
    expect(billed[0].referenceId).not.toBe(billed[1].referenceId);
  });
});

describe('public repurpose limits: per COMPANY (real), global (backstop), per IP (loose backstop)', () => {
  it('per company: the cap-th request is served, the next is 429 before any blog read / model call / charge; another company is unaffected', async () => {
    auth.memberships = new Set([CALLER_CO, OTHER_CO]);
    for (let i = 0; i < PUBLIC_REPURPOSE_COMPANY_LIMIT.limit; i++) expect((await post({ companyId: CALLER_CO })).statusCode).toBe(200);
    const before = [blogReads.length, modelCalls.length, billed.length];
    const over = await post({ companyId: CALLER_CO });
    expect(over.statusCode).toBe(429);
    expect(over.body).toEqual({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    expect([blogReads.length, modelCalls.length, billed.length]).toEqual(before);
    expect((await post({ companyId: OTHER_CO })).statusCode).toBe(200);
  });
  it('10 users of 10 companies behind ONE office IP, 5 repurposes each: none throttled (colocation is not abuse)', async () => {
    let served = 0;
    for (let u = 0; u < 10; u++) {
      auth.userId = `u${u}`; auth.memberships = new Set([`co-${u}`]);
      for (let k = 0; k < 5; k++) if ((await post({ ip: '203.0.113.50' })).statusCode === 200) served += 1;
    }
    expect(served).toBe(50);
  });
  it('global backstop: across many companies the global cap holds', async () => {
    let served = 0;
    for (let i = 0; i < PUBLIC_REPURPOSE_GLOBAL_LIMIT.limit + 5; i++) {
      auth.memberships = new Set([`co-g${i}`]);
      if ((await post({ ip: `198.51.${Math.floor(i / 250)}.${i % 250}` })).statusCode === 200) served += 1;
    }
    expect(served).toBe(PUBLIC_REPURPOSE_GLOBAL_LIMIT.limit);
  });
  it('per IP is only a loose burst backstop (well above the per-company cap)', () => {
    expect(PUBLIC_REPURPOSE_IP_LIMIT.limit).toBeGreaterThan(PUBLIC_REPURPOSE_COMPANY_LIMIT.limit);
  });
  it('no trusted client IP: an authenticated, billed request is NOT refused for it', async () => {
    expect((await post({ ip: null })).statusCode).toBe(200);
  });
  it("all limits are 'strict' on a Redis failure (real cap in-process; never closed, never unlimited)", () => {
    for (const cfg of [PUBLIC_REPURPOSE_COMPANY_LIMIT, PUBLIC_REPURPOSE_GLOBAL_LIMIT, PUBLIC_REPURPOSE_IP_LIMIT]) expect(resolveRedisFailureMode(cfg)).toBe('strict');
  });
  it('CONTROL: company-source requests are not touched by the public limiter', async () => {
    const res = mockRes();
    await (handler as any)({ method: 'POST', query: { id: 'b1', company_id: CALLER_CO }, body: { source: 'company' }, headers: {}, socket: { remoteAddress: '203.0.113.9' } }, res);
    expect(limiterCalls.filter((c) => c.prefix.startsWith('rl:public:'))).toHaveLength(0);
  });
});

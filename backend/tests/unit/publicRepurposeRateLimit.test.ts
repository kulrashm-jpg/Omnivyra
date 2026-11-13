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

import handler, { PUBLIC_REPURPOSE_IP_LIMIT, PUBLIC_REPURPOSE_GLOBAL_LIMIT } from '../../../pages/api/blogs/[id]/repurpose';
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

describe('public repurpose: defence-in-depth limiter (fail-closed)', () => {
  it('per IP: over the limit -> 429 before any blog read / model call / charge', async () => {
    for (let i = 0; i < PUBLIC_REPURPOSE_IP_LIMIT.limit; i++) expect((await post()).statusCode).toBe(200);
    const reads = blogReads.length; const calls = modelCalls.length; const charges = billed.length;
    const over = await post();
    expect(over.statusCode).toBe(429);
    expect(over.body).toEqual({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    expect([blogReads.length, modelCalls.length, billed.length]).toEqual([reads, calls, charges]);
    expect((await post({ ip: '203.0.113.8' })).statusCode).toBe(200);
  });
  it('global: across many IPs the global cap holds', async () => {
    const cap = PUBLIC_REPURPOSE_GLOBAL_LIMIT.limit;
    let served = 0;
    for (let i = 0; i < cap + 5; i++) if ((await post({ ip: `198.51.${Math.floor(i / 250)}.${i % 250}` })).statusCode === 200) served += 1;
    expect(served).toBe(cap);
  });
  it('no trusted client IP -> fail closed (429)', async () => {
    expect((await post({ ip: null })).statusCode).toBe(429);
    expect(modelCalls).toHaveLength(0);
  });
  it('both limits FAIL CLOSED when Redis is unavailable', () => {
    expect(resolveRedisFailureMode(PUBLIC_REPURPOSE_IP_LIMIT)).toBe('closed');
    expect(resolveRedisFailureMode(PUBLIC_REPURPOSE_GLOBAL_LIMIT)).toBe('closed');
  });
  it('CONTROL: company-source requests are not touched by the public limiter', async () => {
    const res = mockRes();
    await (handler as any)({ method: 'POST', query: { id: 'b1', company_id: CALLER_CO }, body: { source: 'company' }, headers: {}, socket: { remoteAddress: '203.0.113.9' } }, res);
    expect(limiterCalls.filter((c) => c.prefix.startsWith('rl:public:'))).toHaveLength(0);
  });
});

/**
 * W4 — the two sending-domain routes: authorization happens BEFORE any read or
 * write, the tenant comes from the authorized request, and another tenant's id
 * is a 404. The capability guard is replaced by a recorder; the service runs
 * for real against a database double.
 */
type Row = Record<string, unknown>;

const db = { tables: {} as Record<string, Row[]>, calls: 0, nextId: 1 };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    db.calls += 1;
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<[string, string, unknown]> };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) =>
      k === 'eq' ? r[c] === v : k === 'is' ? (r[c] ?? null) === v : k === 'in' ? (v as unknown[]).includes(r[c]) : true);
    const exec = async (mode: 'many' | 'one') => {
      await Promise.resolve();
      if (st.op === 'insert') {
        const row: Row = { id: `sd-${db.nextId++}`, removed_at: null, dkim_tokens: [], last_error_code: null, last_checked_at: null, verified_at: null, ...st.payload };
        if (table === 'tenant_sending_domains' && rows().some((r) => r.domain === row.domain && r.removed_at == null)) {
          return { data: null, error: { code: '23505', message: 'dup' } };
        }
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return mode === 'one' ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
      }
      const found = rows().filter(match);
      return mode === 'one' ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      single: () => exec('one'),
      maybeSingle: () => exec('one'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const guard = { allow: true, calls: [] as Array<Record<string, unknown>> };
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, options: Record<string, unknown>) => {
    guard.calls.push(options);
    if (!guard.allow) {
      res.status(403).json({ error: 'forbidden' });
      return { ok: false, sent: true };
    }
    return { ok: true, principal: { userId: 'user-42' } };
  },
}));
jest.mock('../../services/emailAuthService', () => ({
  checkEmailAuth: async (domain: string) => ({ spf: false, dmarc: false, configured: false, domain }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/** The established limiter, faked: per-key counters, or a scripted answer/throw. */
const limiter = {
  calls: [] as Array<{ key: string; prefix: string; onRedisFailure: unknown; atDbCalls: number; atGuardCalls: number }>,
  counts: new Map<string, number>(),
  limit: 2,
  answer: null as null | (() => unknown),
};
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: async (key: string, config: { keyPrefix: string; onRedisFailure?: unknown }) => {
    limiter.calls.push({ key, prefix: config.keyPrefix, onRedisFailure: config.onRedisFailure, atDbCalls: db.calls, atGuardCalls: guard.calls.length });
    if (limiter.answer) return limiter.answer();
    const n = (limiter.counts.get(key) ?? 0) + 1;
    limiter.counts.set(key, n);
    return { allowed: n <= limiter.limit, remaining: Math.max(0, limiter.limit - n), resetAt: Math.ceil(Date.now() / 1000) + 120, bypassed: false };
  },
}));

import listHandler from '../../../pages/api/sending-domains/index';
import itemHandler from '../../../pages/api/sending-domains/[id]';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

interface Res { statusCode: number; body: Record<string, unknown>; headers: Record<string, unknown> }
async function call(handler: unknown, method: string, query: Record<string, string>, body: Record<string, unknown> = {}): Promise<Res> {
  const res: Res = { statusCode: 0, body: {}, headers: {} };
  const api = {
    status(c: number) { res.statusCode = c; return api; },
    setHeader(k: string, v: unknown) { res.headers[k] = v; return api; },
    json(b: Record<string, unknown>) { res.body = b; return api; },
  };
  await (handler as (q: unknown, s: unknown) => Promise<void>)({ method, query, body, headers: {} }, api);
  return res;
}

beforeEach(() => {
  db.tables = { company_domains: [{ company_id: ORG_A, final_domain: 'acme.com', verification_status: 'verified' }], tenant_sending_domains: [] };
  db.calls = 0;
  db.nextId = 1;
  guard.allow = true;
  guard.calls = [];
  limiter.calls = [];
  limiter.counts = new Map();
  limiter.limit = 2;
  limiter.answer = null;
});

describe('W4 routes — authorization first', () => {
  it('requires integration.manage on the NAMED tenant', async () => {
    await call(listHandler, 'GET', { companyId: ORG_A });
    expect(guard.calls[0]).toMatchObject({ capability: 'integration.manage', organizationId: ORG_A });
  });

  it.each([
    ['list', listHandler, 'GET', { companyId: ORG_A }],
    ['register', listHandler, 'POST', { companyId: ORG_A }],
    ['read', itemHandler, 'GET', { companyId: ORG_A, id: 'sd-1' }],
    ['refresh', itemHandler, 'POST', { companyId: ORG_A, id: 'sd-1' }],
  ])('a denied %s writes the guard response and touches NO table', async (_label, handler, method, query) => {
    guard.allow = false;
    const res = await call(handler, method as string, query as Record<string, string>, { domain: 'acme.com' });
    expect(res.statusCode).toBe(403);
    expect(db.calls).toBe(0);
  });

  it('a missing companyId is 400 before the guard runs', async () => {
    expect((await call(listHandler, 'GET', {})).statusCode).toBe(400);
    expect((await call(itemHandler, 'GET', { id: 'sd-1' })).statusCode).toBe(400);
    expect(guard.calls).toHaveLength(0);
  });

  it.each([[listHandler], [itemHandler]])('other methods are 405 before the guard', async (handler) => {
    expect((await call(handler, 'DELETE', { companyId: ORG_A, id: 'x' })).statusCode).toBe(405);
    expect(guard.calls).toHaveLength(0);
  });
});

describe('W4 routes — behaviour', () => {
  it('POST registers with the actor from the AUTHENTICATED principal; fails closed while no SES adapter is wired', async () => {
    const res = await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'acme.com', actorUserId: 'spoofed' });
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: 'ses_provider_not_configured' });
    expect(db.tables.tenant_sending_domains[0]).toMatchObject({ created_by: 'user-42', status: 'pending', dkim_tokens: [] });
  });

  it.each([
    ['an invalid domain', 'not a domain', 400],
    ['a domain the tenant does not own', 'other.com', 422],
  ])('POST with %s is refused (%i)', async (_label, domain, status) => {
    expect((await call(listHandler, 'POST', { companyId: ORG_A }, { domain })).statusCode).toBe(status);
  });

  it("POST for a domain another tenant holds is 409", async () => {
    db.tables.tenant_sending_domains.push({ id: 'sd-b', organization_id: ORG_B, domain: 'acme.com', status: 'verified', removed_at: null, dkim_tokens: ['t'] });
    expect((await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'acme.com' })).statusCode).toBe(409);
  });

  it("GET of ANOTHER tenant's domain id is 404 and returns no data", async () => {
    db.tables.tenant_sending_domains.push({ id: 'sd-b', organization_id: ORG_B, domain: 'beta.com', status: 'verified', removed_at: null, dkim_tokens: ['t1'] });
    const res = await call(itemHandler, 'GET', { companyId: ORG_A, id: 'sd-b' });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('beta.com');
  });

  it('GET of an own domain returns DKIM instructions and diagnostics', async () => {
    db.tables.tenant_sending_domains.push({ id: 'sd-a', organization_id: ORG_A, domain: 'acme.com', status: 'pending', removed_at: null, dkim_tokens: ['t1', 't2', 't3'], ses_region: 'eu-north-1', configuration_set_name: 'omnivyra-t-x' });
    const res = await call(itemHandler, 'GET', { companyId: ORG_A, id: 'sd-a' });
    expect(res.statusCode).toBe(200);
    expect((res.body.dnsRecords as unknown[]).length).toBe(3);
  });

  it('GET list returns only this tenant\'s live domains', async () => {
    db.tables.tenant_sending_domains.push(
      { id: 'sd-a', organization_id: ORG_A, domain: 'acme.com', status: 'pending', removed_at: null, dkim_tokens: [] },
      { id: 'sd-b', organization_id: ORG_B, domain: 'beta.com', status: 'verified', removed_at: null, dkim_tokens: [] },
    );
    const res = await call(listHandler, 'GET', { companyId: ORG_A });
    expect((res.body.domains as Array<{ domain: string }>).map((d) => d.domain)).toEqual(['acme.com']);
  });
});

describe('W4 A1 routes — per-tenant SES rate limit', () => {
  const sesPosts: Array<[string, unknown, Record<string, string>]> = [
    ['register', listHandler, { companyId: ORG_A }],
    ['refresh', itemHandler, { companyId: ORG_A, id: 'sd-1' }],
  ];

  it.each(sesPosts)('%s: the limiter runs only AFTER the guard, keyed by the AUTHORIZED tenant, fail-closed config', async (_l, handler, query) => {
    await call(handler, 'POST', query, { domain: 'acme.com', companyId: ORG_B });
    expect(limiter.calls).toHaveLength(1);
    expect(limiter.calls[0]).toMatchObject({ key: ORG_A, prefix: 'rl:tenant:sending_domains_ses', onRedisFailure: 'closed', atGuardCalls: 1 });
  });

  it.each(sesPosts)('%s: a DENIED caller never reaches the limiter (cannot spend the tenant budget)', async (_l, handler, query) => {
    guard.allow = false;
    expect((await call(handler, 'POST', query, { domain: 'acme.com' })).statusCode).toBe(403);
    expect(limiter.calls).toHaveLength(0);
  });

  it.each(sesPosts)('%s: the limiter runs before ANY database access', async (_l, handler, query) => {
    await call(handler, 'POST', query, { domain: 'acme.com' });
    expect(limiter.calls[0].atDbCalls).toBe(0);
  });

  it('over the limit → 429 with Retry-After and the standard body; no table touched', async () => {
    limiter.limit = 0;
    const res = await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'acme.com' });
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests. Try again later.' });
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(db.calls).toBe(0);
  });

  it('register and refresh share ONE budget per tenant; tenants are isolated', async () => {
    db.tables.company_domains.push({ company_id: ORG_B, final_domain: 'beta.com', verification_status: 'verified' });
    expect((await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'acme.com' })).statusCode).not.toBe(429);
    expect((await call(itemHandler, 'POST', { companyId: ORG_A, id: 'sd-1' })).statusCode).not.toBe(429);
    expect((await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'acme.com' })).statusCode).toBe(429);
    // Tenant B is unaffected by A's exhaustion.
    expect((await call(listHandler, 'POST', { companyId: ORG_B }, { domain: 'beta.com' })).statusCode).not.toBe(429);
    expect(limiter.calls.map((c) => c.key)).toEqual([ORG_A, ORG_A, ORG_A, ORG_B]);
  });

  it.each([
    ['the limiter throws', () => { throw new Error('redis down'); }],
    ['Redis was unavailable (closed degraded answer)', () => ({ allowed: false, remaining: 0, resetAt: 0, bypassed: true, degradedMode: 'closed' })],
    ['a degraded answer that would allow', () => ({ allowed: true, remaining: 5, resetAt: 0, bypassed: true, degradedMode: 'fallback' })],
    ['a non-boolean `allowed` from Redis', () => ({ allowed: 'yes', remaining: 5, resetAt: 0, bypassed: false })],
    ['a missing `allowed` from Redis', () => ({ remaining: 5, resetAt: 0, bypassed: false })],
    ['a malformed answer', () => ({ allowed: 'yes' })],
    ['no answer', () => undefined],
  ])('fails CLOSED when %s → 503, no table touched, no internals exposed', async (_l, answer) => {
    limiter.answer = answer;
    for (const [handler, query] of [[listHandler, { companyId: ORG_A }], [itemHandler, { companyId: ORG_A, id: 'sd-1' }]] as const) {
      const res = await call(handler, 'POST', query, { domain: 'acme.com' });
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'temporarily_unavailable' });
    }
    expect(db.calls).toBe(0);
  });

  it('GET reads are not rate-limited (they make no SES call)', async () => {
    limiter.limit = 0;
    expect((await call(listHandler, 'GET', { companyId: ORG_A })).statusCode).toBe(200);
    expect((await call(itemHandler, 'GET', { companyId: ORG_A, id: 'sd-x' })).statusCode).toBe(404);
    expect(limiter.calls).toHaveLength(0);
  });

  it('a reserved platform domain is refused with 422', async () => {
    db.tables.company_domains.push({ company_id: ORG_A, final_domain: 'omnivyra.com', verification_status: 'admin_override' });
    const res = await call(listHandler, 'POST', { companyId: ORG_A }, { domain: 'mail.omnivyra.com' });
    expect(res).toMatchObject({ statusCode: 422, body: { error: 'domain_reserved' } });
  });
});

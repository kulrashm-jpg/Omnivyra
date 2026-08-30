/**
 * ORGACCESS-BINDING-SEC-001 — billing/checkout/close and usage/track.
 *
 * Both mount `withOrgAccess`, whose resolver authorizes:
 *
 *     req.query.org_id || body.org_id || body.organization_id || body.companyId
 *
 * and both previously re-derived the organization themselves.
 *
 *   checkout/close  read `body.org_id ?? body.organization_id`, so a request
 *   carrying `?org_id=<own>` with `{"org_id":"<victim>"}` was authorized against
 *   one organization while closePurchaseFromClient scoped its ownership check —
 *   and therefore the payment-state mutation — to another.
 *
 *   usage/track     read `body.companyId ?? body.org_id ?? body.organization_id`,
 *   i.e. the OPPOSITE precedence to the resolver. That one diverges with NO query
 *   string at all: `{"org_id":"<own>","companyId":"<victim>"}` authorizes the
 *   caller's org and attributes every ingested event to the victim's, because
 *   ingestUsageEvents forces ctx.companyId onto each event.
 *
 * Both now bind to `req.orgAccess.orgId` — the organization the wrapper actually
 * authorized. The real chain runs here: withOrgAccess -> resolver ->
 * assertOrgAccess -> requireTenantAccess -> assertTenantAccess -> handler ->
 * sink. Only the data layer, the principal resolver and the two sinks are
 * mocked, and the assertions inspect which organization reached each sink.
 */

// Module scope, not script scope: without this the file's top-level helpers
// collide with identically named globals in sibling test files.
export {};

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE_B = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const ORG_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const ORG_SUSPENDED = 'e0000000-0000-0000-0000-00000000000e';

const OWN_PURCHASE = '11111111-0000-0000-0000-0000000000p1';
const VICTIM_PURCHASE = '22222222-0000-0000-0000-0000000000p2';

const ROLES = [
  { user_id: MEMBER_A, company_id: ORG_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: ORG_SUSPENDED, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: SUPERADMIN, company_id: ORG_A, role: 'SUPER_ADMIN', status: 'active' },
];
const COMPANY_STATUS: Record<string, string | null> = {
  [ORG_A]: 'active',
  [VICTIM]: 'active',
  [ORG_SUSPENDED]: 'suspended',
};

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
/** Business writes only — the guard's own denial audit is not a tenant sink. */
const writes: Array<{ table: string; payload: any }> = [];
const AUDIT_TABLES = ['capability_audit_log'];
/** Every sink call, with the organization it received. */
const sinks: Array<{ fn: string; org: unknown; args: any }> = [];

jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }),
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    const w = (payload: any) => { if (!AUDIT_TABLES.includes(table)) writes.push({ table, payload }); return b; };
    b.insert = w; b.update = w; b.upsert = w;
    b.delete = () => w(null);
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') {
        const st = COMPANY_STATUS[String(filters.id)];
        return st == null ? [] : [{ id: filters.id, status: st }];
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => Promise.resolve({ data: resolve().data[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: resolve().data[0] ?? null, error: null });
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../services/billing/purchaseClosureService', () => ({
  closePurchaseFromClient: jest.fn(async (args: any) => {
    sinks.push({ fn: 'closePurchaseFromClient', org: args.organizationId, args });
    // Mirror the real service: ownership is scoped to the org handed in.
    const owner = args.purchaseId === VICTIM_PURCHASE ? VICTIM : ORG_A;
    if (owner !== args.organizationId) return { purchaseId: args.purchaseId, action: 'not_found' };
    return { purchaseId: args.purchaseId, action: 'closed' };
  }),
}));

jest.mock('../../services/usage/usageIngestionService', () => ({
  ingestUsageEvents: jest.fn(async (events: any[], ctx: any) => {
    sinks.push({ fn: 'ingestUsageEvents', org: ctx?.companyId, args: { events, ctx } });
    return { ok: true, received: events.length, persisted: events.length, duplicates: 0, rejected: 0, reasons: {} };
  }),
}));

const closeRoute = require('../../../pages/api/billing/checkout/close').default;
const trackRoute = require('../../../pages/api/usage/track').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {}, headersSent: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}

async function call(route: any, user: string | null, opts: { query?: any; body?: any; method?: string }) {
  authUser = user;
  queries.length = 0; writes.length = 0; sinks.length = 0;
  const res = mockRes();
  await route(
    { method: opts.method ?? 'POST', url: '/x', headers: {}, query: opts.query ?? {}, body: opts.body ?? {} } as never,
    res,
  );
  return res;
}

const EVENT = { eventId: 'e1', type: 'feature.used', occurredAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => { authUser = MEMBER_A; superAdmins = [SUPERADMIN]; });

/* ────────────────────────────────────────────────────────────────────────────
 * checkout/close
 * ──────────────────────────────────────────────────────────────────────────── */
describe('billing/checkout/close — org binding', () => {
  const closeBody = (extra: any = {}) => ({ purchase_id: OWN_PURCHASE, reason: 'client_cancelled', ...extra });

  it('unauthenticated reaches no sink', async () => {
    const res = await call(closeRoute, null, { body: closeBody({ org_id: ORG_A }) });
    expect(res.statusCode).toBe(401);
    expect(sinks).toEqual([]);
  });

  it('a bogus principal reaches no sink', async () => {
    const res = await call(closeRoute, null, { query: { org_id: ORG_A }, body: closeBody() });
    expect(res.statusCode).toBe(401);
    expect(sinks).toEqual([]);
  });

  it('the own organization closes its own purchase', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_A }) });
    expect(res.statusCode).toBe(200);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('CRITICAL query org = attacker, body org = victim cannot redirect the sink', async () => {
    const res = await call(closeRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: closeBody({ org_id: VICTIM, purchase_id: VICTIM_PURCHASE }),
    });
    for (const s of sinks) expect(s.org).toBe(ORG_A);
    expect(sinks.every(s => s.org !== VICTIM)).toBe(true);
    // The victim's purchase is not closable by this caller.
    expect(res.statusCode).toBe(404);
  });

  it('query absent, body org = attacker still authorizes and binds to the attacker org', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_A }) });
    expect(res.statusCode).toBe(200);
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('CRITICAL body org_id = attacker while another alias names the victim', async () => {
    await call(closeRoute, MEMBER_A, {
      body: closeBody({ org_id: ORG_A, organization_id: VICTIM, companyId: VICTIM }),
    });
    for (const s of sinks) expect(s.org).toBe(ORG_A);
  });

  it('CRITICAL every alias conflicting at once cannot redirect the sink', async () => {
    await call(closeRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: closeBody({
        org_id: VICTIM, organization_id: VICTIM, companyId: VICTIM,
        organizationId: VICTIM, orgId: VICTIM, purchase_id: VICTIM_PURCHASE,
      }),
    });
    for (const s of sinks) expect(s.org).toBe(ORG_A);
    expect(writes).toEqual([]);
  });

  it('a stale (inactive) membership is refused', async () => {
    const res = await call(closeRoute, STALE_B, { body: closeBody({ org_id: VICTIM }) });
    expect([401, 403]).toContain(res.statusCode);
    expect(sinks).toEqual([]);
  });

  it('a suspended organization is refused', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_SUSPENDED }) });
    expect([403, 404]).toContain(res.statusCode);
    expect(sinks).toEqual([]);
  });

  it('a malformed org reaches no sink', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: "x' OR 1=1--" }) });
    expect(res.statusCode).not.toBe(200);
    expect(sinks).toEqual([]);
  });

  it('a foreign purchase reports not_found rather than closing', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_A, purchase_id: VICTIM_PURCHASE }) });
    expect(res.statusCode).toBe(404);
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('a missing purchase_id is rejected before the sink', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: { org_id: ORG_A } });
    expect(res.statusCode).toBe(400);
    expect(sinks).toEqual([]);
  });

  it('an invalid reason is rejected before the sink', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_A, reason: 'anything' }) });
    expect(res.statusCode).toBe(400);
    expect(sinks).toEqual([]);
  });

  it('a super admin keeps the platform bypass', async () => {
    const res = await call(closeRoute, SUPERADMIN, { body: closeBody({ org_id: VICTIM, purchase_id: VICTIM_PURCHASE }) });
    expect(res.statusCode).not.toBe(403);
    expect(sinks[0].org).toBe(VICTIM);
  });

  it('a non-POST verb reaches nothing', async () => {
    const res = await call(closeRoute, MEMBER_A, { body: closeBody({ org_id: ORG_A }), method: 'GET' });
    expect(res.statusCode).toBe(405);
    expect(sinks).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * usage/track
 * ──────────────────────────────────────────────────────────────────────────── */
describe('usage/track — org binding', () => {
  it('unauthenticated reaches no sink', async () => {
    const res = await call(trackRoute, null, { body: { org_id: ORG_A, events: [EVENT] } });
    expect(res.statusCode).toBe(401);
    expect(sinks).toEqual([]);
  });

  it('a legitimate body.org_id attributes to that org', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { org_id: ORG_A, events: [EVENT] } });
    expect(res.statusCode).toBe(202);
    expect(sinks[0].fn).toBe('ingestUsageEvents');
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('a legitimate body.companyId still works (resolver falls through to it)', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { companyId: ORG_A, events: [EVENT] } });
    expect(res.statusCode).toBe(202);
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('CRITICAL org_id = attacker + companyId = victim attributes to the ATTACKER (no query needed)', async () => {
    // This is the shape that needed no query string: the resolver prefers
    // org_id, the handler used to prefer companyId.
    const res = await call(trackRoute, MEMBER_A, {
      body: { org_id: ORG_A, companyId: VICTIM, events: [EVENT] },
    });
    expect(res.statusCode).toBe(202);
    expect(sinks[0].org).toBe(ORG_A);
    expect(sinks[0].org).not.toBe(VICTIM);
  });

  it('CRITICAL org_id = victim + companyId = attacker is refused, not silently re-attributed', async () => {
    // The resolver authorizes org_id (the victim), which the caller cannot access.
    const res = await call(trackRoute, MEMBER_A, {
      body: { org_id: VICTIM, companyId: ORG_A, events: [EVENT] },
    });
    expect(res.statusCode).toBe(403);
    expect(sinks).toEqual([]);
  });

  it('CRITICAL every alias conflicting at once cannot redirect attribution', async () => {
    const res = await call(trackRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: {
        org_id: VICTIM, organization_id: VICTIM, companyId: VICTIM,
        organizationId: VICTIM, orgId: VICTIM, events: [EVENT],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('a per-event companyId cannot override the authorized org', async () => {
    await call(trackRoute, MEMBER_A, {
      body: { org_id: ORG_A, events: [{ ...EVENT, companyId: VICTIM }] },
    });
    expect(sinks[0].org).toBe(ORG_A);
  });

  it('a missing organization is rejected before the sink', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { events: [EVENT] } });
    expect(res.statusCode).toBe(400);
    expect(sinks).toEqual([]);
  });

  it('a stale (inactive) membership is refused', async () => {
    const res = await call(trackRoute, STALE_B, { body: { org_id: VICTIM, events: [EVENT] } });
    expect([401, 403]).toContain(res.statusCode);
    expect(sinks).toEqual([]);
  });

  it('a suspended organization is refused', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { org_id: ORG_SUSPENDED, events: [EVENT] } });
    expect([403, 404]).toContain(res.statusCode);
    expect(sinks).toEqual([]);
  });

  it('a malformed organization reaches no sink', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { org_id: "x' OR 1=1--", events: [EVENT] } });
    expect(res.statusCode).not.toBe(202);
    expect(sinks).toEqual([]);
  });

  it('a super admin keeps the platform bypass', async () => {
    const res = await call(trackRoute, SUPERADMIN, { body: { org_id: VICTIM, events: [EVENT] } });
    expect(res.statusCode).toBe(202);
    expect(sinks[0].org).toBe(VICTIM);
  });

  it('a non-POST verb reaches nothing', async () => {
    const res = await call(trackRoute, MEMBER_A, { body: { org_id: ORG_A, events: [EVENT] }, method: 'GET' });
    expect(res.statusCode).toBe(405);
    expect(sinks).toEqual([]);
  });
});

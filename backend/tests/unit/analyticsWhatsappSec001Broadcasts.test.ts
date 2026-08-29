/**
 * ANALYTICS-WHATSAPP-SEC-001 — GET /api/analytics/whatsapp/broadcasts.
 *
 * The last analytics route on the tenant-authz grandfathered list, and it
 * carried the same defect its siblings did: authentication proved WHO the
 * caller was and nothing about WHICH company they could read. `company_id`
 * arrived in the query string and went straight into a service-role predicate
 * that bypasses RLS, so any authenticated user could read another company's
 * WhatsApp broadcast analytics by naming its id.
 *
 * whatsapp_broadcasts is company-anchored — company_id uuid, no user_id — so
 * company_id IS the canonical tenant field and requireCompanyAccess is the
 * correct primitive.
 *
 * The REAL authorization primitive runs here: only the data layer and the auth
 * seam are mocked, so requireCompanyAccess → assertTenantAccess → the actual
 * membership/org decision tree is exercised rather than simulated. Assertions
 * inspect the SINK — the predicate the whatsapp_broadcasts query actually
 * carried — not merely the HTTP status.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';

const MEMBERSHIPS: Record<string, string> = {
  [`${MEMBER_A}:${COMPANY_A}`]: 'COMPANY_ADMIN',
};

/** COMPANY_B's broadcast. Its name is the canary: it must never be returned. */
const BROADCASTS = [
  {
    id: 'bb000000-0000-0000-0000-0000000000bb', company_id: COMPANY_B,
    name: 'VICTIM_TENANT_CAMPAIGN', template_name: 'victim_template', status: 'sent',
    total_recipients: 100, sent_count: 100, delivered_count: 90, read_count: 40,
    failed_count: 10, created_at: '2026-01-01', completed_at: '2026-01-01',
  },
  {
    id: 'aa000000-0000-0000-0000-0000000000aa', company_id: COMPANY_A,
    name: 'Own Campaign', template_name: 'own_template', status: 'sent',
    total_recipients: 10, sent_count: 10, delivered_count: 8, read_count: 5,
    failed_count: 1, created_at: '2026-01-02', completed_at: '2026-01-02',
  },
];

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

type Q = { table: string; filters: Record<string, unknown> };
const queries: Q[] = [];
const writes: Array<{ table: string; payload: unknown }> = [];

/** Queries against the analytics sink, excluding the guard's own lookups. */
const sinkQueries = () =>
  queries.filter(q => !['user_company_roles', 'companies'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@example.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }
  ),
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
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[`${c}__gte`] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[`${c}__lte`] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    b.range = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return Promise.resolve({ error: null }); };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      if (table === 'user_company_roles') {
        const role = MEMBERSHIPS[`${filters.user_id}:${filters.company_id}`];
        return { data: role ? { role, status: 'active' } : null, error: null };
      }
      if (table === 'companies') return { data: { id: filters.id, status: 'active' }, error: null };
      if (table === 'whatsapp_broadcasts') {
        // Honour the predicate exactly. If the tenant filter were ever dropped,
        // the victim row would flow into the response and the canary fires.
        const rows = filters.company_id === undefined
          ? BROADCASTS
          : BROADCASTS.filter(x => x.company_id === filters.company_id);
        return { data: rows, count: rows.length, error: null };
      }
      return { data: [], count: 0, error: null };
    };
    b.maybeSingle = () => Promise.resolve(resolve());
    b.single = () => Promise.resolve(resolve());
    b.then = (r: any) => Promise.resolve(resolve()).then(r);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/analytics/whatsapp/broadcasts';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(as: string | null, query: Record<string, unknown> = {}, method = 'GET') {
  authUser = as;
  const res = mockRes();
  await handler({ method, url: '/api/analytics/whatsapp/broadcasts', query, body: {}, headers: {} } as never, res);
  return res;
}

/** The victim tenant appears nowhere in the payload, by id or by content. */
function assertNoVictimData(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain('VICTIM_TENANT_CAMPAIGN');
  expect(blob).not.toContain('victim_template');
  expect(blob).not.toContain(COMPANY_B);
}

beforeEach(() => {
  authUser = MEMBER_A;
  superAdmins = [SUPERADMIN];
  queries.length = 0; writes.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it('CRITICAL: 401, and the broadcasts table is never queried', async () => {
    const res = await call(null, { company_id: COMPANY_B });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(sinkQueries()).toEqual([]);
  });

  it('invalid authentication is refused identically', async () => {
    const res = await call(null, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(401);
    assertNoVictimData(res.body);
  });
});

/* ── B — legitimate access preserved ──────────────────────────────────── */

describe('B — an authenticated member reading their OWN company', () => {
  it('still gets their broadcasts', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Own Campaign');
  });

  it('the computed rates and summary still work', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_A });
    expect(res.body.data[0].delivery_rate).toBe(80);
    expect(res.body.summary.total_delivered).toBe(8);
    expect(res.body.total).toBe(1);
  });

  it('the sink predicate is the authorized company', async () => {
    await call(MEMBER_A, { company_id: COMPANY_A });
    const sink = sinkQueries().find(q => q.table === 'whatsapp_broadcasts');
    expect(sink).toBeDefined();
    expect(sink!.filters.company_id).toBe(COMPANY_A);
  });
});

/* ── C/D — another company, and a caller-supplied victim id ───────────── */

describe('C/D — an authenticated caller naming another company', () => {
  it('CRITICAL: 403, and the broadcasts table is never queried', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(sinkQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('CRITICAL: the victim company never reaches any analytics query', async () => {
    await call(MEMBER_A, { company_id: COMPANY_B });
    const leaked = sinkQueries().filter(q => JSON.stringify(q.filters).includes(COMPANY_B));
    expect(leaked).toEqual([]);
  });

  it('the supplied id is not turned into authorization', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_B });
    expect(res.statusCode).not.toBe(200);
    expect(res.body.data).toBeUndefined();
  });
});

/* ── E — other caller-controlled selectors cannot widen scope ─────────── */

describe('E — no other selector widens the tenant scope', () => {
  it('status/date/pagination filters cannot reach another tenant', async () => {
    await call(MEMBER_A, {
      company_id: COMPANY_A, status: 'sent',
      date_from: '2020-01-01', date_to: '2030-01-01', page: '1', per_page: '100',
    });
    for (const q of sinkQueries()) {
      expect(JSON.stringify(q.filters)).not.toContain(COMPANY_B);
      expect(q.filters.company_id).toBe(COMPANY_A);
    }
  });

  it('a scope-like parameter is not honoured — there is no privileged mode', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_B, scope: 'platform', admin: 'true' });
    expect(res.statusCode).toBe(403);
    expect(sinkQueries()).toEqual([]);
  });

  it('pagination is clamped and cannot be used to escape the predicate', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_A, per_page: '99999', page: '-5' });
    expect(res.statusCode).toBe(200);
    expect(res.body.per_page).toBe(100);
    expect(res.body.page).toBe(1);
  });
});

/* ── F — privileged behaviour preserved ───────────────────────────────── */

describe('F — platform super-admin', () => {
  it('keeps the established bypass', async () => {
    const res = await call(SUPERADMIN, { company_id: COMPANY_B });
    expect(res.statusCode).toBe(200);
    const sink = sinkQueries().find(q => q.table === 'whatsapp_broadcasts');
    expect(sink!.filters.company_id).toBe(COMPANY_B);
  });
});

/* ── G/H — unknown company and malformed input ────────────────────────── */

describe('G/H — unknown and malformed identifiers', () => {
  it('a company the caller is not in is denied, existent or not', async () => {
    const unknown = await call(MEMBER_A, { company_id: 'ffffffff-0000-0000-0000-0000000000ff' });
    const foreign = await call(MEMBER_A, { company_id: COMPANY_B });
    expect(unknown.statusCode).toBe(403);
    expect(foreign.statusCode).toBe(403);
    expect(sinkQueries()).toEqual([]);
  });

  it('a missing company_id is rejected before authorization', async () => {
    const res = await call(MEMBER_A, {});
    expect(res.statusCode).toBe(400);
    expect(sinkQueries()).toEqual([]);
  });

  it('a malformed company_id cannot bypass the guard or leak internals', async () => {
    const res = await call(MEMBER_A, { company_id: "not-a-uuid' OR 1=1--" });
    expect(res.statusCode).not.toBe(200);
    expect(sinkQueries()).toEqual([]);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('syntax');
    expect(blob).not.toContain('whatsapp_broadcasts');
  });
});

/* ── side effects ─────────────────────────────────────────────────────── */

describe('the route is read-only', () => {
  it('a non-GET verb reaches nothing', async () => {
    const res = await call(MEMBER_A, { company_id: COMPANY_A }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(sinkQueries()).toEqual([]);
  });

  it('CRITICAL: no denial path writes anything', async () => {
    await call(null, { company_id: COMPANY_B });
    await call(MEMBER_A, { company_id: COMPANY_B });
    await call(MEMBER_A, {});
    expect(writes).toEqual([]);
  });

  it('even a successful read writes nothing', async () => {
    await call(MEMBER_A, { company_id: COMPANY_A });
    expect(writes).toEqual([]);
  });
});

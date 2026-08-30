/**
 * GROWTH-COMMUNITY-SEC-001 — GET /api/growth-intelligence/community.
 *
 * THE DEFECT
 *
 *     withRBAC / requireCompanyContext   authorize   req.query.companyId  = A
 *     getCommunityEngagementMetrics(supabase, req.query.organizationId = B)
 *       -> community_ai_actions.eq('organization_id', B)
 *
 * `organizationId` merely "defaulted to" companyId, so nothing bound A to B.
 * `community_ai_actions.organization_id` is a companies(id) value in this
 * schema, so B is another tenant and A's members could read its engagement.
 *
 * THE BINDING
 *
 * The read is bound to `req.rbac.companyId` — the exact value withRBAC passed
 * to enforceRole (WITHRBAC-STRUCT-001) — not to a comparison of the two
 * caller-supplied parameters. A named organizationId is a scope REQUEST: it is
 * accepted only when it names the already-authorized company, and refused
 * BEFORE the read, so the sink is never reached with a foreign identity.
 *
 * The REAL chain runs here: withRBAC -> enforceRole -> getUserRole ->
 * handler -> requireCompanyContext -> enforceCompanyAccess -> assertTenantAccess
 * -> getCommunityEngagementMetrics' own query. Only the data layer and the auth
 * seam are mocked; assertions inspect the predicates the queries actually
 * carried.
 */

const USER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const USER_OUTSIDER = 'dddddddd-0000-0000-0000-0000000000dd';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM_B = 'b0000000-0000-0000-0000-00000000000b';

/** Memberships. USER_A belongs to A only; USER_OUTSIDER belongs to nothing. */
const ROLES = [
  { id: 'r1', user_id: USER_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
];

const COMPANIES = [
  { id: COMPANY_A, status: 'active' },
  { id: VICTIM_B, status: 'active' },
];

/**
 * Sink data. The two tenants are deliberately given DIFFERENT, recognisable
 * shapes so a leak is visible in the numbers, not only in the status code:
 * A has exactly one reply; the victim has three likes.
 */
const ACTIONS = [
  { organization_id: COMPANY_A, status: 'executed', action_type: 'reply' },
  { organization_id: VICTIM_B, status: 'executed', action_type: 'like' },
  { organization_id: VICTIM_B, status: 'executed', action_type: 'like' },
  { organization_id: VICTIM_B, status: 'executed', action_type: 'like' },
];

let authUser: string | null = USER_A;

/** Every query issued, with the predicates it carried. */
const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown }> = [];

/** Reads that actually hit the tenant sink. */
const actionQueries = () => queries.filter((q) => q.table === 'community_ai_actions');

/**
 * The env schema is validated lazily on first `config` access, and the
 * unauthenticated path reaches it (devIdentityOptIn reads DEV_USER_ID). There is
 * no `.env.test` in a clean checkout, so the real config throws a ZodError that
 * has nothing to do with this route. DEV_USER_ID is deliberately absent below,
 * which is exactly production's shape: no synthetic dev identity.
 */
jest.mock('@/config', () => ({
  config: { NODE_ENV: 'test' },
  getValidatedConfig: () => ({ NODE_ENV: 'test' }),
}));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }
  ),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: null }); return b; };

    const matches = (row: Record<string, unknown>) =>
      Object.entries(filters).every(([col, want]) =>
        Array.isArray(want) ? want.includes(row[col]) : row[col] === want
      );

    const rows = (): any[] => {
      if (table === 'user_company_roles') return ROLES.filter(matches);
      if (table === 'companies') return COMPANIES.filter(matches);
      // The sink honours its predicate EXACTLY — this is what makes a foreign
      // organization_id return the foreign tenant's rows if one ever reaches it.
      if (table === 'community_ai_actions') return ACTIONS.filter(matches);
      return [];
    };

    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };

    b.maybeSingle = () => Promise.resolve({ data: resolve().data[0] ?? null, error: null });
    b.single = () => {
      const r = resolve();
      return Promise.resolve({ data: r.data[0] ?? null, error: r.data.length ? null : { message: 'no rows' } });
    };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/growth-intelligence/community';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

/**
 * withRBAC resolves `req.query.companyId || req.body.companyId`, and enforceRole
 * answers 400 without one, so a companyId must be present to reach the handler
 * at all. Callers therefore name their OWN company by default — which is also
 * the exploit's shape: authorize for a company you belong to, then name another
 * company's organizationId.
 */
async function call(as: string | null, query: Record<string, unknown> = {}, method = 'GET') {
  authUser = as;
  const res = mockRes();
  const q = { companyId: COMPANY_A, ...query };
  await handler(
    { method, url: '/api/growth-intelligence/community', query: q, body: {}, headers: {} } as never,
    res
  );
  return res;
}

/** Nothing about the victim tenant leaked into the response. */
function noVictimLeak(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain(VICTIM_B);
  // The victim's distinctive shape: 3 executed actions, all likes.
  expect((body as any)?.data?.likes ?? 0).toBe(0);
  expect((body as any)?.data?.executedActions ?? 0).not.toBe(3);
}

/** No read ever carried the victim's identity into the tenant sink. */
function sinkNeverTouchedVictim() {
  for (const q of actionQueries()) {
    expect(q.filters.organization_id).not.toBe(VICTIM_B);
  }
}

beforeEach(() => {
  authUser = USER_A;
  queries.length = 0;
  writes.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

/* ── authentication ───────────────────────────────────────────────────── */

describe('authentication', () => {
  it('unauthenticated → rejected, and the tenant sink is never queried', async () => {
    const res = await call(null, { organizationId: VICTIM_B });
    expect(res.statusCode).toBe(401);
    expect(actionQueries()).toEqual([]);
    noVictimLeak(res.body);
  });

  it('unauthenticated on a plain, well-formed request is refused the same way', async () => {
    const res = await call(null);
    expect(res.statusCode).toBe(401);
    expect(actionQueries()).toEqual([]);
  });

  it('an authenticated principal who belongs to no company is rejected before the read', async () => {
    const res = await call(USER_OUTSIDER);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(actionQueries()).toEqual([]);
  });
});

/* ── the authorized tenant is the operative tenant ────────────────────── */

describe('tenant binding', () => {
  it('A operating on A → allowed, and the read carries A', async () => {
    const res = await call(USER_A);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { executedActions: 1, replies: 1, likes: 0, shares: 0 },
    });
    expect(actionQueries()).toHaveLength(1);
    expect(actionQueries()[0].filters.organization_id).toBe(COMPANY_A);
    expect(actionQueries()[0].filters.status).toBe('executed');
  });

  it('A naming its OWN organizationId explicitly → still allowed, still bound to A', async () => {
    const res = await call(USER_A, { organizationId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ executedActions: 1, replies: 1, likes: 0, shares: 0 });
    expect(actionQueries()[0].filters.organization_id).toBe(COMPANY_A);
  });

  it('CRITICAL: A operating on B → rejected; the sink is NEVER called with B and no B data is returned', async () => {
    const res = await call(USER_A, { organizationId: VICTIM_B });

    // The SINK assertions come first, deliberately: they are stronger than the
    // status code. Authorization is decided BEFORE the read, so the sink is not
    // reached at all — a version that read first and compared afterwards, or one
    // that trusted the caller's organizationId, fails here rather than on 403.
    expect(actionQueries()).toEqual([]);
    sinkNeverTouchedVictim();
    noVictimLeak(res.body);

    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: naming B as the PRIMARY companyId is rejected too, with no read', async () => {
    const res = await call(USER_A, { companyId: VICTIM_B, organizationId: VICTIM_B });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).not.toBe(200);
    expect(actionQueries()).toEqual([]);
    sinkNeverTouchedVictim();
    noVictimLeak(res.body);
  });

  it("CRITICAL: the RESPONSE carries none of the victim's data, asserted on its own", async () => {
    // Independent of the sink assertions above: even if the read were somehow
    // reached, the victim's distinctive shape (3 executed actions, all likes)
    // must never appear in what the caller receives.
    const res = await call(USER_A, { organizationId: VICTIM_B });
    noVictimLeak(res.body);
    expect(res.body?.data).toBeUndefined();
  });

  it('a whitespace-padded foreign organizationId does not slip past the binding', async () => {
    const res = await call(USER_A, { organizationId: `  ${VICTIM_B}  ` });
    expect(actionQueries()).toEqual([]);
    sinkNeverTouchedVictim();
    noVictimLeak(res.body);
    expect(res.statusCode).toBe(403);
  });

  it('the route is read-only: no write ever reaches the database', async () => {
    await call(USER_A);
    await call(USER_A, { organizationId: VICTIM_B });
    expect(writes).toEqual([]);
  });
});

/* ── the route still works ────────────────────────────────────────────── */

describe('functional contract', () => {
  it('a legitimate request returns the full metric shape', async () => {
    const res = await call(USER_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['executedActions', 'likes', 'replies', 'shares'].sort()
    );
  });

  it('a non-GET method is still refused with 405', async () => {
    const res = await call(USER_A, {}, 'POST');
    expect(res.statusCode).toBe(405);
    expect(actionQueries()).toEqual([]);
  });
});

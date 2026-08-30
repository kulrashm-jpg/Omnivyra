/**
 * ENGAGEMENT-UNIFIED-SEC-001 — GET /api/engagement/unified.
 *
 * The route had NO authentication and NO authorization. Its only wrapper was
 * createApiRoute(handler, { route }), which is pass-through observability, so
 * a caller-supplied `organization_id` went straight into
 * `.eq('organization_id', orgId)` on the service-role client that bypasses
 * RLS. An ANONYMOUS caller who knew an organization uuid could read that
 * tenant's whole engagement inbox — suggested reply text, intent
 * classification, tone, status, target ids and discovered user ids.
 *
 * The REAL authorization chain runs in every test here:
 *   resolveUserContext -> enforceCompanyAccess -> assertTenantAccess
 *   -> user_company_roles / companies, plus the invited-admin fallback via
 *      getCompanyRoleIncludingInvited.
 * Only the auth seam (supabaseAuthService / IdentityResolver) and the data
 * layer are mocked, so the actual membership decision tree is exercised.
 *
 * Assertions inspect the SINK: whether community_ai_actions was queried at
 * all, and with which organization_id predicate. Asserting the status code
 * alone would not prove the victim's rows were never fetched.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';

/** Only MEMBER_A/COMPANY_A is an active membership. Nobody is a member of B. */
const ROLES: Array<{ user_id: string; company_id: string; role: string; status: string }> = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
];

/** Marker strings that must never appear in a rejected response. */
const VICTIM_TEXT = 'VICTIM_ENGAGEMENT_SUGGESTED_TEXT';
const VICTIM_USER = 'VICTIM_DISCOVERED_USER';

let authUser: string | null = MEMBER_A;

type Q = { table: string; filters: Record<string, unknown> };
const queries: Q[] = [];
const writes: Array<{ table: string; payload: unknown }> = [];

/** The read sink under audit, excluding the authorization chain's own lookups. */
const inboxQueries = () => queries.filter((q) => q.table === 'community_ai_actions');

/*
 * `@/config` is a Proxy that THROWS on every property access when env
 * validation fails, and no `.env.test` exists in the repo. Left real, the
 * authorization chain dies inside resolveUserContext/TenantGuard and the
 * route's own try/catch turns a security decision into a 200 — which is
 * exactly the failure this suite must not be blind to. Stubbed with a
 * permissive, non-throwing config so the REAL decision tree runs:
 * DEV_USER_ID is empty, so the synthetic dev identity stays off and an
 * unauthenticated caller is genuinely unauthenticated.
 */
jest.mock('@/config', () => {
  const values: Record<string, unknown> = { NODE_ENV: 'test', DEV_USER_ID: '', DEV_ROLE: '', DEV_COMPANY_IDS: '' };
  const config = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => values[prop],
    has: () => true,
  });
  return { config, getConfig: () => config, getConfigError: () => null, getConfigState: () => ({ ok: true }) };
});

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@example.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }
  ),
}));

jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }
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
    b.range = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return Promise.resolve({ error: null }); };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: 'delete' }); return b; };

    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        // The `role` predicate MUST be honoured: the platform-super-admin
        // probe selects by role alone, so ignoring it would hand every
        // caller a super-admin bypass and mask the very defect under test.
        return ROLES.filter((r) =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status)
        );
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active' }];
      if (table === 'community_ai_actions') {
        // Every organization has inbox rows; the org id is stamped into the
        // payload so a leak is visible in the response body itself.
        const org = String(filters.organization_id ?? '');
        if (!org) return [];
        const victim = org === COMPANY_B;
        return [{
          id: `act-${org}`,
          platform: 'linkedin',
          action_type: 'comment',
          target_id: `tgt-${org}`,
          suggested_text: victim ? VICTIM_TEXT : 'own org suggested text',
          intent_classification: { sentiment: 'negative' },
          tone: 'negative',
          status: 'pending',
          discovered_user_id: victim ? VICTIM_USER : 'own-user',
          created_at: '2026-01-01T00:00:00.000Z',
        }];
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const data = rows();
      return { data, count: data.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import unifiedHandler from '../../../pages/api/engagement/unified';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(as: string | null, query: Record<string, unknown>, method = 'GET') {
  authUser = as;
  const res = mockRes();
  await (unifiedHandler as any)(
    { method, url: '/api/engagement/unified', query, body: {}, headers: {} } as never,
    res,
  );
  return res;
}

/** Stronger than a status assertion: no B row may appear anywhere in the body. */
function assertNoVictimData(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain(VICTIM_TEXT);
  expect(blob).not.toContain(VICTIM_USER);
  expect(blob).not.toContain(COMPANY_B);
}

/** The read sink was never reached with the victim tenant's identity. */
function assertSinkNeverSawCompanyB() {
  for (const q of inboxQueries()) {
    expect(q.filters.organization_id).not.toBe(COMPANY_B);
  }
}

beforeEach(() => {
  authUser = MEMBER_A;
  queries.length = 0;
  writes.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/engagement/unified — ENGAGEMENT-UNIFIED-SEC-001', () => {
  it('A CRITICAL: an unauthenticated caller is rejected and the inbox is never queried', async () => {
    const res = await call(null, { organization_id: COMPANY_B });

    expect(res.statusCode).toBe(401);
    // Sink assertion — the defect was an anonymous read, so the query must not exist at all.
    expect(inboxQueries()).toEqual([]);
    assertSinkNeverSawCompanyB();
    assertNoVictimData(res.body);
  });

  it('A2: an unauthenticated caller naming an own-looking org is still rejected', async () => {
    const res = await call(null, { organization_id: COMPANY_A });

    expect(res.statusCode).toBe(401);
    expect(inboxQueries()).toEqual([]);
  });

  it('B: authenticated tenant A reading A is allowed and still returns its inbox', async () => {
    const res = await call(MEMBER_A, { organization_id: COMPANY_A });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(`act-${COMPANY_A}`);
    // The legitimate read is genuinely served, not merely non-403.
    expect(res.body.items[0].suggested_text).toBe('own org suggested text');
  });

  it('C CRITICAL: authenticated tenant A reading B is rejected, and the sink never saw B', async () => {
    const res = await call(MEMBER_A, { organization_id: COMPANY_B });

    expect(res.statusCode).toBe(403);
    // Sink assertion — proves the rejection happened BEFORE the read, not after it.
    expect(inboxQueries()).toEqual([]);
    assertSinkNeverSawCompanyB();
    assertNoVictimData(res.body);
  });

  it('C2: the camelCase alias cannot smuggle another tenant past the guard', async () => {
    const res = await call(MEMBER_A, { organizationId: COMPANY_B });

    expect(res.statusCode).toBe(403);
    expect(inboxQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('D: the read predicate is the AUTHORIZED organization, never a caller-selected one', async () => {
    await call(MEMBER_A, { organization_id: COMPANY_A });

    const sink = inboxQueries();
    expect(sink).toHaveLength(1);
    expect(sink[0].filters.organization_id).toBe(COMPANY_A);
  });

  it('E: with no organization_id the session default is used and authorized', async () => {
    const res = await call(MEMBER_A, {});

    expect(res.statusCode).toBe(200);
    const sink = inboxQueries();
    expect(sink).toHaveLength(1);
    // Bound to the session's own tenant — not to anything the caller supplied.
    expect(sink[0].filters.organization_id).toBe(COMPANY_A);
  });

  it('F: a role/scope flag in the query string is not a privilege grant', async () => {
    const res = await call(MEMBER_A, {
      organization_id: COMPANY_B,
      scope: 'platform',
      role: 'SUPER_ADMIN',
      isAdmin: 'true',
    });

    expect(res.statusCode).toBe(403);
    expect(inboxQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('G: sentiment filtering still works for the authorized tenant', async () => {
    const res = await call(MEMBER_A, { organization_id: COMPANY_A, sentiment: 'negative' });

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].sentiment).toBe('negative');
    expect(res.body.items[0].priority_score).toBe(1);
  });

  it('H: a non-GET method is refused before any authorization or read', async () => {
    const res = await call(MEMBER_A, { organization_id: COMPANY_A }, 'POST');

    expect(res.statusCode).toBe(405);
    expect(inboxQueries()).toEqual([]);
  });

  it('I: the route remains read-only — no write sink is ever exercised', async () => {
    await call(MEMBER_A, { organization_id: COMPANY_A });
    await call(MEMBER_A, { organization_id: COMPANY_B });

    expect(writes).toEqual([]);
  });
});

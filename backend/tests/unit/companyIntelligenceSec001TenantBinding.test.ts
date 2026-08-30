/**
 * COMPANY-INTELLIGENCE-SEC-001 — the five company-intelligence config routes
 * mutated rows selected by ID ALONE.
 *
 * The routes authorize correctly: each calls requireCompanyContext ->
 * enforceCompanyAccess -> assertTenantAccess against the request's companyId,
 * and the LIST reads are filtered by company_id. But every mutation was handed
 * only the row id:
 *
 *     updateTopic(id, topic)            ->  .update(...).eq('id', id)
 *     setTopicEnabled(id, enabled)      ->  .update(...).eq('id', id)
 *     ... and the same for competitors, products, regions and keywords
 *
 * so a COMPANY_ADMIN of company A, naming their OWN companyId to satisfy both
 * withRBAC and the company guard, could pass company B's row id and rewrite or
 * disable B's intelligence configuration. updateCompetitor was worse: it read
 * the row's own company_id back and validated the new name against THAT — the
 * victim's company drove the (network-calling) competitor engine.
 *
 * Fix: the mutation is bound to the company the route ACTUALLY AUTHORIZED
 * (companyContext.companyId), via an ownership check plus a company_id
 * predicate on the UPDATE itself. A row the authorized company does not own is
 * rejected with RESOURCE_NOT_FOUND -> 404, which the caller cannot confuse with
 * success.
 *
 * The REAL chain runs here — withRBAC -> enforceRole -> getUserRole, and
 * requireCompanyContext -> enforceCompanyAccess -> assertTenantAccess -> into
 * the REAL companyIntelligenceConfigService. Only the data layer, the auth seam
 * and the competitor engine (a network sink) are mocked. Assertions rest on
 * recorded database predicates and recorded writes, which cannot go vacuous:
 * remove the binding and the write reappears.
 */

/**
 * The UNAUTHENTICATED path is the only one that touches the canonical config
 * module: resolveUserContext -> devIdentityOptIn() reads `config.DEV_USER_ID`,
 * which initializes `@/config` and throws when the required variables are
 * absent (this repo's suites normally inherit them from a local .env). These
 * are inert placeholders — the Supabase client is fully mocked below, so
 * nothing here connects anywhere. Existing values are never overwritten.
 */
for (const [key, value] of Object.entries({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  REDIS_URL: 'redis://127.0.0.1:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
})) {
  if (!process.env[key]) process.env[key] = value;
}

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const CREATOR_A = 'dddddddd-0000-0000-0000-0000000000dd';
const STALE_A = 'eeeeeeee-0000-0000-0000-0000000000ee';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

/** A well-formed uuid that names no row anywhere. */
const GHOST_ID = 'f0000000-0000-0000-0000-00000000000f';
/** Not a uuid at all — can never match the uuid `id` column. */
const MALFORMED_ID = 'not-a-uuid';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: CREATOR_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  // Revoked membership in the caller's OWN company: the row still exists but is
  // not active, so nothing may be mutated through it.
  { user_id: STALE_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'inactive' },
];

type TableFixture = {
  table: string;
  valueColumn: string;
  ownRow: string;
  victimRow: string;
};

const TABLES: Record<string, TableFixture> = {
  topics: {
    table: 'company_intelligence_topics',
    valueColumn: 'topic',
    ownRow: '10000000-0000-0000-0000-00000000000a',
    victimRow: '10000000-0000-0000-0000-00000000000b',
  },
  competitors: {
    table: 'company_intelligence_competitors',
    valueColumn: 'competitor_name',
    ownRow: '20000000-0000-0000-0000-00000000000a',
    victimRow: '20000000-0000-0000-0000-00000000000b',
  },
  products: {
    table: 'company_intelligence_products',
    valueColumn: 'product_name',
    ownRow: '30000000-0000-0000-0000-00000000000a',
    victimRow: '30000000-0000-0000-0000-00000000000b',
  },
  regions: {
    table: 'company_intelligence_regions',
    valueColumn: 'region',
    ownRow: '40000000-0000-0000-0000-00000000000a',
    victimRow: '40000000-0000-0000-0000-00000000000b',
  },
  keywords: {
    table: 'company_intelligence_keywords',
    valueColumn: 'keyword',
    ownRow: '50000000-0000-0000-0000-00000000000a',
    victimRow: '50000000-0000-0000-0000-00000000000b',
  },
};

/** id -> { company, table, value }. The victim rows carry marker values. */
const ROW_INDEX: Record<string, { company: string; table: string; value: string }> = {};
for (const f of Object.values(TABLES)) {
  ROW_INDEX[f.ownRow] = { company: COMPANY_A, table: f.table, value: 'own-value' };
  ROW_INDEX[f.victimRow] = { company: VICTIM, table: f.table, value: 'VICTIM-SECRET-VALUE' };
}

let authUser: string | null = ADMIN_A;

type Recorded = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };
const queries: Recorded[] = [];
const writes: Recorded[] = [];
/** The competitor engine is a NETWORK sink; a rejected request must not reach it. */
const competitorEngineCalls: Array<{ companyId: string | undefined }> = [];

/** Everything except the authorization chain's own lookups. */
const appQueries = () => queries.filter((q) => !['user_company_roles', 'companies'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = 'select';
    let payload: unknown;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c + '__in'] = v; return b; };
    b.limit = () => b;
    b.order = () => b;
    b.insert = (p: unknown) => { op = 'insert'; payload = p; return b; };
    b.update = (p: unknown) => { op = 'update'; payload = p; return b; };
    b.delete = () => { op = 'delete'; return b; };

    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        const statusIn = filters.status__in as string[] | undefined;
        return ROLES.filter((r) =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status) &&
          (statusIn === undefined || statusIn.includes(r.status)));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active' }];

      const fixture = Object.values(TABLES).find((f) => f.table === table);
      if (fixture) {
        const row = ROW_INDEX[String(filters.id)];
        if (!row || row.table !== table) return [];
        // The REAL ownership predicate: a company_id filter that does not match
        // the row's owner returns nothing, exactly as PostgREST would.
        if (filters.company_id !== undefined && filters.company_id !== row.company) return [];
        return [{
          id: filters.id,
          company_id: row.company,
          [fixture.valueColumn]: row.value,
          enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }];
      }
      return [];
    };

    const resolve = () => {
      const snapshot: Recorded = { table, op, filters: { ...filters }, payload };
      queries.push(snapshot);
      if (op === 'insert' || op === 'update' || op === 'delete') writes.push(snapshot);
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => {
      const r = resolve();
      return Promise.resolve({ data: r.data[0] ?? null, error: null });
    };
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

// The competitor engine reaches the network. Mocked so it stays deterministic
// AND so it can be asserted as a sink that a rejected request never reaches.
jest.mock('../../services/competitorEngineService', () => ({
  buildCandidatesFromNames: (names: string[]) => names.map((name) => ({ name })),
  extractCompetitiveContextFromProfile: () => ({}),
  getFinalCompetitors: jest.fn(async (input: { candidates: Array<{ name: string }>; companyId?: string }) => {
    competitorEngineCalls.push({ companyId: input.companyId });
    return input.candidates.map((c) => ({ name: c.name, domain: null }));
  }),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

import topicsHandler from '../../../pages/api/company/intelligence/topics';
import competitorsHandler from '../../../pages/api/company/intelligence/competitors';
import productsHandler from '../../../pages/api/company/intelligence/products';
import regionsHandler from '../../../pages/api/company/intelligence/regions';
import keywordsHandler from '../../../pages/api/company/intelligence/keywords';

const HANDLERS: Record<string, any> = {
  topics: topicsHandler,
  competitors: competitorsHandler,
  products: productsHandler,
  regions: regionsHandler,
  keywords: keywordsHandler,
};

/** The response envelope key each route uses for a single item. */
const RESPONSE_KEY: Record<string, string> = {
  topics: 'topic',
  competitors: 'competitor',
  products: 'product',
  regions: 'region',
  keywords: 'keyword',
};

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(
  route: string,
  as: string | null,
  opts: { query?: any; body?: any; method?: string } = {},
) {
  authUser = as;
  const res = mockRes();
  await HANDLERS[route]({
    method: opts.method ?? 'GET',
    url: `/api/company/intelligence/${route}`,
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: {},
  } as never, res);
  return res;
}

/** PUT body for a route: the value column the route expects. */
function putBody(route: string, id: string, value: string) {
  return { id, [TABLES[route]!.valueColumn]: value };
}

/**
 * Nothing belonging to the victim tenant was reached, written or returned.
 *
 * Three independent checks, because any one alone can be satisfied by accident:
 *   - no write of ANY kind was recorded (the mutation sink was not called);
 *   - no query predicate named the victim company;
 *   - the response body contains neither the victim company id nor the victim
 *     row's marker value.
 */
function noVictimReach(res: { body: unknown }) {
  expect(writes).toEqual([]);
  const leaked = appQueries().filter((q) => JSON.stringify(q.filters).includes(VICTIM));
  expect(leaked).toEqual([]);
  const serialized = JSON.stringify(res.body ?? {});
  expect(serialized).not.toContain(VICTIM);
  expect(serialized).not.toContain('VICTIM-SECRET-VALUE');
}

/** Every recorded write carried the authorized company as a predicate. */
function everyWriteIsCompanyScoped(companyId: string) {
  expect(writes.length).toBeGreaterThan(0);
  for (const w of writes) {
    expect(w.filters.company_id).toBe(companyId);
  }
}

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0;
  writes.length = 0;
  competitorEngineCalls.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

describe.each(Object.keys(TABLES))('company/intelligence/%s', (route) => {
  const fixture = TABLES[route]!;

  /* ── A admin -> A row -> ALLOWED ─────────────────────────────────────── */

  it('PUT: an admin of A may rewrite A\'s own row', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, fixture.ownRow, 'renamed'),
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as any)[RESPONSE_KEY[route]!].id).toBe(fixture.ownRow);
    everyWriteIsCompanyScoped(COMPANY_A);
  });

  it('PATCH: an admin of A may disable A\'s own row', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PATCH',
      query: { companyId: COMPANY_A },
      body: { id: fixture.ownRow, enabled: false },
    });
    expect(res.statusCode).toBe(200);
    everyWriteIsCompanyScoped(COMPANY_A);
    expect(writes[writes.length - 1]!.payload).toEqual({ enabled: false });
  });

  /* ── A admin -> B row -> REJECTED (the defect) ───────────────────────── */

  it('PUT: an admin of A may NOT rewrite B\'s row', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, fixture.victimRow, 'pwned'),
    });
    expect(res.statusCode).toBe(404);
    expect((res.body as any).error).toBe('RESOURCE_NOT_FOUND');
    noVictimReach(res);
  });

  it('PATCH: an admin of A may NOT disable B\'s row', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PATCH',
      query: { companyId: COMPANY_A },
      body: { id: fixture.victimRow, enabled: false },
    });
    expect(res.statusCode).toBe(404);
    expect((res.body as any).error).toBe('RESOURCE_NOT_FOUND');
    noVictimReach(res);
  });

  it('PUT: naming B in the BODY does not move the mutation to B', async () => {
    // withRBAC and the route both resolve query-first, so the body company is
    // inert — but it must be PROVEN inert, not assumed.
    const res = await call(route, ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: { ...putBody(route, fixture.victimRow, 'pwned'), companyId: VICTIM },
    });
    expect(res.statusCode).toBe(404);
    noVictimReach(res);
  });

  it('PUT: naming B in the body while omitting the query company is denied', async () => {
    // Here the wrapper AND the guard both see VICTIM, so authorization itself
    // must reject: ADMIN_A is not a member of the victim tenant.
    const res = await call(route, ADMIN_A, {
      method: 'PUT',
      query: {},
      body: { ...putBody(route, fixture.victimRow, 'pwned'), companyId: VICTIM },
    });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
    expect(appQueries()).toEqual([]);
  });

  /* ── malformed / nonexistent row id -> REJECTED ──────────────────────── */

  it('PUT: a malformed row id is rejected and reaches no table at all', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, MALFORMED_ID, 'x'),
    });
    expect(res.statusCode).toBe(404);
    expect((res.body as any).error).toBe('RESOURCE_NOT_FOUND');
    expect(writes).toEqual([]);
    expect(appQueries()).toEqual([]);
  });

  it('PATCH: a nonexistent row id is rejected with no write', async () => {
    const res = await call(route, ADMIN_A, {
      method: 'PATCH',
      query: { companyId: COMPANY_A },
      body: { id: GHOST_ID, enabled: false },
    });
    expect(res.statusCode).toBe(404);
    expect((res.body as any).error).toBe('RESOURCE_NOT_FOUND');
    expect(writes).toEqual([]);
  });

  it('a nonexistent id and a foreign id are indistinguishable to the caller', async () => {
    const ghost = await call(route, ADMIN_A, {
      method: 'PATCH', query: { companyId: COMPANY_A }, body: { id: GHOST_ID, enabled: false },
    });
    queries.length = 0; writes.length = 0;
    const foreign = await call(route, ADMIN_A, {
      method: 'PATCH', query: { companyId: COMPANY_A }, body: { id: fixture.victimRow, enabled: false },
    });
    expect(foreign.statusCode).toBe(ghost.statusCode);
    expect(foreign.body).toEqual(ghost.body);
  });

  /* ── stale / revoked membership -> REJECTED ──────────────────────────── */

  it('PUT: a revoked member of A may not mutate A\'s own row', async () => {
    const res = await call(route, STALE_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, fixture.ownRow, 'pwned'),
    });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
    expect(appQueries()).toEqual([]);
  });

  it('PATCH: a revoked member reaches neither B\'s row nor any write', async () => {
    const res = await call(route, STALE_A, {
      method: 'PATCH',
      query: { companyId: COMPANY_A },
      body: { id: fixture.victimRow, enabled: false },
    });
    expect(res.statusCode).toBe(403);
    noVictimReach(res);
  });

  /* ── unauthenticated ─────────────────────────────────────────────────── */

  it('PUT: an unauthenticated caller is denied before any table is touched', async () => {
    const res = await call(route, null, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, fixture.ownRow, 'x'),
    });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
    expect(appQueries()).toEqual([]);
  });

  /* ── SUPER_ADMIN semantics preserved ─────────────────────────────────── */

  it('PUT: a SUPER_ADMIN naming the victim tenant may still mutate it', async () => {
    // Platform super admins are authorized for every tenant by design
    // (TenantGuard bypass). The fix binds the mutation to the AUTHORIZED
    // company; for a super admin that company may legitimately be B.
    const res = await call(route, SUPERADMIN, {
      method: 'PUT',
      query: { companyId: VICTIM },
      body: putBody(route, fixture.victimRow, 'admin-edit'),
    });
    expect(res.statusCode).toBe(200);
    everyWriteIsCompanyScoped(VICTIM);
  });

  it('PUT: a SUPER_ADMIN acting AS company A still may not reach B\'s row', async () => {
    const res = await call(route, SUPERADMIN, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: putBody(route, fixture.victimRow, 'admin-edit'),
    });
    expect(res.statusCode).toBe(404);
    noVictimReach(res);
  });

  /* ── the read path is unchanged ──────────────────────────────────────── */

  it('GET still lists only the authorized company', async () => {
    const res = await call(route, ADMIN_A, { method: 'GET', query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    const reads = appQueries().filter((q) => q.table === fixture.table);
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.filters.company_id).toBe(COMPANY_A);
  });
});

/* ── competitor-specific: the network sink must not be reached ─────────── */

describe('company/intelligence/competitors — competitor engine sink', () => {
  const fixture = TABLES.competitors!;

  it('a rejected cross-tenant PUT never reaches the competitor engine', async () => {
    const res = await call('competitors', ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: { id: fixture.victimRow, competitor_name: 'pwned' },
    });
    expect(res.statusCode).toBe(404);
    expect(competitorEngineCalls).toEqual([]);
    noVictimReach(res);
  });

  it('an allowed PUT validates against the AUTHORIZED company, never the row\'s own', async () => {
    const res = await call('competitors', ADMIN_A, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: { id: fixture.ownRow, competitor_name: 'Acme' },
    });
    expect(res.statusCode).toBe(200);
    expect(competitorEngineCalls.length).toBeGreaterThan(0);
    for (const c of competitorEngineCalls) expect(c.companyId).toBe(COMPANY_A);
    everyWriteIsCompanyScoped(COMPANY_A);
  });

  it('a SUPER_ADMIN acting as A cannot drive the engine with the victim\'s context', async () => {
    const res = await call('competitors', SUPERADMIN, {
      method: 'PUT',
      query: { companyId: COMPANY_A },
      body: { id: fixture.victimRow, competitor_name: 'pwned' },
    });
    expect(res.statusCode).toBe(404);
    expect(competitorEngineCalls).toEqual([]);
    noVictimReach(res);
  });
});

/* ── cross-route invariant ─────────────────────────────────────────────── */

describe('every mutation in the cluster is company-scoped', () => {
  it('no UPDATE is ever issued without a company_id predicate', async () => {
    for (const route of Object.keys(TABLES)) {
      const fixture = TABLES[route]!;
      await call(route, ADMIN_A, {
        method: 'PUT', query: { companyId: COMPANY_A }, body: putBody(route, fixture.ownRow, 'v'),
      });
      await call(route, ADMIN_A, {
        method: 'PATCH', query: { companyId: COMPANY_A }, body: { id: fixture.ownRow, enabled: false },
      });
    }
    // 5 routes x 2 methods = 10 mutations, all bound.
    expect(writes.length).toBe(10);
    for (const w of writes) {
      expect(w.op).toBe('update');
      expect(w.filters.company_id).toBe(COMPANY_A);
      expect(w.filters.id).toBeDefined();
    }
  });

  it('a cross-tenant attempt on every route produces zero writes', async () => {
    for (const route of Object.keys(TABLES)) {
      const fixture = TABLES[route]!;
      const put = await call(route, ADMIN_A, {
        method: 'PUT', query: { companyId: COMPANY_A }, body: putBody(route, fixture.victimRow, 'pwned'),
      });
      const patch = await call(route, ADMIN_A, {
        method: 'PATCH', query: { companyId: COMPANY_A }, body: { id: fixture.victimRow, enabled: false },
      });
      expect(put.statusCode).toBe(404);
      expect(patch.statusCode).toBe(404);
    }
    expect(writes).toEqual([]);
    expect(appQueries().filter((q) => JSON.stringify(q.filters).includes(VICTIM))).toEqual([]);
  });
});

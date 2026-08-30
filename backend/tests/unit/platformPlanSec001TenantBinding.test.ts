/**
 * PLATFORM-PLAN-SEC-001 — POST /api/campaigns/platform-plan.
 *
 * The route had NO authorization at all. Its only wrapper was createApiRoute
 * (pass-through observability), and `companyId` / `campaignId` came straight
 * from the request body into the SERVICE-ROLE client: the company profile read,
 * the cached-plan read, the resolved plan context, the trend snapshots, the
 * platform_execution_plans INSERT, the `campaigns` stage UPDATE keyed on the
 * caller's id alone, and syncCampaignVersionStage. An UNAUTHENTICATED POST could
 * therefore write a plan into any tenant and advance any tenant's campaign.
 *
 * Fix: withRBAC (authenticate + authorize `query.companyId || body.companyId`),
 * bind the body identifier to `req.rbac.companyId` (the company the wrapper
 * ACTUALLY authorized — WITHRBAC-STRUCT-001), then requireCampaignTenantAccess
 * to resolve the campaign's SERVER-OWNED company_id (WITHRBAC-SEC-001).
 *
 * The REAL chain runs here — withRBAC -> enforceRole -> resolveUserContext /
 * getUserRole / isSuperAdmin, and requireCampaignTenantAccess ->
 * assertTenantAccess -> resolvePrincipal. Only the data layer, the auth seam and
 * the route's own downstream modules are mocked, and EVERY mocked downstream is
 * a module this route really imports (a `{ virtual: true }` mock pathed at a
 * module the route does not import passes vacuously — that mistake is recorded
 * in WITHRBAC-SEC-001 and is deliberately not repeated).
 *
 * Assertions rest on two independent recorders:
 *   1. the SINK recorders below — most importantly savePlatformExecutionPlan,
 *      the write sink — with the company each one actually received;
 *   2. the supabase mock's recorded query predicates and writes, which capture
 *      the `campaigns` stage UPDATE the route performs directly.
 */

/*
 * The authorization chain reaches `@/config` lazily (enforceRole ->
 * `await import('./userContextService')` -> backend/lib/userContext -> config),
 * whose zod schema throws when these six are absent. A developer checkout with
 * no .env/.env.local therefore fails the FIRST request of a suite and then
 * silently "passes" the rest against a half-initialized config module. These are
 * inert placeholders — no real credential, no network is ever reached, since the
 * data layer and auth seam are mocked below — and they make this suite
 * self-contained rather than dependent on an ambient dotenv file.
 */
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0'.repeat(64),
})) {
  if (!process.env[k]) process.env[k] = v;
}

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const CREATOR_A = 'dddddddd-0000-0000-0000-0000000000dd';
const VIEWER_A = 'ffffffff-0000-0000-0000-0000000000ff';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const STALE_B = 'eeeeeeee-0000-0000-0000-0000000000ee';
/** An agency-style principal with an ACTIVE membership in BOTH tenants. */
const DUAL_MEMBER = '11111111-0000-0000-0000-000000000011';

const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const CAMPAIGN_A = 'ca000000-0000-0000-0000-00000000000a';
const CAMPAIGN_V = 'cb000000-0000-0000-0000-00000000000b';
const CAMPAIGN_GHOST = 'cf000000-0000-0000-0000-00000000000f';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: CREATOR_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: VIEWER_A, company_id: COMPANY_A, role: 'VIEW_ONLY', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  // Membership in the victim tenant that is NOT active — must never authorize.
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: DUAL_MEMBER, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: DUAL_MEMBER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'active' },
];

const CAMPAIGN_OWNER: Record<string, string> = {
  [CAMPAIGN_A]: COMPANY_A,
  [CAMPAIGN_V]: VICTIM,
};

let authUser: string | null = ADMIN_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown; filters: Record<string, unknown> }> = [];

/** Queries other than the authorization chain's own lookups. */
const appQueries = () =>
  queries.filter((q) => !['user_company_roles', 'companies'].includes(q.table));

/* ── Sink recorders — one per tenant-scoped downstream the route calls ─────── */
const profileCalls: Array<{ companyId: unknown }> = [];
const cacheReadCalls: Array<{ companyId: unknown; campaignId: unknown }> = [];
const planContextCalls: Array<{ companyId: unknown; campaignId: unknown }> = [];
const trendCalls: Array<{ companyId: unknown; campaignId: unknown }> = [];
/** THE WRITE SINK. */
const saveCalls: Array<{ companyId: unknown; campaignId: unknown; weekNumber: unknown }> = [];
const syncStageCalls: Array<{ campaignId: unknown; companyId: unknown }> = [];
const assetCalls: Array<{ campaignId: unknown }> = [];

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
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p, filters: { ...filters } }); return b; };
    b.update = (p: unknown) => { b.__pendingUpdate = p; return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter((r) =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active', deleted_at: null }];
      if (table === 'campaigns') {
        const owner = CAMPAIGN_OWNER[String(filters.id)];
        if (!owner) return [];
        if (filters.company_id !== undefined && filters.company_id !== owner) return [];
        return [{ id: filters.id, company_id: owner, current_stage: 'plan', duration_weeks: 4 }];
      }
      return [];
    };
    const resolve = () => {
      // An UPDATE only becomes a write once its predicates are attached and it
      // is awaited — record it here so the recorded filters are complete.
      if (b.__pendingUpdate !== undefined) {
        writes.push({ table, payload: b.__pendingUpdate, filters: { ...filters } });
        b.__pendingUpdate = undefined;
        queries.push({ table, filters: { ...filters } });
        return { data: [], count: 0, error: null };
      }
      queries.push({ table, filters: { ...filters } });
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

/* Downstream modules the route really imports. */
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: jest.fn(async (companyId: unknown) => {
    profileCalls.push({ companyId });
    return { company_id: companyId, company_name: 'Acme' };
  }),
}));
jest.mock('../../services/campaignBlueprintService', () => {
  class PrePlanningRequiredError extends Error {
    code = 'PRE_PLANNING_REQUIRED';
  }
  return {
    PrePlanningRequiredError,
    getResolvedCampaignPlanContext: jest.fn(async (companyId: unknown, campaignId: unknown) => {
      planContextCalls.push({ companyId, campaignId });
      return {
        campaign: { id: campaignId, company_id: companyId },
        weekly_plan: [{ week_number: 1, theme: 't' }],
        daily_plan: [],
        duration_weeks: 4,
      };
    }),
  };
});
jest.mock('../../db/campaignVersionStore', () => ({
  getTrendSnapshots: jest.fn(async (companyId: unknown, campaignId: unknown) => {
    trendCalls.push({ companyId, campaignId });
    return [{ snapshot: { emerging_trends: [{ topic: 'ai' }] } }];
  }),
  syncCampaignVersionStage: jest.fn(async (campaignId: unknown, _stage: unknown, companyId: unknown) => {
    syncStageCalls.push({ campaignId, companyId });
  }),
}));
jest.mock('../../services/platformIntelligenceService', () => ({
  buildPlatformExecutionPlan: jest.fn(() => ({ platforms: ['linkedin'] })),
}));
jest.mock('../../db/platformExecutionStore', () => ({
  getLatestPlatformExecutionPlan: jest.fn(async (input: any) => {
    cacheReadCalls.push({ companyId: input?.companyId, campaignId: input?.campaignId });
    return null;
  }),
  savePlatformExecutionPlan: jest.fn(async (input: any) => {
    saveCalls.push({
      companyId: input?.companyId,
      campaignId: input?.campaignId,
      weekNumber: input?.weekNumber,
    });
  }),
}));
jest.mock('../../services/campaignHealthService', () => ({
  validateCampaignHealth: jest.fn(() => ({ status: 'ok', confidence: 1, issues: [], scores: {} })),
}));
jest.mock('../../db/contentAssetStore', () => ({
  listAssetsWithLatestContent: jest.fn(async (input: any) => {
    assetCalls.push({ campaignId: input?.campaignId });
    return [];
  }),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/campaigns/platform-plan';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(
  as: string | null,
  opts: { query?: any; body?: any; method?: string } = {}
) {
  authUser = as;
  const res = mockRes();
  await handler(
    {
      method: opts.method ?? 'POST',
      url: '/api/campaigns/platform-plan',
      query: opts.query ?? {},
      body: opts.body ?? {},
      headers: {},
      socket: {},
    } as never,
    res
  );
  return res;
}

/** Every tenant-scoped sink the route has, with the company each received. */
const allSinkCompanies = () => [
  ...profileCalls.map((c) => c.companyId),
  ...cacheReadCalls.map((c) => c.companyId),
  ...planContextCalls.map((c) => c.companyId),
  ...trendCalls.map((c) => c.companyId),
  ...saveCalls.map((c) => c.companyId),
  ...syncStageCalls.map((c) => c.companyId),
];

/** THE required sink assertion: the write sink never ran. */
const noWriteSink = () => {
  expect(saveCalls).toEqual([]);
  expect(writes).toEqual([]);
};

/**
 * Nothing anywhere — no sink argument, no recorded DB predicate — carried the
 * victim's identity. Two independent recorders, so neither can go vacuous on
 * its own.
 */
const noVictimReach = () => {
  expect(allSinkCompanies().filter((c) => c === VICTIM)).toEqual([]);
  expect([...cacheReadCalls, ...planContextCalls, ...trendCalls, ...saveCalls, ...syncStageCalls, ...assetCalls]
    .filter((c: any) => c.campaignId === CAMPAIGN_V)).toEqual([]);
  const leaked = appQueries().filter((q) => JSON.stringify(q.filters).includes(VICTIM));
  expect(leaked).toEqual([]);
  const leakedWrites = writes.filter((w) => JSON.stringify(w).includes(VICTIM) || JSON.stringify(w).includes(CAMPAIGN_V));
  expect(leakedWrites).toEqual([]);
};

/**
 * An UNAUTHENTICATED request must not touch a tenant table at all.
 *
 * This pins withRBAC specifically, and it is a real property rather than a
 * structural assertion. The route has two independent guards: withRBAC (which
 * authenticates from `req.rbac` before the handler body runs) and
 * requireCampaignTenantAccess (which authenticates too, but only AFTER it has
 * SELECTed the `campaigns` row to discover the owner). Drop withRBAC and the
 * route still denies — but it first reads `campaigns` by id, and the resulting
 * 404 CAMPAIGN_NOT_FOUND vs 401 split is a campaign-existence oracle available
 * to a caller with no credentials at all. Authentication must come first.
 */
const noTenantReadBeforeAuth = () => {
  expect(appQueries()).toEqual([]);
};

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0;
  writes.length = 0;
  profileCalls.length = 0;
  cacheReadCalls.length = 0;
  planContextCalls.length = 0;
  trendCalls.length = 0;
  saveCalls.length = 0;
  syncStageCalls.length = 0;
  assetCalls.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('PLATFORM-PLAN-SEC-001 — authentication', () => {
  it('CRITICAL: an unauthenticated caller is rejected and the write sink never runs', async () => {
    const res = await call(null, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(401);
    noWriteSink();
    expect(allSinkCompanies()).toEqual([]);
    noTenantReadBeforeAuth();
  });

  it('CRITICAL: an unauthenticated caller cannot write into a FOREIGN tenant', async () => {
    // This is the shipped exploit verbatim: no credentials, victim identifiers
    // in the body. Before the fix this returned 200 and inserted a plan row.
    const res = await call(null, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(401);
    noWriteSink();
    noVictimReach();
    noTenantReadBeforeAuth();
  });

  it('a non-POST verb reaches nothing', async () => {
    // withRBAC now runs before the handler's own method check, so an authorized
    // caller is needed to reach the 405 at all — same shape as health-report.
    const res = await call(ADMIN_A, { method: 'GET', query: { companyId: COMPANY_A }, body: {} });
    expect(res.statusCode).toBe(405);
    noWriteSink();
  });
});

describe('PLATFORM-PLAN-SEC-001 — company A operating on A', () => {
  it.each([
    ['COMPANY_ADMIN', ADMIN_A],
    ['CONTENT_CREATOR', CREATOR_A],
    ['VIEW_ONLY', VIEWER_A],
  ])('%s of A may build A\'s plan, and every sink receives A', async (_role, user) => {
    const res = await call(user, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body?.plan).toEqual({ platforms: ['linkedin'] });

    // The write sink ran, for A.
    expect(saveCalls).toEqual([
      { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 },
    ]);
    // Nothing anywhere received a company other than A.
    expect(allSinkCompanies().filter((c) => c !== COMPANY_A)).toEqual([]);
  });

  it('the legitimate stage UPDATE is scoped to BOTH the campaign and its company', async () => {
    await call(ADMIN_A, { body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 } });
    const stageUpdate = writes.find((w) => w.table === 'campaigns');
    expect(stageUpdate).toBeDefined();
    expect(stageUpdate!.filters).toEqual(
      expect.objectContaining({ id: CAMPAIGN_A, company_id: COMPANY_A })
    );
  });

  it('a cache hit still returns the plan (force=false path is preserved)', async () => {
    const store = require('../../db/platformExecutionStore');
    store.getLatestPlatformExecutionPlan.mockImplementationOnce(async (input: any) => {
      cacheReadCalls.push({ companyId: input?.companyId, campaignId: input?.campaignId });
      return { plan_json: { platforms: ['x'] } };
    });
    const res = await call(ADMIN_A, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body?.plan).toEqual({ platforms: ['x'] });
    expect(cacheReadCalls).toEqual([{ companyId: COMPANY_A, campaignId: CAMPAIGN_A }]);
  });
});

describe('PLATFORM-PLAN-SEC-001 — company A operating on B', () => {
  it('CRITICAL: naming the victim company in the body is refused; write sink NOT called', async () => {
    const res = await call(ADMIN_A, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect([401, 403]).toContain(res.statusCode);
    noWriteSink();
    noVictimReach();
  });

  it('CRITICAL: the query/body split cannot operate on the victim; write sink NOT called', async () => {
    // withRBAC resolves `query.companyId || body.companyId` — QUERY FIRST — so
    // this authorizes A while the body asks for the victim. The body identifier
    // must AGREE with the authorized company, never override it.
    const res = await call(ADMIN_A, {
      query: { companyId: COMPANY_A },
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(403);
    noWriteSink();
    noVictimReach();
  });

  it('CRITICAL: an inactive membership in the victim does not authorize it', async () => {
    const res = await call(STALE_B, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect([401, 403]).toContain(res.statusCode);
    noWriteSink();
    noVictimReach();
  });

  it('CRITICAL: even a VIEW_ONLY member of A cannot reach the victim', async () => {
    const res = await call(VIEWER_A, {
      query: { companyId: COMPANY_A },
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(403);
    noWriteSink();
    noVictimReach();
  });
});

describe('PLATFORM-PLAN-SEC-001 — campaign identity binding', () => {
  it('CRITICAL: own companyId + FOREIGN campaignId is refused; write sink NOT called', async () => {
    // The campaigns stage UPDATE was keyed on the caller's campaign id ALONE.
    // A guessable UUID from another tenant must not reach it.
    const res = await call(ADMIN_A, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect([403, 404]).toContain(res.statusCode);
    noWriteSink();
    noVictimReach();
  });

  it('CRITICAL: authorization runs BEFORE any campaign read or write', async () => {
    // noVictimReach() alone cannot see a late guard: a read filtered by campaign
    // id need not mention the victim's company. The discriminator is HOW MANY
    // times `campaigns` is touched on a denied request — exactly once, by
    // requireCampaignTenantAccess resolving the owner. A second touch means the
    // handler body ran first and the check came too late.
    await call(ADMIN_A, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(appQueries().filter((q) => q.table === 'campaigns')).toHaveLength(1);
    expect(saveCalls).toEqual([]);
  });

  it('a nonexistent campaign is refused and writes nothing', async () => {
    const res = await call(ADMIN_A, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_GHOST, weekNumber: 1 },
    });
    expect([403, 404]).toContain(res.statusCode);
    noWriteSink();
  });

  it('CRITICAL: a member of BOTH tenants cannot mix one tenant with the other\'s campaign', async () => {
    // This principal legitimately passes every membership check on both sides,
    // so no authentication or role test can catch the mismatch — only deriving
    // the operative company from the CAMPAIGN ROW and requiring it to agree with
    // the authorized company does. Trust the body value instead and the route
    // writes a plan keyed to company A carrying the victim's campaign, and vice
    // versa: a cross-tenant record with no forged credential anywhere.
    const res = await call(DUAL_MEMBER, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body?.code).toBe('CAMPAIGN_NOT_IN_COMPANY');
    noWriteSink();

    // The mirror image is refused too.
    const res2 = await call(DUAL_MEMBER, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_A, weekNumber: 1 },
    });
    expect(res2.statusCode).toBe(403);
    expect(saveCalls).toEqual([]);
  });

  it('the same dual member CAN operate on each tenant with its OWN campaign', async () => {
    // The guard rejects mismatched pairs, not the principal — both coherent
    // pairs must still work, or the fix would have broken agency access.
    const res = await call(DUAL_MEMBER, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(saveCalls).toEqual([{ companyId: COMPANY_A, campaignId: CAMPAIGN_A, weekNumber: 1 }]);

    saveCalls.length = 0;
    const res2 = await call(DUAL_MEMBER, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res2.statusCode).toBe(200);
    expect(saveCalls).toEqual([{ companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 }]);
  });

  it('a missing campaignId is rejected before any sink', async () => {
    const res = await call(ADMIN_A, { body: { companyId: COMPANY_A, weekNumber: 1 } });
    expect(res.statusCode).toBe(400);
    noWriteSink();
    expect(allSinkCompanies()).toEqual([]);
  });

  it('a missing companyId is still a 400 from the wrapper', async () => {
    const res = await call(ADMIN_A, { body: { campaignId: CAMPAIGN_A, weekNumber: 1 } });
    expect(res.statusCode).toBe(400);
    noWriteSink();
  });
});

describe('PLATFORM-PLAN-SEC-001 — SUPER_ADMIN semantics preserved', () => {
  it('a super admin may operate on a company they are not a member of', async () => {
    // enforceRole grants SUPER_ADMIN for any company and TenantGuard honours the
    // platform bypass, so the victim tenant's own campaign is reachable — by
    // design, and unchanged by this fix.
    const res = await call(SUPERADMIN, {
      body: { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(saveCalls).toEqual([
      { companyId: VICTIM, campaignId: CAMPAIGN_V, weekNumber: 1 },
    ]);
  });

  it('a super admin is still held to a coherent company/campaign pair', async () => {
    const res = await call(SUPERADMIN, {
      body: { companyId: COMPANY_A, campaignId: CAMPAIGN_V, weekNumber: 1 },
    });
    expect(res.statusCode).toBe(403);
    noWriteSink();
  });
});

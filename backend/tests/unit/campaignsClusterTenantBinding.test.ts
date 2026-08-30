/**
 * TENANT-AUTHZ-BATCH-SEC-001 — the campaigns cluster.
 *
 *   pages/api/campaigns/create-12week-plan.ts   (POST, 8 write sinks)
 *   pages/api/campaigns/[id]/strategic-insights.ts (GET)
 *   pages/api/campaigns/business-report.ts      (GET)
 *
 * These three are the campaign<->company binding family among the remaining
 * tenant-authz baseline. The question the suite answers for all of them is one
 * question: can a caller authorized for Company A read or mutate Company B's
 * campaign data?
 *
 * create-12week-plan authenticated the caller (getSupabaseUserFromRequest ->
 * 401) and then performed NO tenant authorization at all:
 *
 *   - `companyId` came straight from req.body into campaign_versions.company_id
 *     (Pattern A);
 *   - the campaign was fetched by id alone and UPDATED with `.eq('id', …)` and
 *     no tenant predicate (Pattern C/F), overwriting start_date,
 *     ai_generated_summary, weekly_themes, current_stage and duration_weeks;
 *   - blueprint, weekly_content_refinements and campaign_performance rows were
 *     then written for that same unowned campaign.
 *
 * The two sibling GETs are included because they share the family and the
 * binding question, not because they were suspected: business-report scopes
 * campaign_versions on BOTH campaign_id and company_id, and strategic-insights
 * derives the company FROM the campaign server-side before authorizing it.
 * They are here to stay correct, and to prove the batch was audited whole.
 */

export {};

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const OUTSIDER = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const OWN_CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const VICTIM_CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const ORPHAN_CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const NEW_CAMPAIGN = '44444444-4444-4444-8444-444444444444';

const ROLES = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: OUTSIDER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];
const COMPANY_STATUS: Record<string, string | null> = { [COMPANY_A]: 'active', [VICTIM]: 'active' };

/** campaign id -> owning company (null = legacy row with no company) + creator. */
const CAMPAIGNS: Record<string, { company_id: string | null; user_id: string }> = {
  [OWN_CAMPAIGN]: { company_id: COMPANY_A, user_id: MEMBER_A },
  [VICTIM_CAMPAIGN]: { company_id: VICTIM, user_id: OUTSIDER },
  [ORPHAN_CAMPAIGN]: { company_id: null, user_id: OUTSIDER },
};

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; op: string; payload: any; filters: Record<string, unknown> }> = [];
const serviceCalls: Array<{ fn: string; args: any }> = [];
const AUDIT_TABLES = ['capability_audit_log'];

/** Writes that are not the guard's own audit log. */
const tenantWrites = () => writes.filter(w => !AUDIT_TABLES.includes(w.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'NO_AUTH' }),
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  Role: {},
  ALL_ROLES: [],
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
    let pending: { op: string; payload: any } | null = null;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c + '__in'] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    const w = (op: string) => (p: any) => {
      pending = { op, payload: p };
      if (!AUDIT_TABLES.includes(table)) writes.push({ table, op, payload: p, filters: { ...filters } });
      return b;
    };
    b.insert = w('insert'); b.update = w('update'); b.upsert = w('upsert');
    b.delete = () => w('delete')(null);

    const rows = (): any[] => {
      if (pending?.op === 'insert') {
        const p = Array.isArray(pending.payload) ? pending.payload[0] : pending.payload;
        return [{ id: p?.id ?? NEW_CAMPAIGN, ...p }];
      }
      if (pending?.op === 'update') {
        const c = CAMPAIGNS[String(filters.id)];
        return [{ id: filters.id, ...(c ?? {}), ...pending.payload }];
      }
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') {
        const st = COMPANY_STATUS[String(filters.id)];
        return st == null ? [] : [{ id: filters.id, status: st }];
      }
      if (table === 'campaigns') {
        const c = CAMPAIGNS[String(filters.id)];
        return c ? [{ id: filters.id, ...c, origin_source: 'seed', duration_weeks: 12 }] : [];
      }
      if (table === 'campaign_versions') {
        const entries = Object.entries(CAMPAIGNS)
          .filter(([cid, c]) => c.company_id !== null
            && (filters.campaign_id === undefined || cid === filters.campaign_id)
            && (filters.company_id === undefined || c.company_id === filters.company_id))
          .map(([cid, c]) => ({ campaign_id: cid, company_id: c.company_id, campaign_snapshot: {} }));
        return entries;
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

jest.mock('../../db/campaignStore', () => ({
  getCampaignById: jest.fn(async (id: string) => {
    const c = (global as any).__CAMPAIGNS__[id];
    return c ? { id, ...c, duration_weeks: 12 } : null;
  }),
}));
(global as any).__CAMPAIGNS__ = CAMPAIGNS;

jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: jest.fn(async (a: any) => {
    serviceCalls.push({ fn: 'saveCampaignBlueprintFromLegacy', args: a });
    return { ok: true };
  }),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: jest.fn(async (campaignId: string, stage: string, companyId?: string) => {
    serviceCalls.push({ fn: 'syncCampaignVersionStage', args: { campaignId, stage, companyId } });
  }),
  getTrendSnapshots: jest.fn(async () => []),
}));
jest.mock('../../services/decisionReportService', () => ({
  getDecisionReportView: jest.fn(async (a: any) => {
    serviceCalls.push({ fn: 'getDecisionReportView', args: a });
    return { companyId: a.companyId, entityId: a.entityId, sections: [] };
  }),
}));
jest.mock('../../services/intelligenceExecutionContext', () => ({
  runInApiReadContext: jest.fn(async (_n: string, fn: any) => fn()),
}));

const createPlanRoute = require('../../../pages/api/campaigns/create-12week-plan').default;
const insightsRoute = require('../../../pages/api/campaigns/[id]/strategic-insights').default;
const businessReportRoute = require('../../../pages/api/campaigns/business-report').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}

async function post(route: any, user: string | null, body: any) {
  authUser = user;
  queries.length = 0; writes.length = 0; serviceCalls.length = 0;
  const res = mockRes();
  await route({ method: 'POST', url: '/x', headers: {}, query: {}, body } as never, res);
  return res;
}

const PLAN = {
  startDate: '2026-09-01',
  aiContent: 'week one: launch',
};

beforeEach(() => { authUser = MEMBER_A; superAdmins = [SUPERADMIN]; });

describe('campaigns/create-12week-plan — tenant binding', () => {
  it('an unauthenticated caller is refused and writes nothing', async () => {
    const res = await post(createPlanRoute, null, { campaignId: OWN_CAMPAIGN, ...PLAN });
    expect(res.statusCode).toBe(401);
    expect(tenantWrites()).toEqual([]);
  });

  it('the owner can still plan their own campaign', async () => {
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: OWN_CAMPAIGN, companyId: COMPANY_A, ...PLAN,
    });
    expect(res.statusCode).toBe(200);
    expect(serviceCalls.some(s => s.fn === 'saveCampaignBlueprintFromLegacy')).toBe(true);
  });

  it("CRITICAL a foreign campaign cannot be updated (Pattern C)", async () => {
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: VICTIM_CAMPAIGN, ...PLAN,
    });
    // No write of any kind may touch the victim's campaign.
    const touched = tenantWrites().filter(w =>
      w.filters.id === VICTIM_CAMPAIGN ||
      w.payload?.campaign_id === VICTIM_CAMPAIGN ||
      (Array.isArray(w.payload) && w.payload.some((r: any) => r.campaign_id === VICTIM_CAMPAIGN)));
    expect(touched).toEqual([]);
    expect(serviceCalls).toEqual([]);
    expect([401, 403, 404]).toContain(res.statusCode);
  });

  /*
   * Mutation note — swapping `authorizedCompanyId` back to the raw body
   * `companyId` at the campaign_versions sink is an EQUIVALENT mutation, not an
   * undetected one. That insert lives inside the `if (!campaign)` branch, and on
   * that branch authorizedCompanyId is set ONLY by authorizing body.companyId
   * itself, so on every path that reaches the sink the two values are identical.
   * The binding is still the correct code: it stops being equivalent the moment
   * the insert moves out of the create branch, and the next test pins the
   * behaviour the binding guarantees.
   */
  it('CRITICAL a caller-supplied companyId cannot attach a version to a foreign company (Pattern A)', async () => {
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: NEW_CAMPAIGN, companyId: VICTIM, ...PLAN,
    });
    const versionWrites = tenantWrites().filter(w => w.table === 'campaign_versions');
    for (const w of versionWrites) expect(w.payload.company_id).not.toBe(VICTIM);
    for (const s of serviceCalls) {
      if (s.args?.companyId) expect(s.args.companyId).not.toBe(VICTIM);
    }
    expect([401, 403, 404]).toContain(res.statusCode);
  });

  it("CRITICAL a foreign campaign plus the attacker OWN companyId is still refused (Pattern B)", async () => {
    // Mutation testing found this gap: the earlier foreign-campaign test sent no
    // body company at all, so it never exercised the shape where the caller
    // supplies a company they legitimately belong to in order to satisfy the
    // guard while operating on someone else's campaign. The operative company
    // must come from the CAMPAIGN, never from the request.
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: VICTIM_CAMPAIGN, companyId: COMPANY_A, ...PLAN,
    });
    expect([401, 403, 404]).toContain(res.statusCode);
    const touched = tenantWrites().filter(w =>
      w.filters.id === VICTIM_CAMPAIGN || w.payload?.campaign_id === VICTIM_CAMPAIGN);
    expect(touched).toEqual([]);
    expect(serviceCalls).toEqual([]);
  });

  it('CRITICAL a foreign companyId cannot ride along on the caller OWN campaign', async () => {
    // The complement: authorization legitimately succeeds (own campaign), so the
    // question is whether a body company can still steer a downstream sink.
    await post(createPlanRoute, MEMBER_A, {
      campaignId: OWN_CAMPAIGN, companyId: VICTIM, ...PLAN,
    });
    for (const s of serviceCalls) {
      if (s.args?.companyId !== undefined) expect(s.args.companyId).not.toBe(VICTIM);
    }
    for (const w of tenantWrites()) {
      if (w.payload?.company_id !== undefined) expect(w.payload.company_id).not.toBe(VICTIM);
    }
    const sync = serviceCalls.find(s => s.fn === 'syncCampaignVersionStage');
    if (sync) expect(sync.args.companyId).toBe(COMPANY_A);
  });

  it('CRITICAL no blueprint, refinement or performance row is written for a foreign campaign', async () => {
    await post(createPlanRoute, MEMBER_A, { campaignId: VICTIM_CAMPAIGN, ...PLAN });
    expect(tenantWrites().some(w => w.table === 'weekly_content_refinements')).toBe(false);
    expect(tenantWrites().some(w => w.table === 'campaign_performance')).toBe(false);
    expect(serviceCalls.some(s => s.fn === 'saveCampaignBlueprintFromLegacy')).toBe(false);
  });

  it('a campaign with no company cannot be hijacked by a non-creator', async () => {
    const res = await post(createPlanRoute, MEMBER_A, { campaignId: ORPHAN_CAMPAIGN, ...PLAN });
    const touched = tenantWrites().filter(w => w.filters.id === ORPHAN_CAMPAIGN);
    expect(touched).toEqual([]);
    expect([401, 403, 404]).toContain(res.statusCode);
  });

  it('creating a brand-new campaign in the caller own company still works', async () => {
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: NEW_CAMPAIGN, companyId: COMPANY_A, campaignName: 'X', ...PLAN,
    });
    expect(res.statusCode).toBe(200);
    const v = tenantWrites().find(w => w.table === 'campaign_versions');
    if (v) expect(v.payload.company_id).toBe(COMPANY_A);
  });

  it('creating a campaign with NO companyId still works (the shipped caller omits it)', async () => {
    const res = await post(createPlanRoute, MEMBER_A, {
      campaignId: NEW_CAMPAIGN, campaignName: 'X', ...PLAN,
    });
    expect(res.statusCode).toBe(200);
    // No company means no campaign_versions row — the pre-existing behaviour.
    expect(tenantWrites().some(w => w.table === 'campaign_versions')).toBe(false);
  });

  it('missing required fields are rejected before any write', async () => {
    const res = await post(createPlanRoute, MEMBER_A, { campaignId: OWN_CAMPAIGN });
    expect(res.statusCode).toBe(400);
    expect(tenantWrites()).toEqual([]);
  });

  it('a non-POST verb reaches nothing', async () => {
    authUser = MEMBER_A;
    writes.length = 0;
    const res = mockRes();
    await createPlanRoute({ method: 'GET', url: '/x', headers: {}, query: {}, body: {} } as never, res);
    expect(res.statusCode).toBe(405);
    expect(tenantWrites()).toEqual([]);
  });

  it('a super admin retains platform reach', async () => {
    const res = await post(createPlanRoute, SUPERADMIN, {
      campaignId: VICTIM_CAMPAIGN, ...PLAN,
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('ordering: authorization precedes the first campaign write', async () => {
    await post(createPlanRoute, MEMBER_A, { campaignId: VICTIM_CAMPAIGN, ...PLAN });
    // The membership lookup must have happened, and no campaign write may follow.
    expect(queries.some(q => q.table === 'user_company_roles')).toBe(true);
    expect(tenantWrites().filter(w => w.table === 'campaigns')).toEqual([]);
  });
});

async function get(route: any, user: string | null, query: any) {
  authUser = user;
  queries.length = 0; writes.length = 0; serviceCalls.length = 0;
  const res = mockRes();
  await route({ method: 'GET', url: '/x', headers: {}, query, body: {} } as never, res);
  return res;
}

/** The company that actually reached the report service. */
const reportOrg = () => serviceCalls.find(s => s.fn === 'getDecisionReportView')?.args?.companyId;

describe('campaigns/[id]/strategic-insights — tenant binding', () => {
  it('an unauthenticated caller reaches no report', async () => {
    const res = await get(insightsRoute, null, { id: OWN_CAMPAIGN });
    expect([401, 403]).toContain(res.statusCode);
    expect(reportOrg()).toBeUndefined();
  });

  it('the owner receives insights for their own campaign', async () => {
    const res = await get(insightsRoute, MEMBER_A, { id: OWN_CAMPAIGN });
    expect(res.statusCode).toBe(200);
    expect(reportOrg()).toBe(COMPANY_A);
  });

  it("CRITICAL a foreign campaign is refused because the company is derived FROM the campaign", async () => {
    // The company is server-derived, so naming the victim's campaign asks for
    // authorization against the VICTIM's company — which the caller lacks.
    const res = await get(insightsRoute, MEMBER_A, { id: VICTIM_CAMPAIGN });
    expect([401, 403]).toContain(res.statusCode);
    expect(reportOrg()).toBeUndefined();
  });

  it('CRITICAL a caller-supplied companyId cannot override the campaign-derived one', async () => {
    const res = await get(insightsRoute, MEMBER_A, { id: VICTIM_CAMPAIGN, companyId: COMPANY_A });
    expect([401, 403]).toContain(res.statusCode);
    expect(reportOrg()).not.toBe(COMPANY_A);
  });

  it('a missing campaign id is rejected before any read', async () => {
    const res = await get(insightsRoute, MEMBER_A, {});
    expect(res.statusCode).toBe(400);
    expect(reportOrg()).toBeUndefined();
  });

  it('a non-GET verb reaches nothing', async () => {
    authUser = MEMBER_A; serviceCalls.length = 0;
    const res = mockRes();
    await insightsRoute({ method: 'POST', url: '/x', headers: {}, query: { id: OWN_CAMPAIGN }, body: {} } as never, res);
    expect(res.statusCode).toBe(405);
    expect(serviceCalls).toEqual([]);
  });

  it('the route performs no writes', async () => {
    await get(insightsRoute, MEMBER_A, { id: OWN_CAMPAIGN });
    expect(tenantWrites()).toEqual([]);
  });
});

describe('campaigns/business-report — tenant binding', () => {
  const q = (companyId: string, campaignId: string) => ({ companyId, campaignId });

  it('an unauthenticated caller reaches no report', async () => {
    const res = await get(businessReportRoute, null, q(COMPANY_A, OWN_CAMPAIGN));
    expect([401, 403]).toContain(res.statusCode);
    expect(reportOrg()).toBeUndefined();
  });

  it('the owner receives their own business report', async () => {
    const res = await get(businessReportRoute, MEMBER_A, q(COMPANY_A, OWN_CAMPAIGN));
    expect(res.statusCode).toBe(200);
    expect(reportOrg()).toBe(COMPANY_A);
  });

  it('CRITICAL a foreign company is refused and no report is produced', async () => {
    const res = await get(businessReportRoute, MEMBER_A, q(VICTIM, VICTIM_CAMPAIGN));
    expect([401, 403]).toContain(res.statusCode);
    expect(reportOrg()).toBeUndefined();
  });

  it("CRITICAL a foreign campaign under the caller own company yields no victim version row", async () => {
    // campaign_versions is scoped on BOTH campaign_id and company_id, so the
    // victim's snapshot is unreachable even when the authorized company is real.
    await get(businessReportRoute, MEMBER_A, q(COMPANY_A, VICTIM_CAMPAIGN));
    const versionRead = queries.find(v => v.table === 'campaign_versions');
    expect(versionRead?.filters.company_id).toBe(COMPANY_A);
    expect(reportOrg()).not.toBe(VICTIM);
  });

  it('every campaign_versions read carries the authorized company predicate', async () => {
    await get(businessReportRoute, MEMBER_A, q(COMPANY_A, OWN_CAMPAIGN));
    for (const v of queries.filter(x => x.table === 'campaign_versions')) {
      expect(v.filters.company_id).toBe(COMPANY_A);
    }
  });

  it('a missing identifier is rejected before any read', async () => {
    const res = await get(businessReportRoute, MEMBER_A, { companyId: COMPANY_A });
    expect(res.statusCode).toBe(400);
    expect(reportOrg()).toBeUndefined();
  });

  it('the route performs no writes', async () => {
    await get(businessReportRoute, MEMBER_A, q(COMPANY_A, OWN_CAMPAIGN));
    expect(tenantWrites()).toEqual([]);
  });
});

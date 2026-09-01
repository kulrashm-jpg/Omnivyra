/**
 * CAMPAIGN-RESOURCE-AUTHZ-SEC-001 — resource-derived tenant authorization.
 *
 * THE DEFECT, confirmed live in production by AUTHZ-CROSS-TABLE-DERIVATION-001:
 * three campaign routes accepted a caller-supplied campaignId, derived that
 * campaign's owning company from the row, and used it as the tenant for reads
 * and writes — without ever proving the caller may touch that campaign.
 * hierarchical-navigation and generate-weekly-structure had NO authentication
 * at all; an anonymous GET answered 404 "Campaign not found" instead of 401,
 * so the route doubled as an existence oracle and, for a real id, returned that
 * tenant's campaign content and company_id.
 *
 * A resource's company_id is ownership METADATA. It never establishes that the
 * caller owns the resource. These tests exercise the REAL authorization chain —
 * requireCampaignAccess -> resolveCampaignCompanyId -> resolveUserContext ->
 * getUserCompanyRole -> getUserRole — with only the database and the identity
 * provider faked, so a regression in any link fails here.
 *
 * Every case asserts TWO things: what the caller got back, and whether the
 * sink was reached at all. A 403 that still ran the query is not a fix.
 */

export {};

/* ── canary fixtures ──────────────────────────────────────────────────────── */
const CO_A = 'co-a-0000-0000-0000-00000000000a';
const CO_B = 'co-b-0000-0000-0000-00000000000b';
const CAMPAIGN_A = 'camp-a-00-0000-0000-00000000000a';
const CAMPAIGN_B = 'camp-b-00-0000-0000-00000000000b';
const UNKNOWN_CAMPAIGN = 'camp-x-00-0000-0000-00000000000x';
const USER_A = 'user-a-00-0000-0000-00000000000a';

/** If this string ever reaches a response, tenant isolation has failed. */
const CANARY = 'CANARY-COMPANY-B-CONFIDENTIAL';

const CAMPAIGN_ROWS = [
  { id: CAMPAIGN_A, company_id: CO_A, name: 'Company A campaign', description: 'a', status: 'planning', created_at: '2026-01-01', weekly_themes: null, duration_weeks: 4, start_date: '2026-07-06T00:00:00.000Z' },
  { id: CAMPAIGN_B, company_id: CO_B, name: `Company B campaign ${CANARY}`, description: CANARY, status: 'planning', created_at: '2026-01-01', weekly_themes: null, duration_weeks: 4, start_date: '2026-07-06T00:00:00.000Z' },
];
const VERSION_ROWS = [
  { campaign_id: CAMPAIGN_A, company_id: CO_A, version: 1, created_at: '2026-01-01', campaign_snapshot: null },
  { campaign_id: CAMPAIGN_B, company_id: CO_B, version: 1, created_at: '2026-01-01', campaign_snapshot: null },
];
const REFINEMENT_ROWS = [
  { id: 'r-b', campaign_id: CAMPAIGN_B, week_number: 1, theme: CANARY, key_messaging: CANARY },
];
const SLOT_ROWS = [
  { campaign_id: CAMPAIGN_B, platform: 'linkedin', status: 'published', week_number: 1, content_type: 'post', actual_metrics: { reach: 4242 } },
];
/** USER_A is an active COMPANY_ADMIN of company A, and of nothing else. */
const ROLE_ROWS = [
  { user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
];

/* ── observable state ─────────────────────────────────────────────────────── */
type Call = { table: string; op: string; filters: Record<string, unknown> };
let calls: Call[] = [];
let authUser: { id: string; email: string } | null = null;
let authError: string | null = null;
/** Tables that only a tenant-authorized caller may ever touch. */
const SENSITIVE = ['campaigns', 'weekly_content_refinements', 'daily_content_plans', 'campaign_week_plan'];
const sensitiveCalls = () => calls.filter((c) => SENSITIVE.includes(c.table));
const writes = () => calls.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op));

function rowsFor(table: string): any[] {
  if (table === 'campaigns') return CAMPAIGN_ROWS;
  if (table === 'campaign_versions') return VERSION_ROWS;
  if (table === 'weekly_content_refinements') return REFINEMENT_ROWS;
  if (table === 'daily_content_plans') return SLOT_ROWS;
  if (table === 'user_company_roles') return ROLE_ROWS;
  return [];
}

/** A small PostgREST-shaped fake that records every call and honours filters. */
function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  let op = 'select';
  const b: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'lt', 'gt', 'neq']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'neq') filters.__neq = args[1];
      return b;
    };
  }
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    b[m] = (...args: unknown[]) => { op = m; filters.__payload = args[0]; return b; };
  }
  b.eq = (col: string, val: unknown) => { filters[col] = val; return b; };
  const resolve = () => {
    calls.push({ table, op, filters: { ...filters } });
    const matched = rowsFor(table).filter((r) =>
      Object.entries(filters).every(([k, v]) =>
        k.startsWith('__') ? true : (r as any)[k] === v));
    return { data: matched, error: null };
  };
  b.maybeSingle = async () => { const r = resolve(); return { data: r.data[0] ?? null, error: null }; };
  b.single = async () => { const r = resolve(); return { data: r.data[0] ?? null, error: null }; };
  b.then = (ok: any, err: any) => Promise.resolve(resolve()).then(ok, err);
  return b;
}

/*
 * `@/config` validates the whole runtime env schema on import and throws under
 * test. resolveUserContext touches it only on the ANONYMOUS branch, via
 * devIdentityOptIn(), so without this the 401 path raises and the route's
 * try/catch turns it into a 500 — masking the very assertion that matters.
 * Faked with production-shaped values: no DEV_USER_ID, so the synthetic dev
 * identity stays off and the real unauthenticated path is exercised.
 */
jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => makeBuilder(t) },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => makeBuilder(t),
}));
/** The identity provider is faked; everything above it runs for real. */
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    (authUser ? { user: authUser, error: null } : { user: null, error: authError ?? 'MISSING_AUTH' })),
}));
/** Blueprint service is a pure campaign-keyed reader; keep it out of the way. */
jest.mock('../../services/campaignBlueprintService', () => ({
  getUnifiedCampaignBlueprint: jest.fn(async () => null),
}));
/*
 * The stored context deliberately carries a DIFFERENT company than the one the
 * caller is authorized for. Real data should never diverge, but the invariant
 * under test is that the tenant comes from the authorization boundary and is
 * never re-derived from the resource — so the fixture makes the two
 * distinguishable. With the context mocked to null, re-deriving would silently
 * pass because both paths collapse to the same value.
 */
const STALE_CONTEXT_CO = 'co-stale-0-0000-0000-00000000000s';
jest.mock('../../services/campaignContextService', () => ({
  getCampaignContext: jest.fn(async () => ({ company_id: 'co-stale-0-0000-0000-00000000000s' })),
  updateCampaignMemory: jest.fn(async () => {}),
}));

import navHandler from '../../../pages/api/campaigns/hierarchical-navigation';
import insightsHandler from '../../../pages/api/campaigns/performance-insights';
import { updateCampaignMemory } from '../../services/campaignContextService';
import { requireCampaignAccess } from '../../services/campaignAccessService';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  res.end = () => res;
  return res;
}
const asMember = () => { authUser = { id: USER_A, email: 'a@example.com' }; authError = null; };
const asAnonymous = () => { authUser = null; authError = 'MISSING_AUTH'; };
const asBogusToken = () => { authUser = null; authError = 'INVALID_AUTH'; };

beforeEach(() => {
  calls = [];
  asMember();
  (updateCampaignMemory as jest.Mock).mockClear();
});

/* ════════════════════════════════════════════════════════════════════════════
 * hierarchical-navigation — was fully unauthenticated and read-only.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('hierarchical-navigation', () => {
  const call = async (query: Record<string, unknown>) => {
    const res = mockRes();
    await navHandler({ method: 'GET', query, headers: {}, body: {} } as any, res);
    return res;
  };

  describe('authentication', () => {
    it('CRITICAL anonymous is rejected and NO campaign query runs', async () => {
      /*
       * The production proof of this defect was an anonymous GET returning
       * 404 "Campaign not found" rather than 401 — the handler had executed.
       * Asserting the status alone would still pass if the lookup ran first,
       * so the sink assertion is the real test here.
       */
      asAnonymous();
      const res = await call({ campaignId: CAMPAIGN_B, action: 'get-overview' });
      expect(res.statusCode).toBe(401);
      expect(sensitiveCalls()).toEqual([]);
    });

    it('CRITICAL a bogus bearer token is rejected before any campaign query', async () => {
      asBogusToken();
      const res = await call({ campaignId: CAMPAIGN_B, action: 'get-overview' });
      expect(res.statusCode).toBe(401);
      expect(sensitiveCalls()).toEqual([]);
    });

    it('CRITICAL anonymous cannot tell a real campaign from an invented one', async () => {
      /*
       * The oracle. Both answers must be identical — same status, same body —
       * or an anonymous caller can still enumerate campaign ids.
       */
      asAnonymous();
      const real = await call({ campaignId: CAMPAIGN_B, action: 'get-overview' });
      calls = [];
      const fake = await call({ campaignId: UNKNOWN_CAMPAIGN, action: 'get-overview' });
      expect(real.statusCode).toBe(fake.statusCode);
      expect(real.body).toEqual(fake.body);
      expect(real.statusCode).toBe(401);
    });

    it('anonymous is rejected on the get-weeks branch too', async () => {
      // Each branch touches tenant data at a different line; the guard sits
      // above the switch precisely so no branch can be reached without it.
      asAnonymous();
      const res = await call({ campaignId: CAMPAIGN_B, action: 'get-weeks' });
      expect(res.statusCode).toBe(401);
      expect(sensitiveCalls()).toEqual([]);
    });
  });

  describe('resource ownership', () => {
    it('CRITICAL a member of A is denied campaign B and receives no B data', async () => {
      const res = await call({ campaignId: CAMPAIGN_B, action: 'get-overview' });
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(CANARY);
      expect(JSON.stringify(res.body)).not.toContain(CO_B);
      expect(sensitiveCalls()).toEqual([]);
    });

    it('CRITICAL the foreign denial leaks neither company_id nor content', async () => {
      const res = await call({ campaignId: CAMPAIGN_B, action: 'get-weeks' });
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.body ?? {})).not.toContain(CANARY);
    });

    it('a member reaches their OWN campaign', async () => {
      const res = await call({ campaignId: CAMPAIGN_A, action: 'get-overview' });
      expect(res.statusCode).toBe(200);
      expect(sensitiveCalls().length).toBeGreaterThan(0);
    });

    it('a nonexistent campaign is refused', async () => {
      const res = await call({ campaignId: UNKNOWN_CAMPAIGN, action: 'get-overview' });
      expect(res.statusCode).toBe(404);
      expect(sensitiveCalls()).toEqual([]);
    });

    it('a malformed campaign id is refused before any query', async () => {
      const res = await call({ action: 'get-overview' });
      expect(res.statusCode).toBe(400);
      expect(sensitiveCalls()).toEqual([]);
    });

    it('the route performs no writes at all', async () => {
      await call({ campaignId: CAMPAIGN_A, action: 'get-overview' });
      expect(writes()).toEqual([]);
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The shared binder itself. These three routes hoist their own identity check,
 * which would mask a regression inside requireCampaignAccess — and 35 other
 * routes depend on it without hoisting. Pinned directly.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('requireCampaignAccess (the shared binder)', () => {
  const run = async (campaignId: string) => {
    const res = mockRes();
    const out = await requireCampaignAccess({ headers: {}, query: {}, body: {} } as any, res, campaignId);
    return { res, out };
  };

  it('CRITICAL refuses an anonymous caller on its own, without the route gate', async () => {
    asAnonymous();
    const { res, out } = await run(CAMPAIGN_A);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('CRITICAL refuses a member of A access to company B', async () => {
    const { res, out } = await run(CAMPAIGN_B);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('fails closed on a campaign with no owner record', async () => {
    const { res, out } = await run(UNKNOWN_CAMPAIGN);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(404);
  });

  it('returns the server-resolved company, never a caller-supplied one', async () => {
    const { out } = await run(CAMPAIGN_A);
    expect(out).toMatchObject({ userId: USER_A, companyId: CO_A, campaignId: CAMPAIGN_A });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * performance-insights — authenticated but never authorized, and it WRITES.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('performance-insights', () => {
  const call = async (query: Record<string, unknown>) => {
    const res = mockRes();
    await insightsHandler({ method: 'GET', query, headers: {}, body: {} } as any, res);
    return res;
  };

  it('anonymous is rejected before the slot read', async () => {
    asAnonymous();
    const res = await call({ campaignId: CAMPAIGN_B });
    expect(res.statusCode).toBe(401);
    expect(sensitiveCalls()).toEqual([]);
  });

  it('CRITICAL a member of A is denied campaign B', async () => {
    // Authentication alone used to be enough here: any signed-in account could
    // name any campaign id.
    const res = await call({ campaignId: CAMPAIGN_B });
    expect(res.statusCode).toBe(403);
    expect(sensitiveCalls()).toEqual([]);
  });

  it('CRITICAL a denied caller never reads company B slots', async () => {
    await call({ campaignId: CAMPAIGN_B });
    expect(calls.filter((c) => c.table === 'daily_content_plans')).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain('4242');
  });

  it('CRITICAL a denied caller never writes to company B campaign memory', async () => {
    /*
     * The write was the worst of it: campaign_context is upserted with
     * onConflict 'campaign_id', so a foreign caller overwrote the victim's
     * stored planner memory, which feeds their next planning prompt.
     */
    await call({ campaignId: CAMPAIGN_B });
    expect(updateCampaignMemory as jest.Mock).not.toHaveBeenCalled();
  });

  it('a member reaches their own campaign', async () => {
    const res = await call({ campaignId: CAMPAIGN_A });
    expect(res.statusCode).toBe(200);
  });

  it('CRITICAL the memory write is stamped with the AUTHORIZED company', async () => {
    /*
     * Not one re-derived from the resource. The stored context here claims a
     * different company on purpose: if the route ever goes back to
     * `campaignCtx?.company_id ?? ...` — the shape that let a member of A write
     * into B's planner memory — this fails.
     */
    await call({ campaignId: CAMPAIGN_A });
    expect(updateCampaignMemory as jest.Mock).toHaveBeenCalled();
    expect((updateCampaignMemory as jest.Mock).mock.calls[0][1]).toBe(CO_A);
    expect((updateCampaignMemory as jest.Mock).mock.calls[0][1]).not.toBe(STALE_CONTEXT_CO);
  });

  it('a nonexistent campaign is refused without reading slots', async () => {
    const res = await call({ campaignId: UNKNOWN_CAMPAIGN });
    expect(res.statusCode).toBe(404);
    expect(calls.filter((c) => c.table === 'daily_content_plans')).toEqual([]);
  });

  it('a missing campaign id is refused', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(sensitiveCalls()).toEqual([]);
  });
});

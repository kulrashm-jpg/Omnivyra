/**
 * e1 2026-11-13 (CI-296 RED, BLOCKING): five routes called pickOperationalMembership WITHOUT importing it.
 * ts-jest is transpile-only, so no suite noticed; in production every call would have thrown a ReferenceError
 * (500). This suite EXECUTES each handler through the pick, so a missing import - or a pick that derives an
 * inactive company - fails a unit test, not only tsc.
 *
 * Fixture: the caller has ACTIVE memberships in two companies; C_INACTIVE (suspended) sorts FIRST, so a route
 * that ignored the gate would derive it. Each request stops right after the pick at a step that proves which
 * company was derived (or, where possible, at a validation step that is only reachable past the pick).
 */
export {};

const U = 'user-1';
const C_INACTIVE = '00000000-0000-0000-0000-00000000000a'; // sorts first
const C_ACTIVE = '00000000-0000-0000-0000-00000000000b';

type Row = Record<string, unknown>;
const mockDb: Record<string, Row[]> = {};
const mockReads: Array<{ table: string; filters: Record<string, unknown> }> = [];

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let rows = [...(mockDb[table] ?? [])];
    const b: any = {};
    const chain = () => b;
    Object.assign(b, {
      select: chain, order: chain, limit: chain, gte: chain, lte: chain, neq: chain, not: chain,
      eq: (c: string, v: unknown) => { filters[c] = v; rows = rows.filter((r) => r[c] === v); return b; },
      in: (c: string, vs: unknown[]) => { filters[c] = { in: vs }; rows = rows.filter((r) => vs.includes(r[c])); return b; },
      maybeSingle: async () => { mockReads.push({ table, filters: { ...filters } }); return { data: rows[0] ?? null, error: null }; },
      single: async () => { mockReads.push({ table, filters: { ...filters } }); return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }; },
      upsert: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
      then: (resolve: any, reject: any) => {
        mockReads.push({ table, filters: { ...filters } });
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
      },
    });
    return b;
  };
  return { supabase: { from: (t: string) => build(t), rpc: async () => ({ data: null, error: null }) } };
});
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1', email: 'u@acme.test' }, error: null }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockEarnOrgIds: string[] = [];
jest.mock('../../services/earnCreditsService', () => {
  const actual = jest.requireActual('../../services/earnCreditsService');
  return {
    ...actual,
    getEarnProgress: async (orgId: string) => { mockEarnOrgIds.push(orgId); return {}; },
    checkAndGrantSetupCredits: async (orgId: string) => { mockEarnOrgIds.push(orgId); return { setup_credits: 0, website_credits: 0 }; },
  };
});
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://app.example.test' }));

/* eslint-disable @typescript-eslint/no-var-requires */
const feedback = require('../../../pages/api/credits/earn/feedback').default;
const progress = require('../../../pages/api/credits/earn/progress').default;
const referral = require('../../../pages/api/credits/earn/referral').default;
const setupProgress = require('../../../pages/api/credits/earn/setup-progress').default;
const schedulerPrefs = require('../../../pages/api/settings/scheduler-prefs').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function seed(companies: Array<[string, string]>) {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockReads.length = 0;
  mockEarnOrgIds.length = 0;
  mockDb.user_company_roles = companies.map(([id]) => ({ user_id: U, company_id: id, status: 'active', role: 'COMPANY_ADMIN' }));
  mockDb.companies = companies.map(([id, status]) => ({ id, status, deleted_at: null }));
  mockDb.users = [{ id: U, active_company_id: null }];
}
async function call(h: (req: unknown, res: unknown) => Promise<unknown>, method: string, body: unknown = {}) {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  await h({ method, headers: {}, query: {}, body }, res);
  return res;
}
const companyFilterOn = (table: string) => mockReads.filter((r) => r.table === table).map((r) => r.filters.company_id);

describe('derive-my-company routes execute the operational pick (CI-296 missing-import regression)', () => {
  const BOTH: Array<[string, string]> = [[C_INACTIVE, 'suspended'], [C_ACTIVE, 'active']];
  const ONLY_INACTIVE: Array<[string, string]> = [[C_INACTIVE, 'suspended']];

  it('credits/earn/feedback: passes the pick with an operational company (reaches body validation)', async () => {
    seed(BOTH);
    const r = await call(feedback, 'POST', { feedbackText: '' });
    expect([r.statusCode, r.body]).toEqual([400, { error: 'feedbackText required' }]);
    seed(ONLY_INACTIVE);
    const r2 = await call(feedback, 'POST', { feedbackText: '' });
    expect([r2.statusCode, r2.body]).toEqual([400, { error: 'No active company' }]);
  });

  it('credits/earn/progress: derives the ACTIVE company, never the suspended one that sorts first', async () => {
    seed(BOTH);
    await call(progress, 'GET');
    expect(mockEarnOrgIds).toEqual([C_ACTIVE]);
    seed(ONLY_INACTIVE);
    const r2 = await call(progress, 'GET');
    expect([r2.statusCode, r2.body]).toEqual([400, { error: 'No active company' }]);
    expect(mockEarnOrgIds).toEqual([]);
  });

  it('credits/earn/referral: passes the pick and answers 200; a suspended-only caller gets "No active company"', async () => {
    seed(BOTH);
    const r = await call(referral, 'GET');
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ referral_link: expect.stringContaining('https://app.example.test/create-account?ref=') });
    seed(ONLY_INACTIVE);
    const r2 = await call(referral, 'GET');
    expect([r2.statusCode, r2.body]).toEqual([400, { error: 'No active company' }]);
  });

  it('credits/earn/setup-progress: passes the pick (reaches step validation)', async () => {
    seed(BOTH);
    const r = await call(setupProgress, 'PATCH', { step: 'not_a_step' });
    expect(r.statusCode).toBe(400);
    expect(String(r.body?.error)).toMatch(/^step must be one of/);
    seed(ONLY_INACTIVE);
    const r2 = await call(setupProgress, 'PATCH', { step: 'not_a_step' });
    expect([r2.statusCode, r2.body]).toEqual([400, { error: 'No active company' }]);
  });

  it('settings/scheduler-prefs: reads the prefs of the ACTIVE company; a suspended-only caller is refused', async () => {
    seed(BOTH);
    const r = await call(schedulerPrefs, 'GET');
    expect(r.statusCode).toBe(200);
    expect(companyFilterOn('company_scheduler_prefs')).toEqual([C_ACTIVE]);
    seed(ONLY_INACTIVE);
    const r2 = await call(schedulerPrefs, 'GET');
    expect(r2.statusCode).toBe(401);
    expect(companyFilterOn('company_scheduler_prefs')).toEqual([]);
  });
});

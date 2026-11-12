/**
 * S2 tenant seam (e1) - growth intelligence. resolveCampaignIdsForCompany used to fall back (no campaign_versions)
 * to campaigns.in('user_id', <active members>): every campaign ANY member had created, whichever company owned it.
 * A user in A and B therefore put B's campaigns, posts and analytics into A's growth intelligence. Now the campaign
 * list is the tenant's own (campaigns.company_id via the seam), health counts scheduled_posts through
 * tenantChildTableOf, and community / opportunity counts go through tenantTable.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let head = false; let counted = false; let cap = Infinity;
  let range: [number, number] | null = null; let orderBy: string | null = null;
  const b: any = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { counted = !!o?.count; head = !!o?.head; return b; },
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    limit: (n: number) => { cap = n; return b; },
    order: (c: string) => { orderBy = c; return b; },
    range: (from: number, to: number) => { range = [from, to]; return b; },
    then: (ok: any, ko: any) => {
      let hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      const count = hit.length;
      if (orderBy) { const k = orderBy; hit = [...hit].sort((x, y) => String(x[k]).localeCompare(String(y[k]))); }
      // PostgREST: a read returns at most max-rows (1000) rows unless a range is requested.
      hit = range ? hit.slice(range[0], range[1] + 1) : hit.slice(0, Math.min(cap, 1000));
      return Promise.resolve({ data: head ? null : hit, count: counted ? count : null, error: null }).then(ok, ko);
    },
  };
  return b;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async () => ({ userId: 'u-shared', role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/companyContextGuardService', () => ({
  requireCompanyContext: async (i: { companyId: string }) => ({ companyId: i.companyId }),
}));
const mockVelocityIds: unknown[] = [];
jest.mock('../../services/growthIntelligence/metrics/contentVelocity', () => ({
  getContentVelocityMetrics: async (_db: unknown, ids: unknown) => { mockVelocityIds.push(ids); return { ok: true }; },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const health = require('../../../pages/api/growth-intelligence/health').default;
const velocity = require('../../../pages/api/growth-intelligence/content-velocity').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function call(route: any, query: Record<string, string>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'GET', headers: {}, query, body: {} }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockVelocityIds.length = 0;
  // 'u-shared' is an active member of BOTH companies and created a campaign in each.
  mockDb.user_company_roles = [
    { user_id: 'u-shared', company_id: A, status: 'active' },
    { user_id: 'u-shared', company_id: B, status: 'active' },
  ];
  mockDb.campaign_versions = []; // forces the former member-created fallback
  mockDb.campaigns = [
    { id: 'camp-a', company_id: A, user_id: 'u-shared' },
    { id: 'camp-b', company_id: B, user_id: 'u-shared' },
    { id: 'camp-legacy', company_id: null, user_id: 'u-shared' },
  ];
  mockDb.scheduled_posts = [
    { id: 'post-a', campaign_id: 'camp-a' },
    { id: 'post-b1', campaign_id: 'camp-b' },
    { id: 'post-b2', campaign_id: 'camp-b' },
  ];
  mockDb.content_analytics = [
    { id: 'an-a', scheduled_post_id: 'post-a' },
    { id: 'an-b1', scheduled_post_id: 'post-b1' },
    { id: 'an-b2', scheduled_post_id: 'post-b2' },
  ];
  mockDb.community_ai_actions = [{ id: 'ca-a', organization_id: A }, ...[1, 2, 3, 4, 5].map((i) => ({ id: `ca-b${i}`, organization_id: B }))];
  mockDb.theme_company_relevance = [{ id: 'tr-a1', company_id: A }, { id: 'tr-a2', company_id: A }, ...[1, 2, 3].map((i) => ({ id: `tr-b${i}`, company_id: B }))];
});

it("A's health counts only A's campaigns, posts, analytics, community actions and signals", async () => {
  const r = await call(health, { companyId: A });
  expect(r.statusCode).toBe(200);
  expect(r.body.data.counts).toEqual({ campaigns: 1, scheduledPosts: 1, analyticsRecords: 1, communityActions: 1, opportunitySignals: 2 });
});

it("A's content-velocity is computed over A's campaign only - never a campaign a shared member created in B", async () => {
  const r = await call(velocity, { companyId: A });
  expect(r.statusCode).toBe(200);
  expect(mockVelocityIds).toEqual([['camp-a']]);
});

it('large accounts: posts and analytics above PostgREST max-rows (1000) are counted exactly', async () => {
  const many = Array.from({ length: 1201 }, (_, i) => `post-a-${String(i).padStart(5, '0')}`);
  mockDb.scheduled_posts = [...many.map((id) => ({ id, campaign_id: 'camp-a' })), { id: 'post-b1', campaign_id: 'camp-b' }];
  mockDb.content_analytics = [...many.map((id) => ({ id: `an-${id}`, scheduled_post_id: id })), { id: 'an-b1', scheduled_post_id: 'post-b1' }];
  const r = await call(health, { companyId: A });
  expect(r.body.data.counts).toMatchObject({ scheduledPosts: 1201, analyticsRecords: 1201 });
});

/**
 * S2 tenant seam (e1) - pages/api/executive/campaign-health.ts. campaign_performance, scheduled_posts
 * (child of campaigns), usage_events and campaigns are read under the company requireCampaignAccess
 * resolved. A B-tenant row carrying A's campaign id never reaches A's health summary.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false;
  const run = () => {
    const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    gte: (c: string, v: any) => { tests.push((r) => r[c] >= v); return b; },
    lte: (c: string, v: any) => { tests.push((r) => r[c] <= v); return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAMP = 'c0000000-0000-4000-8000-0000000000aa';
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: async () => ({ userId: 'user-a', companyId: '11111111-1111-4111-8111-111111111111', campaignId: 'c0000000-0000-4000-8000-0000000000aa' }),
}));
jest.mock('../../services/decisionReportService', () => ({ getDecisionReportView: async () => null }));
jest.mock('../../services/intelligenceExecutionContext', () => ({ runInApiReadContext: (fn: () => unknown) => fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const health = require('../../../pages/api/executive/campaign-health').default;
/* eslint-enable @typescript-eslint/no-var-requires */
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
  mockDb.campaigns = [{ id: CAMP, company_id: A, ai_budget_monthly: 100 }];
  mockDb.campaign_performance = [
    { company_id: A, campaign_id: CAMP, performance_date: today, total_reach: 10, total_engagement: 5 },
    { company_id: B, campaign_id: CAMP, performance_date: today, total_reach: 99999, total_engagement: 77777 },
  ];
  mockDb.scheduled_posts = [{ id: 'sp-a', campaign_id: CAMP }];
  mockDb.post_comments = [];
  mockDb.usage_events = [
    { organization_id: A, campaign_id: CAMP, source_type: 'llm', total_tokens: 100, total_cost: 1, created_at: recent },
    { organization_id: B, campaign_id: CAMP, source_type: 'llm', total_tokens: 9999, total_cost: 555, created_at: recent },
  ];
});

it("A's campaign health never includes B's rows that carry A's campaign id", async () => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await health({ method: 'GET', headers: {}, query: { campaignId: CAMP }, body: {} }, res);
  expect(res.statusCode).toBe(200);
  // exact aggregates: B's usage row (cost 555, tokens 9999) would make these 556 / 10099
  expect(res.body.ai_spend_last_30_days).toEqual({ total_tokens: 100, total_cost: 1, llm_calls: 1 });
});

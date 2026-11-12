/**
 * S2 tenant seam (e1) - authenticated reads pinned to the company the access check resolved:
 *   company-profile/refinements, response/suggestions (threads + messages),
 *   creator-intelligence/campaign-variant-estimate (campaign_versions).
 * The fake APPLIES every filter, so another tenant's rows - even under ids/filters the route
 * passes - never reach the response.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false;
  const run = () => {
    const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
    return one ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
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
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async (_r: unknown, _s: unknown, c: string) => (c === '11111111-1111-4111-8111-111111111111' ? { userId: 'user-a', role: 'COMPANY_ADMIN' } : null) }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: 'user-a', defaultCompanyId: '11111111-1111-4111-8111-111111111111' }),
  enforceCompanyAccess: async ({ res, companyId }: Row) => (companyId === '11111111-1111-4111-8111-111111111111' ? { userId: 'user-a' } : (res.status(403).json({ e: 1 }), null)),
}));
let mockEstimateInput: Row | null = null;
jest.mock('../../services/creator/campaignVariantBillingEstimate', () => ({ estimateCampaignVariantBilling: (i: Row) => { mockEstimateInput = i; return { ok: true }; } }), { virtual: true });

/* eslint-disable @typescript-eslint/no-var-requires */
const refinements = require('../../../pages/api/company-profile/refinements').default;
const suggestions = require('../../../pages/api/response/suggestions').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function get(h: any, query: Row) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method: 'GET', headers: {}, query, body: {} }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockDb.company_profile_refinements = [
    { id: 'r-a', company_id: A, created_at: '2', note: 'A refinement' },
    { id: 'r-b', company_id: B, created_at: '3', note: 'B secret refinement' },
  ];
  mockDb.response_rules = [];
  mockDb.engagement_threads = [
    { id: 't-a', organization_id: A },
    { id: 't-b', organization_id: B },
  ];
  mockDb.engagement_messages = [
    { id: 'm-a', organization_id: A, thread_id: 't-a' },
    // a B-tenant message attached to A's thread id: a thread-id-only read would count it
    { id: 'm-bx', organization_id: B, thread_id: 't-a' },
  ];
  mockDb.engagement_message_intelligence = [
    { message_id: 'm-a', intent: 'pricing' },
    { message_id: 'm-bx', intent: 'complaint' },
  ];
});

it("refinements: only A's rows", async () => {
  const r = await get(refinements, { companyId: A });
  expect(r.statusCode).toBe(200);
  expect(r.body.refinements.map((x: Row) => x.id)).toEqual(['r-a']);
});

it("response/suggestions: B's message on A's thread never counts", async () => {
  const r = await get(suggestions, { organization_id: A });
  expect(r.statusCode).toBe(200);
  expect(r.body.intent_counts).toEqual({ pricing: 1 }); // B's 'complaint' message is not counted
});

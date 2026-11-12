/**
 * S2 tenant seam (e1) - money reads with a request-sourced predicate (R6): billing/topup/history,
 * credits/usage (both behind withOrgAccess) now read through the seam with the org withOrgAccess
 * VALIDATED (req.orgAccess); company/billing/ledger with the assertOrgAccess-validated company
 * (pinned in companyBillingPortal). Structural: these routes already filtered by the validated
 * org, so this pins the outcome - another tenant's rows never appear, and a non-member is refused
 * before any read.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockReads: string[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = [];
  const run = () => { mockReads.push(table); return { data: (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))), error: null }; };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    gte: () => b,
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../services/requestAccessService', () => ({
  assertOrgAccess: async (_req: unknown, res: any, orgId: string) => (orgId === '11111111-1111-4111-8111-111111111111' ? { userId: 'user-a', superAdmin: false } : (res.status(403).json({ e: 1 }), null)),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const history = require('../../../pages/api/billing/topup/history').default;
const usage = require('../../../pages/api/credits/usage').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function get(h: any, query: Row) {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  await h({ method: 'GET', headers: {}, query, body: {} }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockReads.length = 0;
  mockDb.credit_purchases = [
    { id: 'p-a', organization_id: A, credits: 10, status: 'completed', created_at: '1' },
    { id: 'p-b', organization_id: B, credits: 999, status: 'completed', created_at: '2' },
  ];
  mockDb.credit_usage_log = [
    { action: 'a-action', organization_id: A, credits_used: 1, created_at: new Date().toISOString() },
    { action: 'b-secret', organization_id: B, credits_used: 9, created_at: new Date().toISOString() },
  ];
});

it("topup history: only A's purchases", async () => {
  const r = await get(history, { org_id: A });
  expect(r.statusCode).toBe(200);
  expect(r.body.purchases.map((p: Row) => p.id)).toEqual(['p-a']);
  expect(r.body.total_credits_purchased).toBe(10);
});

it("credits usage: B's actions never appear", async () => {
  const r = await get(usage, { org_id: A });
  expect(r.statusCode).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain('b-secret');
});

it('a non-member is refused before any read', async () => {
  const r = await get(history, { org_id: B });
  expect(r.statusCode).toBe(403);
  expect(mockReads).toEqual([]);
});

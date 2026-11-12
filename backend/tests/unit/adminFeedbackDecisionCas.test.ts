/**
 * CLASS 2 + CLASS 1 (2026-11-12): admin feedback approve / reject.
 *  - The decision update was unconditioned (and unread): a concurrent approve
 *    and reject both passed the 'pending' read; the LAST write won, so an
 *    approved-and-credited submission could end up 'rejected'.
 *  - credits_granted was set BEFORE the grant; a failed grant left the
 *    submission 'approved' with nothing credited and no way to retry (409).
 * Now: CAS on 'pending' + row count; a failed grant reverts the review to
 * pending (retryable); credits_granted is set only after the credit moved.
 *
 * The fake applies eq filters and returns copies; a race is injected after
 * the route's read.
 */
export {};
type Row = Record<string, any>;
let mockRows: Row[] = [];
let mockFail: Record<string, boolean> = {};
let mockBetween: (() => void) | null = null;
let mockGrant: { granted: boolean; credits: number; reason?: string } = { granted: true, credits: 50 };
const mockGrantCalls: string[] = [];

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: Row = {};
  const exec = async (single: boolean) => {
    if (mockFail[`${table}:${op}`]) return { data: null, error: { message: 'down' } };
    if (table !== 'feedback_submissions') return { data: null, error: null };
    const hit = mockRows.filter((r) => filters.every((f) => f(r)));
    if (op === 'select') { const c = hit.map((r) => ({ ...r })); if (mockBetween) { const f = mockBetween; mockBetween = null; f(); } return { data: single ? c[0] ?? null : c, error: null }; }
    for (const r of hit) Object.assign(r, payload);
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  };
  const b: any = {
    select: () => (op === 'select' ? b : b),
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: () => { op = 'insert'; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    maybeSingle: () => exec(true),
    then: (ok: any, ko: any) => exec(false).then(ok, ko),
  };
  return b;
}
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t) } }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'sa1' } }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => true }));
jest.mock('../../services/earnCreditsService', () => ({
  grantEarnCredit: async (p: { referenceId: string }) => { mockGrantCalls.push(p.referenceId); return mockGrant; },
}));

import handler from '../../../pages/api/admin/feedback';

const fb = () => mockRows[0];
function mockRes() { const r: any = { statusCode: 0, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.end = () => r; return r; }
async function decide(action: string) { const res = mockRes(); await handler({ method: 'PATCH', query: { id: 'f1' }, body: { action }, headers: {} } as any, res); return res; }

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockRows = [{ id: 'f1', user_id: 'u1', organization_id: 'o1', status: 'pending', credits_granted: false }];
  mockFail = {}; mockBetween = null; mockGrant = { granted: true, credits: 50 }; mockGrantCalls.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('control: approve -> approved, credited, flag set', async () => {
  const r = await decide('approve');
  expect(r.statusCode).toBe(200);
  expect(fb()).toMatchObject({ status: 'approved', credits_granted: true });
  expect(r.body.creditsGranted).toBe(50);
});

it('REJECT racing an approve that already landed: the approval stands, 409', async () => {
  mockBetween = () => { fb().status = 'approved'; };
  const r = await decide('reject');
  expect(r.statusCode).toBe(409);
  expect(fb().status).toBe('approved');
});

it('APPROVE racing a reject: no credit, the rejection stands, 409', async () => {
  mockBetween = () => { fb().status = 'rejected'; };
  const r = await decide('approve');
  expect(r.statusCode).toBe(409);
  expect(mockGrantCalls).toEqual([]);
  expect(fb().status).toBe('rejected');
});

it('grant FAILS -> 500 retryable, the review is back to pending, no credits_granted flag', async () => {
  mockGrant = { granted: false, credits: 0, reason: 'grant_failed' };
  const r = await decide('approve');
  expect(r.statusCode).toBe(500);
  expect(fb()).toMatchObject({ status: 'pending', credits_granted: false });
});

it('control: already granted earlier (idempotent) -> 200, approved', async () => {
  mockGrant = { granted: false, credits: 0, reason: 'already_granted' };
  const r = await decide('approve');
  expect(r.statusCode).toBe(200);
  expect(fb().status).toBe('approved');
});

it('read error -> 503 (never 404)', async () => {
  mockFail['feedback_submissions:select'] = true;
  expect((await decide('approve')).statusCode).toBe(503);
});

it('decision update error -> 500, nothing credited', async () => {
  mockFail['feedback_submissions:update'] = true;
  const r = await decide('approve');
  expect(r.statusCode).toBe(500);
  expect(mockGrantCalls).toEqual([]);
});

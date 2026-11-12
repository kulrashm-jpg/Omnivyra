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
let mockBetweenUpdate: (() => void) | null = null;
let mockGrant: { granted: boolean; credits: number; reason?: string } = { granted: true, credits: 50 };
const mockGrantCalls: string[] = [];

function mockSplitTop(expr: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function mockTerm(term: string): (r: Row) => boolean {
  if (term.startsWith('and(')) {
    const parts = mockSplitTop(term.slice(4, -1)).map(mockTerm);
    return (r) => parts.every((f) => f(r));
  }
  const [col, op, raw] = term.split('.');
  if (op !== 'eq') throw new Error(`fake or(): unsupported op ${op}`);
  const val = raw === 'true' ? true : raw === 'false' ? false : raw;
  return (r) => r[col] === val;
}
function mockOrFilter(expr: string): (r: Row) => boolean {
  const terms = mockSplitTop(expr).map(mockTerm);
  return (r) => terms.some((f) => f(r));
}

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: Row = {};
  const exec = async (single: boolean) => {
    if (mockFail[`${table}:${op}`]) return { data: null, error: { message: 'down' } };
    if (table !== 'feedback_submissions') return { data: null, error: null };
    const hit = mockRows.filter((r) => filters.every((f) => f(r)));
    if (op === 'select') { const c = hit.map((r) => ({ ...r })); if (mockBetween) { const f = mockBetween; mockBetween = null; f(); } return { data: single ? c[0] ?? null : c, error: null }; }
    for (const r of hit) Object.assign(r, payload);
    if (mockBetweenUpdate) { const f = mockBetweenUpdate; mockBetweenUpdate = null; f(); }
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  };
  const b: any = {
    select: () => (op === 'select' ? b : b),
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: () => { op = 'insert'; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    // PostgREST or(): comma-separated terms, `and(...)` groups, `col.eq.val`.
    or: (expr: string) => { filters.push(mockOrFilter(expr)); return b; },
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
  mockFail = {}; mockBetween = null; mockBetweenUpdate = null; mockGrant = { granted: true, credits: 50 }; mockGrantCalls.length = 0;
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

// 05 (2026-11-12): a row stuck 'approved' with credits_granted = false (a crash
// between a failed grant and its revert, a failed revert, a lost flag write)
// must be RETRYABLE by an approve - and only by an approve.
describe('approved-but-uncredited is retryable', () => {
  beforeEach(() => { mockRows[0].status = 'approved'; mockRows[0].credits_granted = false; });
  it('re-approve -> credited, flag set, 200', async () => {
    const r = await decide('approve');
    expect(r.statusCode).toBe(200);
    expect(fb()).toMatchObject({ status: 'approved', credits_granted: true });
    expect(mockGrantCalls).toEqual(['f1']);
  });
  it('re-approve of a row the ledger already credited -> 200 alreadyCredited, flag healed', async () => {
    mockGrant = { granted: false, credits: 0, reason: 'already_granted' };
    const r = await decide('approve');
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ alreadyCredited: true });
    expect(fb().credits_granted).toBe(true);
  });
  it('a REJECT is not allowed on it (409) - reversing a visible approval is a different decision', async () => {
    const r = await decide('reject');
    expect(r.statusCode).toBe(409);
    expect(fb().status).toBe('approved');
  });
  it('control: an approved AND credited row is final (409)', async () => {
    mockRows[0].credits_granted = true;
    expect((await decide('approve')).statusCode).toBe(409);
    expect(mockGrantCalls).toEqual([]);
  });
});

it('grant fails AND the revert matches nothing -> a DIFFERENT code that says the item is approved-uncredited (never "back in the queue")', async () => {
  mockGrant = { granted: false, credits: 0, reason: 'grant_failed' };
  // the revert's CAS misses: someone changed reviewed_at in between
  mockBetweenUpdate = () => { fb().reviewed_at = 'someone-else'; };
  const r = await decide('approve');
  expect(r.statusCode).toBe(500);
  expect(r.body.code).toBe('CREDIT_GRANT_FAILED_APPROVED_UNCREDITED');
});

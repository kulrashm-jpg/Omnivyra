/**
 * CLASS 2 (2026-11-12): admin access-request approve / reject / delete.
 * The status read was only an early answer; the writes were unconditioned, so
 * a concurrent decision was overwritten:
 *  - approve racing reject turned a REJECTED request into an approved one
 *    (onboarding then makes that user COMPANY_ADMIN);
 *  - a double approve created two companies;
 *  - delete could overwrite an APPROVED request.
 * Now every write is a CAS on the expected status with a row-count check.
 *
 * The fake is an in-memory table that APPLIES the update's filters the way the
 * database does (an update only touches rows still matching eq/in), so a test
 * cannot pass on a write that would not have matched. Races are injected
 * between the route's read and its write via `mockBetween`.
 */
export {};
type Row = Record<string, any>;
let mockRequests: Row[] = [];
let mockCompanies: Row[] = [];
let mockFail: Record<string, boolean> = {};
let mockBetween: (() => void) | null = null;

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Row | null = null;
  let returning = false;
  const store = () => (table === 'access_requests' ? mockRequests : mockCompanies);
  const exec = async (single: boolean) => {
    if (mockFail[`${table}:${op}`]) return { data: null, error: { message: 'down' } };
    if (op === 'select') {
      // COPIES, like a real read: a later change to the stored row must not
      // reach into what the route already read.
      const rows = store().filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
      const out = single ? rows[0] ?? null : rows;
      // the race window opens AFTER the route's read of access_requests
      if (table === 'access_requests' && mockBetween) { const f = mockBetween; mockBetween = null; f(); }
      return { data: out, error: null };
    }
    if (op === 'insert') {
      const row = { id: `co-${store().length + 1}`, ...payload };
      store().push(row);
      return { data: row, error: null };
    }
    if (op === 'update') {
      const hit = store().filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, payload);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    const keep = store().filter((r) => !filters.every((f) => f(r)));
    if (table === 'companies') mockCompanies = keep;
    return { data: null, error: null };
  };
  const b: any = {
    select: () => { if (op !== 'select') returning = true; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    not: (c: string, _o: string, _v: unknown) => { filters.push((r) => r[c] !== null && r[c] !== undefined); return b; },
    limit: () => b,
    maybeSingle: () => exec(true),
    single: () => exec(true),
    then: (ok: any, ko: any) => exec(false).then(ok, ko),
  };
  return b;
}

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'admin-1' } }),
}));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t) } }));

import approve from '../../../pages/api/admin/access-requests/approve';
import reject from '../../../pages/api/admin/access-requests/reject';
import del from '../../../pages/api/admin/access-requests/delete';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
async function call(h: any, body: unknown, method = 'POST') { const res = mockRes(); await h({ method, body, headers: {}, query: {} }, res); return res; }
const req = () => mockRequests[0];

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockRequests = [{ id: 'r1', email: 'a@x.com', name: 'A', status: 'pending', organization_id: null }];
  mockCompanies = [];
  mockFail = {};
  mockBetween = null;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

describe('approve', () => {
  it('control: pending -> approved WITH the new company id, one company', async () => {
    const res = await call(approve, { requestId: 'r1' });
    expect(res.statusCode).toBe(200);
    expect(req()).toMatchObject({ status: 'approved', organization_id: 'co-1' });
    expect(mockCompanies).toHaveLength(1);
  });

  it('approve RACING reject: the rejection stands, 409, and the new company is removed', async () => {
    mockBetween = () => { req().status = 'rejected'; };
    const res = await call(approve, { requestId: 'r1' });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('REQUEST_STATE_CHANGED');
    expect(req()).toMatchObject({ status: 'rejected', organization_id: null });
    expect(mockCompanies).toEqual([]);
  });

  it('double approve: the second one loses the CAS, 409, no second company left behind', async () => {
    mockBetween = () => { req().status = 'approved'; req().organization_id = 'co-first'; };
    const res = await call(approve, { requestId: 'r1' });
    expect(res.statusCode).toBe(409);
    expect(req().organization_id).toBe('co-first');
    expect(mockCompanies).toEqual([]);
  });

  it('request read error -> 503 (never 404), no company', async () => {
    mockFail['access_requests:select'] = true;
    const res = await call(approve, { requestId: 'r1' });
    expect(res.statusCode).toBe(503);
    expect(mockCompanies).toEqual([]);
  });

  it('prior-approval read error -> 503, never a second company', async () => {
    let n = 0;
    const real = mockQuery;
    // fail only the SECOND access_requests read (the prior-approval lookup)
    mockFail = {};
    const orig = jest.requireMock('@/backend/db/supabaseClient').supabase.from;
    jest.requireMock('@/backend/db/supabaseClient').supabase.from = (t: string) => {
      const q = real(t);
      if (t === 'access_requests' && ++n === 2) { q.maybeSingle = async () => ({ data: null, error: { message: 'down' } }); }
      return q;
    };
    try {
      const res = await call(approve, { requestId: 'r1' });
      expect(res.statusCode).toBe(503);
      expect(mockCompanies).toEqual([]);
      expect(req().status).toBe('pending');
    } finally {
      jest.requireMock('@/backend/db/supabaseClient').supabase.from = orig;
    }
  });

  it('duplicate-person path is a CAS too: a concurrent reject stands, 409', async () => {
    mockRequests.push({ id: 'r0', email: 'a@x.com', status: 'approved', organization_id: 'co-old' });
    mockBetween = () => { req().status = 'rejected'; };
    const res = await call(approve, { requestId: 'r1' });
    expect(res.statusCode).toBe(409);
    expect(req()).toMatchObject({ status: 'rejected', organization_id: null });
  });
});

describe('reject', () => {
  it('control: pending -> rejected', async () => {
    const res = await call(reject, { requestId: 'r1', reason: 'no' });
    expect(res.statusCode).toBe(200);
    expect(req().status).toBe('rejected');
  });
  it('reject RACING approve: the approval stands, 409', async () => {
    mockBetween = () => { req().status = 'approved'; req().organization_id = 'co-9'; };
    const res = await call(reject, { requestId: 'r1', reason: 'no' });
    expect(res.statusCode).toBe(409);
    expect(req()).toMatchObject({ status: 'approved', organization_id: 'co-9' });
  });
  it('read error -> 503, never 404', async () => {
    mockFail['access_requests:select'] = true;
    const res = await call(reject, { requestId: 'r1', reason: 'no' });
    expect(res.statusCode).toBe(503);
  });
  it('update error -> 500, never a 200 for a rejection that did not happen', async () => {
    mockFail['access_requests:update'] = true;
    const res = await call(reject, { requestId: 'r1', reason: 'no' });
    expect(res.statusCode).toBe(500);
    expect(req().status).toBe('pending');
  });
});

describe('delete', () => {
  it.each(['pending', 'rejected'])('a %s request can be deleted', async (status) => {
    req().status = status;
    const res = await call(del, { requestId: 'r1' }, 'DELETE');
    expect(res.statusCode).toBe(200);
    expect(req().status).toBe('deleted');
  });
  it('an APPROVED request is NOT overwritten: 409, stays approved', async () => {
    req().status = 'approved'; req().organization_id = 'co-9';
    const res = await call(del, { requestId: 'r1' }, 'DELETE');
    expect(res.statusCode).toBe(409);
    expect(req()).toMatchObject({ status: 'approved', organization_id: 'co-9' });
  });
});

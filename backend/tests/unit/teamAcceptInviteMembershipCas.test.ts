/**
 * CLASS 2 (2026-11-12): team/accept-invite claimed the invitation by CAS, but
 * then updated the membership BY ID ONLY, from a stale read:
 *  - a row an admin DEACTIVATED (or re-roled) in between was reactivated /
 *    overwritten;
 *  - a row DELETED in between matched nothing, yet the route answered 200 with
 *    the invitation spent and no membership.
 * Now the membership write is a CAS on the row as read (status + role) with a
 * row count, and every failure RELEASES the invitation claim. Read errors are
 * truthful 503s (never "not found" / "no membership" -> a second row).
 *
 * The fake applies filters like the database and returns COPIES; a race is
 * injected right after the route reads the membership (`mockBetween`).
 */
export {};
import { createHash } from 'crypto';
type Row = Record<string, any>;
let mockT: Record<string, Row[]> = {};
let mockFail: Record<string, boolean> = {};
let mockBetween: (() => void) | null = null;

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: Row = {};
  const rowsOf = () => (mockT[table] ??= []);
  const exec = async (single: boolean) => {
    if (mockFail[`${table}:${op}`]) return { data: null, error: { message: 'down' } };
    if (op === 'insert') { rowsOf().push({ id: `new-${rowsOf().length}`, ...payload }); return { data: null, error: null }; }
    const hit = rowsOf().filter((r) => filters.every((f) => f(r)));
    if (op === 'select') {
      const copies = hit.map((r) => ({ ...r }));
      if (table === 'user_company_roles' && mockBetween) { const f = mockBetween; mockBetween = null; f(); }
      return { data: single ? copies[0] ?? null : copies, error: null };
    }
    for (const r of hit) Object.assign(r, payload);
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    or: () => b, // users lookup by uid OR email: one user is seeded
    maybeSingle: () => exec(true),
    then: (ok: any, ko: any) => exec(false).then(ok, ko),
  };
  return b;
}
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t) } }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: { id: 'u1', supabaseUid: 'sb-u1', email: 'invitee@example.test', status: 'active' }, error: null }),
}));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: jest.fn(async () => ({ ok: true })), SYSTEM_USER_ID: 'system' }));

import handler from '../../../pages/api/team/accept-invite';

const TOKEN = 'team-invite-token-not-real-0001';
const inv = () => mockT.invitations[0];
const mem = () => mockT.user_company_roles[0];
function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
async function accept() { const res = mockRes(); await handler({ method: 'POST', body: { token: TOKEN }, headers: {}, query: {} } as any, res); return res; }

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockT = {
    invitations: [{ id: 'inv-1', email: 'invitee@example.test', company_id: 'c1', role: 'CONTENT_CREATOR', token_hash: createHash('sha256').update(TOKEN).digest('hex'), expires_at: new Date(Date.now() + 86_400_000).toISOString(), accepted_at: null, revoked_at: null, accepted_by: null }],
    users: [{ id: 'u1', email: 'invitee@example.test', status: 'active', active_company_id: 'c1' }],
    user_company_roles: [{ id: 'ucr-1', user_id: 'u1', company_id: 'c1', role: 'CONTENT_CREATOR', status: 'invited' }],
  };
  mockFail = {};
  mockBetween = null;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('control: an invited row is activated and the invitation is spent', async () => {
  const r = await accept();
  expect(r.statusCode).toBe(200);
  expect(mem()).toMatchObject({ status: 'active' });
  expect(inv().accepted_by).toBe('u1');
});

it('row DEACTIVATED by an admin between read and write -> NOT reactivated, 409, invitation released', async () => {
  mockBetween = () => { mem().status = 'deactivated'; };
  const r = await accept();
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('STALE_MEMBERSHIP');
  expect(mem().status).toBe('deactivated');
  expect(inv()).toMatchObject({ accepted_at: null, accepted_by: null });
});

it('row DELETED between read and write -> never a 200 with the invite spent: 409, invitation released', async () => {
  mockBetween = () => { mockT.user_company_roles = []; };
  const r = await accept();
  expect(r.statusCode).toBe(409);
  expect(inv()).toMatchObject({ accepted_at: null, accepted_by: null });
});

it('membership update ERROR -> 500 and the invitation claim is released (stays usable)', async () => {
  mockFail['user_company_roles:update'] = true;
  const r = await accept();
  expect(r.statusCode).toBe(500);
  expect(inv()).toMatchObject({ accepted_at: null, accepted_by: null });
});

it('membership read error -> 503 BEFORE the claim (never "no membership" -> a second row)', async () => {
  mockFail['user_company_roles:select'] = true;
  const r = await accept();
  expect(r.statusCode).toBe(503);
  expect(inv().accepted_at).toBeNull();
  expect(mockT.user_company_roles).toHaveLength(1);
});

it.each([['invitations', 'invitation'], ['users', 'account']])('%s read error -> 503 (never "not found")', async (table) => {
  mockFail[`${table}:select`] = true;
  const r = await accept();
  expect(r.statusCode).toBe(503);
});

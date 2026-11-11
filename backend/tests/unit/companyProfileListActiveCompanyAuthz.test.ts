/**
 * 83 (R6-ORDER), 2026-11-11: GET /api/company-profile?mode=list rewrites the
 * caller's users.active_company_id when the stored one is no longer among
 * their memberships. That write stores a COMPANY id, so it is now
 * tenant-authorized first: the caller must hold an ACTIVE role in the company
 * being made active (getUserRole). Before (C) the ordering was masked by the
 * legacy cookie getter counting as platform authority.
 */
const USER = 'user-1';
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const STALE = '00000000-0000-4000-8000-0000000000ff';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
const updates: Array<{ table: string; payload: Row; eq: Array<[string, unknown]> }> = [];
let mockRole: string | null = 'COMPANY_ADMIN';

function table(name: string) {
  const eqs: Array<[string, unknown]> = [];
  let ins: unknown[] | null = null;
  let upd: Row | null = null;
  const rows = () => (db[name] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v) && (!ins || ins.includes(r.id)));
  const run = () => {
    if (upd) { updates.push({ table: name, payload: upd, eq: [...eqs] }); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
  b.in = (_c: string, v: unknown[]) => { ins = v; return b; };
  b.order = () => b;
  b.limit = () => b;
  b.update = (p: Row) => { upd = p; return b; };
  b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t) } }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: USER, email: 'u@example.test', emailVerified: true }, error: null }),
}));
jest.mock('../../services/rbacService', () => ({ getUserRole: jest.fn(async () => ({ role: mockRole, error: null })) }));
jest.mock('../../services/companyMembershipIntegrityService', () => ({
  filterCompatibleCompanyRoleRows: ({ rows }: { rows: unknown[] }) => rows,
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
  saveProfile: jest.fn(),
  calculateCompanyProfileCompleteness: jest.fn(),
  toLimitedCompanyProfile: jest.fn(),
  upsertCompanyProfileGovernanceSettings: jest.fn(),
  getCompanyProfileReviewStatus: jest.fn(),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/company-profile/index';
import { getUserRole } from '../../services/rbacService';

async function list() {
  const out = { code: 0 };
  const r = { status: (c: number) => { out.code = c; return r; }, json: () => r, setHeader: () => r, getHeader: () => undefined };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'GET', query: { mode: 'list' }, body: {}, headers: {}, cookies: {} }, r);
  return out;
}
const userUpdates = () => updates.filter((u) => u.table === 'users');

beforeEach(() => {
  updates.length = 0;
  mockRole = 'COMPANY_ADMIN';
  (getUserRole as jest.Mock).mockClear();
  db = {
    users: [{ id: USER, name: 'U', email: 'u@example.test', active_company_id: STALE }],
    user_company_roles: [{ user_id: USER, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active', created_at: '2026-01-01' }],
    companies: [{ id: CO_A, name: 'Acme' }],
  };
});

it('a stale active company is replaced ONLY after the new one is authorized (active role)', async () => {
  expect((await list()).code).toBe(200);
  expect(getUserRole).toHaveBeenCalledWith(USER, CO_A);
  expect(userUpdates()).toHaveLength(1);
  expect(userUpdates()[0].payload).toMatchObject({ active_company_id: CO_A });
  expect(userUpdates()[0].eq).toEqual([['id', USER]]); // the caller's own row
});

it('no active role in the company -> the preference is NOT written', async () => {
  mockRole = null;
  expect((await list()).code).toBe(200);
  expect(userUpdates()).toHaveLength(0);
});

it('an already-current active company -> no role lookup and no write', async () => {
  db.users[0].active_company_id = CO_A;
  await list();
  expect(getUserRole).not.toHaveBeenCalled();
  expect(userUpdates()).toHaveLength(0);
});

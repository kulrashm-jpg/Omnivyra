/**
 * CLASS 2 (2026-11-12): promoteMemberToAdmin read the membership, then updated
 * it by (user, company) only. A change landing in between was overwritten:
 *  - a concurrent SUPER_ADMIN grant was rewritten to COMPANY_ADMIN;
 *  - a row deactivated in between still got the admin role.
 * Now the write is a CAS on the row as read (role + status 'active') with a
 * row count. Also: read errors THROW (never "no org / no membership").
 *
 * The fake APPLIES the update's filters like the database does; races are
 * injected after the membership read via `mockBetween`.
 */
export {};
type Row = Record<string, any>;
let mockTables: Record<string, Row[]> = {};
let mockFail: Record<string, boolean> = {};
let mockBetween: (() => void) | null = null;

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let payload: Row = {};
  const exec = async (single: boolean) => {
    if (mockFail[`${table}:${op}`]) return { data: null, error: { message: 'down' } };
    const rows = (mockTables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (op === 'select') {
      // COPIES, like a real read (a later change must not reach the read result).
      const copies = rows.map((r) => ({ ...r }));
      if (table === 'user_company_roles' && mockBetween) { const f = mockBetween; mockBetween = null; f(); }
      return { data: single ? copies[0] ?? null : copies, error: null };
    }
    for (const r of rows) Object.assign(r, payload);
    return { data: rows.map((r) => ({ user_id: r.user_id })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    maybeSingle: () => exec(true),
    then: (ok: any, ko: any) => exec(false).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockQuery(t) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../services/lifecycleGovernance', () => ({ cascadeDisableCompany: jest.fn() }));

import { promoteMemberToAdmin } from '../../services/orgOwnershipRecoveryService';

const member = () => mockTables.user_company_roles[0];
const INPUT = { orgId: 'o1', userId: 'u1', performedBy: 'sa', reason: 'headless' };
beforeEach(() => {
  mockTables = {
    companies: [{ id: 'o1', status: 'active' }],
    users: [{ id: 'u1', is_deleted: false }],
    user_company_roles: [{ user_id: 'u1', company_id: 'o1', role: 'CONTENT_CREATOR', status: 'active' }],
  };
  mockFail = {};
  mockBetween = null;
});

it('control: an active member is promoted', async () => {
  await expect(promoteMemberToAdmin(INPUT)).resolves.toMatchObject({ ok: true, newRole: 'COMPANY_ADMIN', idempotent: false });
  expect(member().role).toBe('COMPANY_ADMIN');
});

it('a SUPER_ADMIN grant landing between read and write is NOT overwritten (STALE_MEMBERSHIP)', async () => {
  mockBetween = () => { member().role = 'SUPER_ADMIN'; };
  await expect(promoteMemberToAdmin(INPUT)).resolves.toMatchObject({ ok: false, reason: 'STALE_MEMBERSHIP' });
  expect(member().role).toBe('SUPER_ADMIN');
});

it('a row DEACTIVATED between read and write does not get the admin role', async () => {
  mockBetween = () => { member().status = 'inactive'; };
  await expect(promoteMemberToAdmin(INPUT)).resolves.toMatchObject({ ok: false, reason: 'STALE_MEMBERSHIP' });
  expect(member().role).toBe('CONTENT_CREATOR');
});

it('a member with a NULL role is matched with IS NULL (still promotable)', async () => {
  member().role = null;
  await expect(promoteMemberToAdmin(INPUT)).resolves.toMatchObject({ ok: true });
  expect(member().role).toBe('COMPANY_ADMIN');
});

it.each(['companies', 'users', 'user_company_roles'])('%s read error THROWS (never NO_ORG / NO_TARGET_USER / NO_MEMBERSHIP)', async (table) => {
  mockFail[`${table}:select`] = true;
  await expect(promoteMemberToAdmin(INPUT)).rejects.toThrow(/read failed/);
  expect(member().role).toBe('CONTENT_CREATOR');
});

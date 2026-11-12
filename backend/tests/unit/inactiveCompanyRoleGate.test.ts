/**
 * BLOCKING safety fix (e1, 2026-11-12; e9 ruling). Membership-based authorization ignored companies.status, so
 * members of an INACTIVE / SUSPENDED company kept acting through getUserRole / getCompanyRoleIncludingInvited /
 * enforceRole and the capability layer (IdentityResolver memberships -> requireCapability).
 * Pinned with a faithful fake (every filter applied; a status read can be made to fail):
 *   - status table: active -> role; inactive / suspended / NULL / soft-deleted / missing row -> no role;
 *     status read error -> no role (fail closed);
 *   - a user in TWO companies keeps full access to the active one;
 *   - capability memberships in an inactive company are reported 'inactive'; SUPER_ADMIN rows stay usable;
 *   - pickOperationalMembership derives the active company, never an inactive one.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockCompaniesReadError = false;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let lim = Infinity;
  const b: any = {
    select: () => b, order: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      if (table === 'companies' && mockCompaniesReadError) return Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(ok, ko);
      const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))).slice(0, lim);
      if (one && hit.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(ok, ko);
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t), rpc: async () => ({ data: null, error: null }) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
/* eslint-disable @typescript-eslint/no-var-requires */
const { getUserRole } = require('../../services/rbacService');
const { getCompanyRoleIncludingInvited, companyRoleGate, pickOperationalMembership } = require('../../services/rbacPrimitives');
const { fetchOrgMemberships } = require('../../security/IdentityResolver');
/* eslint-enable @typescript-eslint/no-var-requires */
const U = 'user-1';
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const OFF = '22222222-2222-4222-8222-222222222222';
const member = (company: string, role = 'COMPANY_ADMIN') => ({ user_id: U, company_id: company, role, status: 'active' });
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockCompaniesReadError = false;
});

describe('status table (getUserRole + getCompanyRoleIncludingInvited)', () => {
  const cases: Array<[string, Row | null, string | null]> = [
    ['active', { status: 'active', deleted_at: null }, 'COMPANY_ADMIN'],
    ['inactive', { status: 'inactive', deleted_at: null }, null],
    ['suspended', { status: 'suspended', deleted_at: null }, null],
    ['NULL status', { status: null, deleted_at: null }, null],
    ['soft-deleted', { status: 'active', deleted_at: '2026-01-01T00:00:00Z' }, null],
    ['missing companies row', null, null],
  ];
  for (const [label, company, expected] of cases) {
    it(`${label} -> ${expected ?? 'no role'}`, async () => {
      mockDb.user_company_roles = [member(ACTIVE)];
      mockDb.companies = company ? [{ id: ACTIVE, ...company }] : [];
      const r = await getUserRole(U, ACTIVE);
      expect([label, r.role]).toEqual([label, expected]);
      if (!expected) expect(r.error).toBe('COMPANY_INACTIVE');
      expect([label, await getCompanyRoleIncludingInvited(U, ACTIVE)]).toEqual([label, expected]);
    });
  }

  it('a companies status READ ERROR is no role (fail closed), never "active"', async () => {
    mockDb.user_company_roles = [member(ACTIVE)];
    mockDb.companies = [{ id: ACTIVE, status: 'active' }];
    mockCompaniesReadError = true;
    const r = await getUserRole(U, ACTIVE);
    expect(r).toMatchObject({ role: null, error: 'COMPANY_STATUS_UNAVAILABLE' });
    expect(await getCompanyRoleIncludingInvited(U, ACTIVE)).toBeNull();
    expect(await companyRoleGate(ACTIVE)).toBe('unavailable');
  });
});

describe('a user in TWO companies keeps full access to the active one', () => {
  beforeEach(() => {
    mockDb.user_company_roles = [member(OFF), member(ACTIVE, 'CONTENT_CREATOR')];
    mockDb.companies = [{ id: OFF, status: 'inactive' }, { id: ACTIVE, status: 'active' }];
  });
  it('getUserRole: role in the active company, none in the inactive one', async () => {
    expect((await getUserRole(U, ACTIVE)).role).toBe('CONTENT_CREATOR');
    expect((await getUserRole(U, OFF)).role).toBeNull();
  });
  it('pickOperationalMembership derives the ACTIVE company even when the inactive membership comes first', async () => {
    const rows = [{ company_id: OFF }, { company_id: ACTIVE }];
    expect(await pickOperationalMembership(rows)).toEqual({ company_id: ACTIVE });
    expect(await pickOperationalMembership([{ company_id: OFF }])).toBeNull();
  });
  it('capability memberships: inactive company reported inactive, active company active', async () => {
    const ms = await fetchOrgMemberships(U);
    expect(ms).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: OFF, status: 'inactive' }),
      expect.objectContaining({ organizationId: ACTIVE, status: 'active' }),
    ]));
  });
});

describe('capability memberships (IdentityResolver -> requireCapability)', () => {
  it('EXEMPT: a platform SUPER_ADMIN row stays usable even if its company is inactive', async () => {
    mockDb.user_company_roles = [member(OFF, 'SUPER_ADMIN')];
    mockDb.companies = [{ id: OFF, status: 'inactive' }];
    expect(await fetchOrgMemberships(U)).toEqual([expect.objectContaining({ organizationId: OFF, status: 'active', role: 'SUPER_ADMIN' })]);
  });
  it('a status read error makes every tenant membership unusable (fail closed)', async () => {
    mockDb.user_company_roles = [member(ACTIVE)];
    mockDb.companies = [{ id: ACTIVE, status: 'active' }];
    mockCompaniesReadError = true;
    expect(await fetchOrgMemberships(U)).toEqual([expect.objectContaining({ organizationId: ACTIVE, status: 'inactive' })]);
  });
  it('an invited membership keeps its own status (not upgraded by an active company)', async () => {
    mockDb.user_company_roles = [{ ...member(ACTIVE), status: 'invited' }];
    mockDb.companies = [{ id: ACTIVE, status: 'active' }];
    expect(await fetchOrgMemberships(U)).toEqual([expect.objectContaining({ status: 'invited' })]);
  });
});

describe('derive-my-company is DETERMINISTIC with two ACTIVE companies (e9 2026-11-13)', () => {
  const C1 = '11111111-1111-4111-8111-111111111111';
  const C2 = '22222222-2222-4222-8222-222222222222';
  beforeEach(() => {
    mockDb.companies = [{ id: C1, status: 'active' }, { id: C2, status: 'active' }];
  });
  it("prefers the user's stored active_company_id, whatever order the memberships arrive in", async () => {
    mockDb.users = [{ id: U, active_company_id: C2 }];
    expect(await pickOperationalMembership([{ company_id: C1 }, { company_id: C2 }], { userId: U })).toEqual({ company_id: C2 });
    expect(await pickOperationalMembership([{ company_id: C2 }, { company_id: C1 }], { userId: U })).toEqual({ company_id: C2 });
  });
  it('without a usable preference, the lowest company_id - independent of row order', async () => {
    mockDb.users = [{ id: U, active_company_id: null }];
    expect(await pickOperationalMembership([{ company_id: C2 }, { company_id: C1 }], { userId: U })).toEqual({ company_id: C1 });
    expect(await pickOperationalMembership([{ company_id: C2 }, { company_id: C1 }])).toEqual({ company_id: C1 });
  });
  it('a stored preference for an INACTIVE company is never honoured', async () => {
    mockDb.companies = [{ id: C1, status: 'active' }, { id: C2, status: 'inactive' }];
    mockDb.users = [{ id: U, active_company_id: C2 }];
    expect(await pickOperationalMembership([{ company_id: C1 }, { company_id: C2 }], { userId: U })).toEqual({ company_id: C1 });
  });
});

/**
 * e9/05 2026-11-13 (class item): getUserRole returned { role: null, error: null } when its query FAILED - identical
 * to "no role in this company", so a caller that reads a null role as "not a member" and then creates / joins /
 * grants would fail OPEN on a transient DB error. A failed read is now the typed ROLE_LOOKUP_FAILED, and enforceRole
 * answers a retryable 503 (never a 403 the client treats as final, never a pass).
 */
let mockFail: Set<string> = new Set();
let mockRows: Record<string, unknown[]> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {};
    for (const op of ['select', 'eq', 'in', 'order', 'is', 'neq']) b[op] = () => b;
    const result = () => (mockFail.has(table)
      ? { data: null, error: { message: `${table} read failed` } }
      : { data: mockRows[table] ?? [], error: null });
    b.limit = () => Promise.resolve(result());
    b.maybeSingle = () => Promise.resolve({ ...result(), data: (result().data as unknown[] | null)?.[0] ?? null });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => {
  const b: any = {};
  for (const op of ['select', 'eq', 'in', 'order', 'is', 'limit', 'neq']) b[op] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: { from: () => b, rpc: () => Promise.resolve({ data: false, error: null }) } };
});
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/userContextService', () => ({ resolveUserContext: jest.fn(async () => ({ authenticated: true, userId: 'u-1' })) }));

import { getUserRole, enforceRole, Role, ROLE_LOOKUP_FAILED } from '../../services/rbacService';

beforeEach(() => { mockFail = new Set(); mockRows = {}; });

it('a FAILED role read is ROLE_LOOKUP_FAILED - never { role: null, error: null } ("no role")', async () => {
  mockFail.add('user_company_roles');
  const r = await getUserRole('u-1', 'c-1');
  expect(r.role).toBeNull();
  expect(r.error).toBe(ROLE_LOOKUP_FAILED);
});

it('control: a genuine non-member is still { role: null, error: null }', async () => {
  const r = await getUserRole('u-1', 'c-1');
  expect(r).toMatchObject({ role: null, error: null });
});

it('control: a member elsewhere but not here is still COMPANY_ACCESS_DENIED', async () => {
  // first read (this company, active) empty; second read (any company) has a row
  let call = 0;
  mockRows = { user_company_roles: [] };
  const real = jest.requireMock('../../db/writeOwner') as any;
  const orig = real.ownedDbTable;
  real.ownedDbTable = (t: string) => {
    const b = orig(t);
    if (t === 'user_company_roles') {
      b.limit = () => Promise.resolve(call++ === 0 ? { data: [], error: null } : { data: [{ role: 'COMPANY_ADMIN' }], error: null });
    }
    return b;
  };
  try {
    const r = await getUserRole('u-1', 'c-1');
    expect(r).toMatchObject({ role: null, error: 'COMPANY_ACCESS_DENIED' });
  } finally { real.ownedDbTable = orig; }
});

it('control: an active member resolves their (normalised) role', async () => {
  mockRows = { user_company_roles: [{ role: ' admin ', status: 'active' }] };
  const r = await getUserRole('u-1', 'c-1');
  expect(r).toMatchObject({ role: 'COMPANY_ADMIN', error: null, membershipType: 'INTERNAL' });
});

describe('enforceRole', () => {
  const run = async () => {
    const out = { code: 0, body: null as any };
    const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; } };
    const gate = await enforceRole({ req: { headers: {} } as any, res, companyId: 'c-1', allowedRoles: [Role.COMPANY_ADMIN] });
    return { gate, ...out };
  };
  it('a role-lookup FAILURE is a retryable 503 ROLE_LOOKUP_FAILED - not a 403, never a pass', async () => {
    mockFail.add('user_company_roles');
    const r = await run();
    expect(r.gate).toBeNull();
    expect([r.code, r.body]).toEqual([503, { error: 'ROLE_LOOKUP_FAILED', retryable: true }]);
  });
  it('control: a genuine non-member is still 403 FORBIDDEN_ROLE', async () => {
    const r = await run();
    expect([r.code, r.body?.error]).toEqual([403, 'FORBIDDEN_ROLE']);
  });
  it('control: an allowed member passes', async () => {
    mockRows = { user_company_roles: [{ role: 'COMPANY_ADMIN', status: 'active' }] };
    const r = await run();
    // (the thin fake ignores .eq filters, so the super-admin probe also sees this row and may take the bypass -
    // either way the gate PASSES, which is what this control proves)
    expect(r.gate).toMatchObject({ userId: 'u-1' });
    expect(r.code).toBe(0);
  });
});

describe('resolveEffectiveCampaignRole', () => {
  it('a failed company-role read THROWS RoleLookupFailedError - never narrows to campaign-role-only access', async () => {
    mockFail.add('user_company_roles');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveEffectiveCampaignRole, RoleLookupFailedError } = require('../../services/campaignRoleService');
    const err = await resolveEffectiveCampaignRole('u-1', 'camp-1', 'c-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoleLookupFailedError);
    expect(err).toMatchObject({ code: 'ROLE_LOOKUP_FAILED', retryable: true });
  });
});

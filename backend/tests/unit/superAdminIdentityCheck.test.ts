/**
 * Phase 1 — Canonical SUPER_ADMIN Provisioning Path regression tests.
 *
 * Asserts every invalid-state branch produces a deterministic
 * SuperAdminIdentityIssue code so downstream alerting can fire on the
 * specific failure mode rather than a generic "auth broken" signal.
 *
 * Mocks `ownedDbTable` to avoid hitting Supabase. We're testing the
 * branching, not the queries.
 */

const dbMock = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (...args: unknown[]) => dbMock(...args),
}));

jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  checkSuperAdminIdentity,
  resetSuperAdminIdentityCache,
} from '../../security/startup/superAdminIdentityCheck';

const ROLE_TABLE = 'user_company_roles';
const USERS_TABLE = 'users';

interface QueryStub {
  select: jest.Mock;
  eq: jest.Mock;
  limit: jest.Mock;
  maybeSingle: jest.Mock;
}

function buildRoleQueryStub(result: { data?: unknown; error?: { message: string } | null }): QueryStub {
  const stub: QueryStub = {
    select: jest.fn(() => stub),
    eq: jest.fn(() => stub),
    limit: jest.fn(() => stub),
    maybeSingle: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
  return stub;
}

function buildUserQueryStub(result: { data?: unknown; error?: { message: string } | null }): QueryStub {
  const stub: QueryStub = {
    select: jest.fn(() => stub),
    eq: jest.fn(() => stub),
    limit: jest.fn(() => stub),
    maybeSingle: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
  return stub;
}

function setupDbMock(roleStub: QueryStub, userStub: QueryStub): void {
  dbMock.mockImplementation((table: string) => {
    if (table === ROLE_TABLE) return roleStub;
    if (table === USERS_TABLE) return userStub;
    throw new Error(`unexpected table ${table}`);
  });
}

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  resetSuperAdminIdentityCache();
  dbMock.mockReset();
  delete process.env.SUPER_ADMIN_PRIMARY_USER_ID;
});

describe('checkSuperAdminIdentity', () => {
  it('returns PRIMARY_USER_ID_MISSING when env var unset', async () => {
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('PRIMARY_USER_ID_MISSING');
  });

  it('returns PRIMARY_USER_ID_INVALID_UUID when env var malformed', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = 'not-a-uuid';
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('PRIMARY_USER_ID_INVALID_UUID');
  });

  it('returns PRIMARY_USER_NOT_FOUND when env var valid but no users row', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ data: { user_id: VALID_UUID, role: 'SUPER_ADMIN', status: 'active' } }),
      buildUserQueryStub({ data: null }),
    );
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('PRIMARY_USER_NOT_FOUND');
  });

  it('returns PRIMARY_USER_DELETED when users row is_deleted=true', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ data: { user_id: VALID_UUID, role: 'SUPER_ADMIN', status: 'active' } }),
      buildUserQueryStub({ data: { id: VALID_UUID, is_deleted: true } }),
    );
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('PRIMARY_USER_DELETED');
  });

  it('returns PRIMARY_USER_NOT_SUPER_ADMIN when role row absent', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ data: null }),
      buildUserQueryStub({ data: { id: VALID_UUID, is_deleted: false } }),
    );
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('PRIMARY_USER_NOT_SUPER_ADMIN');
  });

  it('returns ok when env + users row + role row all present', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ data: { user_id: VALID_UUID, role: 'SUPER_ADMIN', status: 'active' } }),
      buildUserQueryStub({ data: { id: VALID_UUID, is_deleted: false } }),
    );
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(true);
    if (out.ok === true) expect(out.primaryUserId).toBe(VALID_UUID);
  });

  it('returns CHECK_QUERY_FAILED when DB role query errors', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ error: { message: 'boom' } }),
      buildUserQueryStub({ data: { id: VALID_UUID, is_deleted: false } }),
    );
    const out = await checkSuperAdminIdentity();
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('CHECK_QUERY_FAILED');
  });

  it('memoizes results within the cache window', async () => {
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = VALID_UUID;
    setupDbMock(
      buildRoleQueryStub({ data: { user_id: VALID_UUID, role: 'SUPER_ADMIN', status: 'active' } }),
      buildUserQueryStub({ data: { id: VALID_UUID, is_deleted: false } }),
    );
    await checkSuperAdminIdentity();
    await checkSuperAdminIdentity();
    await checkSuperAdminIdentity();
    // dbMock is called twice per non-cached call (role + user); 6 means
    // the cache was bypassed, 2 means memoization worked.
    expect(dbMock.mock.calls.length).toBe(2);
  });
});

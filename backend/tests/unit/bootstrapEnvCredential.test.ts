/**
 * Phase 2 — env-credential bootstrap regression tests.
 *
 * Asserts the new mode='env-credential' branch in
 * pages/api/admin/bootstrap-super-admin.ts:
 *   - Rejects when env username/password missing.
 *   - Rejects when env username/password mismatched.
 *   - Rejects when SUPER_ADMIN_BOOTSTRAP_TOKEN env missing or short.
 *   - Rejects when bootstrap token mismatched.
 *   - Rejects when a SUPER_ADMIN already exists (single-use lock).
 *   - Rejects when targetUserId points to a missing user.
 *   - Rejects when targetUserId points to a soft-deleted user.
 *   - Rate-limits: 5 failures in 60s → 429.
 *   - Happy path: inserts user_company_roles row + returns nextSteps.
 *
 * Mocks the DB via `ownedDbTable` so tests don't need a Supabase
 * connection. Mocks SecurityAuditService so audit inserts are no-ops.
 */

const dbMock = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (...args: unknown[]) => dbMock(...args),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
  logCookieSuperAdminUsage: jest.fn().mockResolvedValue(undefined),
  snapshotFromPrincipal: jest.fn().mockReturnValue({}),
}));
// SessionAuthorityService is hit only when mintCanonicalSession=true.
jest.mock('../../security/SessionAuthorityService', () => ({
  createSession: jest.fn().mockResolvedValue({
    session: { id: 'session-id-1' },
    cookieValue: 'fake-cookie-value',
  }),
  attachSessionCookie: jest.fn(),
}));
jest.mock('../../security/startup/superAdminIdentityCheck', () => ({
  resetSuperAdminIdentityCache: jest.fn(),
}));

import type { NextApiRequest, NextApiResponse } from 'next';

let handler: any;
let _resetEnvCredentialRateLimit: any;
beforeAll(async () => {
  const mod = await import('../../../pages/api/admin/bootstrap-super-admin');
  handler = mod.default;
  _resetEnvCredentialRateLimit = mod._resetEnvCredentialRateLimit;
});

interface CapturedResponse {
  status: number;
  body: any;
  headers: Record<string, string | string[]>;
}

function makeRes(): { res: NextApiResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: {}, headers: {} };
  const res = {
    setHeader(name: string, value: string | string[]) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as NextApiResponse;
  return { res, captured };
}

function makeReq(body: unknown, ip = '1.2.3.4'): NextApiRequest {
  return {
    method: 'POST',
    body,
    headers: { 'x-forwarded-for': ip, 'user-agent': 'jest' },
    cookies: {},
    socket: { remoteAddress: ip },
  } as unknown as NextApiRequest;
}

const VALID_TARGET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENV_USER = 'admin';
const ENV_PASS = 'longenoughpassword123';
const TOKEN = 'token-token-token-token-token-token-32+';

beforeEach(() => {
  process.env.SUPER_ADMIN_USERNAME = ENV_USER;
  process.env.SUPER_ADMIN_PASSWORD = ENV_PASS;
  process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN = TOKEN;
  dbMock.mockReset();
  _resetEnvCredentialRateLimit();
});

function withDb({
  superAdminCount,
  targetUser,
  insertResult,
  existingRoleRow,
}: {
  superAdminCount?: number;
  targetUser?: { id: string; supabase_uid: string | null; email: string | null; is_deleted: boolean } | null;
  insertResult?: { data: any; error: { message: string } | null };
  existingRoleRow?: any;
}): void {
  dbMock.mockImplementation((table: string) => {
    if (table === 'user_company_roles') {
      // The handler chains: select(...).eq(...).eq(...) → returns the
      // .select() result with `count` for the head:true call, then
      // separately the assignSuperAdmin path uses select.eq.maybeSingle.
      const stub: any = {
        select: jest.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === 'exact' && opts?.head === true) {
            // Return a thenable that resolves to { count }.
            const thenable: any = {
              eq: jest.fn(() => thenable),
              then(resolve: (v: { count: number }) => void) {
                resolve({ count: superAdminCount ?? 0 });
                return thenable;
              },
            };
            return thenable;
          }
          // Existing-role lookup inside assignSuperAdmin.
          return {
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn().mockResolvedValue({ data: existingRoleRow ?? null }),
              })),
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn().mockResolvedValue({ data: null }),
                })),
              })),
              maybeSingle: jest.fn().mockResolvedValue({ data: existingRoleRow ?? null }),
            })),
          };
        }),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn().mockResolvedValue(insertResult ?? { data: { id: 'new-role-row-id' }, error: null }),
          })),
        })),
        update: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        })),
      };
      return stub;
    }
    if (table === 'users') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: targetUser ?? null }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe('bootstrap-super-admin mode=env-credential', () => {
  it('rejects when env username/password missing', async () => {
    delete process.env.SUPER_ADMIN_USERNAME;
    delete process.env.SUPER_ADMIN_PASSWORD;
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: 'x', password: 'x',
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(503);
    expect(captured.body.code).toBe('BOOTSTRAP_NOT_CONFIGURED');
  });

  it('rejects when env credentials mismatched', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: 'wrong', password: 'wrong',
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(401);
    expect(captured.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects when bootstrap token env missing or too short', async () => {
    process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN = 'short';
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: 'short', targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(503);
  });

  it('rejects when bootstrap token mismatched', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: 'wrong-token-but-32-characters-long-y', targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(401);
    expect(captured.body.code).toBe('BOOTSTRAP_TOKEN_INVALID');
  });

  it('rejects when a SUPER_ADMIN already exists (single-use lock)', async () => {
    withDb({ superAdminCount: 1 });
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(409);
    expect(captured.body.code).toBe('BOOTSTRAP_ALREADY_CONSUMED');
  });

  it('rejects when targetUserId not found', async () => {
    withDb({ superAdminCount: 0, targetUser: null });
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(404);
    expect(captured.body.code).toBe('TARGET_USER_NOT_FOUND');
  });

  it('rejects when targetUserId is soft-deleted', async () => {
    withDb({
      superAdminCount: 0,
      targetUser: { id: VALID_TARGET, supabase_uid: VALID_TARGET, email: 'x@y', is_deleted: true },
    });
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(409);
    expect(captured.body.code).toBe('TARGET_USER_DELETED');
  });

  it('rate-limits: 5 failures in 60s → 429 on next attempt', async () => {
    for (let i = 0; i < 5; i++) {
      const { res } = makeRes();
      await handler(makeReq({
        mode: 'env-credential', username: 'wrong', password: 'wrong',
        bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
      }), res);
    }
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: 'wrong', password: 'wrong',
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
    }), res);
    expect(captured.status).toBe(429);
    expect(captured.body.code).toBe('BOOTSTRAP_RATE_LIMITED');
  });

  it('happy path: promotes target user, returns nextSteps with env-var guidance', async () => {
    // Provision: org assignment must succeed. assignSuperAdmin needs an
    // org id — we provide one via organizationId override in the body so
    // the lookup chain can resolve.
    withDb({
      superAdminCount: 0,
      targetUser: { id: VALID_TARGET, supabase_uid: VALID_TARGET, email: 'op@x', is_deleted: false },
      insertResult: { data: { id: 'new-role-row-id' }, error: null },
    });
    const { res, captured } = makeRes();
    await handler(makeReq({
      mode: 'env-credential', username: ENV_USER, password: ENV_PASS,
      bootstrapToken: TOKEN, targetUserId: VALID_TARGET,
      organizationId: '00000000-0000-4000-8000-000000000001',
    }), res);
    expect(captured.status).toBe(201);
    expect(captured.body.ok).toBe(true);
    expect(captured.body.bootstrappedUserId).toBe(VALID_TARGET);
    expect(captured.body.nextSteps?.setEnv?.name).toBe('SUPER_ADMIN_PRIMARY_USER_ID');
    expect(captured.body.nextSteps?.setEnv?.value).toBe(VALID_TARGET);
  });
});

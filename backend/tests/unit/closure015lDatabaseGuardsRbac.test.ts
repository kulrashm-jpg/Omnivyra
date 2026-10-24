/**
 * Closure-015L — database guards (company lifecycle) and the rbac_config schema / stale-edit path.
 *
 *   B  company DISABLE gets the application SUPER_ADMIN guard (defence in depth); disable / soft
 *      delete / hard delete map the DATABASE guard's refusal (COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP)
 *      to 409; hard delete calls the atomic hard_delete_company function first and keeps the
 *      Closure-015K statement path only while the function is not deployed. The proposed SQL is
 *      checked for STRUCTURE only — its concurrency guarantees need the real-Postgres suite
 *      (backend/tests/realschema/closure015l_*.test.ts), which this phase did not run.
 *   C/D rbac_config: version token (GET), stale-edit refusal (409 RBAC_CONFIG_STALE) through a JS model
 *      of the proposed save_rbac_config, legacy path while it is absent, cache non-poisoning,
 *      last-trusted fallback, governed recovery.
 *
 * Same in-memory harness as Closure-015J/015K — not Postgres; no lock, isolation or deadlock is modelled.
 */
import fs from 'fs';
import path from 'path';
import { seed, rows, calls, invoke, CO_A, USER_SUPER } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
/** Failure hooks: `${table}:${op}` (op = select:<cols> | update | delete | insert). */
const mockFail = new Set<string>();
/** Closure-015L: per-test supabase.rpc model (null → the deployed state: save_rbac_config absent). */
const mockRpc: { fn: ((fn: string, args: unknown) => unknown) | null } = { fn: null };
/** Optional error code for a forced failure key (e.g. PGRST205 / 42P01). */
const mockFailCode = new Map<string, string>();
/** Race hook: runs when a write on `table` is issued (between a read and its conditional write). */
const mockBeforeWrite: { fn: ((table: string, op: string) => void) | null } = { fn: null };
/** Read gate: the next matching select returns its rows as of query time, delivered when `gate` resolves. */
const mockHoldRead: { key: string | null; gate: Promise<void> | null } = { key: null, gate: null };
let mockRateLimited = false;
const mockRateLimitPrefixes: string[] = [];

function mockFailing(code?: string): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order', 'maybeSingle', 'single']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: 'forced failure', code } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  failing.single = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  const origSelect = builder.select as (cols?: string, opts?: unknown) => Record<string, unknown>;
  builder.select = (cols?: string, opts?: unknown) => {
    if (mockFail.has(`${table}:select:${cols}`)) return mockFailing(mockFailCode.get(`${table}:select:${cols}`));
    const b = origSelect(cols, opts);
    if (mockHoldRead.key === `${table}:${cols}` && mockHoldRead.gate) {
      const gate = mockHoldRead.gate;
      mockHoldRead.key = null;
      mockHoldRead.gate = null;
      const origThen = b.then as (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise<unknown>;
      b.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
        const snapshot = new Promise((resolve) => { origThen.call(b, resolve); });
        return snapshot.then((v) => gate.then(() => v)).then(ok, err);
      };
    }
    return b;
  };
  for (const op of ['update', 'delete', 'insert'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockBeforeWrite.fn) mockBeforeWrite.fn(table, op);
      return mockFail.has(`${table}:${op}`) ? mockFailing() : orig(p);
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  // Closure-015L: models the CURRENT deployment — save_rbac_config (proposal 03) is not
  // deployed, so saveRbacConfig takes its legacy append path.
  const rpc = (fn: string, args?: unknown) => (mockRpc.fn
    ? Promise.resolve(mockRpc.fn(fn, args))
    : (fn === 'save_rbac_config'
      ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_rbac_config' } })
      : fake.rpc(fn, args)));
  const wrapped = { ...fake, rpc, from: (t: string) => mockWrap(fake.from(t), t) };
  return { supabase: wrapped, default: wrapped, getSupabase: () => wrapped, supabaseAdmin: wrapped };
});
jest.mock('../../db/writeOwner', () => {
  const base = require('../helpers/routeAuthHarness').writeOwnerModule();
  return { ownedDbTable: (t: string) => mockWrap(base.ownedDbTable(t), t) };
});
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' };
  },
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const user = req?.headers?.['x-test-user'];
    if (typeof user !== 'string' || !user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: async () => null }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockSecurityAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }, prefix: string) => {
    mockRateLimitPrefixes.push(prefix);
    if (mockRateLimited) { res.status(429).json({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' }); return false; }
    return true;
  },
}));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: jest.fn(async () => undefined) }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// No invitation, email or credit ever leaves the test: these services are spies.
const mockCreateInvitation = jest.fn(async () => ({ id: 'inv-test', inviteLink: 'http://localhost/accept', expiresAt: '2026-10-22T00:00:00.000Z', replayed: false }));
jest.mock('../../services/invitationService', () => ({
  createAndSendInvitation: (...a: unknown[]) => mockCreateInvitation(...(a as [])),
  createInvitation: (...a: unknown[]) => mockCreateInvitation(...(a as [])),
}));
const mockSendInvite = jest.fn(async () => undefined);
jest.mock('../../services/emailService', () => ({ sendInvite: (...a: unknown[]) => mockSendInvite(...(a as [])) }));
jest.mock('../../services/emailJobsService', () => ({ enqueueEmailJob: jest.fn(async () => ({ id: 'job-test' })) }));
const mockCreateCredit = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: (...a: unknown[]) => mockCreateCredit(...(a as [])),
  makeIdempotencyKey: (...a: unknown[]) => a.join(':'),
}));
const mockSoftDelete = jest.fn(async () => ({ affectedUsers: 0, revokedRoles: 0, revokedSessions: 0 }));
const mockDisable = jest.fn(async (): Promise<unknown> => ({ affectedUsers: 0, revokedRoles: 0, revokedSessions: 0 }));
const mockHardDelete = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: false, code: 'FUNCTION_MISSING' }));
jest.mock('../../services/lifecycleGovernance', () => ({
  softDeleteCompanyWithCascade: (...a: unknown[]) => mockSoftDelete(...(a as [])),
  cascadeDisableCompany: (...a: unknown[]) => mockDisable(...(a as [])),
  // Closure-015L: models the CURRENT deployment — hard_delete_company is not deployed
  // (proposal only), so the route uses the Closure-015K statement-level hard path.
  hardDeleteCompany: (...a: unknown[]) => mockHardDelete(...a),
}));
jest.mock('../../services/companyProfileService', () => ({ saveProfile: jest.fn(async () => ({})) }));
jest.mock('../../services/companyIdentityDriftService', () => ({ monitorCompanyIdentityDrift: jest.fn(async () => undefined) }));
jest.mock('../../services/domainEligibilityService', () => ({ isNonWorkEmailDomain: async () => false, invalidateDomainCache: jest.fn() }));
jest.mock('../../services/domainRecordService', () => ({ saveDomainRecord: jest.fn(async () => ({ ok: true })), reassignDomain: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/domainVerificationService', () => ({ logDomainUnverifiedUsageForCompany: jest.fn(async () => undefined) }));

import archiveRoute from '../../../pages/api/super-admin/companies/archive-abandoned';
import transferRoute from '../../../pages/api/super-admin/companies/transfer-ownership';
import usersCreateRoute from '../../../pages/api/super-admin/users/create';
import companiesRoute from '../../../pages/api/super-admin/companies';
import freeCreditGrantRoute from '../../../pages/api/super-admin/free-credits/grant';
import revokeRoute from '../../../pages/api/admin/revoke-super-admin';
import userRoleRoute from '../../../pages/api/users/[userId]/role';
import userRemoveRoute from '../../../pages/api/users/[userId]/index';
import companyUserRoleRoute from '../../../pages/api/company/users/[userId]/role';
import unlockRoute from '../../../pages/api/governance/unlock';
import restoreSnapshotRoute from '../../../pages/api/governance/restore-snapshot';
import rbacRoute from '../../../pages/api/super-admin/rbac';
import companyUsersRoute from '../../../pages/api/company/users';
import superAdminUsersRoute from '../../../pages/api/super-admin/users';
import reinviteRoute from '../../../pages/api/company/users/reinvite';
import { upsertCompanyRole } from '../../apiHandlers/superAdmin/usersCreateShared';
import {
  hasPermission, getRbacConfig, saveRbacConfig, clearRbacCache, RbacConfigValidationError, validateRbacConfigInput,
} from '../../services/rbacService';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444';   // the platform SA's home company
const ORPHAN = 'co-orphan-0000-0000-0000-000000000001'; // abandoned: no active members
const SA_HOME = 'co-sahome-0000-0000-0000-000000000002'; // PSA is an active member here too
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const PSA = 'u-psa';               // active platform SA (row in P), passkey + trusted device
const PSA_NOSTEP = 'u-psa-nostep'; // active platform SA, no step-up
const CADMIN = 'u-cadmin';         // active COMPANY_ADMIN of CO_A
const TARGET = 'u-target';         // ordinary member of CO_A
const SA_IN_A = 'u-sa-in-a';       // SUPER_ADMIN row residing in CO_A

function world(target: Record<string, unknown> = { role: 'CONTENT_CREATOR', status: 'active' }, sa: Record<string, unknown> = { status: 'active' }) {
  seed({
    companies: [
      { id: P, name: 'Platform', status: 'active', deleted_at: null },
      { id: ORPHAN, name: 'Orphan', status: 'active', deleted_at: null },
      { id: SA_HOME, name: 'SA home', status: 'active', deleted_at: null },
    ],
    user_company_roles: [
      { id: 'r-psa', user_id: PSA, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-psa-home', user_id: PSA, company_id: SA_HOME, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-psa-n', user_id: PSA_NOSTEP, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-cadmin', user_id: CADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-target', user_id: TARGET, company_id: CO_A, accepted_at: '2026-01-01T00:00:00.000Z', ...target },
      { id: 'r-sa-a', user_id: SA_IN_A, company_id: CO_A, role: 'SUPER_ADMIN', ...sa },
      { id: 'r-orphan-gone', user_id: 'u-gone', company_id: ORPHAN, role: 'COMPANY_ADMIN', status: 'inactive' },
    ],
    users: [
      { id: CADMIN, email: 'cadmin@example.test', is_deleted: false, role: 'COMPANY_ADMIN' },
      { id: TARGET, email: 'target@example.test', is_deleted: false, role: 'CONTENT_CREATOR' },
      { id: SA_IN_A, email: 'sa-in-a@example.test', is_deleted: false, role: 'SUPER_ADMIN' },
    ],
    stepup_sessions: [{ id: 'su-psa', user_id: PSA, auth_session_id: `sess-${PSA}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }],
    trusted_devices: [PSA, PSA_NOSTEP].map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null })),
    api_idempotency_keys: [],
    audit_logs: [],
    rbac_config: [],
    manual_credit_grants: [],
    company_profiles: [],
  });
  clearRbacCache();
}
let keySeq = 0;
const key = () => `c15j-${++keySeq}`;
const as = (user: string) => ({ 'x-test-user': user, 'idempotency-key': key() });
const company = (id: string) => rows('companies').find((c) => c.id === id);
const mem = (userId: string, companyId: string = CO_A) => rows('user_company_roles').find((r) => r.user_id === userId && r.company_id === companyId);
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && ['update', 'delete', 'insert', 'upsert'].includes(c.op));
const denialsFor = (cap: string) => mockSecurityAudit.filter((e) => e.capability === cap && e.decision === 'denied');

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockFail.clear();
  mockBeforeWrite.fn = null;
  mockHoldRead.key = null;
  mockHoldRead.gate = null;
  mockRateLimited = false;
  mockRateLimitPrefixes.length = 0;
  mockCreateInvitation.mockClear();
  mockSendInvite.mockClear();
  mockCreateCredit.mockClear();
  mockSoftDelete.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────
// Closure-015L additions to the 015J/015K harness.
import { resetRbacTrustState, getRbacConfigVersion } from '../../services/rbacService';

const P15L = path.resolve(__dirname, '../../../supabase/proposals/closure015l');
const sqlOf = (f: string) => fs.readFileSync(path.join(P15L, f), 'utf8');

/** JS model of the proposed public.save_rbac_config (03_rbac_config.sql) over the harness rows. */
function modelSaveRbacConfig(args: { p_roles: unknown; p_permissions: unknown; p_updated_by: unknown; p_expected_version: number | null }) {
  const table = rows('rbac_config');
  const head = table.reduce<Record<string, unknown> | null>((h, r) => (h === null || Number(r.version) > Number(h.version) ? r : h), null);
  const headVersion = head ? Number(head.version) : null;
  if (args.p_expected_version !== headVersion) {
    return { data: null, error: { code: 'P0001', message: 'RBAC_CONFIG_STALE', details: headVersion === null ? 'none' : String(headVersion) } };
  }
  const prevAt = head ? Date.parse(String(head.updated_at)) : 0;
  const at = new Date(Math.max(Date.now(), prevAt + 1)).toISOString();
  const row = { version: (headVersion ?? 0) + 1, roles: args.p_roles, permissions: args.p_permissions, updated_by: args.p_updated_by, updated_at: at };
  table.push(row);
  return { data: [row], error: null };
}
const missingFunction = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };

beforeEach(() => {
  resetRbacTrustState();
  mockFailCode.clear();
  mockRpc.fn = null;
  mockDisable.mockReset();
  mockDisable.mockImplementation(async () => ({ affectedUsers: 1, revokedRoles: 1, revokedSessions: 0 }));
  mockHardDelete.mockReset();
  mockHardDelete.mockImplementation(async () => ({ ok: false, code: 'FUNCTION_MISSING' }));
});

const patch = (who: string, body: Record<string, unknown>) =>
  invoke(companiesRoute as never, { method: 'PATCH', body: { status: 'inactive', reason: 'disable for test', ...body }, headers: as(who) });
const del = (body: Record<string, unknown>, who = PSA) => invoke(companiesRoute as never, { method: 'DELETE', body, headers: as(who) });
const membershipDeletes = () => calls().filter((c) => c.table === 'user_company_roles' && c.op === 'delete');

// ─────────────────────────────────────────────────────────────────────────────
describe('B — company DISABLE: application guard (defence in depth) + database refusal mapping', () => {
  it('ordinary disable (no active SUPER_ADMIN membership) → 200; the cascade runs', async () => {
    world();
    const r = await patch(PSA, { companyId: ORPHAN });
    expect(r.status).toBe(200);
    expect(mockDisable).toHaveBeenCalledTimes(1);
  });

  it('an existing ACTIVE SUPER_ADMIN membership → 409 COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP; cascade NOT called; membership untouched', async () => {
    world();
    const r = await patch(PSA, { companyId: CO_A });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' });
    expect(mockDisable).not.toHaveBeenCalled();
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('an INACTIVE / invited SUPER_ADMIN row confers nothing and does not block', async () => {
    world();
    rows('user_company_roles').push({ id: 'o-sa', user_id: SA_IN_A, company_id: ORPHAN, role: 'SUPER_ADMIN', status: 'invited' });
    expect((await patch(PSA, { companyId: ORPHAN })).status).toBe(200);
    expect(mockDisable).toHaveBeenCalledTimes(1);
  });

  it('membership lookup failure → 503 MEMBERSHIP_LOOKUP_FAILED; cascade NOT called (fail closed)', async () => {
    world();
    mockFail.add('user_company_roles:select:user_id, role, status');
    const r = await patch(PSA, { companyId: ORPHAN });
    expect(r.status).toBe(503);
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('authorization failure: a company admin → 403; an SA without step-up → refused; cascade NOT called', async () => {
    world();
    expect((await patch(CADMIN, { companyId: ORPHAN })).status).toBe(403);
    expect([401, 403]).toContain((await patch(PSA_NOSTEP, { companyId: ORPHAN })).status);
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('the DATABASE guard refuses (SA activated after the application check) → 409, not 500 CASCADE_FAILED', async () => {
    world();
    mockDisable.mockImplementationOnce(async () => { throw new Error('DISABLE_COMPANY_CASCADE_RPC_FAILED:COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'); });
    const r = await patch(PSA, { companyId: ORPHAN });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' });
    expect(rows('audit_logs').filter((a) => a.action === 'SUPER_ADMIN_COMPANY_DISABLE')).toHaveLength(0);
  });

  it('any other cascade failure is still 500 CASCADE_FAILED', async () => {
    world();
    mockDisable.mockImplementationOnce(async () => { throw new Error('DISABLE_COMPANY_CASCADE_RPC_FAILED:boom'); });
    expect((await patch(PSA, { companyId: ORPHAN })).body).toMatchObject({ error: 'CASCADE_FAILED' });
  });
});

describe('B — company SOFT delete: database refusal mapping and authorization', () => {
  it('the DATABASE guard refuses inside soft_delete_company → 409; no success audit', async () => {
    world();
    mockSoftDelete.mockImplementationOnce(async () => { throw new Error('SOFT_DELETE_COMPANY_RPC_FAILED:COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'); });
    const r = await del({ companyId: ORPHAN });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' });
    expect(rows('audit_logs').filter((a) => a.action === 'SUPER_ADMIN_COMPANY_SOFT_DELETE')).toHaveLength(0);
  });

  it('authorization failure (company admin) → 403; nothing called', async () => {
    world();
    expect((await del({ companyId: ORPHAN }, CADMIN)).status).toBe(403);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });
});

describe('B — company HARD delete: the atomic database function first', () => {
  it('function deployed → ONE call; no application-side membership/profile/company statements; audit says atomic', async () => {
    world();
    mockHardDelete.mockImplementationOnce(async () => ({ ok: true, deletedMemberships: 1, deletedProfiles: 0 }));
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, mode: 'hard', atomic: true });
    expect(mockHardDelete).toHaveBeenCalledWith(ORPHAN, PSA, expect.stringContaining('delete:'));
    expect(calls().filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'SUPER_ADMIN_COMPANY_HARD_DELETE', metadata: expect.objectContaining({ atomic: true, deleted_memberships: 1 }) }));
  });

  it('the database refuses (concurrently activated SUPER_ADMIN) → 409; nothing deleted, no fallback to the statement path', async () => {
    world();
    mockHardDelete.mockImplementationOnce(async () => { throw new Error('HARD_DELETE_COMPANY_RPC_FAILED:COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'); });
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(409);
    expect(calls().filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(company(ORPHAN)).toBeDefined();
  });

  it('COMPANY_NOT_FOUND from the function → 404; any other function error → 500 partial:false (rolled back), no fallback', async () => {
    world();
    mockHardDelete.mockImplementationOnce(async () => { throw new Error('HARD_DELETE_COMPANY_RPC_FAILED:COMPANY_NOT_FOUND'); });
    expect((await del({ companyId: ORPHAN, hard: true })).status).toBe(404);
    mockHardDelete.mockImplementationOnce(async () => { throw new Error('HARD_DELETE_COMPANY_RPC_FAILED:update or delete on table "companies" violates foreign key constraint'); });
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'FAILED_TO_DELETE_COMPANY', partial: false });
    expect(membershipDeletes()).toHaveLength(0);
  });

  it('the application pre-check still runs first: an existing active SUPER_ADMIN → 409 before the function is called', async () => {
    world();
    expect((await del({ companyId: CO_A, hard: true })).status).toBe(409);
    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('function NOT deployed (current state) → the Closure-015K statement path still deletes an ordinary company', async () => {
    world();
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, mode: 'hard' });
    expect(company(ORPHAN)).toBeUndefined();
  });

  it('authorization failure (company admin) → 403; the function is not called', async () => {
    world();
    expect((await del({ companyId: ORPHAN, hard: true }, CADMIN)).status).toBe(403);
    expect(mockHardDelete).not.toHaveBeenCalled();
  });
});

describe('B — the proposed SQL (static structure only; real-Postgres proof is operator-run)', () => {
  // Closure-015O promoted the reviewed package (supabase/proposals/closure015n) into dated migrations.
  // Each object is now defined in EXACTLY its promoted top-level migration — nowhere else.
  it('each guard object is defined in exactly its promoted migration (Closure-015O), nowhere else in supabase/migrations', () => {
    const migrations = path.resolve(__dirname, '../../../supabase/migrations');
    const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql'));
    const definedIn = (needle: string) => files.filter((f) => fs.readFileSync(path.join(migrations, f), 'utf8').includes(needle)).sort();
    // Closure-015P: 0002 re-creates the guard function with the direct application-role grant refusal.
    expect(definedIn('CREATE OR REPLACE FUNCTION public.guard_super_admin_membership_company()')).toEqual([
      '20261210000001_company_lifecycle_super_admin_guard.sql',
      '20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql',
    ]);
    expect(definedIn('CREATE TRIGGER trg_guard_super_admin_membership_company')).toEqual(['20261210000001_company_lifecycle_super_admin_guard.sql']);
    expect(definedIn('SUPER_ADMIN_GRANT_NOT_GOVERNED')).toEqual(['20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql']);
    expect(definedIn('CREATE OR REPLACE FUNCTION public.hard_delete_company(')).toEqual(['20261210000001_company_lifecycle_super_admin_guard.sql']);
    expect(definedIn('CREATE OR REPLACE FUNCTION public.assign_super_admin(')).toEqual(['20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql']);
    expect(definedIn('CREATE OR REPLACE FUNCTION public.save_rbac_config(')).toEqual(['20261210000003_rbac_config.sql']);
    expect(definedIn('CREATE TABLE IF NOT EXISTS public.rbac_config (')).toEqual(['20261210000003_rbac_config.sql']);
  });

  // Closure-015P (owner decision 1): the rbac_config CONTRACT step is deferred — absent from the
  // migration batch, preserved (with its rollback) under supabase/deferred without a version prefix.
  it('the rbac_config contract REVOKE is deferred: in supabase/deferred only, never in supabase/migrations', () => {
    const root = path.resolve(__dirname, '../../../supabase');
    // Closure-015Q (F-1): the contract revokes EVERYTHING the application roles hold (the hosted default
    // privileges grant ALL), then grants back only SELECT; the identity sequence is revoked too.
    const contract = 'REVOKE ALL ON TABLE public.rbac_config FROM PUBLIC, anon, authenticated, authenticator, service_role';
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.sql') ? [path.join(d, e.name)] : []);
    // Closure-015R: the forward pre-C-7 reduction (20261211000001) shares the REVOKE ALL line, so the
    // "never in supabase/migrations" check pins what only the CONTRACT has: its SELECT-only grant (which
    // removes the legacy INSERT) and its post-condition marker.
    for (const needle of [
      'GRANT SELECT ON TABLE public.rbac_config TO service_role;',
      'RBAC_CONTRACT_POSTCONDITION',
      'RBAC_CONTRACT_PRECONDITION',
      'REVOKE INSERT, UPDATE, DELETE ON public.rbac_config FROM service_role',
    ]) {
      expect(walk(path.join(root, 'migrations')).filter((f) => fs.readFileSync(f, 'utf8').includes(needle))).toEqual([]);
    }
    // and no migration revokes INSERT from service_role on its own (that is the C-7-gated step)
    // (SQL only: 0003's VARIANT B documentation mentions such a REVOKE in a `--` comment)
    const sqlOnly = (f: string) => fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(walk(path.join(root, 'migrations')).filter((f) => /REVOKE\s+INSERT\b[^;]*rbac_config/i.test(sqlOnly(f)))).toEqual([]);
    const deferred = fs.readFileSync(path.join(root, 'deferred/rbac_config_contract_legacy_insert.sql'), 'utf8');
    expect(deferred).toContain(contract);
    expect(deferred).toContain('GRANT SELECT ON TABLE public.rbac_config TO service_role;');
    expect(deferred).toMatch(/REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, authenticator, service_role/);
    expect(deferred).toMatch(/RBAC_CONTRACT_POSTCONDITION/);
    expect(deferred).not.toMatch(/^\s*GRANT\s+(?!SELECT ON TABLE public\.rbac_config TO service_role;)/m);
    expect(deferred).toMatch(/DEFERRED by Closure-015P/);
    const rollback = fs.readFileSync(path.join(root, 'deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql'), 'utf8');
    expect(rollback).toContain('GRANT INSERT ON TABLE public.rbac_config TO service_role;');
    // the rollback re-opens only the legacy INSERT — never the broad hosted default
    expect(rollback.split('\n').filter((l) => /^\s*GRANT\b/.test(l))).toEqual(['GRANT INSERT ON TABLE public.rbac_config TO service_role;']);
  });

  // Closure-015R (owner decision 2): the forward pre-C-7 privilege reduction, after 0004.
  it('the pre-C-7 reduction (20261211000001) follows 0004 and grants service_role exactly SELECT, INSERT; its rollback never re-grants the broad default', () => {
    const migrations = path.resolve(__dirname, '../../../supabase/migrations');
    const files = fs.readdirSync(migrations).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    const name = '20261211000001_rbac_config_pre_c7_privilege_reduction.sql';
    expect(files).toContain(name);
    expect(files.indexOf(name)).toBe(files.indexOf('20261210000004_activate_invitation_membership.sql') + 1);
    // the only migrations granting on rbac_config are 0003 (creation) and this one
    expect(files.filter((f) => /GRANT[^;]*ON\s+(TABLE\s+)?public\.rbac_config\b/i.test(fs.readFileSync(path.join(migrations, f), 'utf8'))))
      .toEqual(['20261210000003_rbac_config.sql', name]);
    const sql = fs.readFileSync(path.join(migrations, name), 'utf8');
    expect(sql).toContain('REVOKE ALL ON TABLE public.rbac_config FROM PUBLIC, anon, authenticated, authenticator, service_role;');
    expect(sql.split('\n').filter((l) => /^\s*GRANT\b/.test(l))).toEqual(['GRANT SELECT, INSERT ON TABLE public.rbac_config TO service_role;']);
    expect(sql).toMatch(/REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, authenticator, service_role/);
    expect(sql).toMatch(/RBAC_PRIVILEGE_REDUCTION_POSTCONDITION/);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    const rollback = fs.readFileSync(path.join(migrations, 'rollbacks/rbac_config_pre_c7_privilege_reduction_rollback.sql'), 'utf8');
    expect(rollback.split('\n').filter((l) => /^\s*GRANT\b/.test(l))).toEqual(['GRANT SELECT, INSERT ON TABLE public.rbac_config TO service_role;']);
  });

  it('the direct-grant guard (0002) stays INVOKER-rights and refuses before taking the company lock', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql'), 'utf8');
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.guard_super_admin_membership_company()');
    const body = sql.slice(start, sql.indexOf('\n$$;', start));
    expect(body.slice(0, body.indexOf('AS $$'))).not.toMatch(/SECURITY DEFINER/);
    expect(body).toContain("current_user IN ('service_role', 'authenticated', 'anon', 'authenticator')");
    expect(body.indexOf('SUPER_ADMIN_GRANT_NOT_GOVERNED')).toBeLessThan(body.indexOf('FOR SHARE'));
  });

  it('every lifecycle function locks the company row FOR UPDATE before touching memberships, and refuses on an active SUPER_ADMIN', () => {
    const sql = sqlOf('01_company_lifecycle_super_admin_guard.sql');
    for (const fn of ['disable_company_cascade', 'hard_delete_company']) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      const lock = body.indexOf('FOR UPDATE');
      const firstMembershipWrite = Math.min(...['UPDATE user_company_roles', 'DELETE FROM user_company_roles'].map((s) => { const i = body.indexOf(s); return i < 0 ? Infinity : i; }));
      expect(lock).toBeGreaterThan(0);
      expect(lock).toBeLessThan(firstMembershipWrite);
      expect(body.slice(0, firstMembershipWrite)).toContain("RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'");
    }
  });

  it('the writer guard takes the company FOR SHARE and refuses a missing / non-active / soft-deleted company', () => {
    const sql = sqlOf('01_company_lifecycle_super_admin_guard.sql');
    const fn = sql.slice(sql.indexOf('FUNCTION public.guard_super_admin_membership_company()'), sql.indexOf('CREATE TRIGGER'));
    expect(fn).toMatch(/FROM public\.companies c\s+WHERE c\.id = NEW\.company_id\s+FOR SHARE;/);
    expect(fn).toContain("'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING'");
    expect(fn).toContain("v_deleted IS NOT NULL OR v_status <> 'active'");
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF role, status, company_id ON public\.user_company_roles/);
  });

  it('hard delete removes the company LAST, inside the same function; grants are service_role only', () => {
    const sql = sqlOf('01_company_lifecycle_super_admin_guard.sql');
    const body = sql.slice(sql.indexOf('FUNCTION public.hard_delete_company('));
    expect(body.indexOf('DELETE FROM companies')).toBeGreaterThan(body.indexOf('DELETE FROM company_profiles'));
    expect(body.indexOf('DELETE FROM company_profiles')).toBeGreaterThan(body.indexOf('DELETE FROM user_company_roles'));
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.hard_delete_company(uuid, uuid, text) FROM PUBLIC, anon, authenticated;');
  });

  it('save_rbac_config serializes on a transaction advisory lock and refuses a stale expected version', () => {
    const sql = sqlOf('03_rbac_config.sql');
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('public.rbac_config'))");
    expect(sql).toContain('IF p_expected_version IS DISTINCT FROM v_head_version THEN');
    expect(sql).toContain("RAISE EXCEPTION 'RBAC_CONFIG_STALE'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C/D — rbac_config stale-edit detection (modelled save_rbac_config) and recovery', () => {
  const CFG = (assign: string[]) => ({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'], permissions: { ASSIGN_ROLE: assign, VIEW_DASHBOARD: ['*'] } });
  const post = (body: Record<string, unknown>, who = PSA) => invoke(rbacRoute as never, { method: 'POST', body, headers: as(who) });
  const get = () => invoke(rbacRoute as never, { method: 'GET', headers: as(PSA) });
  const withModel = () => { mockRpc.fn = (fn, args) => (fn === 'save_rbac_config' ? modelSaveRbacConfig(args as never) : missingFunction); };

  it('GET hands out the version token; the first save (expectedVersion null) creates version 1; the next save uses it', async () => {
    world();
    withModel();
    expect((await get()).body).toMatchObject({ version: null });
    const r1 = await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ version: 1 });
    expect((await get()).body).toMatchObject({ version: 1 });
    expect((await post({ ...CFG(['COMPANY_ADMIN', 'VIEW_ONLY']), expectedVersion: 1 })).body).toMatchObject({ version: 2 });
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
  });

  it('STALE SAVE: two editors loaded version 1; the second save is refused 409 RBAC_CONFIG_STALE (no silent overwrite)', async () => {
    world();
    withModel();
    await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null });          // v1
    const a = await post({ ...CFG(['COMPANY_ADMIN', 'VIEW_ONLY']), expectedVersion: 1 }); // editor A → v2
    const b = await post({ ...CFG([]), expectedVersion: 1 });                  // editor B, stale
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ error: 'RBAC_CONFIG_STALE', currentVersion: 2 });
    expect(rows('rbac_config')).toHaveLength(2);
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);         // A's config, not B's
  });

  it('a stale save after a first save that the editor never saw (expectedVersion null while v1 exists) is refused', async () => {
    world();
    withModel();
    await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null });
    const r = await post({ ...CFG(['VIEW_ONLY']) });                            // absent ≡ null
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ currentVersion: 1 });
  });

  it.each([['a string', '1'], ['zero', 0], ['negative', -1], ['fractional', 1.5], ['an object', { v: 1 }]])('expectedVersion %s → 400 RBAC_EXPECTED_VERSION_INVALID; nothing written', async (_d, expectedVersion) => {
    world();
    withModel();
    const r = await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'RBAC_EXPECTED_VERSION_INVALID' });
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('failed write in the save function → 500; nothing stored; NO fallback to the unguarded legacy insert; effective config unchanged', async () => {
    world();
    withModel();
    await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null });
    mockRpc.fn = () => ({ data: null, error: { code: '53300', message: 'too many connections' } });
    const r = await post({ ...CFG(['COMPANY_ADMIN', 'VIEW_ONLY']), expectedVersion: 1 });
    expect(r.status).toBe(500);
    expect(rows('rbac_config')).toHaveLength(1);
    expect(calls().filter((c) => c.table === 'rbac_config' && c.op === 'insert')).toHaveLength(0);
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });

  it('function NOT deployed (current state) → the legacy append path; version stays null', async () => {
    world();
    const r = await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: null });
    expect(calls().filter((c) => c.table === 'rbac_config' && c.op === 'insert')).toHaveLength(1);
  });

  it('getRbacConfigVersion: no row, read failure, legacy row without a version → null', async () => {
    world();
    expect(await getRbacConfigVersion()).toBeNull();
    rows('rbac_config').push({ ...CFG(['COMPANY_ADMIN']), updated_at: '2026-10-16T00:00:00.000Z' });
    expect(await getRbacConfigVersion()).toBeNull();
    mockFail.add('rbac_config:select:version');
    expect(await getRbacConfigVersion()).toBeNull();
  });

  it('CACHE: a malformed read does not poison the cache — a repair saved by ANOTHER instance is seen on the next check', async () => {
    world();
    rows('rbac_config').push({ roles: 'garbage', permissions: 'garbage', updated_at: '2026-10-16T00:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);   // deny-all
    // another instance repairs (no clearRbacCache in THIS process)
    rows('rbac_config').push({ ...CFG(['COMPANY_ADMIN']), updated_at: '2026-10-16T00:00:01.000Z' });
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
  });

  it('CACHE: a malformed newer row never replaces the last trusted config; a later read failure falls back to that trusted config only', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-16T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world();
    rows('rbac_config').push({ ...CFG(['COMPANY_ADMIN']), updated_at: '2026-10-16T09:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);    // trusted
    rows('rbac_config').push({ roles: [], permissions: {}, updated_at: '2026-10-16T09:30:00.000Z' });
    jest.setSystemTime(Date.parse('2026-10-16T10:00:31.000Z'));
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);   // malformed → deny-all
    mockFail.add('rbac_config:select:roles, permissions, updated_at');
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);    // read failure → last TRUSTED (not the malformed doc, not the defaults)
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });

  it('RECOVERY (versioned): deny-all in force; a company admin cannot repair (403); the governed super-admin save with the current token restores it', async () => {
    world();
    withModel();
    rows('rbac_config').push({ version: 1, roles: 'garbage', permissions: 'garbage', updated_at: '2026-10-16T00:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);
    expect((await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: 1 }, CADMIN)).status).toBe(403);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);
    const token = (await get()).body as { version: number };
    expect(token.version).toBe(1);
    const r = await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: token.version });
    expect(r.status).toBe(200);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
  });

  it('a stale refusal does not disturb the cache: the effective config stays the newest stored one', async () => {
    world();
    withModel();
    await post({ ...CFG(['COMPANY_ADMIN', 'VIEW_ONLY']), expectedVersion: null });
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
    expect((await post({ ...CFG(['COMPANY_ADMIN']), expectedVersion: null })).status).toBe(409);
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
  });
});

describe('B — lifecycleGovernance.hardDeleteCompany (the real wrapper, over a modelled supabase.rpc)', () => {
  const real = () => jest.requireActual('../../services/lifecycleGovernance') as typeof import('../../services/lifecycleGovernance');

  it.each(['PGRST202', '42883'])('function not deployed (%s) → { ok: false, code: FUNCTION_MISSING }', async (code) => {
    mockRpc.fn = () => ({ data: null, error: { code, message: 'Could not find the function' } });
    await expect(real().hardDeleteCompany(ORPHAN, PSA, 'r')).resolves.toEqual({ ok: false, code: 'FUNCTION_MISSING' });
  });

  it('the database refusal and every other error THROW (never mistaken for FUNCTION_MISSING)', async () => {
    mockRpc.fn = () => ({ data: null, error: { code: 'P0001', message: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' } });
    await expect(real().hardDeleteCompany(ORPHAN, PSA, 'r')).rejects.toThrow('HARD_DELETE_COMPANY_RPC_FAILED:COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP');
    mockRpc.fn = () => ({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } });
    await expect(real().hardDeleteCompany(ORPHAN, PSA, 'r')).rejects.toThrow('violates foreign key constraint');
  });

  it('success maps the function result; the RPC receives the company, actor and reason', async () => {
    let seen: unknown = null;
    mockRpc.fn = (fn, args) => { seen = { fn, args }; return { data: [{ deleted_memberships: 3, deleted_profiles: 1 }], error: null }; };
    await expect(real().hardDeleteCompany(ORPHAN, PSA, 'cleanup')).resolves.toEqual({ ok: true, deletedMemberships: 3, deletedProfiles: 1 });
    expect(seen).toEqual({ fn: 'hard_delete_company', args: { p_company_id: ORPHAN, p_actor: PSA, p_reason: 'cleanup' } });
  });

  it('missing arguments are refused before any call', async () => {
    mockRpc.fn = jest.fn();
    await expect(real().hardDeleteCompany(ORPHAN, PSA, '  ')).rejects.toThrow('HARD_DELETE_COMPANY_MISSING_REASON');
    expect(mockRpc.fn).not.toHaveBeenCalled();
  });
});

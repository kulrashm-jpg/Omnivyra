/**
 * Closure-015K — remaining concurrency and RBAC blockers.
 *
 *   R-9 hard delete  the bulk membership DELETE excludes role = 'SUPER_ADMIN' (statement-atomic), the
 *                    leftovers are re-read, an ACTIVE SUPER_ADMIN row stops the deletion before the company
 *                    is touched, every other leftover is removed by a conditional delete (id + role +
 *                    status). Four interleavings of a concurrent governed grant are exercised.
 *   R-9 soft delete  characterization only: the cascade runs inside the soft_delete_company SQL function,
 *                    so the application cannot make it atomic (proposal in the 015K report).
 *   C                an untrusted stored RBAC document is DENY-ALL (no longer the built-in defaults); a
 *                    failed read uses the last trusted config, else deny-all, never cached; a missing table
 *                    keeps the defaults; recovery is the governed super-admin save.
 *
 * Same in-memory harness as Closure-015J (routeAuthHarness + the real routes / authorization chain). The
 * races are injected between statements; the harness does NOT model Postgres row locks, EvalPlanQual
 * re-checks or transaction isolation — real-Postgres verification is still required.
 */
import fs from 'fs';
import path from 'path';
import { seed, rows, calls, invoke, CO_A, USER_SUPER } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
/** Failure hooks: `${table}:${op}` (op = select:<cols> | update | delete | insert). */
const mockFail = new Set<string>();
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
  const rpc = (fn: string, args?: unknown) => (fn === 'save_rbac_config'
    ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_rbac_config' } })
    : fake.rpc(fn, args));
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
jest.mock('../../services/lifecycleGovernance', () => ({
  softDeleteCompanyWithCascade: (...a: unknown[]) => mockSoftDelete(...(a as [])),
  cascadeDisableCompany: jest.fn(async () => ({})),
  // Closure-015L: models the CURRENT deployment — hard_delete_company is not deployed
  // (proposal only), so the route uses the Closure-015K statement-level hard path.
  hardDeleteCompany: jest.fn(async () => ({ ok: false, code: 'FUNCTION_MISSING' })),
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
// Closure-015K additions to the 015J harness.
import { resetRbacTrustState, PERMISSIONS, ALL_ROLES } from '../../services/rbacService';

// Tolerant call: lets this suite run unchanged against the pre-015K module (pre-fix comparison).
beforeEach(() => { (resetRbacTrustState as (() => void) | undefined)?.(); mockFailCode.clear(); });

const del = (body: Record<string, unknown>) => invoke(companiesRoute as never, { method: 'DELETE', body, headers: as(PSA) });
const orphanRows = () => rows('user_company_roles').filter((r) => r.company_id === ORPHAN);
const orphanRow = (id: string) => rows('user_company_roles').find((r) => r.id === id);
/** ORPHAN holds an ordinary member, an INACTIVE SUPER_ADMIN row (confers nothing) and an expired row. */
function orphanWorld() {
  world();
  rows('user_company_roles').push(
    { id: 'o-member', user_id: TARGET, company_id: ORPHAN, role: 'CONTENT_CREATOR', status: 'active' },
    { id: 'o-sa', user_id: SA_IN_A, company_id: ORPHAN, role: 'SUPER_ADMIN', status: 'inactive' },
    { id: 'o-old', user_id: CADMIN, company_id: ORPHAN, role: 'VIEW_ONLY', status: 'expired' },
  );
}
let deleteSeq = 0;
const onNthMembershipDelete = (n: number, fn: () => void) => {
  deleteSeq = 0;
  mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'delete' && ++deleteSeq === n) fn(); };
};

describe('R-9 (hard delete) — a concurrently activated SUPER_ADMIN membership is never removed', () => {
  it('ordinary hard delete: every membership (incl. the inactive SUPER_ADMIN row) and the company are removed', async () => {
    orphanWorld();
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, mode: 'hard' });
    expect(orphanRows()).toHaveLength(0);
    expect(company(ORPHAN)).toBeUndefined();
  });

  it('an existing ACTIVE SUPER_ADMIN membership: refused by the pre-check; nothing deleted', async () => {
    orphanWorld();
    orphanRow('o-sa')!.status = 'active';
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' });
    expect(orphanRows()).toHaveLength(4); // 3 added + the world inactive r-orphan-gone
    expect(calls().filter((c) => c.op === 'delete')).toHaveLength(0);
  });

  it('RACE A: the inactive SUPER_ADMIN row is re-activated after the pre-check, before the bulk delete → kept; company NOT deleted; 409 partial', async () => {
    orphanWorld();
    onNthMembershipDelete(1, () => { orphanRow('o-sa')!.status = 'active'; });
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP', partial: true, completed: ['memberships_deleted'], count: 1 });
    expect(orphanRow('o-sa')).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(orphanRow('o-member')).toBeUndefined();
    expect(company(ORPHAN)).toBeDefined();
    expect(calls().filter((c) => c.table === 'companies' && c.op === 'delete')).toHaveLength(0);
  });

  it('RACE B: a NEW active SUPER_ADMIN row is inserted (assignSuperAdmin) during the bulk delete → kept; company NOT deleted', async () => {
    orphanWorld();
    onNthMembershipDelete(1, () => {
      rows('user_company_roles').push({ id: 'o-sa-new', user_id: 'u-new-sa', company_id: ORPHAN, role: 'SUPER_ADMIN', status: 'active' });
    });
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(409);
    expect(orphanRow('o-sa-new')).toMatchObject({ status: 'active' });
    expect(company(ORPHAN)).toBeDefined();
  });

  it('RACE C: the SUPER_ADMIN row is activated after the re-read, before its own conditional delete → kept; 409 STALE_MEMBERSHIP partial', async () => {
    orphanWorld();
    // delete #1 = bulk (non-SUPER_ADMIN); the leftover SUPER_ADMIN row is the next conditional delete
    onNthMembershipDelete(2, () => { orphanRow('o-sa')!.status = 'active'; });
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'STALE_MEMBERSHIP', partial: true, completed: ['memberships_deleted'] });
    expect(orphanRow('o-sa')).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(company(ORPHAN)).toBeDefined();
  });

  it('RACE D (residual, documented): activation AFTER the last membership statement → the company is deleted, but the SUPER_ADMIN row is never removed (authority intact; orphaned row)', async () => {
    orphanWorld();
    orphanRow('o-sa')!.status = 'expired';
    mockBeforeWrite.fn = (table, op) => {
      if (table === 'companies' && op === 'delete') {
        rows('user_company_roles').push({ id: 'o-sa-late', user_id: 'u-late-sa', company_id: ORPHAN, role: 'SUPER_ADMIN', status: 'active' });
      }
    };
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(200);
    expect(company(ORPHAN)).toBeUndefined();
    expect(orphanRow('o-sa-late')).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('failures: bulk delete error → 500 before anything else; re-read error → 503 partial; company kept', async () => {
    orphanWorld();
    mockFail.add('user_company_roles:delete');
    const r1 = await del({ companyId: ORPHAN, hard: true });
    expect(r1.status).toBe(500);
    expect(r1.body).toEqual({ error: 'FAILED_TO_DELETE_COMPANY_USERS' });
    expect(orphanRows()).toHaveLength(4); // 3 added + the world inactive r-orphan-gone

    orphanWorld();
    mockFail.clear();
    mockFail.add('user_company_roles:select:id, role, status');
    const r2 = await del({ companyId: ORPHAN, hard: true });
    expect(r2.status).toBe(503);
    expect(r2.body).toMatchObject({ error: 'MEMBERSHIP_LOOKUP_FAILED', partial: true, completed: ['memberships_deleted'] });
    expect(orphanRow('o-sa')).toMatchObject({ status: 'inactive' });
    expect(company(ORPHAN)).toBeDefined();
  });
});

describe('R-9 (soft delete) — the race is NOT closable in the application (characterization of the residual)', () => {
  it('the pre-check is not atomic with soft_delete_company: an SA activated in between is deactivated by the cascade RPC (modelled), which only a DB-side guard can prevent', async () => {
    orphanWorld();
    // Model the RPC exactly as baseline.sql disable_company_cascade does: deactivate every
    // ACTIVE membership of the company — and let assignSuperAdmin commit just before it runs.
    mockSoftDelete.mockImplementationOnce(async () => {
      orphanRow('o-sa')!.status = 'active';                         // concurrent governed grant commits
      for (const m of orphanRows()) if (m.status === 'active') m.status = 'inactive'; // the cascade UPDATE
      return { affectedUsers: 2, revokedRoles: 2, revokedSessions: 0 };
    });
    const r = await del({ companyId: ORPHAN });
    expect(r.status).toBe(200);
    // The documented residual (Closure-015K report §2.3): platform authority was removed.
    expect(orphanRow('o-sa')).toMatchObject({ role: 'SUPER_ADMIN', status: 'inactive' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — malformed stored RBAC configuration fails closed; recovery stays available', () => {
  const NARROW = { roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'], permissions: { CREATE_USER: ['SUPER_ADMIN'], ASSIGN_ROLE: ['SUPER_ADMIN'], VIEW_DASHBOARD: ['VIEW_ONLY'] } };
  const push = (row: Record<string, unknown>) => { rows('rbac_config').push({ updated_at: '2026-10-15T00:00:00.000Z', ...row }); clearRbacCache(); };
  /** Every (role, permission) pair the built-in defaults know about. */
  const grid = async () => {
    const out: string[] = [];
    for (const perm of Object.keys(PERMISSIONS)) for (const role of ALL_ROLES) if (await hasPermission(role, perm)) out.push(`${role}:${perm}`);
    return out;
  };

  it.each<[string, Record<string, unknown>]>([
    ['roles a string', { roles: 'COMPANY_ADMIN', permissions: NARROW.permissions }],
    ['roles empty', { roles: [], permissions: NARROW.permissions }],
    ['roles with a non-string', { roles: ['COMPANY_ADMIN', 7], permissions: NARROW.permissions }],
    ['roles missing', { permissions: NARROW.permissions }],
    ['permissions missing', { roles: NARROW.roles }],
    ['permissions a string', { roles: NARROW.roles, permissions: 'garbage' }],
    ['permissions an array', { roles: NARROW.roles, permissions: [['CREATE_USER', ['COMPANY_ADMIN']]] }],
    ['permissions empty', { roles: NARROW.roles, permissions: {} }],
    ['permissions null', { roles: NARROW.roles, permissions: null }],
    ['only blank permission keys', { roles: NARROW.roles, permissions: { '   ': ['COMPANY_ADMIN'] } }],
  ])('untrusted whole document (%s) → DENY-ALL: no role holds any permission', async (_d, row) => {
    world();
    push(row);
    expect(await grid()).toEqual([]);
  });

  it('malformed individual entries keep narrowing (never widening): unknown role names dropped, a malformed value grants nobody', async () => {
    world();
    push({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HACKER'], permissions: { CREATE_USER: 'COMPANY_ADMIN', ASSIGN_ROLE: ['COMPANY_ADMIN', 'HACKER'], VIEW_DASHBOARD: ['COMPANY_ADMIN'] } });
    expect((await grid()).sort()).toEqual(['COMPANY_ADMIN:ASSIGN_ROLE', 'COMPANY_ADMIN:VIEW_DASHBOARD']);
  });

  it('valid defaults: no stored row → the built-in defaults', async () => {
    world();
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(true);
    expect(await hasPermission('VIEW_ONLY', 'CREATE_USER')).toBe(false);
  });

  it.each(['PGRST205', '42P01'])('table missing (%s) → the built-in defaults (nothing narrower can have been stored)', async (code) => {
    world();
    mockFailCode.set('rbac_config:select:roles, permissions, updated_at', code);
    mockFail.add('rbac_config:select:roles, permissions, updated_at');
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(true);
  });

  it('failed read with no trusted config in this process → DENY-ALL, and the failure is not cached', async () => {
    world();
    push(NARROW);
    mockFail.add('rbac_config:select:roles, permissions, updated_at');
    expect(await grid()).toEqual([]);
    mockFail.clear();
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true); // next check reads again
  });

  it('failed read after a trusted narrowed config → that config (NOT the wider defaults)', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-16T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world();
    push(NARROW);
    const narrowed = await grid();
    expect(narrowed).not.toContain('COMPANY_ADMIN:CREATE_USER');
    jest.setSystemTime(Date.parse('2026-10-16T10:00:31.000Z')); // cache expired
    mockFail.add('rbac_config:select:roles, permissions, updated_at');
    expect(await grid()).toEqual(narrowed);
  });

  it('invalid configuration never expands permissions: every corruption of a narrowed config grants a subset of it', async () => {
    world();
    push(NARROW);
    const allowed = new Set(await grid());
    for (const corrupt of [{ roles: 'x', permissions: NARROW.permissions }, { roles: NARROW.roles, permissions: 'x' }, { roles: NARROW.roles, permissions: { CREATE_USER: 'COMPANY_ADMIN' } }]) {
      world();
      push(NARROW);
      rows('rbac_config').push({ ...corrupt, updated_at: '2026-10-15T01:00:00.000Z' });
      clearRbacCache();
      for (const pair of await grid()) expect(allowed.has(pair)).toBe(true);
    }
  });

  it('failed write while the stored document is untrusted → 500; still deny-all; nothing widened', async () => {
    world();
    push({ roles: 'garbage', permissions: 'garbage' });
    mockFail.add('rbac_config:insert');
    const r = await invoke(rbacRoute as never, { method: 'POST', body: NARROW, headers: as(PSA) });
    expect(r.status).toBe(500);
    expect(await grid()).toEqual([]);
  });

  it('RECOVERY: with deny-all in force, the governed super-admin save (identity.admin + step-up, not hasPermission) restores a valid config at once', async () => {
    world();
    push({ roles: 'garbage', permissions: 'garbage' });
    expect(await grid()).toEqual([]);
    const r = await invoke(rbacRoute as never, { method: 'POST', body: NARROW, headers: as(PSA) });
    expect(r.status).toBe(200);
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true);
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(false);
  });

  it('recovery is still governed: a company admin cannot save while deny-all is in force (403)', async () => {
    world();
    push({ roles: 'garbage', permissions: 'garbage' });
    const r = await invoke(rbacRoute as never, { method: 'POST', body: NARROW, headers: as(CADMIN) });
    expect(r.status).toBe(403);
    expect(await grid()).toEqual([]);
  });
});

/**
 * Closure-015J — final privileged-membership and configuration review (R-4 … R-13).
 *
 *   R-4  super-admin/companies/archive-abandoned: no organization binding (a non-member platform
 *        SA was refused NOT_ORG_MEMBER); conditional archive (CONFLICT); count error fails closed.
 *   R-5  onboarding/setup-company no longer demotes the caller's SUPER_ADMIN memberships.
 *   R-6  free-credits grant / requests leave an existing SUPER_ADMIN membership untouched.
 *   R-7  transfer-ownership never demotes / overwrites a SUPER_ADMIN membership; demoteToRole is
 *        validated; promote + demote are conditional on the roles as read (CONFLICT).
 *   R-8  super-admin/users/create never rewrites a SUPER_ADMIN membership (pre-check + backstop).
 *   R-9  company deletion refuses while the company holds an ACTIVE SUPER_ADMIN membership.
 *   R-10 rate limits on five step-up mutation routes; the governed revoke reads back what it
 *        changed, fails truthfully, and writes a business audit row.
 *   R-11 RBAC config: a missing / malformed config is refused before any write; a malformed stored
 *        permission grants nobody.
 *   R-12 RBAC config: strictly increasing updated_at, deterministic tie resolution, and an in-flight
 *        load never re-caches the pre-save config.
 *   R-13 re-inviting never resets an ACTIVE member (company POST, super-admin POST, users/create);
 *        the re-invite of a non-active member is conditional (STALE_MEMBERSHIP).
 *
 * REAL: the routes, withIdempotency, withRBAC, requireCapability → IdentityResolver →
 * CapabilityService → step-up → platform write authority, orgOwnershipRecoveryService,
 * rbacService, the invite upserts, insertAuditLogStrict — over the routeAuthHarness tables.
 * FAKED (I/O only): identity provider + session (x-test-user), legacy bridge, security-audit sink,
 * admin rate limiter (switchable), invitation service, credit ledger, soft-delete cascade RPC,
 * auth-event log; and, for failure / race cases only, hooks on specific in-memory operations.
 * In-memory: not Postgres, not a real WebAuthn ceremony.
 */
import fs from 'fs';
import path from 'path';
import { seed, rows, calls, invoke, CO_A, USER_SUPER } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
/** Failure hooks: `${table}:${op}` (op = select:<cols> | update | delete | insert). */
const mockFail = new Set<string>();
/** Race hook: runs when a write on `table` is issued (between a read and its conditional write). */
const mockBeforeWrite: { fn: ((table: string, op: string) => void) | null } = { fn: null };
/** Read gate: the next matching select returns its rows as of query time, delivered when `gate` resolves. */
const mockHoldRead: { key: string | null; gate: Promise<void> | null } = { key: null, gate: null };
let mockRateLimited = false;
const mockRateLimitPrefixes: string[] = [];

function mockFailing(): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order', 'maybeSingle', 'single']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: 'forced failure' } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  failing.single = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  const origSelect = builder.select as (cols?: string, opts?: unknown) => Record<string, unknown>;
  builder.select = (cols?: string, opts?: unknown) => {
    if (mockFail.has(`${table}:select:${cols}`)) return mockFailing();
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
  // Closure-015M: models the DEPLOYED baseline disable_company_cascade on the harness rows
  // (status 'inactive'; every active membership deactivated) — archive-abandoned now uses it.
  cascadeDisableCompany: jest.fn(async (companyId: string) => {
    const h = require('../helpers/routeAuthHarness');
    for (const c of h.rows('companies')) if (c.id === companyId) c.status = 'inactive';
    for (const m of h.rows('user_company_roles')) if (m.company_id === companyId && m.status === 'active') m.status = 'inactive';
    return { affectedUsers: 0, revokedRoles: 0, revokedSessions: 0 };
  }),
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
describe('R-4 — archive-abandoned: target-company binding (F-5 pattern) and conditional archive', () => {
  const archive = (who: string, body: Record<string, unknown>) =>
    invoke(archiveRoute as never, { method: 'POST', body: { reason: 'abandoned tenant', ...body }, headers: as(who) });

  it('a platform SA who is NOT a member of the abandoned org archives it (was NOT_ORG_MEMBER)', async () => {
    world();
    const r = await archive(PSA, { orgId: ORPHAN });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, previousStatus: 'active', idempotent: false });
    expect(company(ORPHAN)).toMatchObject({ status: 'inactive' }); // Closure-015M (R-15): archive = disable
    expect(denialsFor('organization.delete')).toHaveLength(0);
  });

  it('a platform SA who IS an active member: not abandoned → 409 NOT_ABANDONED; with force → archived', async () => {
    world();
    const r1 = await archive(PSA, { orgId: SA_HOME });
    expect(r1.status).toBe(409);
    expect(r1.body).toMatchObject({ code: 'NOT_ABANDONED' });
    expect(company(SA_HOME)).toMatchObject({ status: 'active' });
    const r2 = await archive(PSA, { orgId: SA_HOME, force: true });
    expect(r2.status).toBe(200);
    expect(company(SA_HOME)).toMatchObject({ status: 'inactive' });
    expect(mem(PSA, SA_HOME)).toMatchObject({ status: 'inactive' }); // force: the cascade deactivates members
  });

  it('cross-tenant: a company admin (of another org) cannot archive → 403; unchanged; no write', async () => {
    world();
    const r = await archive(CADMIN, { orgId: ORPHAN });
    expect(r.status).toBe(403);
    expect(company(ORPHAN)).toMatchObject({ status: 'active' });
    expect(calls().filter((c) => c.table === 'companies' && c.op === 'update')).toHaveLength(0);
  });

  it('unauthenticated → 401; an SA without step-up → refused; unchanged', async () => {
    world();
    expect((await invoke(archiveRoute as never, { method: 'POST', body: { orgId: ORPHAN, reason: 'x' }, headers: {} })).status).toBe(401);
    const r = await archive(PSA_NOSTEP, { orgId: ORPHAN });
    expect([401, 403]).toContain(r.status);
    expect(company(ORPHAN)).toMatchObject({ status: 'active' });
  });

  it('missing org → 404 NO_ORG; already archived → 200 idempotent (no write)', async () => {
    world();
    const r = await archive(PSA, { orgId: 'co-missing' });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'NO_ORG' });
    company(ORPHAN)!.status = 'inactive'; // Closure-015M: an archived org is a disabled ('inactive') one
    const r2 = await archive(PSA, { orgId: ORPHAN });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ idempotent: true });
    expect(calls().filter((c) => c.table === 'companies' && c.op === 'update')).toHaveLength(0);
  });

  // Closure-015M (R-15): the 015J status compare-and-set is replaced by the atomic disable RPC
  // (its concurrency boundary is the database guard, proposal 01). What the route guards itself:
  it('an ACTIVE SUPER_ADMIN membership refuses the archive, force included → 409 SUPER_ADMIN_MEMBERSHIP; nothing changed', async () => {
    world();
    rows('user_company_roles').push({ id: 'o-sa', user_id: SA_IN_A, company_id: ORPHAN, role: 'SUPER_ADMIN', status: 'active' });
    const r = await archive(PSA, { orgId: ORPHAN, force: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SUPER_ADMIN_MEMBERSHIP' });
    expect(company(ORPHAN)).toMatchObject({ status: 'active' });
    expect(rows('user_company_roles').find((m) => m.id === 'o-sa')).toMatchObject({ status: 'active' });
  });

  it('a failed active-member count is NOT zero members → 500 DB_ERROR; nothing archived', async () => {
    world();
    mockFail.add('user_company_roles:select:user_id');
    const r = await archive(PSA, { orgId: CO_A });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'DB_ERROR' });
    expect(company(CO_A)).toMatchObject({ status: 'active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-7 — transfer-ownership never removes or overwrites SUPER_ADMIN authority', () => {
  const transfer = (body: Record<string, unknown>) =>
    invoke(transferRoute as never, { method: 'POST', body: { orgId: CO_A, reason: 'owner left', ...body }, headers: as(PSA) });

  it('from-user is a SUPER_ADMIN → 409 SUPER_ADMIN_MEMBERSHIP; nothing changed', async () => {
    world();
    const r = await transfer({ fromUserId: SA_IN_A, toUserId: TARGET });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'SUPER_ADMIN_MEMBERSHIP' });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('to-user is a SUPER_ADMIN → 409 (the promote would have overwritten SUPER_ADMIN with COMPANY_ADMIN)', async () => {
    world();
    const r = await transfer({ fromUserId: CADMIN, toUserId: SA_IN_A });
    expect(r.status).toBe(409);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(mem(CADMIN)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it.each(['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'OWNER'])('demoteToRole %j → 400 INVALID_DEMOTE_ROLE; nothing changed', async (demoteToRole) => {
    world();
    const r = await transfer({ fromUserId: CADMIN, toUserId: TARGET, demoteToRole });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_DEMOTE_ROLE' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('legitimate transfer still works (demoteToRole is case-normalized)', async () => {
    world();
    const r = await transfer({ fromUserId: CADMIN, toUserId: TARGET, demoteToRole: 'view_only' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, demotedFromRole: 'COMPANY_ADMIN', promotedToRole: 'COMPANY_ADMIN' });
    expect(mem(TARGET)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(mem(CADMIN)).toMatchObject({ role: 'VIEW_ONLY' });
  });

  it('concurrency: the to-user is promoted to SUPER_ADMIN before the promote → 409 CONFLICT; nothing overwritten', async () => {
    world();
    let fired = false;
    mockBeforeWrite.fn = (table, op) => { if (!fired && table === 'user_company_roles' && op === 'update') { fired = true; mem(TARGET)!.role = 'SUPER_ADMIN'; } };
    const r = await transfer({ fromUserId: CADMIN, toUserId: TARGET });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'CONFLICT' });
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(mem(CADMIN)).toMatchObject({ role: 'COMPANY_ADMIN' });
  });

  it('concurrency: the from-user is promoted to SUPER_ADMIN before the demote → 409 CONFLICT; SUPER_ADMIN kept (safe two-admin state)', async () => {
    world();
    let n = 0;
    mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update' && ++n === 2) mem(CADMIN)!.role = 'SUPER_ADMIN'; };
    const r = await transfer({ fromUserId: CADMIN, toUserId: TARGET });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'CONFLICT' });
    expect(mem(CADMIN)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(mem(TARGET)).toMatchObject({ role: 'COMPANY_ADMIN' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-8 — users/create never rewrites a SUPER_ADMIN membership', () => {
  const create = (body: Record<string, unknown>) =>
    invoke(usersCreateRoute as never, { method: 'POST', body: { companyId: CO_A, allowPersonalEmail: true, sendInvite: false, ...body }, headers: as(PSA) });

  it.each(['active', 'invited', 'inactive', 'expired'])('existing SUPER_ADMIN row (%s) → 403 before any side effect', async (status) => {
    world(undefined, { status });
    const r = await create({ email: 'sa-in-a@example.test', role: 'COMPANY_ADMIN' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status });
    expect(membershipWrites()).toHaveLength(0);
    expect(calls().filter((c) => c.table === 'users' && c.op !== 'select')).toHaveLength(0);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it('lookup failure → 503 MEMBERSHIP_LOOKUP_FAILED; nothing written', async () => {
    world();
    mockFail.add('users:select:id');
    const r = await create({ email: 'sa-in-a@example.test', role: 'COMPANY_ADMIN' });
    expect(r.status).toBe(503);
    expect(membershipWrites()).toHaveLength(0);
  });

  it('backstop: upsertCompanyRole refuses a SUPER_ADMIN row (a race past the pre-check)', async () => {
    world();
    const r = await upsertCompanyRole({ userId: SA_IN_A, companyId: CO_A, role: 'VIEW_ONLY', status: 'invited' });
    expect(r).toEqual({ ok: false, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-9 — company deletion keeps SUPER_ADMIN authority (revoke first)', () => {
  const del = (body: Record<string, unknown>) => invoke(companiesRoute as never, { method: 'DELETE', body, headers: as(PSA) });

  it.each([[false], [true]])('company holding an ACTIVE SUPER_ADMIN membership (hard=%s) → 409; nothing deleted', async (hard) => {
    world();
    const r = await del({ companyId: CO_A, hard });
    expect(r.status).toBe(409);
    // SA_IN_A + the harness base world's USER_SUPER (an active SUPER_ADMIN row in CO_A)
    expect(r.body).toMatchObject({ error: 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP', count: 2 });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(calls().filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('the platform SA home company is protected the same way', async () => {
    world();
    expect((await del({ companyId: P })).status).toBe(409);
    expect(mem(PSA, P)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('an inactive / invited SUPER_ADMIN row confers nothing and does not block the (soft) delete', async () => {
    world(undefined, { status: 'inactive' });
    mem(USER_SUPER)!.status = 'invited';
    const r = await del({ companyId: CO_A });
    expect(r.status).toBe(200);
    expect(mockSoftDelete).toHaveBeenCalledTimes(1);
  });

  it('a company without SUPER_ADMIN memberships is still deletable (hard)', async () => {
    world();
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'hard' });
  });

  it('lookup failure → 503; nothing deleted', async () => {
    world();
    mockFail.add('user_company_roles:select:user_id, role, status');
    const r = await del({ companyId: ORPHAN, hard: true });
    expect(r.status).toBe(503);
    expect(calls().filter((c) => c.op === 'delete')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-5 / R-6 — onboarding and free credits no longer demote SUPER_ADMIN memberships', () => {
  const grant = (body: Record<string, unknown>) => invoke(freeCreditGrantRoute as never, {
    method: 'POST', body: { organizationId: CO_A, creditsAmount: 10, reason: 'goodwill', ...body }, headers: as(PSA),
  });

  it('R-6 grant tagging a SUPER_ADMIN user: credit applied, the SUPER_ADMIN membership untouched', async () => {
    world();
    const r = await grant({ userId: SA_IN_A });
    expect(r.status).toBe(200);
    expect(mockCreateCredit).toHaveBeenCalledTimes(1);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('R-6 grant tagging a user with no membership still inserts an active COMPANY_ADMIN row (unchanged)', async () => {
    world();
    const r = await grant({ userId: 'u-newcomer' });
    expect(r.status).toBe(200);
    expect(mem('u-newcomer')).toMatchObject({ role: 'COMPANY_ADMIN', status: 'active' });
  });

  it('R-6 / R-5 source: no SUPER_ADMIN → COMPANY_ADMIN demotion remains in grant, requests or onboarding', () => {
    const root = path.resolve(__dirname, '../../..');
    const demote = /\.update\(\s*\{\s*role:\s*'COMPANY_ADMIN'[\s\S]{0,200}?\.eq\('role',\s*'SUPER_ADMIN'\)/;
    for (const f of ['pages/api/super-admin/free-credits/grant.ts', 'pages/api/super-admin/free-credits/requests.ts', 'pages/api/onboarding/setup-company.ts']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(demote);
      expect(src).not.toMatch(/existingRole\.role === 'SUPER_ADMIN'/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-10 — rate limits before authorization; governed revoke audit and truthful failure', () => {
  const RATE_LIMITED: ReadonlyArray<readonly [string, unknown, string, string, Record<string, unknown>, Record<string, unknown>]> = [
    ['users/[userId]/role', userRoleRoute, 'PATCH', 'rl:users:role', { userId: TARGET }, { companyId: CO_A, role: 'VIEW_ONLY' }],
    ['users/[userId] DELETE', userRemoveRoute, 'DELETE', 'rl:users:remove', { userId: TARGET }, { companyId: CO_A }],
    ['company/users/[userId]/role', companyUserRoleRoute, 'PATCH', 'rl:company:users:role', { userId: TARGET, companyId: CO_A }, { companyId: CO_A, role: 'VIEW_ONLY' }],
    ['governance/unlock', unlockRoute, 'POST', 'rl:governance:unlock', { companyId: P }, { companyId: P }],
    ['governance/restore-snapshot', restoreSnapshotRoute, 'POST', 'rl:governance:restore-snapshot', { companyId: P }, { companyId: P, snapshotId: 's1' }],
  ];

  it.each(RATE_LIMITED)('%s: rate-limited → 429 before the capability / step-up decision; no write', async (_n, route, method, prefix, query, body) => {
    world();
    mockRateLimited = true;
    const r = await invoke(route as never, { method, query, body, headers: as(PSA) });
    expect(r.status).toBe(429);
    expect(mockRateLimitPrefixes).toContain(prefix);
    expect(mockSecurityAudit.filter((e) => e.decision === 'allowed')).toHaveLength(0);
    expect(calls().filter((c) => ['insert', 'update', 'delete', 'upsert'].includes(c.op) && c.table !== 'api_idempotency_keys')).toHaveLength(0);
  });

  const revoke = (who: string, userId: string) => invoke(revokeRoute as never, { method: 'POST', body: { userId }, headers: as(who) });

  it('revoke: downgrades, reads back what changed and writes a business audit row (actor + memberships)', async () => {
    world();
    const r = await revoke(PSA, SA_IN_A);
    expect(r.status).toBe(200);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({
      action: 'SUPER_ADMIN_REVOKE', actor_user_id: PSA, target_user_id: SA_IN_A,
      metadata: expect.objectContaining({ downgraded_memberships: [CO_A], downgraded_count: 1 }),
    }));
  });

  it('revoke duplicate: the second call changes nothing (downgraded_count 0) — idempotent effect, not exactly-once audit', async () => {
    world();
    expect((await revoke(PSA, SA_IN_A)).status).toBe(200);
    expect((await revoke(PSA, SA_IN_A)).status).toBe(200);
    const audits = rows('audit_logs').filter((a) => a.action === 'SUPER_ADMIN_REVOKE');
    expect(audits.map((a) => (a.metadata as { downgraded_count: number }).downgraded_count)).toEqual([1, 0]);
  });

  it('revoke: audit failure is reported truthfully (500 REVOKED_AUDIT_FAILED, revoked: true) — the revocation stands', async () => {
    world();
    mockFail.add('audit_logs:insert');
    const r = await revoke(PSA, SA_IN_A);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'REVOKED_AUDIT_FAILED', revoked: true, downgraded_count: 1 });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'COMPANY_ADMIN' });
  });

  it('revoke: membership downgrade failure → 500 MEMBERSHIP_DOWNGRADE_FAILED (partial, step 1 completed); no success audit', async () => {
    world();
    mockFail.add('user_company_roles:update');
    const r = await revoke(PSA, SA_IN_A);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'MEMBERSHIP_DOWNGRADE_FAILED', partial: true, completed: ['users_role_downgraded'] });
    expect(rows('audit_logs').filter((a) => a.action === 'SUPER_ADMIN_REVOKE')).toHaveLength(0);
  });

  it('revoke: authorization failure (company admin) → 403; nothing changed, no audit row', async () => {
    world();
    const r = await revoke(CADMIN, SA_IN_A);
    expect(r.status).toBe(403);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(rows('audit_logs').filter((a) => a.action === 'SUPER_ADMIN_REVOKE')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-11 — an incomplete / malformed RBAC config is refused before any write', () => {
  const FULL = {
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'CONTENT_CREATOR', 'VIEW_ONLY'],
    permissions: { ASSIGN_ROLE: ['SUPER_ADMIN', 'COMPANY_ADMIN'], CREATE_USER: ['SUPER_ADMIN', 'COMPANY_ADMIN'], VIEW_DASHBOARD: ['*'] },
  };
  const post = (body: unknown, who = PSA) => invoke(rbacRoute as never, { method: 'POST', body, headers: as(who) });

  it.each<[string, Record<string, unknown>, string]>([
    ['roles missing', { permissions: FULL.permissions }, 'RBAC_ROLES_REQUIRED'],
    ['roles empty', { roles: [], permissions: FULL.permissions }, 'RBAC_ROLES_REQUIRED'],
    ['roles not an array', { roles: 'COMPANY_ADMIN', permissions: FULL.permissions }, 'RBAC_ROLES_REQUIRED'],
    ['roles with an unknown role', { roles: [...FULL.roles, 'ROOT'], permissions: FULL.permissions }, 'RBAC_ROLE_UNKNOWN'],
    ['roles with a non-string', { roles: [...FULL.roles, 5], permissions: FULL.permissions }, 'RBAC_ROLE_UNKNOWN'],
    ['permissions an array', { roles: FULL.roles, permissions: [] }, 'RBAC_PERMISSIONS_REQUIRED'],
    ['permissions empty', { roles: FULL.roles, permissions: {} }, 'RBAC_PERMISSIONS_REQUIRED'],
    ['a scalar permission value', { roles: FULL.roles, permissions: { ASSIGN_ROLE: 'COMPANY_ADMIN' } }, 'RBAC_PERMISSION_VALUE_INVALID'],
    ['a null permission value', { roles: FULL.roles, permissions: { ASSIGN_ROLE: null } }, 'RBAC_PERMISSION_VALUE_INVALID'],
    ['a non-string role in a value', { roles: FULL.roles, permissions: { ASSIGN_ROLE: [1] } }, 'RBAC_PERMISSION_VALUE_INVALID'],
    ['a blank permission key', { roles: FULL.roles, permissions: { '   ': ['COMPANY_ADMIN'] } }, 'RBAC_PERMISSION_KEY_INVALID'],
    ['duplicate keys after normalization', { roles: FULL.roles, permissions: { 'view team': ['COMPANY_ADMIN'], VIEW_TEAM: [] } }, 'RBAC_PERMISSION_KEY_DUPLICATE'],
    ['a value naming an undeclared role', { roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], permissions: { VIEW_DASHBOARD: ['VIEW_ONLY'] } }, 'RBAC_PERMISSION_ROLE_NOT_DECLARED'],
  ])('%s → 400 %s; nothing stored; the previous config stays effective', async (_d, body, code) => {
    world();
    expect((await post(FULL)).status).toBe(200);
    const before = rows('rbac_config').length;
    const r = await post(body);
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
    expect(rows('rbac_config')).toHaveLength(before);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
  });

  it('THE FOOTGUN CLOSED: omitting roles no longer strips every tenant role (was: roles → [SUPER_ADMIN])', async () => {
    world();
    expect((await post(FULL)).status).toBe(200);
    expect((await post({ permissions: { ...FULL.permissions, VIEW_DASHBOARD: ['COMPANY_ADMIN', 'VIEW_ONLY'] } })).status).toBe(400);
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true);
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(true);
  });

  it('the H-4 wildcard refusal keeps precedence and its exact response', async () => {
    world();
    const r = await post({ roles: [], permissions: { ASSIGN_ROLE: ['*'] } });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'RBAC_WILDCARD_NOT_ALLOWED', permission: 'ASSIGN_ROLE' });
  });

  it('a valid full config is stored and effective at once; an explicit [] grants nobody', async () => {
    world();
    const r = await post({ ...FULL, permissions: { ...FULL.permissions, MANAGE_EXTERNAL_APIS: [] } });
    expect(r.status).toBe(200);
    expect(rows('rbac_config')).toHaveLength(1);
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true);
    expect(await hasPermission('COMPANY_ADMIN', 'MANAGE_EXTERNAL_APIS')).toBe(false);
  });

  it('persistence failure → 500; nothing stored; the cached effective config is not replaced', async () => {
    world();
    expect((await post(FULL)).status).toBe(200);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
    mockFail.add('rbac_config:insert');
    const r = await post({ ...FULL, permissions: { ASSIGN_ROLE: ['SUPER_ADMIN'] } });
    expect(r.status).toBe(500);
    expect(rows('rbac_config')).toHaveLength(1);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
  });

  it('the pre-save ordering read fails → the save fails closed (500); nothing stored', async () => {
    world();
    mockFail.add('rbac_config:select:updated_at');
    const r = await post(FULL);
    expect(r.status).toBe(500);
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('authorization failure (company admin) → 403 before validation; nothing stored', async () => {
    world();
    const r = await post({ roles: [] }, CADMIN);
    expect(r.status).toBe(403);
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('a malformed STORED permission value grants nobody (fail closed); valid entries of the same row still apply', async () => {
    world();
    rows('rbac_config').push({ roles: FULL.roles, permissions: { ASSIGN_ROLE: 'COMPANY_ADMIN', CREATE_USER: [7], VIEW_DASHBOARD: ['VIEW_ONLY'] }, updated_at: '2026-10-15T00:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(false);
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true);
  });

  it('validateRbacConfigInput is the single write gate (direct callers get RbacConfigValidationError)', async () => {
    world();
    expect(() => validateRbacConfigInput({ roles: undefined, permissions: FULL.permissions })).toThrow(RbacConfigValidationError);
    await expect(saveRbacConfig({ roles: [], permissions: FULL.permissions })).rejects.toBeInstanceOf(RbacConfigValidationError);
    expect(rows('rbac_config')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-12 — RBAC config ordering and cache coherence', () => {
  const cfg = (assign: string[]) => ({
    roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'],
    permissions: { ASSIGN_ROLE: assign, VIEW_DASHBOARD: ['*'] },
  });

  it('two saves in the same millisecond: strictly increasing updated_at; the later save is the latest', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-15T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world();
    await saveRbacConfig(cfg(['COMPANY_ADMIN']));
    await saveRbacConfig(cfg(['COMPANY_ADMIN', 'VIEW_ONLY']));
    const stamps = rows('rbac_config').map((r) => Date.parse(String(r.updated_at)));
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    clearRbacCache();
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
  });

  it('a newer row from another instance (or clock skew): the next save is issued after it and wins', async () => {
    world();
    rows('rbac_config').push({ ...cfg(['COMPANY_ADMIN', 'VIEW_ONLY']), updated_at: '2099-01-01T00:00:00.000Z' });
    await saveRbacConfig(cfg(['COMPANY_ADMIN']));
    expect(String(rows('rbac_config')[1].updated_at) > '2099-01-01T00:00:00.000Z').toBe(true);
    clearRbacCache();
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });

  it('a stored tie (two instances, same millisecond) resolves to the SAME row whatever the database row order', async () => {
    const T = '2026-10-15T10:00:00.000Z';
    const a = { ...cfg(['COMPANY_ADMIN']), updated_at: T };
    const b = { ...cfg(['COMPANY_ADMIN', 'VIEW_ONLY']), updated_at: T };
    const results: boolean[] = [];
    for (const order of [[a, b], [b, a]]) {
      world();
      rows('rbac_config').push(...order.map((r) => ({ ...r })));
      clearRbacCache();
      results.push(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE'));
    }
    expect(results[0]).toBe(results[1]);
  });

  it('out-of-order completion: a load in flight during a save never re-caches the pre-save config', async () => {
    world();
    await saveRbacConfig(cfg(['COMPANY_ADMIN', 'VIEW_ONLY']));
    clearRbacCache();
    let open!: () => void;
    mockHoldRead.key = 'rbac_config:roles, permissions, updated_at';
    mockHoldRead.gate = new Promise<void>((r) => { open = r; });
    const inFlight = getRbacConfig();                       // reads the OLD row, delivery held
    await new Promise((r) => setImmediate(r));
    await saveRbacConfig(cfg(['COMPANY_ADMIN']));          // narrows; clears the cache
    open();
    const stale = await inFlight;
    expect(stale.permissions.ASSIGN_ROLE).toContain('VIEW_ONLY'); // its own (older) snapshot …
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false); // … but not cached
  });

  it('cache: a save in this process takes effect immediately; latest retrieval returns the saved config', async () => {
    world();
    await saveRbacConfig(cfg(['COMPANY_ADMIN', 'VIEW_ONLY']));
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
    await saveRbacConfig(cfg(['COMPANY_ADMIN']));
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
    expect((await getRbacConfig()).permissions.ASSIGN_ROLE).toEqual(['COMPANY_ADMIN']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-13 — re-inviting never resets an ACTIVE member', () => {
  const companyInvite = (role = 'VIEW_ONLY') => invoke(companyUsersRoute as never, {
    method: 'POST', query: { companyId: CO_A }, body: { companyId: CO_A, email: 'target@example.test', role }, headers: as(CADMIN),
  });
  const saInvite = (role = 'VIEW_ONLY') => invoke(superAdminUsersRoute as never, {
    method: 'POST', body: { companyId: CO_A, email: 'target@example.test', role }, headers: as(PSA),
  });

  describe.each([['company POST /api/company/users', companyInvite], ['super-admin POST /api/super-admin/users', saInvite]])('%s', (_n, invite) => {
    it('active member → 409 ALREADY_ACTIVE_MEMBER; row unchanged (status, role, accepted_at); no invitation', async () => {
      world();
      const r = await invite();
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'ALREADY_ACTIVE_MEMBER' });
      expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active', accepted_at: '2026-01-01T00:00:00.000Z' });
      expect(membershipWrites()).toHaveLength(0);
      expect(mockCreateInvitation).not.toHaveBeenCalled();
    });

    it.each(['invited', 'expired', 'inactive'])('%s member → re-invited (status invited, new role) with one invitation', async (status) => {
      world({ role: 'CONTENT_CREATOR', status });
      const r = await invite();
      expect(r.status).toBe(201);
      expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY', status: 'invited' });
      expect(mockCreateInvitation).toHaveBeenCalledTimes(1);
    });

    it('retry of a re-invite (fresh key) re-sends; the membership stays invited', async () => {
      world({ role: 'CONTENT_CREATOR', status: 'invited' });
      expect((await invite()).status).toBe(201);
      expect((await invite()).status).toBe(201);
      expect(mem(TARGET)).toMatchObject({ status: 'invited' });
      expect(mockCreateInvitation).toHaveBeenCalledTimes(2);
    });

    it('concurrency: the member is activated between the read and the re-invite → 409 STALE_MEMBERSHIP; stays active', async () => {
      world({ role: 'CONTENT_CREATOR', status: 'invited' });
      mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update') mem(TARGET)!.status = 'active'; };
      const r = await invite();
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
      expect(mem(TARGET)).toMatchObject({ status: 'active', role: 'CONTENT_CREATOR' });
      expect(mockCreateInvitation).not.toHaveBeenCalled();
    });

    it('an active row next to a stale non-active row → 409; neither row changed', async () => {
      world();
      rows('user_company_roles').unshift({ id: 'r-target-old', user_id: TARGET, company_id: CO_A, role: 'VIEW_ONLY', status: 'expired' });
      const r = await invite();
      expect(r.status).toBe(409);
      expect(rows('user_company_roles').find((m) => m.id === 'r-target-old')).toMatchObject({ status: 'expired' });
      expect(rows('user_company_roles').find((m) => m.id === 'r-target')).toMatchObject({ status: 'active' });
    });
  });

  describe('company reinvite POST /api/company/users/reinvite', () => {
    const reinvite = () => invoke(reinviteRoute as never, { method: 'POST', body: { email: 'target@example.test', companyId: CO_A }, headers: as(CADMIN) });
    const invitations = () => rows('invitations').filter((i) => i.email === 'target@example.test');

    it('active member → 409 ALREADY_ACTIVE_MEMBER; membership kept (was: deleted + re-inserted invited); no invitation, no email', async () => {
      world();
      const r = await reinvite();
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'ALREADY_ACTIVE_MEMBER' });
      expect(rows('user_company_roles').find((m) => m.id === 'r-target')).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
      expect(membershipWrites()).toHaveLength(0);
      expect(invitations()).toHaveLength(0);
      expect(mockSendInvite).not.toHaveBeenCalled();
    });

    it.each(['invited', 'expired', 'inactive'])('%s member → reinvited (role kept, status invited, one email)', async (status) => {
      world({ role: 'CONTENT_REVIEWER', status });
      const r = await reinvite();
      expect(r.status).toBe(200);
      expect(rows('user_company_roles').filter((m) => m.user_id === TARGET && m.company_id === CO_A)).toEqual([expect.objectContaining({ role: 'CONTENT_REVIEWER', status: 'invited' })]);
      expect(mockSendInvite).toHaveBeenCalledTimes(1);
    });

    it('retry: a second reinvite of an invited member succeeds again (one invited row; earlier invitation revoked)', async () => {
      world({ role: 'CONTENT_CREATOR', status: 'invited' });
      expect((await reinvite()).status).toBe(200);
      expect((await reinvite()).status).toBe(200);
      expect(rows('user_company_roles').filter((m) => m.user_id === TARGET && m.company_id === CO_A)).toHaveLength(1);
      expect(invitations().filter((i) => !i.revoked_at)).toHaveLength(1);
    });

    it('concurrency: the member is activated between the read and the delete → 409 STALE_MEMBERSHIP; the active row survives; no invitation', async () => {
      world({ role: 'CONTENT_CREATOR', status: 'invited' });
      mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'delete') rows('user_company_roles').find((m) => m.id === 'r-target')!.status = 'active'; };
      const r = await reinvite();
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
      expect(rows('user_company_roles').find((m) => m.id === 'r-target')).toMatchObject({ status: 'active' });
      expect(invitations()).toHaveLength(0);
      expect(mockSendInvite).not.toHaveBeenCalled();
    });

    it('an active row next to a stale non-active row → 409; neither row changed', async () => {
      world();
      rows('user_company_roles').unshift({ id: 'r-target-old', user_id: TARGET, company_id: CO_A, role: 'VIEW_ONLY', status: 'expired' });
      expect((await reinvite()).status).toBe(409);
      expect(rows('user_company_roles').filter((m) => m.user_id === TARGET && m.company_id === CO_A)).toHaveLength(2);
    });
  });

  it('users/create: an ACTIVE member with a different role → 409 before any side effect', async () => {
    world();
    const r = await invoke(usersCreateRoute as never, {
      method: 'POST', body: { companyId: CO_A, email: 'target@example.test', role: 'VIEW_ONLY', allowPersonalEmail: true, sendInvite: false }, headers: as(PSA),
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'ALREADY_ACTIVE_MEMBER' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
    expect(membershipWrites()).toHaveLength(0);
    expect(calls().filter((c) => c.table === 'users' && c.op !== 'select')).toHaveLength(0);
  });

  it('users/create upsert: active same role = documented no-op; active other role refused; non-active re-invited; race → STALE', async () => {
    world();
    expect(await upsertCompanyRole({ userId: TARGET, companyId: CO_A, role: 'CONTENT_CREATOR', status: 'invited' }))
      .toEqual({ ok: true, created: false, previousRole: 'CONTENT_CREATOR', previousStatus: 'active' });
    expect(await upsertCompanyRole({ userId: TARGET, companyId: CO_A, role: 'VIEW_ONLY', status: 'invited' }))
      .toEqual({ ok: false, error: 'ALREADY_ACTIVE_MEMBER' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });

    world({ role: 'CONTENT_CREATOR', status: 'inactive' });
    expect(await upsertCompanyRole({ userId: TARGET, companyId: CO_A, role: 'VIEW_ONLY', status: 'invited' }))
      .toMatchObject({ ok: true, previousStatus: 'inactive' });
    expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY', status: 'invited' });

    world({ role: 'CONTENT_CREATOR', status: 'invited' });
    mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update') mem(TARGET)!.status = 'active'; };
    expect(await upsertCompanyRole({ userId: TARGET, companyId: CO_A, role: 'VIEW_ONLY', status: 'invited' }))
      .toEqual({ ok: false, error: 'STALE_MEMBERSHIP' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
  });
});

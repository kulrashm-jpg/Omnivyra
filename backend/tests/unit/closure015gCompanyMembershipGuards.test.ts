/**
 * Closure-015G — /api/company/users PUT and DELETE never mutate a SUPER_ADMIN
 * membership (Closure-015F finding F-1).
 *
 * Before: requireCompanyContext + ensureCompanyAdminAccess + ASSIGN_ROLE — held
 * by an active COMPANY_ADMIN of the company (and the active platform SA) — then
 * an UNCONDITIONAL update (role, arbitrary status) or delete of the target's
 * membership, keyed only by (user_id, company_id). A company admin of X could
 * demote, deactivate or delete a SUPER_ADMIN row that resides in X — revoking
 * platform authority if it was the user's only active SA row — and a missing
 * membership answered 200.
 *
 * After: the target membership is read first (id, role, status). A SUPER_ADMIN
 * row in ANY status is refused (403, audited) whoever calls — this is a
 * company-scoped route; platform authority stays on identity.admin.assign /
 * identity.admin.revoke with step-up. The write is conditional on the snapshot
 * (PUT: id + role + status; DELETE: id + role) → 409 on a concurrent change.
 * Missing → 404, lookup failure → 503; nothing partially changed.
 *
 * REAL: the route, withIdempotency, requireCompanyContext → enforceCompanyAccess
 * (TenantGuard), ensureCompanyAdminAccess → isSuperAdmin / getUserRole /
 * hasPermission (default RBAC config), readTargetMembership, insertAuditLog; the
 * governed admin/revoke-super-admin route via requireCapability → IdentityResolver
 * → CapabilityService → step-up — all over the routeAuthHarness in-memory tables.
 * FAKED (I/O only): identity provider + session (x-test-user), legacy bridge,
 * security-audit sink, admin rate limiter; and — for race / write-failure cases
 * only — a hook on the in-memory builder between the route's read and its write.
 * In-memory: not Postgres, not a real WebAuthn ceremony.
 */
import { seed, rows, calls, invoke, failTable, CO_A, CO_B } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
const mockHooks: { beforeWrite: ((op: 'update' | 'delete') => void) | null; failWrite: 'update' | 'delete' | null; failSelect: string | null } = { beforeWrite: null, failWrite: null, failSelect: null };

function mockFailing(): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'forced failure' } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  if (table !== 'user_company_roles') return builder;
  // Fail ONLY a select with exactly these columns (the route's target read), not the access guards' reads.
  const origSelect = builder.select as (cols?: string) => Record<string, unknown>;
  builder.select = (cols?: string) => (mockHooks.failSelect !== null && cols === mockHooks.failSelect ? mockFailing() : origSelect(cols));
  for (const op of ['update', 'delete'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockHooks.beforeWrite) mockHooks.beforeWrite(op);
      const next = orig(p);
      if (mockHooks.failWrite === op) {
        const failing: Record<string, unknown> = {};
        const chain = () => failing;
        for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order']) failing[m] = chain;
        failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'forced write failure' } }).then(ok);
        return failing;
      }
      return next;
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  const wrapped = { ...fake, from: (t: string) => mockWrap(fake.from(t), t) };
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
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import companyUsersRoute from '../../../pages/api/company/users';
import revokeSuperAdminRoute from '../../../pages/api/admin/revoke-super-admin';
import { IDENTITY_ADMIN_REVOKE } from '../../../shared/contracts/security';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const CADMIN = 'u-cadmin';        // active COMPANY_ADMIN of CO_A (passkey + trusted device, irrelevant here)
const BADMIN = 'u-badmin';        // active COMPANY_ADMIN of CO_B
const VIEWER = 'u-viewer';        // active VIEW_ONLY of CO_A
const PSA = 'u-psa';              // active platform SA (row in P), passkey step-up, trusted device
const PSA_NOSTEP = 'u-psa-nostep';// active platform SA, no step-up
const SA = 'u-sa-in-a';           // the SUPER_ADMIN whose membership row resides in tenant CO_A
const MEMBER = 'u-member';        // ordinary member of CO_A (also a member of CO_B)
const B_ONLY = 'u-b-only';        // member of CO_B only

function world(saRow: { role?: string; status?: string } | null = { role: 'SUPER_ADMIN', status: 'active' }) {
  seed({
    user_company_roles: [
      { id: 'r-cadmin', user_id: CADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-badmin', user_id: BADMIN, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-viewer', user_id: VIEWER, company_id: CO_A, role: 'VIEW_ONLY', status: 'active' },
      { id: 'r-psa', user_id: PSA, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-psa-n', user_id: PSA_NOSTEP, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      ...(saRow ? [{ id: 'r-sa-a', user_id: SA, company_id: CO_A, role: 'SUPER_ADMIN', status: 'active', ...saRow }] : []),
      { id: 'r-member-a', user_id: MEMBER, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
      { id: 'r-member-b', user_id: MEMBER, company_id: CO_B, role: 'CONTENT_REVIEWER', status: 'active' },
      { id: 'r-bonly', user_id: B_ONLY, company_id: CO_B, role: 'CONTENT_CREATOR', status: 'active' },
    ],
    users: [{ id: SA, role: 'SUPER_ADMIN', email: 'sa@example.test' }],
    stepup_sessions: [{ id: 'su-psa', user_id: PSA, auth_session_id: `sess-${PSA}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }],
    trusted_devices: [PSA, PSA_NOSTEP].map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null })),
    audit_logs: [],
    api_idempotency_keys: [],
  });
}
let keySeq = 0;
const send = (method: 'PUT' | 'DELETE', who: string | null, body: Record<string, unknown>, companyId = CO_A) =>
  invoke(companyUsersRoute as never, {
    method,
    query: { companyId },
    body: { companyId, ...body },
    headers: { ...(who ? { 'x-test-user': who } : {}), 'idempotency-key': `c15g-${++keySeq}` },
  });
const put = (who: string | null, body: Record<string, unknown>, companyId = CO_A) => send('PUT', who, body, companyId);
const del = (who: string | null, userId: string, companyId = CO_A) => send('DELETE', who, { userId }, companyId);
const mem = (userId: string, companyId = CO_A) => rows('user_company_roles').find((r) => r.user_id === userId && r.company_id === companyId);
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && (c.op === 'update' || c.op === 'delete'));
const deniedAudits = () => rows('audit_logs').filter((a) => a.action === 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED');

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockHooks.beforeWrite = null;
  mockHooks.failWrite = null;
  mockHooks.failSelect = null;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const SA_STATES: Array<[string, { role?: string; status?: string }]> = [
  ['active', { status: 'active' }],
  ['invited', { status: 'invited' }],
  ['inactive (revoked by deactivation)', { status: 'inactive' }],
  ['expired', { status: 'expired' }],
  ['active, legacy lower-case role spelling', { role: 'super_admin', status: 'active' }],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT — a company admin never demotes, deactivates or otherwise changes a SUPER_ADMIN membership', () => {
  it.each(SA_STATES)('%s SUPER_ADMIN row: demote (role CONTENT_CREATOR) → 403, unchanged, no membership write, audited denial', async (_d, sa) => {
    world(sa);
    const before = { ...mem(SA) };
    const r = await put(CADMIN, { userId: SA, role: 'CONTENT_CREATOR' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA)).toEqual(before);
    expect(membershipWrites()).toHaveLength(0);
    expect(deniedAudits()).toEqual([expect.objectContaining({ actor_user_id: CADMIN, target_user_id: SA, company_id: CO_A })]);
  });

  it.each(SA_STATES)('%s SUPER_ADMIN row: deactivate (status inactive) → 403, unchanged', async (_d, sa) => {
    world(sa);
    const before = { ...mem(SA) };
    const r = await put(CADMIN, { userId: SA, role: 'COMPANY_ADMIN', status: 'inactive' });
    expect(r.status).toBe(403);
    expect(mem(SA)).toEqual(before);
    expect(membershipWrites()).toHaveLength(0);
  });

  it('re-activating an inactive SUPER_ADMIN row (status active) → 403, still inactive (no restoration of platform authority)', async () => {
    world({ status: 'inactive' });
    const r = await put(CADMIN, { userId: SA, role: 'COMPANY_ADMIN', status: 'active' });
    expect(r.status).toBe(403);
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN', status: 'inactive' });
  });

  it('even an active platform SA cannot change a SUPER_ADMIN membership through this company-scoped route (→ governed path)', async () => {
    world();
    const r = await put(PSA, { userId: SA, role: 'CONTENT_CREATOR' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('SUPER_ADMIN is not a requestable role here → 400 ROLE_NOT_ALLOWED (unchanged)', async () => {
    world();
    const r = await put(CADMIN, { userId: MEMBER, role: 'SUPER_ADMIN' });
    expect(r.status).toBe(400);
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });
});

describe('PUT — legitimate company-admin changes to ordinary members are preserved', () => {
  it('role change CONTENT_CREATOR → CONTENT_REVIEWER → 200; only the CO_A membership changes', async () => {
    world();
    const r = await put(CADMIN, { userId: MEMBER, role: 'CONTENT_REVIEWER' });
    expect(r.status).toBe(200);
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_REVIEWER', status: 'active' });
    expect(mem(MEMBER, CO_B)).toMatchObject({ role: 'CONTENT_REVIEWER', status: 'active' });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'UPDATE_USER_ROLE', target_user_id: MEMBER }));
  });

  it('deactivation (status inactive) → 200; deactivated_at set; B membership untouched', async () => {
    world();
    const r = await put(CADMIN, { userId: MEMBER, role: 'CONTENT_CREATOR', status: 'inactive' });
    expect(r.status).toBe(200);
    expect(mem(MEMBER)).toMatchObject({ status: 'inactive' });
    expect(mem(MEMBER)?.deactivated_at).toBeTruthy();
    expect(mem(MEMBER, CO_B)).toMatchObject({ status: 'active' });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'DEACTIVATE_USER', target_user_id: MEMBER }));
  });

  it('promotion to COMPANY_ADMIN while another active admin exists → 409 ADMIN_TRANSFER_REQUIRED (existing rule preserved)', async () => {
    world();
    const r = await put(CADMIN, { userId: MEMBER, role: 'COMPANY_ADMIN' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'ADMIN_TRANSFER_REQUIRED' });
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('an active platform SA may still change an ordinary member (unchanged)', async () => {
    world();
    expect((await put(PSA, { userId: MEMBER, role: 'VIEW_ONLY' })).status).toBe(200);
    expect(mem(MEMBER)).toMatchObject({ role: 'VIEW_ONLY' });
  });
});

describe('PUT — authorization, missing membership, lookup failure', () => {
  it('a VIEW_ONLY member (no ASSIGN_ROLE) → 403 PERMISSION_DENIED; unchanged', async () => {
    world();
    const r = await put(VIEWER, { userId: MEMBER, role: 'VIEW_ONLY' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'PERMISSION_DENIED' });
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('cross-company: a company admin of A naming B → 403; nothing in B changes', async () => {
    world();
    const r = await put(CADMIN, { userId: B_ONLY, role: 'VIEW_ONLY' }, CO_B);
    expect(r.status).toBe(403);
    expect(mem(B_ONLY, CO_B)).toMatchObject({ role: 'CONTENT_CREATOR' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('cross-company target: a company admin of A naming A with a user who is only in B → 404, no write, nothing about B disclosed', async () => {
    world();
    const r = await put(CADMIN, { userId: B_ONLY, role: 'VIEW_ONLY' });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'MEMBERSHIP_NOT_FOUND' });
    expect(JSON.stringify(r.body)).not.toContain(CO_B);
    expect(mem(B_ONLY, CO_B)).toMatchObject({ role: 'CONTENT_CREATOR' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('missing membership → 404 MEMBERSHIP_NOT_FOUND (was a false 200)', async () => {
    world();
    const r = await put(CADMIN, { userId: 'u-nobody', role: 'VIEW_ONLY' });
    expect(r.status).toBe(404);
    expect(membershipWrites()).toHaveLength(0);
  });

  it('unauthenticated → 401; unchanged', async () => {
    world();
    expect((await put(null, { userId: MEMBER, role: 'VIEW_ONLY' })).status).toBe(401);
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('membership lookup failure → never 200; nothing changed', async () => {
    world();
    failTable('user_company_roles');
    const r = await put(CADMIN, { userId: SA, role: 'CONTENT_CREATOR' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(membershipWrites()).toHaveLength(0);
  });
});

describe('target-membership lookup failure (guards pass; only the target read fails)', () => {
  it('PUT → 503 MEMBERSHIP_LOOKUP_FAILED; no membership write; nothing changed', async () => {
    world();
    mockHooks.failSelect = 'id, role, status';
    const r = await put(CADMIN, { userId: SA, role: 'CONTENT_CREATOR' });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'MEMBERSHIP_LOOKUP_FAILED' });
    expect(membershipWrites()).toHaveLength(0);
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('DELETE → 503 MEMBERSHIP_LOOKUP_FAILED; nothing deleted', async () => {
    world();
    mockHooks.failSelect = 'id, role, status';
    const r = await del(CADMIN, SA);
    expect(r.status).toBe(503);
    expect(membershipWrites()).toHaveLength(0);
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN' });
  });
});

describe('PUT — concurrency (conditional write on the membership read)', () => {
  it('target promoted to SUPER_ADMIN between the read and the write → 409; the promotion is NOT overwritten', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'update') (mem(MEMBER) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await put(CADMIN, { userId: MEMBER, role: 'VIEW_ONLY' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(mem(MEMBER)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('target status changed concurrently (deactivated) → 409; the concurrent change stands', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'update') (mem(MEMBER) as Record<string, unknown>).status = 'inactive'; };
    const r = await put(CADMIN, { userId: MEMBER, role: 'VIEW_ONLY' });
    expect(r.status).toBe(409);
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'inactive' });
  });

  it('write failure → 500; nothing changed', async () => {
    world();
    mockHooks.failWrite = 'update';
    const r = await put(CADMIN, { userId: MEMBER, role: 'VIEW_ONLY' });
    expect(r.status).toBe(500);
    expect(mem(MEMBER)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE — a company admin never deletes a SUPER_ADMIN membership', () => {
  it.each(SA_STATES)('%s SUPER_ADMIN row → 403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE; preserved; no membership write; audited', async (_d, sa) => {
    world(sa);
    const before = { ...mem(SA) };
    const r = await del(CADMIN, SA);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' });
    expect(mem(SA)).toEqual(before);
    expect(membershipWrites()).toHaveLength(0);
    expect(deniedAudits()).toEqual([expect.objectContaining({ actor_user_id: CADMIN, target_user_id: SA })]);
  });

  it('even an active platform SA cannot delete a SUPER_ADMIN membership through this route', async () => {
    world();
    expect((await del(PSA, SA)).status).toBe(403);
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN' });
  });
});

describe('DELETE — ordinary members, isolation, missing, concurrency, failure', () => {
  it('ordinary member → 200; ONLY the CO_A membership is deleted (the user\'s CO_B membership and other members untouched)', async () => {
    world();
    const r = await del(CADMIN, MEMBER);
    expect(r.status).toBe(200);
    expect(mem(MEMBER)).toBeUndefined();
    expect(mem(MEMBER, CO_B)).toMatchObject({ role: 'CONTENT_REVIEWER', status: 'active' });
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'REMOVE_USER', target_user_id: MEMBER }));
  });

  it('cross-company: company admin of A naming B → 403; B intact', async () => {
    world();
    expect((await del(CADMIN, B_ONLY, CO_B)).status).toBe(403);
    expect(mem(B_ONLY, CO_B)).toBeTruthy();
  });

  it('a user who is only in B, deleted "from A" → 404; B intact; nothing about B disclosed', async () => {
    world();
    const r = await del(CADMIN, B_ONLY);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(CO_B);
    expect(mem(B_ONLY, CO_B)).toBeTruthy();
  });

  it('missing membership → 404 (was a false 200)', async () => {
    world();
    expect((await del(CADMIN, 'u-nobody')).status).toBe(404);
    expect(membershipWrites()).toHaveLength(0);
  });

  it('a VIEW_ONLY member → 403 PERMISSION_DENIED; nothing deleted', async () => {
    world();
    expect((await del(VIEWER, MEMBER)).status).toBe(403);
    expect(mem(MEMBER)).toBeTruthy();
  });

  it('target promoted to SUPER_ADMIN between the read and the delete → 409; NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(MEMBER) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await del(CADMIN, MEMBER);
    expect(r.status).toBe(409);
    expect(mem(MEMBER)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('delete failure after a successful read → 500; membership intact; no REMOVE_USER audit', async () => {
    world();
    mockHooks.failWrite = 'delete';
    const r = await del(CADMIN, MEMBER);
    expect(r.status).toBe(500);
    expect(mem(MEMBER)).toBeTruthy();
    expect(rows('audit_logs').some((a) => a.action === 'REMOVE_USER')).toBe(false);
  });

  it('membership lookup failure → never 200; nothing deleted', async () => {
    world();
    failTable('user_company_roles');
    const r = await del(CADMIN, MEMBER);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(membershipWrites()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('privileged identity changes still require the governed path and its step-up', () => {
  const revoke = (who: string) => invoke(revokeSuperAdminRoute as never, { method: 'POST', body: { userId: SA }, headers: { 'x-test-user': who } });

  it('admin/revoke-super-admin (identity.admin.revoke): a company admin of the SA\'s tenant → 403; SA intact', async () => {
    world();
    const r = await revoke(CADMIN);
    expect(r.status).toBe(403);
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('active platform SA WITHOUT step-up → STEP_UP_REQUIRED; SA intact', async () => {
    world();
    const r = await revoke(PSA_NOSTEP);
    expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(mem(SA)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('active platform SA WITH passkey step-up on a trusted device → 200; the SA membership is downgraded by the governed path', async () => {
    world();
    const r = await revoke(PSA);
    expect(r.status).toBe(200);
    expect(mem(SA)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_REVOKE, decision: 'elevated_route_accessed', actorUserId: PSA }));
  });
});

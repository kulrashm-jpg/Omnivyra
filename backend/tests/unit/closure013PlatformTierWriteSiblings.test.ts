/**
 * Closure-013 (D-3) — the platform-tier WRITE siblings.
 *
 * D-3 was not specific to the OAuth routes: AuthorizationService honours a
 * platform-tier capability from a DIRECT capability_assignments grant without
 * any organisation binding, and 53 platform write routes (access requests,
 * billing, plans, credits, users, blog, intelligence overrides, cron/queue
 * config, RBAC, ...) gated on such a capability with no platform-authority
 * check. requireCapability now refuses a principal that HOLDS a platform-tier
 * write capability without active platform SUPER_ADMIN write authority, before
 * the capability/step-up decision and before any audit of success.
 *
 * Drives the REAL chain for every statically discovered route/method pair:
 * route handler (+ withIdempotency / rate-limit wrappers where present) →
 * requireCapability → resolvePrincipal → resolveUserCapabilities → decision.
 * Only I/O is replaced: database rows, the identity/session lookup, the legacy
 * bridge, the security-audit sink and per-IP rate limiting. No authorized call
 * is made through these routes (their business effects include real providers
 * and credit/billing writes); global fetch is replaced by a refusing spy, so no
 * external integration can be reached.
 *
 * In-memory: proves ordering and decisions, NOT Postgres RLS.
 */

// ── Database fake (records every write, RPC and table read) ───────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string }[] = [];
const mockRpc: string[] = [];
const mockReads: string[] = [];
const echo = (p: unknown) => (Array.isArray(p) ? p : [p]).map((r, i) => ({ id: `row-${i}`, ...(r as Record<string, unknown>) }));
const persist = (table: string, p: unknown) => { const r = echo(p); (mockTables[table] ??= []).push(...r); return r; };
function mockBuilder(table: string) {
  mockReads.push(table);
  let rows = [...(mockTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain, not: chain,
    contains: chain, or: chain, ilike: chain, like: chain, match: chain, filter: chain, returns: chain, csv: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    update: () => { mockWrites.push({ table, op: 'update' }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    // Inserts/upserts persist and echo (withIdempotency reads its reservation back).
    insert: (p: unknown) => { mockWrites.push({ table, op: 'insert' }); rows = persist(table, p); return b; },
    upsert: (p: unknown) => { mockWrites.push({ table, op: 'upsert' }); rows = persist(table, p); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej),
  });
  return b;
}
const mockSupabase = {
  from: (t: string) => mockBuilder(t),
  rpc: async (fn: string) => { mockRpc.push(fn); return { data: null, error: { message: 'rpc refused in test' } }; },
  auth: { admin: new Proxy({}, { get: () => async () => { mockRpc.push('auth.admin'); return { data: null, error: { message: 'refused' } }; } }) },
  storage: { from: () => new Proxy({}, { get: () => async () => { mockRpc.push('storage'); return { data: null, error: { message: 'refused' } }; } }) },
};
jest.mock('../../db/supabaseClient', () => ({ supabase: mockSupabase, default: mockSupabase }));

// ── Identity, session, bridge ─────────────────────────────────────────────────
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers: Record<string, string> }) => {
    const id = req.headers['x-test-user'];
    return id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers: Record<string, string> }) => {
    const user = req.headers['x-test-user'];
    if (!user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  resolveLegacyCookieSuperAdminPrincipal: async (req: { headers: Record<string, string> }) => {
    if (!req.headers['x-test-bridge']) return null;
    const sec = jest.requireActual('../../../shared/contracts/security');
    return {
      userId: 'legacy:cookie-super-admin', supabaseUid: 'legacy:cookie-super-admin', email: '', emailVerified: false,
      sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
      organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }],
      activeOrgId: null,
      capabilities: [...sec.ALL_CAPABILITIES],
      mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: null, phishingResistant: true },
      device: { deviceId: null, trusted: true, fingerprint: 'bridge' },
      stepUp: { active: true, expiresAt: new Date(Date.now() + 300_000), factor: 'webauthn', sessionId: 'su-bridge' },
      legacyCookieSuperAdmin: true,
    };
  },
}));
const mockSecurityAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockSecurityAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => {
  const actual = jest.requireActual('../../services/requestAccessService');
  return { ...actual, requireAdminRateLimit: async () => true };
});

import fs from 'fs';
import path from 'path';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { CONSUMPTION_VIEW_AGGREGATE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

/** Every statically discovered platform-tier write route/method pair without a route-level authority check. */
const SIBLINGS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['admin/access-requests/approve', ['POST']],
  ['admin/access-requests/delete', ['DELETE']],
  ['admin/access-requests/reject', ['POST']],
  ['admin/billing/allocate', ['POST']],
  ['admin/billing/reconcile', ['POST']],
  ['admin/blog/index', ['POST']],
  ['admin/blog/relationships', ['POST', 'DELETE']],
  ['admin/blog/series/index', ['POST']],
  ['admin/blog/series/[id]', ['PATCH', 'DELETE']],
  ['admin/blog/[id]', ['PATCH', 'DELETE']],
  ['admin/bootstrap-super-admin', ['POST']],
  ['admin/config/[type]', ['POST']],
  ['admin/cron-config', ['POST']],
  ['admin/experiment/toggle', ['POST']],
  ['admin/intelligence/scheduler-boost', ['POST']],
  ['admin/intelligence/scheduler-config', ['PUT']],
  ['admin/intelligence/scheduler-overrides', ['POST', 'DELETE']],
  ['admin/intelligence/throttle-status', ['PUT']],
  ['admin/knowledge-graph/canonical-topic', ['POST', 'DELETE']],
  ['admin/knowledge-graph/embed-topic', ['POST']],
  ['admin/knowledge-graph/topic', ['POST', 'PATCH']],
  ['admin/platform-oauth-configs/index', ['POST']],
  ['admin/queue-config', ['POST']],
  ['admin/revoke-super-admin', ['POST']],
  ['super-admin/billing-catalog/index', ['POST', 'PATCH']],
  ['super-admin/community-ai-policy', ['POST']],
  ['super-admin/companies/archive-abandoned', ['POST']],
  ['super-admin/companies/promote-admin', ['POST']],
  ['super-admin/companies/transfer-ownership', ['POST']],
  ['super-admin/companies', ['DELETE', 'POST', 'PATCH']],
  ['super-admin/credit-cost-config/update', ['POST']],
  ['super-admin/credits/grant', ['POST']],
  ['super-admin/free-credits/grant', ['POST']],
  ['super-admin/free-credits/requests', ['POST']],
  ['super-admin/free-credits/revoke', ['POST']],
  ['super-admin/invitations/[invitationId]/resend', ['POST']],
  ['super-admin/monetization/operations', ['POST']],
  ['super-admin/payment-providers/index', ['PATCH']],
  ['super-admin/plans/assign', ['POST']],
  ['super-admin/plans/create', ['POST']],
  ['super-admin/plans/override', ['POST']],
  ['super-admin/plans/toggle', ['POST']],
  ['super-admin/pricing/index', ['POST']],
  ['super-admin/purchases/complete', ['POST']],
  ['super-admin/razorpay/create-staging-order', ['POST']],
  ['super-admin/razorpay/verify-staging-payment', ['POST']],
  ['super-admin/rbac', ['POST']],
  ['super-admin/usage/grant-access', ['POST']],
  ['super-admin/usage/revoke-access', ['POST', 'DELETE']],
  ['super-admin/users/create', ['POST']],
  ['super-admin/users/[id]/force-logout', ['POST']],
  ['super-admin/users/[id]/resume', ['POST']],
  ['super-admin/users/[id]/suspend', ['POST']],
  ['super-admin/users', ['POST', 'PATCH', 'DELETE']],
];
const PAIRS = SIBLINGS.flatMap(([route, methods]) => methods.map((m) => [`${m} ${route}`, route, m] as const));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ user_id, company_id, role: r, status });
const assign = (user_id: string, capability: string) => ({ user_id, capability, organization_id: null, expires_at: null, revoked_at: null });
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
/** VIEW_ONLY tenant user with DIRECT grants of EVERY platform-tier capability, passkey step-up, trusted device. */
const GRANTEE_ALL = 'u-grantee-all';
/** VIEW_ONLY tenant user with direct grants of ONLY the two read-only platform capabilities. */
const GRANTEE_READ = 'u-grantee-read';
const TENANT_ADMIN = 'u-tenant-admin';
/** A DEACTIVATED SUPER_ADMIN that still holds every platform-tier capability by direct grant. */
const SUPER_DEACTIVATED = 'u-super-deact';
const ELEVATED = [GRANTEE_ALL, GRANTEE_READ, TENANT_ADMIN, SUPER_DEACTIVATED];

const fetchSpy = jest.fn(async () => { throw new Error('outbound network refused in test'); });
beforeAll(() => { (global as { fetch: unknown }).fetch = fetchSpy; });
beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0; mockRpc.length = 0; mockReads.length = 0; mockSecurityAudit.length = 0; fetchSpy.mockClear();
  mockTables.user_company_roles = [
    role(GRANTEE_ALL, A, 'VIEW_ONLY'), role(GRANTEE_READ, A, 'VIEW_ONLY'), role(TENANT_ADMIN, A, 'COMPANY_ADMIN'),
    role(SUPER_DEACTIVATED, P, 'SUPER_ADMIN', 'inactive'),
  ];
  mockTables.capability_assignments = [
    ...PLATFORM_TIER_CAPABILITIES.map((c) => assign(GRANTEE_ALL, c)),
    ...PLATFORM_TIER_CAPABILITIES.map((c) => assign(SUPER_DEACTIVATED, c)),
    assign(GRANTEE_READ, SUPER_ADMIN_DASHBOARD_VIEW), assign(GRANTEE_READ, CONSUMPTION_VIEW_AGGREGATE),
  ];
  mockTables.stepup_sessions = ELEVATED.map((u) =>
    ({ id: `su-${u}`, user_id: u, auth_session_id: `sess-${u}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }));
  mockTables.trusted_devices = ELEVATED.map((u) =>
    ({ id: `dev-${u}`, user_id: u, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null }));
  mockTables.users = [];
});

type Res = { statusCode: number; body: unknown; headers: Record<string, unknown> } & Record<string, unknown>;
function fakeRes(): Res {
  const r = { statusCode: 200, body: undefined, headers: {} } as Res;
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.getHeader = (k: string) => r.headers[k];
  r.end = () => r;
  r.redirect = () => r;
  return r;
}
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
const handlers = new Map<string, Handler>();
function load(route: string): Handler {
  if (!handlers.has(route)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(`../../../pages/api/${route}`) as { default: Handler };
    handlers.set(route, mod.default);
  }
  return handlers.get(route)!;
}
async function call(route: string, method: string, who: { user?: string; bridge?: boolean } | null) {
  const headers: Record<string, string> = { 'idempotency-key': `c13-${route}-${method}`, 'content-type': 'application/json' };
  if (who?.user) headers['x-test-user'] = who.user;
  if (who?.bridge) headers['x-test-bridge'] = '1';
  const req = {
    headers, method, url: `/api/${route}`, socket: {}, cookies: {},
    query: { id: 'x-1', type: 'x', invitationId: 'inv-1', threadId: 't-1' },
    body: { ...WELL_FORMED_BODY, ...(BODY_OVERRIDES[route] ?? {}) },
  };
  const res = fakeRes();
  await load(route)(req, res);
  return res;
}
/**
 * One well-formed synthetic body for every route: several routes validate required fields BEFORE they
 * authorize (an established, data-free ordering), so a bare body would stop there and never exercise the guard.
 */
const WELL_FORMED_BODY = {
  mode: 'promote', targetUserId: 'u-target', organizationId: A, companyId: A, organization_id: A, orgId: A, userId: 'u-target',
  reason: 'closure-013 synthetic', creditsAmount: 10, category: 'free', fromUserId: 'u-from', toUserId: 'u-target', package_id: 'pkg-1', amount: 10, plan_id: 'plan-1', planId: 'plan-1',
  razorpay_order_id: 'order_synthetic', razorpay_payment_id: 'pay_synthetic', razorpay_signature: 'sig_synthetic',
  email: 'new-user@example.test', role: 'VIEW_ONLY', id: 'x-1', key: 'k', value: 'v', enabled: true,
};
/** Where one route's pre-auth validation contradicts another's. */
const BODY_OVERRIDES: Record<string, Record<string, unknown>> = {
  'super-admin/free-credits/grant': { category: 'manual' },
};
const code = (r: Res) => (r.body as { code?: string } | undefined)?.code;
/** Identity-chain and idempotency-reservation tables; anything else read is a business read. */
const NON_BUSINESS = new Set(['user_company_roles', 'capability_assignments', 'stepup_sessions', 'trusted_devices', 'users',
  'auth_sessions', 'totp_factors', 'webauthn_credentials', 'recovery_codes', 'api_idempotency_keys']);
const WRITE_CAPS = new Set<string>(PLATFORM_TIER_CAPABILITIES.filter((c) => c !== SUPER_ADMIN_DASHBOARD_VIEW && c !== CONSUMPTION_VIEW_AGGREGATE));
/** Removed endpoints answer 410 to everyone before any business work. */
const TOMBSTONES = new Set(['admin/platform-oauth-configs/index']);
function expectNothingHappened() {
  expect(mockWrites.filter((w) => w.table !== 'api_idempotency_keys')).toEqual([]);
  expect(mockRpc).toEqual([]);
  expect(mockReads.filter((t) => !NON_BUSINESS.has(t))).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
  // A read gate (e.g. the users routes' dashboard-view top guard) may legitimately allow; a WRITE capability never may.
  expect(mockSecurityAudit.filter((e) => WRITE_CAPS.has(String(e.capability)) && (e.decision === 'allowed' || e.decision === 'elevated_route_accessed'))).toEqual([]);
}

describe('VIEW_ONLY + DIRECT grants of every platform-tier capability + valid passkey step-up on a trusted device', () => {
  it.each(PAIRS)('%s → 403 PLATFORM_SUPER_ADMIN_REQUIRED, audited as elevated_route_denied, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, { user: GRANTEE_ALL });
    expectNothingHappened();
    if (TOMBSTONES.has(route)) {
      expect(r.statusCode).toBe(410);
      expect(code(r)).toBe('ENDPOINT_GONE');
      return;
    }
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    const denial = mockSecurityAudit.filter((e) => e.decision === 'elevated_route_denied');
    expect(denial.length).toBeGreaterThanOrEqual(1);
    expect(denial[0]).toMatchObject({ actorUserId: GRANTEE_ALL, actorSessionId: `sess-${GRANTEE_ALL}` });
    expect(String(denial[0].reason)).toContain('PLATFORM_SUPER_ADMIN_REQUIRED');
  });
});

describe('a read-only platform capability never authorizes a write', () => {
  it.each(PAIRS)('%s → a dashboard-view / consumption-view grantee is denied, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, { user: GRANTEE_READ });
    expect(TOMBSTONES.has(route) ? [410] : [401, 403]).toContain(r.statusCode);
    expectNothingHappened();
  });
});

describe('other refused principals', () => {
  it.each(PAIRS)('%s → an ordinary tenant administrator is denied, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, { user: TENANT_ADMIN });
    expect(TOMBSTONES.has(route) ? [410] : [401, 403]).toContain(r.statusCode);
    expectNothingHappened();
  });
  it.each(PAIRS)('%s → a deactivated SUPER_ADMIN holding every platform grant is denied, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, { user: SUPER_DEACTIVATED });
    expect(r.statusCode).toBe(TOMBSTONES.has(route) ? 410 : 403);
    expectNothingHappened();
  });
  it.each(PAIRS)('%s → a bridge principal claiming everything is denied, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, { bridge: true });
    expect(TOMBSTONES.has(route) ? [410] : [401, 403]).toContain(r.statusCode);
    expectNothingHappened();
  });
  it.each(PAIRS)('%s → no principal → 401, nothing happens', async (_n, route, method) => {
    const r = await call(route, method, null);
    expect(r.statusCode).toBe(TOMBSTONES.has(route) ? 410 : 401);
    expectNothingHappened();
  });
});

describe('static completeness — no platform-tier write route escapes the guard', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const CAP_NAMES = [
    'IDENTITY_ADMIN', 'IDENTITY_ADMIN_ASSIGN', 'IDENTITY_ADMIN_REVOKE', 'IDENTITY_ADMIN_DELETE', 'ORGANIZATION_DELETE',
    'INTELLIGENCE_OVERRIDE_MANAGE', 'CRON_CONFIG_MANAGE', 'BLOG_PUBLISH_MANAGE', 'INTEGRATION_PLATFORM_OAUTH_MANAGE',
    'BILLING_PLATFORM_MANAGE', 'BILLING_PLAN_MANAGE', 'BILLING_GRANT_FREE_CREDITS', 'OUTREACH_PLATFORM_MANAGE',
    'PUBLISH_RECOVERY_MANAGE', 'PLATFORM_CONTROLS_MANAGE',
  ];
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = [...walk(path.join(ROOT, 'pages/api')), ...walk(path.join(ROOT, 'backend/apiHandlers'))];

  it('every file that names a platform-tier WRITE capability authorizes through requireCapability or a platform-authority helper', () => {
    const escapes: string[] = [];
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8');
      if (!CAP_NAMES.some((c) => new RegExp(`\\b${c}\\b`).test(t))) continue;
      const viaGuard = /requireCapability\(/.test(t);
      const viaHelper = /requirePlatformWriteAuthority|enforcePlatformWriteAuthority|requireSuperAdminGaWriteAccess/.test(t);
      if (!viaGuard && !viaHelper) escapes.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
    // Files that only mention a capability (types, re-exports, UI-facing lists) are listed here explicitly.
    expect(escapes.filter((f) => !STATIC_MENTION_ONLY.has(f))).toEqual([]);
  });

  it('every sibling page under test still exists (the list cannot silently rot)', () => {
    for (const [route] of SIBLINGS) {
      expect(fs.existsSync(path.join(ROOT, 'pages/api', `${route}.ts`))).toBe(true);
    }
  });
});
const STATIC_MENTION_ONLY = new Set<string>([]);

// ── The guard itself, through the real requireCapability ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requireCapability, isPlatformTierWrite } = require('../../security/requireCapability') as typeof import('../../security/requireCapability');
const SUPER = 'u-super';
const SUPER_NO_STEPUP = 'u-super-nostep';
async function gate(who: string | null, capability: string, method: string | undefined) {
  if (who === SUPER || who === SUPER_NO_STEPUP) {
    mockTables.user_company_roles.push(role(who, P, 'SUPER_ADMIN'));
    if (who === SUPER) {
      mockTables.stepup_sessions.push({ id: `su-${who}`, user_id: who, auth_session_id: `sess-${who}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null });
      mockTables.trusted_devices.push({ id: `dev-${who}`, user_id: who, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });
    }
  }
  const headers: Record<string, string> = {};
  if (who) headers['x-test-user'] = who;
  const req = { headers, method, url: '/api/x', socket: {}, cookies: {}, query: {}, body: {} };
  const res = fakeRes();
  const out = await requireCapability(req as never, res as never, { capability: capability as never, reason: 'closure-013 guard test' });
  return { out, res };
}

/** Platform-tier write capabilities with no registered step-up policy today. */
const NO_STEP_UP_POLICY = new Set<string>(['intelligence.override.manage', 'cron.config.manage', 'blog.publish.manage']);

describe('requireCapability platform-tier write guard', () => {
  const WRITE_TIER = PLATFORM_TIER_CAPABILITIES.filter((c) => c !== SUPER_ADMIN_DASHBOARD_VIEW && c !== CONSUMPTION_VIEW_AGGREGATE);

  it('classifies writes: every platform-tier WRITE capability on a mutating or missing method; never the two read capabilities, never GET/HEAD/OPTIONS', () => {
    for (const c of WRITE_TIER) {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', undefined]) expect(isPlatformTierWrite(c, m)).toBe(true);
      for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(isPlatformTierWrite(c, m)).toBe(false);
    }
    for (const m of ['POST', 'DELETE', undefined]) {
      expect(isPlatformTierWrite(SUPER_ADMIN_DASHBOARD_VIEW, m)).toBe(false);
      expect(isPlatformTierWrite(CONSUMPTION_VIEW_AGGREGATE, m)).toBe(false);
    }
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: a direct-grant holder is refused BEFORE the decision — one elevated_route_denied row, no allowed/accessed row', async (c) => {
    const { out, res } = await gate(GRANTEE_ALL, c, 'POST');
    expect(out.ok).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PLATFORM_SUPER_ADMIN_REQUIRED', capability: c });
    expect(mockSecurityAudit.map((e) => e.decision)).toEqual(['elevated_route_denied']);
    expect(mockSecurityAudit[0]).toMatchObject({ capability: c, actorUserId: GRANTEE_ALL, principalUserId: GRANTEE_ALL, actorSessionId: `sess-${GRANTEE_ALL}` });
    expect(res.headers['x-omnivyra-correlation-id']).toBeDefined();
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: a request with NO method is treated as a write', async (c) => {
    const { res } = await gate(GRANTEE_ALL, c, undefined);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PLATFORM_SUPER_ADMIN_REQUIRED' });
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: an active, stepped-up platform SUPER_ADMIN passes the guard and is authorized', async (c) => {
    const { out } = await gate(SUPER, c, 'POST');
    expect(out.ok).toBe(true);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_denied')).toBe(false);
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: an active SUPER_ADMIN WITHOUT step-up still gets the step-up requirement where one is registered (not weakened, not a 403)', async (c) => {
    const { out, res } = await gate(SUPER_NO_STEPUP, c, 'POST');
    if (NO_STEP_UP_POLICY.has(c)) {
      // Pre-existing policy: these platform writes register no step-up (reported, not changed here).
      expect(out.ok).toBe(true);
      return;
    }
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe('STEP_UP_REQUIRED');
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: a principal that does NOT hold the capability keeps the established CAPABILITY_NOT_HELD denial', async (c) => {
    const { res } = await gate(TENANT_ADMIN, c, 'POST');
    expect(res.statusCode).toBe(403);
    expect((res.body as { code?: string }).code).toBe('CAPABILITY_NOT_HELD');
  });

  it.each(WRITE_TIER.map((c) => [c]))('%s: reads are unchanged — GET by a direct-grant holder is decided exactly as before', async (c) => {
    const { res } = await gate(GRANTEE_ALL, c, 'GET');
    expect((res.body as { code?: string } | undefined)?.code).not.toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expect(mockSecurityAudit.some((e) => String(e.reason).includes('PLATFORM_SUPER_ADMIN_REQUIRED'))).toBe(false);
  });

  it('the two read-only platform capabilities are not given a write-authority check (Closure-009 POST reads stay open to grantees)', async () => {
    for (const c of [SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE]) {
      mockSecurityAudit.length = 0;
      const { res } = await gate(GRANTEE_READ, c, 'POST');
      expect((res.body as { code?: string } | undefined)?.code).not.toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    }
  });

  it('no principal → 401 NOT_AUTHENTICATED, no write-authority row', async () => {
    const { res } = await gate(null, WRITE_TIER[0], 'POST');
    expect(res.statusCode).toBe(401);
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_denied')).toBe(false);
  });
});

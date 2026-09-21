/**
 * CPG-066 — /api/super-admin/razorpay/create-staging-order is a PLATFORM-ONLY
 * operation (security regression).
 *
 * THE DEFECT: the route authorized on the TENANT capability billing.purchase,
 * scoped to the caller-supplied organization_id. Any tenant COMPANY_ADMIN could
 * therefore create a staging credit order (a pending credit_purchases row plus
 * a Razorpay test order) for their own organisation, while a platform
 * SUPER_ADMIN could only do so for organisations they happened to belong to.
 * Its sibling verify-staging-payment is platform-only; tenants have their own
 * checkout path (/api/billing/checkout-session, /api/billing/checkout/*).
 *
 * THE FIX: authorize on the platform-tier billing.platform.manage with no
 * organisation scope; organization_id stays a required purchase binding.
 *
 * These tests drive the REAL chain end to end: route → requireCapability →
 * resolvePrincipal → resolveUserCapabilities → decideCapabilityWithStepUp →
 * evaluateStepUp → createRazorpayStagingCreditOrder (real environment gate,
 * real beta-access gate, real package lookup, purchase insert and order
 * attach). Only I/O is replaced: an in-memory database, the identity/session
 * lookups, the audit sink, and `fetch` (a fake Razorpay test API — nothing
 * leaves the process). `requireCapability` is NOT mocked.
 */

// ── Database fake: in-memory rows; inserts are recorded and readable ─────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string; payload?: Record<string, unknown> }[] = [];
function mockBuilder(table: string) {
  let rows = [...(mockTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain, not: chain, contains: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    insert: (payload: Record<string, unknown>) => {
      const row = { id: `${table}-${mockWrites.length + 1}`, ...payload };
      mockWrites.push({ table, op: 'insert', payload });
      rows = [row];
      return b;
    },
    update: (payload: Record<string, unknown>) => { mockWrites.push({ table, op: 'update', payload }); return b; },
    upsert: (payload: Record<string, unknown>) => { mockWrites.push({ table, op: 'upsert', payload }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockBuilder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));
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
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: async () => null }));
const mockAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// Not on the order-creation path (settlement only); stubbed to keep the import graph small.
jest.mock('../../services/purchaseService', () => ({
  completePurchase: jest.fn(), failPurchase: jest.fn(), recordPaymentProviderEvent: jest.fn(),
}));

import route from '../../../pages/api/super-admin/razorpay/create-staging-order';
import { capabilitiesForRole } from '../../security/capabilityRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { BILLING_MANAGE, BILLING_PLATFORM_MANAGE, BILLING_PURCHASE, CONTENT_PUBLISH } from '../../../shared/contracts/security';

// ── Fixtures ────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111'; // tenant org of the tenant users
const B = '22222222-2222-4222-8222-222222222222'; // another tenant org
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN row
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string) => ({ user_id, company_id, role: r, status: 'active' });
/** Mirror of IdentityResolver's fingerprint for a request with no UA / language / cookies. */
function bareFingerprint(): string {
  let h = 5381;
  for (const ch of '||') h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const ADMIN = 'u-admin-a', PUBLISHER = 'u-pub-a', VIEWER = 'u-view-a', CAPS = 'u-caps-a';
const SUPER = 'u-super', SUPER_NO_STEPUP = 'u-super-nostep', SUPER_UNTRUSTED = 'u-super-untrusted';
const STEPPED_UP = [ADMIN, PUBLISHER, VIEWER, CAPS, SUPER, SUPER_UNTRUSTED];
const TRUSTED = [ADMIN, PUBLISHER, VIEWER, CAPS, SUPER, SUPER_NO_STEPUP];

const ENV_KEYS = ['RAZORPAY_STAGING_ENABLED', 'RAZORPAY_TEST_KEY_ID', 'RAZORPAY_TEST_KEY_SECRET', 'EXTERNAL_BETA_ENABLED',
  'INTERNAL_STAGING_ONLY', 'MONETIZATION_STAGING_KILL_SWITCH', 'RAZORPAY_ALLOW_PRODUCTION_STAGING'] as const;
const savedEnv: Record<string, string | undefined> = {};
function stagingEnv(enabled: boolean) {
  process.env.RAZORPAY_STAGING_ENABLED = enabled ? 'true' : 'false';
  process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_fake';
  process.env.RAZORPAY_TEST_KEY_SECRET = 'fake-secret';
  delete process.env.EXTERNAL_BETA_ENABLED;
  delete process.env.INTERNAL_STAGING_ONLY;
  delete process.env.MONETIZATION_STAGING_KILL_SWITCH;
}

const fakeFetch = jest.fn(async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { amount: number; currency: string; notes: Record<string, string> };
  return { ok: true, status: 200, json: async () => ({ id: 'order_test_fake1', amount: body.amount, currency: body.currency, notes: body.notes }) };
});
const realFetch = global.fetch;

beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  global.fetch = realFetch;
});
beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockAudit.length = 0;
  fakeFetch.mockClear();
  global.fetch = fakeFetch as unknown as typeof fetch;
  stagingEnv(true);
  mockTables.user_company_roles = [
    role(ADMIN, A, 'COMPANY_ADMIN'), role(PUBLISHER, A, 'CONTENT_PUBLISHER'), role(VIEWER, A, 'VIEW_ONLY'), role(CAPS, A, 'VIEW_ONLY'),
    role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
  ];
  mockTables.capability_assignments = [BILLING_PURCHASE, BILLING_MANAGE, CONTENT_PUBLISH]
    .map((capability) => ({ user_id: CAPS, capability, organization_id: null, expires_at: null, revoked_at: null }));
  mockTables.stepup_sessions = STEPPED_UP.map((u) => ({ id: `su-${u}`, user_id: u, auth_session_id: `sess-${u}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }));
  mockTables.trusted_devices = TRUSTED.map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: bareFingerprint(), expires_at: FUTURE(), revoked_at: null }));
  mockTables.users = [];
  mockTables.credit_packages = [{ id: 'pkg-1', credits: 100, price: 499, is_active: true, sku: 'pack-100', canonical_usd_price: null }];
});

function fakeRes() {
  const r: { statusCode: number; body: Record<string, unknown> | undefined } & Record<string, unknown> = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: Record<string, unknown>) => { r.body = b; return r; };
  r.setHeader = () => r;
  r.end = () => r;
  return r;
}
async function call(user: string | null, body: Record<string, unknown>) {
  const res = fakeRes();
  await (route as (q: unknown, s: unknown) => Promise<unknown>)(
    { headers: user ? { 'x-test-user': user } : {}, query: {}, body, method: 'POST', url: '/api/super-admin/razorpay/create-staging-order', socket: {} },
    res,
  );
  return res;
}
const order = (org?: string) => ({ ...(org ? { organization_id: org } : {}), package_id: 'pkg-1' });
const purchaseInserts = () => mockWrites.filter((w) => w.table === 'credit_purchases' && w.op === 'insert');
const effects = () => ({ razorpayCalls: fakeFetch.mock.calls.length, purchaseInserts: purchaseInserts().length, writes: mockWrites.length });

function expectDenied(res: { statusCode: number; body: Record<string, unknown> | undefined }, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  expect(res.body?.code).toBe(code);
  expect(effects()).toEqual({ razorpayCalls: 0, purchaseInserts: 0, writes: 0 });
}
function expectCreated(res: { statusCode: number; body: Record<string, unknown> | undefined }, org: string) {
  expect(res.statusCode).toBe(201);
  expect(res.body).toMatchObject({ ok: true, mode: 'test', organization_id: org, razorpay_order_id: 'order_test_fake1' });
  // Organisation binding is preserved end to end: purchase row and provider order notes.
  expect(purchaseInserts()).toHaveLength(1);
  expect(purchaseInserts()[0].payload).toMatchObject({ organization_id: org, package_id: 'pkg-1', status: 'pending', provider_mode: 'test' });
  expect(fakeFetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fakeFetch.mock.calls[0][1] as { body: string }).body).notes).toMatchObject({ organization_id: org });
}

describe('create-staging-order — security matrix (real route, real service, staging enabled)', () => {
  it('A. COMPANY_ADMIN + own organization → 403 CAPABILITY_NOT_HELD, no order', async () => {
    expectDenied(await call(ADMIN, order(A)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('B. COMPANY_ADMIN + another organization → 403, no order', async () => {
    expectDenied(await call(ADMIN, order(B)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('C. CONTENT_PUBLISHER + own organization → 403', async () => {
    expectDenied(await call(PUBLISHER, order(A)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('D. CONTENT_PUBLISHER + another organization → 403', async () => {
    expectDenied(await call(PUBLISHER, order(B)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('E. VIEW_ONLY + own organization → 403', async () => {
    expectDenied(await call(VIEWER, order(A)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('tenant holding billing.purchase + billing.manage + content.publish (org-less grants) → 403', async () => {
    expectDenied(await call(CAPS, order(A)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('F. SUPER_ADMIN + own (platform) organization → 201, binding preserved', async () => {
    expectCreated(await call(SUPER, order(P)), P);
  });
  it('G. SUPER_ADMIN + another (tenant) organization → 201, binding = that organization', async () => {
    expectCreated(await call(SUPER, order(B)), B);
  });
  it('H. SUPER_ADMIN without organization_id → 400 before authorization (the route requires the binding)', async () => {
    const res = await call(SUPER, order());
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('organization_id is required');
    expect(mockAudit).toEqual([]);
    expect(effects()).toEqual({ razorpayCalls: 0, purchaseInserts: 0, writes: 0 });
  });
  it('I. unauthenticated → 401 NOT_AUTHENTICATED, no order', async () => {
    expectDenied(await call(null, order(A)), 401, 'NOT_AUTHENTICATED');
  });
});

describe('create-staging-order — environment gate and step-up', () => {
  it('J. SUPER_ADMIN, staging DISABLED → authorized, then the service gate refuses before any write or provider call', async () => {
    stagingEnv(false);
    const res = await call(SUPER, order(B));
    expect(res.statusCode).toBe(400);
    expect(String(res.body?.error)).toMatch(/Razorpay staging is disabled/);
    expect(mockAudit.filter((a) => a.decision === 'denied' || a.decision === 'step_up_required')).toEqual([]);
    expect(effects()).toEqual({ razorpayCalls: 0, purchaseInserts: 0, writes: 0 });
  });
  it('J2. tenant, staging DISABLED → 403 from authorization (it runs BEFORE the environment gate)', async () => {
    stagingEnv(false);
    expectDenied(await call(ADMIN, order(A)), 403, 'CAPABILITY_NOT_HELD');
  });
  it('K. SUPER_ADMIN, staging ENABLED → real service path creates the pending purchase and the (fake) test order', async () => {
    expectCreated(await call(SUPER, order(A)), A);
    expect(mockWrites.map((w) => `${w.op}:${w.table}`)).toEqual(expect.arrayContaining(['insert:credit_purchases', 'update:credit_purchases']));
  });
  it('SUPER_ADMIN without a step-up session → 401 STEP_UP_REQUIRED, no order', async () => {
    expectDenied(await call(SUPER_NO_STEPUP, order(B)), 401, 'STEP_UP_REQUIRED');
  });
  it('SUPER_ADMIN stepped-up on an UNTRUSTED device → 401 (platform billing requires a trusted device)', async () => {
    expectDenied(await call(SUPER_UNTRUSTED, order(B)), 401, 'STEP_UP_REQUIRED');
  });
  it('missing package_id → 400 before authorization', async () => {
    const res = await call(SUPER, { organization_id: A });
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('package_id is required');
    expect(mockAudit).toEqual([]);
    expect(effects().writes).toBe(0);
  });
});

describe('create-staging-order — capability contract', () => {
  it('the route requires billing.platform.manage (every denial names it)', async () => {
    const res = await call(ADMIN, order(A));
    expect(res.body?.capability).toBe(BILLING_PLATFORM_MANAGE);
  });
  it('billing.platform.manage is platform-tier, held by SUPER_ADMIN and by no tenant role', () => {
    expect(PLATFORM_TIER_CAPABILITIES).toContain(BILLING_PLATFORM_MANAGE);
    expect(capabilitiesForRole('SUPER_ADMIN')).toContain(BILLING_PLATFORM_MANAGE);
    for (const r of ['COMPANY_ADMIN', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER', 'CONTENT_CREATOR', 'VIEW_ONLY', 'CONTENT_ARCHITECT']) {
      expect(capabilitiesForRole(r)).not.toContain(BILLING_PLATFORM_MANAGE);
    }
  });
  it('authorization does not depend on the target organisation (no organisation scope in the audit trail)', async () => {
    await call(ADMIN, order(A));
    await call(ADMIN, order(B));
    const denials = mockAudit.filter((a) => a.decision === 'denied');
    expect(denials).toHaveLength(2);
    for (const d of denials) expect(d.organizationId ?? null).toBeNull();
  });
});

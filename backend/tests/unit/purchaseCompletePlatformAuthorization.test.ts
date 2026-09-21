/**
 * CPG-069 — /api/super-admin/purchases/complete is a PLATFORM-ONLY operator
 * tool (security regression).
 *
 * THE DEFECT (CPG-068): the route authorized on the TENANT capability
 * billing.purchase with an OPTIONAL, caller-supplied organisation scope. With
 * no organization_id the gate fell back to the cross-org capability union, so
 * a tenant COMPANY_ADMIN could create a pending purchase for their own org with
 * arbitrary credits and then complete it — a paid credit grant with no
 * payment — or complete / fail another organisation's pending purchase. The
 * route has no payment verification by design (manual / offline purchases), so
 * authorization is its only boundary.
 *
 * THE FIX: authorize on the platform-tier billing.platform.manage with no
 * organisation scope. create still requires organization_id as the purchase
 * binding; complete / fail act on the purchase row, whose organization_id is
 * authoritative.
 *
 * REAL chain: route → requireCapability → resolvePrincipal →
 * resolveUserCapabilities → decideCapabilityWithStepUp → evaluateStepUp →
 * monetization env gates → purchaseService (completePurchase / failPurchase) →
 * createCredit → callCreditReservation. Only persistence is replaced: an
 * in-memory store; the credit RPC is RECORDED, never executed.
 */
type Row = Record<string, unknown>;
const mockDb: Record<string, Row[]> = {};
const mockRpc: { fn: string; args: Row }[] = [];
const mockWrites: { table: string; op: string; payload?: Row }[] = [];
const mockReads: string[] = [];
let mockSeq = 0;
function mockBuilder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: Row | null = null;
  let lastInserted: Row | null = null;
  const b: Record<string, unknown> = {};
  const chain = () => b;
  const matching = () => (mockDb[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const run = (): Row[] => {
    if (op === 'insert') return lastInserted ? [lastInserted] : [];
    if (op === 'update') { const hit = matching(); for (const r of hit) Object.assign(r, payload); return hit; }
    mockReads.push(table);
    return matching();
  };
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain, not: chain, contains: chain, limit: chain,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    insert: (p: Row) => {
      op = 'insert';
      lastInserted = { id: `${table}-${++mockSeq}`, ...p };
      (mockDb[table] ??= []).push(lastInserted);
      mockWrites.push({ table, op: 'insert', payload: p });
      return b;
    },
    update: (p: Row) => { op = 'update'; payload = p; mockWrites.push({ table, op: 'update', payload: p }); return b; },
    upsert: (p: Row) => { mockWrites.push({ table, op: 'upsert', payload: p }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => { const r = run()[0]; return { data: r ?? null, error: r ? null : { message: 'no rows' } }; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockBuilder(t),
    rpc: async (fn: string, args: Row) => { mockRpc.push({ fn, args }); return { data: { id: 'tx-recorded' }, error: null }; },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers: Record<string, string> }) => {
    const id = req.headers['x-test-user'];
    return id ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null } : { user: null, error: 'NO_TOKEN' };
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
const mockAudit: Row[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Row) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import route from '../../../pages/api/super-admin/purchases/complete';
import { capabilitiesForRole } from '../../security/capabilityRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { BILLING_PLATFORM_MANAGE } from '../../../shared/contracts/security';

// ── Synthetic identities ─────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '44444444-4444-4444-8444-444444444444';
const PKG = '55555555-5555-4555-8555-555555555555';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function bareFingerprint(): string { let h = 5381; for (const ch of '||') h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return `dj2-${h.toString(36)}`; }
const U = {
  ADMIN_A: 'u-admin-a', GRANT_PURCHASE: 'u-grant-purchase', GRANT_MANAGE: 'u-grant-manage', VIEWER_A: 'u-view-a',
  SUPER: 'u-super', SUPER_NO_STEPUP: 'u-super-nostep', SUPER_UNTRUSTED: 'u-super-untrusted',
};
const role = (user_id: string, company_id: string, r: string) => ({ user_id, company_id, role: r, status: 'active' });
const grant = (user_id: string, capability: string) => ({ user_id, capability, organization_id: null, expires_at: null, revoked_at: null });

const ENV = ['RAZORPAY_STAGING_ENABLED', 'EXTERNAL_BETA_ENABLED', 'INTERNAL_STAGING_ONLY', 'MONETIZATION_STAGING_KILL_SWITCH', 'MONETIZATION_READ_ONLY_AUDIT_MODE'];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterAll(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
function env(o: { staging?: boolean; externalBeta?: boolean; internalOnly?: string; readOnly?: boolean; kill?: boolean } = {}) {
  process.env.RAZORPAY_STAGING_ENABLED = o.staging === false ? 'false' : 'true';
  if (o.externalBeta) process.env.EXTERNAL_BETA_ENABLED = 'true'; else delete process.env.EXTERNAL_BETA_ENABLED;
  if (o.internalOnly !== undefined) process.env.INTERNAL_STAGING_ONLY = o.internalOnly; else delete process.env.INTERNAL_STAGING_ONLY;
  if (o.readOnly) process.env.MONETIZATION_READ_ONLY_AUDIT_MODE = 'true'; else delete process.env.MONETIZATION_READ_ONLY_AUDIT_MODE;
  if (o.kill) process.env.MONETIZATION_STAGING_KILL_SWITCH = 'true'; else delete process.env.MONETIZATION_STAGING_KILL_SWITCH;
}
const purchase = (id: string, org: string, extra: Row = {}) => ({
  id, organization_id: org, package_id: PKG, credits: 100, amount_paid: 0, currency: 'USD', status: 'pending',
  fulfillment_status: null, reference_id: null, provider: null, provider_payment_id: null, ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockRpc.length = 0; mockWrites.length = 0; mockReads.length = 0; mockAudit.length = 0;
  env();
  mockDb.user_company_roles = [
    role(U.ADMIN_A, A, 'COMPANY_ADMIN'), role(U.GRANT_PURCHASE, A, 'COMPANY_ADMIN'), role(U.GRANT_MANAGE, A, 'COMPANY_ADMIN'),
    role(U.VIEWER_A, A, 'VIEW_ONLY'), role(U.SUPER, P, 'SUPER_ADMIN'), role(U.SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(U.SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
  ];
  mockDb.capability_assignments = [grant(U.GRANT_PURCHASE, 'billing.purchase'), grant(U.GRANT_MANAGE, 'billing.manage')];
  // Every principal except SUPER_NO_STEPUP holds a valid passkey step-up; every
  // principal except SUPER_UNTRUSTED is on a trusted device. Tenant denials
  // therefore come from the capability, never from step-up.
  mockDb.stepup_sessions = Object.values(U).filter((u) => u !== U.SUPER_NO_STEPUP)
    .map((u) => ({ id: `su-${u}`, user_id: u, auth_session_id: `sess-${u}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }));
  mockDb.trusted_devices = Object.values(U).filter((u) => u !== U.SUPER_UNTRUSTED)
    .map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: bareFingerprint(), expires_at: FUTURE(), revoked_at: null }));
  mockDb.users = [];
  mockDb.credit_purchases = [
    purchase('pur-a', A), purchase('pur-b', B, { credits: 5000 }), purchase('pur-p', P),
    purchase('pur-b-done', B, { status: 'completed', fulfillment_status: 'completed' }),
  ];
});

function fakeRes() {
  const r: { statusCode: number; body: Row | undefined } & Row = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: Row) => { r.body = b; return r; };
  r.setHeader = () => r; r.end = () => r;
  return r;
}
async function call(user: string | null, body: Row) {
  const res = fakeRes();
  await (route as (q: unknown, s: unknown) => Promise<unknown>)({ headers: user ? { 'x-test-user': user } : {}, query: {}, body, method: 'POST', url: '/api/super-admin/purchases/complete', socket: {} }, res);
  return res;
}
const grants = () => mockRpc.filter((c) => c.fn === 'apply_credit_reservation' && c.args.p_phase === 'grant');
const row = (id: string) => mockDb.credit_purchases.find((r) => r.id === id)!;
const purchaseEffects = () => ({
  purchaseReads: mockReads.filter((t) => t === 'credit_purchases' || t === 'payment_provider_events').length,
  purchaseWrites: mockWrites.filter((w) => w.table === 'credit_purchases' || w.table === 'payment_provider_events').length,
  creditRpc: mockRpc.length,
});
function expectDenied(res: { statusCode: number; body: Row | undefined }, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  expect(res.body?.code).toBe(code);
  // Refused before the purchase is even looked up: no read, no write, no credit.
  expect(purchaseEffects()).toEqual({ purchaseReads: 0, purchaseWrites: 0, creditRpc: 0 });
}
function expectCredited(res: { statusCode: number; body: Row | undefined }, org: string, amount: number) {
  expect(res.statusCode).toBe(200);
  expect(grants()).toHaveLength(1);
  expect(grants()[0].args).toMatchObject({ p_org_id: org, p_paid_amount: amount, p_category: 'paid' });
}

describe('A — tenant COMPANY_ADMIN is denied every shape', () => {
  it('1. own purchase + organization_id', async () => expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-a', organization_id: A }), 403, 'CAPABILITY_NOT_HELD'));
  it('2. own purchase + no organization_id', async () => expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-a' }), 403, 'CAPABILITY_NOT_HELD'));
  it('3. other org purchase + organization_id', async () => expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-b', organization_id: A }), 403, 'CAPABILITY_NOT_HELD'));
  it('4. other org purchase + no organization_id', async () => expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD'));
  it('fail action on another org purchase', async () => {
    expectDenied(await call(U.ADMIN_A, { action: 'fail', purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD');
    expect(row('pur-b').status).toBe('pending');
  });
});

describe('B/C — org-less tenant grants cannot substitute for the platform capability', () => {
  it('5. org-less billing.purchase + own purchase', async () => expectDenied(await call(U.GRANT_PURCHASE, { purchase_id: 'pur-a' }), 403, 'CAPABILITY_NOT_HELD'));
  it('6. org-less billing.purchase + other org purchase', async () => expectDenied(await call(U.GRANT_PURCHASE, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD'));
  it('7. org-less billing.manage + own purchase', async () => expectDenied(await call(U.GRANT_MANAGE, { purchase_id: 'pur-a' }), 403, 'CAPABILITY_NOT_HELD'));
  it('8. org-less billing.manage + other org purchase', async () => expectDenied(await call(U.GRANT_MANAGE, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD'));
});

describe('D — VIEW_ONLY', () => {
  it('9. own purchase', async () => expectDenied(await call(U.VIEWER_A, { purchase_id: 'pur-a' }), 403, 'CAPABILITY_NOT_HELD'));
  it('10. other org purchase', async () => expectDenied(await call(U.VIEWER_A, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD'));
});

describe('E — SUPER_ADMIN (platform capability, passkey + trusted device)', () => {
  it('11. own (platform) org purchase', async () => expectCredited(await call(U.SUPER, { purchase_id: 'pur-p' }), P, 100));
  it('12. another org purchase → credits the PURCHASE ROW org', async () => expectCredited(await call(U.SUPER, { purchase_id: 'pur-b' }), B, 5000));
  it('13. body organization_id is not an authorization scope and cannot redirect the credit', async () => {
    // Before the fix, organization_id=B denied SA (NOT_ORG_MEMBER); a mismatching value is simply ignored now.
    expectCredited(await call(U.SUPER, { purchase_id: 'pur-b', organization_id: A }), B, 5000);
  });
  it('SUPER_ADMIN fails another org purchase', async () => {
    const res = await call(U.SUPER, { action: 'fail', purchase_id: 'pur-b' });
    expect(res.statusCode).toBe(200);
    expect(row('pur-b')).toMatchObject({ status: 'failed', fulfillment_status: 'failed' });
    expect(mockRpc).toEqual([]);
  });
  it('without a step-up session → 401 STEP_UP_REQUIRED, nothing touched', async () => expectDenied(await call(U.SUPER_NO_STEPUP, { purchase_id: 'pur-b' }), 401, 'STEP_UP_REQUIRED'));
  it('on an untrusted device → 401 STEP_UP_REQUIRED, nothing touched', async () => expectDenied(await call(U.SUPER_UNTRUSTED, { purchase_id: 'pur-b' }), 401, 'STEP_UP_REQUIRED'));
  it('unauthenticated → 401, nothing touched', async () => expectDenied(await call(null, { purchase_id: 'pur-b' }), 401, 'NOT_AUTHENTICATED'));
});

describe('F — create', () => {
  it('14. tenant COMPANY_ADMIN cannot create a manual purchase (own org)', async () => {
    expectDenied(await call(U.ADMIN_A, { action: 'create', organization_id: A, package_id: PKG, credits: 1_000_000 }), 403, 'CAPABILITY_NOT_HELD');
    expect(mockDb.credit_purchases).toHaveLength(4);
  });
  it('15. SUPER_ADMIN creates for a target organisation; the row is bound to it', async () => {
    const res = await call(U.SUPER, { action: 'create', organization_id: B, package_id: PKG, credits: 250 });
    expect(res.statusCode).toBe(201);
    const inserted = mockDb.credit_purchases[mockDb.credit_purchases.length - 1];
    expect(inserted).toMatchObject({ id: res.body?.purchase_id, organization_id: B, credits: 250, status: 'pending' });
  });
  it('16. missing organization_id → 400, nothing written', async () => {
    const res = await call(U.SUPER, { action: 'create', package_id: PKG, credits: 250 });
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('organization_id is required');
    expect(mockWrites).toEqual([]);
  });
});

describe('G — payment / state invariants', () => {
  it('17. an unpaid manual purchase can still be completed by SUPER_ADMIN (manual-operator contract)', async () => {
    expectCredited(await call(U.SUPER, { purchase_id: 'pur-b' }), B, 5000);
    expect(row('pur-b')).toMatchObject({ status: 'completed', fulfillment_status: 'completed', provider: null, amount_paid: 0 });
  });
  it('18. a tenant cannot complete that unpaid purchase', async () => {
    expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD');
    expect(row('pur-b').status).toBe('pending');
  });
  it('19. already-completed purchase stays idempotent: 200, no second grant', async () => {
    const res = await call(U.SUPER, { purchase_id: 'pur-b-done' });
    expect(res.statusCode).toBe(200);
    expect(grants()).toEqual([]);
  });
  it('failed purchase cannot be completed (409), no grant', async () => {
    await call(U.SUPER, { action: 'fail', purchase_id: 'pur-b' });
    mockRpc.length = 0;
    const res = await call(U.SUPER, { purchase_id: 'pur-b' });
    expect(res.statusCode).toBe(409);
    expect(grants()).toEqual([]);
  });
  it.each([
    ['staging disabled', { staging: false }, 'monetization_staging_disabled'],
    ['read-only audit mode', { readOnly: true }, 'monetization_read_only_audit_mode'],
    ['kill switch', { kill: true }, 'monetization_global_kill_switch_enabled'],
    ['external beta mode', { externalBeta: true, internalOnly: 'false' }, 'legacy_manual_purchase_endpoint_disabled_for_external_beta'],
    ['exposure-mode conflict', { externalBeta: true }, 'monetization_exposure_mode_conflict'],
  ] as const)('20. %s → SUPER_ADMIN still refused with 403, nothing touched', async (_n, e, err) => {
    env(e);
    const res = await call(U.SUPER, { purchase_id: 'pur-b' });
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe(err);
    expect(purchaseEffects()).toEqual({ purchaseReads: 0, purchaseWrites: 0, creditRpc: 0 });
  });
});

describe('H — ordering: authorization precedes every protected effect', () => {
  it('21–23. a denied tenant reaches no lookup, completion, provider-event record, or credit (all actions)', async () => {
    for (const body of [
      { purchase_id: 'pur-b' },
      { purchase_id: 'pur-b', provider: 'razorpay', provider_event_id: 'evt-1' },
      { action: 'fail', purchase_id: 'pur-b' },
      { action: 'create', organization_id: A, package_id: PKG, credits: 5 },
    ]) {
      expectDenied(await call(U.ADMIN_A, body), 403, 'CAPABILITY_NOT_HELD');
    }
  });
  it('tenant denial happens even when the environment would refuse (authorization runs first)', async () => {
    env({ staging: false });
    expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-b' }), 403, 'CAPABILITY_NOT_HELD');
  });
});

describe('CPG-068 exploit characterization — now closed', () => {
  it('X1. tenant create → complete (self-mint) stops at authorization', async () => {
    expectDenied(await call(U.ADMIN_A, { action: 'create', organization_id: A, package_id: PKG, credits: 1_000_000 }), 403, 'CAPABILITY_NOT_HELD');
    expectDenied(await call(U.ADMIN_A, { purchase_id: 'pur-a' }), 403, 'CAPABILITY_NOT_HELD');
  });
  it('X6. SUPER_ADMIN completes another org purchase', async () => expectCredited(await call(U.SUPER, { purchase_id: 'pur-b' }), B, 5000));
  it('the route requires billing.platform.manage: platform-tier, SUPER_ADMIN-held, no tenant role holds it', async () => {
    const res = await call(U.ADMIN_A, { purchase_id: 'pur-a' });
    expect(res.body?.capability).toBe(BILLING_PLATFORM_MANAGE);
    expect(PLATFORM_TIER_CAPABILITIES).toContain(BILLING_PLATFORM_MANAGE);
    expect(capabilitiesForRole('SUPER_ADMIN')).toContain(BILLING_PLATFORM_MANAGE);
    for (const r of ['COMPANY_ADMIN', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER', 'CONTENT_CREATOR', 'VIEW_ONLY', 'CONTENT_ARCHITECT']) {
      expect(capabilitiesForRole(r)).not.toContain(BILLING_PLATFORM_MANAGE);
    }
  });
  it('authorization carries no organisation scope (audit rows are org-less for every shape)', async () => {
    await call(U.ADMIN_A, { purchase_id: 'pur-b', organization_id: A });
    await call(U.ADMIN_A, { action: 'create', organization_id: A, package_id: PKG, credits: 5 });
    const denials = mockAudit.filter((a) => a.decision === 'denied');
    expect(denials).toHaveLength(2);
    for (const d of denials) expect(d.organizationId ?? null).toBeNull();
  });
});

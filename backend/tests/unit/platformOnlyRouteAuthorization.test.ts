/**
 * CPG-065 — platform-only route authorization (security regression).
 *
 * THE DEFECT (CPG-064): 13 platform-only routes under /api/super-admin/* and
 * /api/admin/billing/* were gated on TENANT capabilities (content.publish,
 * billing.purchase, billing.manage) with no organizationId. decideCapability
 * then checks only the cross-organisation capability union, so a tenant
 * COMPANY_ADMIN (and, for the operations routes, a CONTENT_PUBLISHER) passed.
 *
 * THE FIX: each route now requests a PLATFORM-TIER capability — one that
 * assertPlatformCapabilityIsolation guarantees no tenant role holds.
 *
 * These tests drive the REAL chain: route handler → requireCapability →
 * resolvePrincipal (IdentityResolver) → resolveUserCapabilities
 * (CapabilityService) → decideCapability / decideCapabilityWithStepUp →
 * evaluateStepUp. Only I/O is replaced: database rows, the identity lookup,
 * the session lookup, the legacy bridge, the audit sink, per-IP rate limiting
 * and each route's downstream side effect. `requireCapability` is NOT mocked.
 */

// ── Database fake: a query builder over in-memory rows ───────────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string }[] = [];
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
    update: () => { mockWrites.push({ table, op: 'update' }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    insert: () => { mockWrites.push({ table, op: 'insert' }); return b; },
    upsert: () => { mockWrites.push({ table, op: 'upsert' }); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej),
  });
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockBuilder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));

// ── Identity + session: chosen by test headers ───────────────────────────────
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
    if (!user || !req.headers['x-test-session']) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  resolveLegacyCookieSuperAdminPrincipal: async () => null,
}));
const mockAudit: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// Per-IP rate limiting is throttling, not authorization (CPG-064): always admit.
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));

// ── Route side effects (the things authorization must precede) ───────────────
const fx = {
  getObservabilitySnapshot: jest.fn(() => ({ api: {} })),
  captureBaseline: jest.fn(async () => ({ key: 'k', persisted: true })),
  listBaselines: jest.fn(async () => []),
  opsSnapshot: jest.fn(() => ({ rolloutFlags: [] })),
  reconcileRow: jest.fn(async () => ({ ran: true, analysis: { kind: 'ok' } })),
  resumeThreadPublish: jest.fn(async () => ({ status: 'COMPLETED' })),
  insertAuditLogStrict: jest.fn(async () => undefined),
  getSocialAccount: jest.fn(async () => ({ platform: 'linkedin', platform_user_id: 'p1' })),
  getToken: jest.fn(async () => ({ access_token: 'redacted' })),
  getOrUploadLinkedInAsset: jest.fn(async () => ({ ok: true, result: { kind: 'image', fromCache: false } })),
  getFxConfig: jest.fn(async () => ({})),
  getPlanPricing: jest.fn(async () => []),
  setFxRate: jest.fn(async () => undefined),
  setPriceOverride: jest.fn(async () => undefined),
  setPlanPricing: jest.fn(async () => undefined),
  runMonthlyAllocationSweep: jest.fn(async () => ({ granted: 0 })),
  commercialReconcile: jest.fn(async () => ({ found: 0 })),
  verifyAndFulfill: jest.fn(async () => ({ status: 'processed' })),
  replayProviderEvent: jest.fn(async () => ({})),
  reconcileReservations: jest.fn(async () => ({})),
  recordOpsEvent: jest.fn(async () => undefined),
};
// Route a mocked export to its fx spy (factories run lazily, after fx exists).
const via = (k: keyof typeof fx) => (...a: unknown[]) => (fx[k] as (...x: unknown[]) => unknown)(...a);
const none = async () => ({});
jest.mock('../../observability', () => ({ getObservabilitySnapshot: via('getObservabilitySnapshot') }));
jest.mock('../../observability/baseline', () => ({ captureBaseline: via('captureBaseline'), listBaselines: via('listBaselines'), getBaseline: async () => null, compareBaselines: () => ({}) }));
jest.mock('../../services/operationsCenterService', () => ({
  getOperationsCenterSnapshot: via('opsSnapshot'), summarizeAiRuntime: () => null, getEmailRuntimeView: async () => null, getStorageRuntimeView: async () => null,
  getWebsiteIntelligenceRuntimeView: async () => null, getMarketIntelligenceRuntimeView: async () => null, getDeploymentRuntimeView: () => null, buildOperationsSummary: () => ({}),
}));
jest.mock('../../services/aiGatewayCore', () => ({ getLlmPoolPressure: () => ({}) }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({}));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: via('insertAuditLogStrict'), SYSTEM_USER_ID: 'system' }));
jest.mock('../../services/providerReconciliation/reconcileRow', () => ({ reconcileRow: via('reconcileRow') }));
jest.mock('../../services/threadRuntime/threadPublishOrchestrator', () => ({ resumeThreadPublish: via('resumeThreadPublish') }));
jest.mock('../../db/queries', () => ({ getSocialAccount: via('getSocialAccount') }));
jest.mock('../../auth/tokenStore', () => ({ getToken: via('getToken') }));
jest.mock('../../adapters/linkedin/linkedinMediaUpload', () => ({ getOrUploadLinkedInAsset: via('getOrUploadLinkedInAsset'), inferLinkedInMediaKind: () => 'image' }));
jest.mock('../../services/pricingConfigService', () => ({
  getFxConfig: via('getFxConfig'), getPlanPricing: via('getPlanPricing'), setFxRate: via('setFxRate'), setPriceOverride: via('setPriceOverride'), setPlanPricing: via('setPlanPricing'),
}));
jest.mock('../../services/subscriptionAllocationService', () => ({ runMonthlyAllocationSweep: via('runMonthlyAllocationSweep') }));
jest.mock('../../services/billing/commercialReconciliationService', () => ({ reconcile: via('commercialReconcile') }));
jest.mock('../../services/payments/razorpayStagingService', () => ({ verifyAndFulfillRazorpayStagingPayment: via('verifyAndFulfill'), replayRazorpayStagingProviderEvent: via('replayProviderEvent') }));
jest.mock('../../services/monetizationOpsService', () => ({
  assertMonetizationOperationAllowed: () => undefined, getMonetizationAlertSummary: none, listMonetizationOperationalEvents: async () => [],
  getMonetizationControlMode: () => ({ externalBetaEnabled: false, replayDryRunOnly: false }), recordMonetizationOperationalEvent: via('recordOpsEvent'),
}));
jest.mock('../../services/monetizationReservationReconciliationService', () => ({ auditMonetizationInvariants: none, reconcileDurableMonetizationReservations: via('reconcileReservations') }));
jest.mock('../../services/monetizationSupportRunbookService', () => ({ listMonetizationSupportCases: async () => [], listMonetizationSupportRunbooks: async () => [] }));
jest.mock('../../services/monetizationBetaAccessService', () => ({
  getMonetizationBetaRuntimeMode: () => ({}), listMonetizationBetaHealthSummary: none, recordMonetizationBetaSupportAction: none, updateMonetizationBetaSupportCase: none,
}));
jest.mock('../../services/monetizationIncidentOpsService', () => ({
  buildMonetizationIncidentTimeline: none, getMonetizationDailyReviewSummary: none, listMonetizationBetaDrillSummary: none, recordMonetizationBetaDrill: none,
}));

import * as fs from 'fs';
import * as path from 'path';
import { decideCapability } from '../../security/AuthorizationService';
import { capabilitiesForRole, legacyCookieSuperAdminCapabilities } from '../../security/capabilityRegistry';
import { PLATFORM_TIER_CAPABILITIES, assertPlatformCapabilityIsolation } from '../../security/platformCapabilities';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import {
  BILLING_MANAGE, BILLING_PLAN_MANAGE, BILLING_PLATFORM_MANAGE, BILLING_PURCHASE, CONTENT_PUBLISH,
  INTEGRATION_PLATFORM_OAUTH_MANAGE, STEP_UP_REQUIRED_CAPABILITIES, SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';
import type { AuthenticatedPrincipal, Capability } from '../../../shared/contracts/security';
import observabilityRoute from '../../../pages/api/super-admin/observability';
import baselineRoute from '../../../pages/api/super-admin/observability-baseline';
import opsCenterRoute from '../../../pages/api/super-admin/operations-center';
import reconSummaryRoute from '../../../pages/api/super-admin/reconciliation-summary';
import healthSummaryRoute from '../../../pages/api/super-admin/system-health-summary';
import smokeTestRoute from '../../../pages/api/super-admin/linkedin-media-smoke-test';
import threadReconcileRoute from '../../../pages/api/super-admin/threads/[threadId]/reconcile';
import threadResumeRoute from '../../../pages/api/super-admin/threads/[threadId]/resume';
import pricingRoute from '../../../pages/api/super-admin/pricing/index';
import allocateRoute from '../../../pages/api/admin/billing/allocate';
import billingReconcileRoute from '../../../pages/api/admin/billing/reconcile';
import verifyStagingRoute from '../../../pages/api/super-admin/razorpay/verify-staging-payment';
import monetizationRoute from '../../../pages/api/super-admin/monetization/operations';

// ── Fixtures ────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN row
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();

const role = (user_id: string, company_id: string, r: string) => ({ user_id, company_id, role: r, status: 'active' });
const assign = (user_id: string, capability: string) =>
  ({ user_id, capability, organization_id: null, expires_at: null, revoked_at: null });
const stepUp = (user_id: string, factor: string) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });

/** Mirror of IdentityResolver's server-side fingerprint for a request with no UA / language / cookies. */
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const trustedDevice = (user_id: string) =>
  ({ id: `dev-${user_id}`, user_id, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });

// Users. Every tenant user below holds a FULLY VALID step-up (passkey + trusted
// device) so a denial can only come from the capability, never from step-up.
const TENANT_ADMIN = 'u-tenant-admin';     // COMPANY_ADMIN of A, no SUPER_ADMIN
const TENANT_PUBLISHER = 'u-tenant-pub';   // CONTENT_PUBLISHER of A, no SUPER_ADMIN
const TENANT_CAP_HOLDER = 'u-tenant-caps'; // VIEW_ONLY + org-less grants of the three tenant caps
const SUPER = 'u-super';                   // SUPER_ADMIN, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';  // SUPER_ADMIN, no step-up session
const SUPER_TOTP = 'u-super-totp';         // SUPER_ADMIN, step-up via TOTP (not phishing-resistant)
const SUPER_UNTRUSTED = 'u-super-untrusted'; // SUPER_ADMIN, passkey step-up, device NOT trusted

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockAudit.length = 0;
  for (const f of Object.values(fx)) f.mockClear();
  mockTables.user_company_roles = [
    role(TENANT_ADMIN, A, 'COMPANY_ADMIN'),
    role(TENANT_PUBLISHER, A, 'CONTENT_PUBLISHER'),
    role(TENANT_CAP_HOLDER, A, 'VIEW_ONLY'),
    role(SUPER, P, 'SUPER_ADMIN'),
    role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'),
    role(SUPER_TOTP, P, 'SUPER_ADMIN'),
    role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
  ];
  mockTables.capability_assignments = [
    assign(TENANT_CAP_HOLDER, CONTENT_PUBLISH),
    assign(TENANT_CAP_HOLDER, BILLING_PURCHASE),
    assign(TENANT_CAP_HOLDER, BILLING_MANAGE),
  ];
  mockTables.stepup_sessions = [
    stepUp(TENANT_ADMIN, 'webauthn'), stepUp(TENANT_PUBLISHER, 'webauthn'), stepUp(TENANT_CAP_HOLDER, 'webauthn'),
    stepUp(SUPER, 'webauthn'), stepUp(SUPER_TOTP, 'totp'), stepUp(SUPER_UNTRUSTED, 'webauthn'),
  ];
  mockTables.trusted_devices = [
    trustedDevice(TENANT_ADMIN), trustedDevice(TENANT_PUBLISHER), trustedDevice(TENANT_CAP_HOLDER),
    trustedDevice(SUPER), trustedDevice(SUPER_NO_STEPUP), trustedDevice(SUPER_TOTP),
  ];
  mockTables.users = [];
  mockTables.scheduled_posts = [];
  mockTables.queue_jobs = [];
});

type Req = { headers: Record<string, string>; query: Record<string, unknown>; body: unknown; method: string; url: string; socket: unknown };
function fakeRes() {
  const r: { statusCode: number; body: unknown; headers: Record<string, unknown> } & Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
}
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;

// ── The 16 affected method surfaces ──────────────────────────────────────────
interface Surface {
  name: string;
  handler: Handler;
  method: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  capability: Capability;
  group: 'content' | 'billing';
  /** The protected side effect(s) that must not run unless authorized. */
  effects: jest.Mock[];
}
const VERIFY_BODY = { razorpay_order_id: 'order_test_1', razorpay_payment_id: 'pay_test_1', razorpay_signature: 'sig' };
const SURFACES: Surface[] = [
  { name: 'GET super-admin/observability', handler: observabilityRoute as Handler, method: 'GET', capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.getObservabilitySnapshot] },
  { name: 'GET super-admin/observability-baseline', handler: baselineRoute as Handler, method: 'GET', query: { action: 'list' }, capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.listBaselines] },
  { name: 'POST super-admin/observability-baseline', handler: baselineRoute as Handler, method: 'POST', body: { label: 't' }, capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.captureBaseline] },
  { name: 'GET super-admin/operations-center', handler: opsCenterRoute as Handler, method: 'GET', capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.opsSnapshot] },
  { name: 'GET super-admin/reconciliation-summary', handler: reconSummaryRoute as Handler, method: 'GET', capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [] },
  { name: 'GET super-admin/system-health-summary', handler: healthSummaryRoute as Handler, method: 'GET', capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [] },
  { name: 'POST super-admin/linkedin-media-smoke-test', handler: smokeTestRoute as Handler, method: 'POST', body: { scheduledPostId: 'row-1', socialAccountId: 'acct-1', sourceUrl: 'https://example.test/a.jpg', mimeType: 'image/jpeg' }, capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, group: 'content', effects: [fx.getSocialAccount, fx.getToken, fx.getOrUploadLinkedInAsset, fx.insertAuditLogStrict] },
  { name: 'POST super-admin/threads/[threadId]/reconcile', handler: threadReconcileRoute as Handler, method: 'POST', query: { threadId: 'row-1' }, capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.reconcileRow, fx.insertAuditLogStrict] },
  { name: 'POST super-admin/threads/[threadId]/resume', handler: threadResumeRoute as Handler, method: 'POST', query: { threadId: 'root-1' }, capability: SUPER_ADMIN_DASHBOARD_VIEW, group: 'content', effects: [fx.resumeThreadPublish, fx.insertAuditLogStrict] },
  { name: 'GET super-admin/pricing', handler: pricingRoute as Handler, method: 'GET', capability: BILLING_PLAN_MANAGE, group: 'billing', effects: [fx.getFxConfig, fx.getPlanPricing] },
  { name: 'POST super-admin/pricing', handler: pricingRoute as Handler, method: 'POST', body: { action: 'fx', currency: 'EUR', rate: 0.9 }, capability: BILLING_PLAN_MANAGE, group: 'billing', effects: [fx.setFxRate, fx.setPriceOverride, fx.setPlanPricing] },
  { name: 'POST admin/billing/allocate', handler: allocateRoute as Handler, method: 'POST', body: { dry_run: false }, capability: BILLING_PLATFORM_MANAGE, group: 'billing', effects: [fx.runMonthlyAllocationSweep] },
  { name: 'POST admin/billing/reconcile', handler: billingReconcileRoute as Handler, method: 'POST', body: { scope: 'global', dry_run: false }, capability: BILLING_PLATFORM_MANAGE, group: 'billing', effects: [fx.commercialReconcile] },
  { name: 'POST super-admin/razorpay/verify-staging-payment', handler: verifyStagingRoute as Handler, method: 'POST', body: { ...VERIFY_BODY }, capability: BILLING_PLATFORM_MANAGE, group: 'billing', effects: [fx.verifyAndFulfill] },
  { name: 'GET super-admin/monetization/operations', handler: monetizationRoute as Handler, method: 'GET', capability: BILLING_PLATFORM_MANAGE, group: 'billing', effects: [fx.recordOpsEvent] },
  { name: 'POST super-admin/monetization/operations', handler: monetizationRoute as Handler, method: 'POST', body: { action: 'reconcile' }, capability: BILLING_PLATFORM_MANAGE, group: 'billing', effects: [fx.reconcileReservations, fx.recordOpsEvent] },
];
const CONTENT = SURFACES.filter((s) => s.group === 'content');
const BILLING = SURFACES.filter((s) => s.group === 'billing');

async function call(s: Surface, user: string, over: { body?: Record<string, unknown>; session?: boolean } = {}) {
  const headers: Record<string, string> = { 'x-test-user': user };
  if (over.session !== false) headers['x-test-session'] = '1';
  const r: Req = { headers, query: { ...(s.query ?? {}) }, body: { ...(over.body ?? s.body ?? {}) }, method: s.method, url: `/api/${s.name}`, socket: {} };
  const res = fakeRes();
  await s.handler(r, res);
  return res;
}
const code = (res: { body: unknown }) => (res.body as { code?: string } | undefined)?.code;
const expectNoEffects = (s: Surface) => {
  for (const e of s.effects) expect(e).not.toHaveBeenCalled();
  expect(mockWrites).toEqual([]);
};

describe('route inventory', () => {
  it('covers exactly the 16 affected method surfaces (9 content, 7 billing)', () => {
    expect(SURFACES).toHaveLength(16);
    expect(CONTENT).toHaveLength(9);
    expect(BILLING).toHaveLength(7);
  });
});

describe('Test 1 — tenant COMPANY_ADMIN (no SUPER_ADMIN, valid step-up) is denied', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → 403 CAPABILITY_NOT_HELD, no side effect', async (_n, s) => {
    const res = await call(s, TENANT_ADMIN);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CAPABILITY_NOT_HELD');
    expect((res.body as { capability: string }).capability).toBe(s.capability);
    expectNoEffects(s);
  });
});

describe('Test 2 — tenant CONTENT_PUBLISHER is denied on the content/operations surfaces', () => {
  it.each(CONTENT.map((s) => [s.name, s] as const))('%s → 403, no side effect', async (_n, s) => {
    const res = await call(s, TENANT_PUBLISHER);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CAPABILITY_NOT_HELD');
    expectNoEffects(s);
  });
});

describe('Test 3 — SUPER_ADMIN is allowed through the platform capability', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → authorized and the route runs', async (_n, s) => {
    const res = await call(s, SUPER);
    expect([401, 403]).not.toContain(res.statusCode);
    expect(res.statusCode).toBe(200);
    for (const e of s.effects.slice(0, 1)) expect(e).toHaveBeenCalled();
    expect(mockAudit.filter((a) => a.decision === 'denied' || a.decision === 'step_up_required')).toEqual([]);
  });
});

describe('Test 4 — tenant capabilities cannot substitute for the platform capability', () => {
  it('the substituted capabilities are really held (org-less grants) — the gate is what refuses them', () => {
    const held = [CONTENT_PUBLISH, BILLING_PURCHASE, BILLING_MANAGE];
    const principal = { capabilities: held } as unknown as AuthenticatedPrincipal;
    for (const c of held) expect(principal.capabilities).toContain(c);
  });
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → a holder of content.publish + billing.purchase + billing.manage is denied', async (_n, s) => {
    const res = await call(s, TENANT_CAP_HOLDER);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CAPABILITY_NOT_HELD');
    expectNoEffects(s);
  });
  it('the route gates no longer name any tenant capability (source-level)', () => {
    const files = [
      'super-admin/observability.ts', 'super-admin/observability-baseline.ts', 'super-admin/operations-center.ts',
      'super-admin/reconciliation-summary.ts', 'super-admin/system-health-summary.ts', 'super-admin/linkedin-media-smoke-test.ts',
      'super-admin/threads/[threadId]/reconcile.ts', 'super-admin/threads/[threadId]/resume.ts', 'super-admin/pricing/index.ts',
      'admin/billing/allocate.ts', 'admin/billing/reconcile.ts', 'super-admin/razorpay/verify-staging-payment.ts',
      'super-admin/monetization/operations.ts',
    ];
    const platformNames = new Set(['SUPER_ADMIN_DASHBOARD_VIEW', 'INTEGRATION_PLATFORM_OAUTH_MANAGE', 'BILLING_PLATFORM_MANAGE', 'BILLING_PLAN_MANAGE']);
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '../../../pages/api', f), 'utf8');
      // The requirement object runs to the gate's own closing `});` line, so an
      // interpolated `${...})` inside the reason text cannot truncate it.
      const gates = [...src.matchAll(/requireCapability\s*\(\s*req\s*,\s*res\s*,\s*\{([\s\S]*?)\n\s*\}\s*\)/g)].map((m) => m[1]);
      expect(gates.length).toBeGreaterThan(0);
      for (const g of gates) {
        const cap = /capability\s*:\s*([A-Z_]+)/.exec(g)?.[1];
        expect(platformNames.has(cap ?? '')).toBe(true);
        // No organizationId PROPERTY in the requirement (a mention inside the audit reason text is fine).
        expect(g).not.toMatch(/(^|[\s{,])organizationId\s*[:,]/m);
      }
      expect(src).not.toMatch(/\b(CONTENT_PUBLISH|BILLING_PURCHASE|BILLING_MANAGE)\b/);
    }
  });
});

describe('Test 5 — platform capability isolation', () => {
  const USED = [SUPER_ADMIN_DASHBOARD_VIEW, INTEGRATION_PLATFORM_OAUTH_MANAGE, BILLING_PLATFORM_MANAGE, BILLING_PLAN_MANAGE];
  it('every capability the routes now require is platform-tier', () => {
    for (const c of USED) expect(PLATFORM_TIER_CAPABILITIES).toContain(c);
  });
  it.each(['COMPANY_ADMIN', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER', 'CONTENT_CREATOR', 'VIEW_ONLY', 'CONTENT_ARCHITECT'])(
    'tenant role %s holds none of them', (r) => {
      const caps = capabilitiesForRole(r);
      for (const c of USED) expect(caps).not.toContain(c);
    },
  );
  it('SUPER_ADMIN holds all of them', () => {
    const caps = capabilitiesForRole('SUPER_ADMIN');
    for (const c of USED) expect(caps).toContain(c);
  });
  it('assertPlatformCapabilityIsolation still passes', () => {
    expect(() => assertPlatformCapabilityIsolation()).not.toThrow();
  });
});

describe('Test 6 — billing step-up is preserved and does not bypass the platform boundary', () => {
  it('the billing capabilities keep a phishing-resistant (and trusted-device) step-up policy', () => {
    for (const c of [BILLING_PLATFORM_MANAGE, BILLING_PLAN_MANAGE]) {
      expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(c);
      expect(getStepUpPolicy(c)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true, maxAgeSeconds: 600 });
    }
  });
  it.each(BILLING.map((s) => [s.name, s] as const))('%s → SUPER_ADMIN without step-up → 401 STEP_UP_REQUIRED, no side effect', async (_n, s) => {
    const res = await call(s, SUPER_NO_STEPUP);
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe('STEP_UP_REQUIRED');
    expectNoEffects(s);
  });
  it.each(BILLING.map((s) => [s.name, s] as const))('%s → SUPER_ADMIN with a TOTP (non-phishing-resistant) step-up → 401', async (_n, s) => {
    const res = await call(s, SUPER_TOTP);
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe('STEP_UP_REQUIRED');
    expectNoEffects(s);
  });
  it.each(BILLING.map((s) => [s.name, s] as const))('%s → SUPER_ADMIN on an untrusted device → 401', async (_n, s) => {
    const res = await call(s, SUPER_UNTRUSTED);
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe('STEP_UP_REQUIRED');
    expectNoEffects(s);
  });
  it.each(BILLING.map((s) => [s.name, s] as const))('%s → tenant with a VALID step-up is still 403 (capability first)', async (_n, s) => {
    const res = await call(s, TENANT_ADMIN);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CAPABILITY_NOT_HELD');
    expectNoEffects(s);
  });
  it('the LinkedIn smoke test (platform OAuth capability) also requires step-up for SUPER_ADMIN', async () => {
    const s = SURFACES.find((x) => x.name.includes('linkedin-media-smoke-test'))!;
    const res = await call(s, SUPER_NO_STEPUP);
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe('STEP_UP_REQUIRED');
    expectNoEffects(s);
  });
});

describe('Test 7 — verify-staging-payment is platform-protected with and without organization_id', () => {
  const s = SURFACES.find((x) => x.name.includes('verify-staging-payment'))!;
  it('tenant COMPANY_ADMIN WITH its own organization_id → 403, no fulfilment', async () => {
    const res = await call(s, TENANT_ADMIN, { body: { ...VERIFY_BODY, organization_id: A } });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CAPABILITY_NOT_HELD');
    expect(fx.verifyAndFulfill).not.toHaveBeenCalled();
  });
  it('tenant COMPANY_ADMIN WITHOUT organization_id → 403, no fulfilment', async () => {
    const res = await call(s, TENANT_ADMIN, { body: { ...VERIFY_BODY } });
    expect(res.statusCode).toBe(403);
    expect(fx.verifyAndFulfill).not.toHaveBeenCalled();
  });
  it('SUPER_ADMIN with organization_id → authorized; the org is passed on as the purchase binding only', async () => {
    const res = await call(s, SUPER, { body: { ...VERIFY_BODY, organization_id: A } });
    expect(res.statusCode).toBe(200);
    expect(fx.verifyAndFulfill).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order_test_1', expectedOrganizationId: A }));
  });
  it('SUPER_ADMIN without organization_id → authorized; no org binding is invented', async () => {
    const res = await call(s, SUPER, { body: { ...VERIFY_BODY } });
    expect(res.statusCode).toBe(200);
    expect(fx.verifyAndFulfill).toHaveBeenCalledWith(expect.objectContaining({ expectedOrganizationId: null }));
  });
  it('the signature is still required before authorization is even evaluated', async () => {
    const res = await call(s, SUPER, { body: { razorpay_order_id: 'o', razorpay_payment_id: 'p' } });
    expect(res.statusCode).toBe(400);
    expect(fx.verifyAndFulfill).not.toHaveBeenCalled();
  });
});

describe('Test 8 — authorization precedes every protected side effect', () => {
  const MUTATING = SURFACES.filter((s) => s.method === 'POST');
  it.each(MUTATING.map((s) => [s.name, s] as const))('%s → denied callers reach no external publish / Redis / DB / credit / repair / pricing effect', async (_n, s) => {
    for (const u of [TENANT_ADMIN, TENANT_CAP_HOLDER, ...(s.group === 'content' ? [TENANT_PUBLISHER] : [])]) {
      const res = await call(s, u);
      expect(res.statusCode).toBe(403);
    }
    expectNoEffects(s);
  });
  it('an unauthenticated caller is refused before any effect', async () => {
    for (const s of SURFACES) {
      const res = fakeRes();
      await s.handler({ headers: {}, query: { ...(s.query ?? {}) }, body: { ...(s.body ?? {}) }, method: s.method, url: '/x', socket: {} }, res);
      expect(res.statusCode).toBe(401);
      expectNoEffects(s);
    }
  });
});

describe('legacy bridge semantics (decision level)', () => {
  const bridge = {
    userId: 'legacy:cookie-super-admin', supabaseUid: 'legacy:cookie-super-admin', email: null, emailVerified: false,
    sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0, organizations: [], activeOrgId: null,
    capabilities: legacyCookieSuperAdminCapabilities(), mfa: { enrolled: false, factors: [], lastVerifiedAt: null, phishingResistant: false },
    device: { deviceId: null, trusted: false, fingerprint: '' }, stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
    legacyCookieSuperAdmin: true,
  } as unknown as AuthenticatedPrincipal;
  it('a bridge principal lacks the mutating platform capabilities', async () => {
    for (const c of [INTEGRATION_PLATFORM_OAUTH_MANAGE, BILLING_PLATFORM_MANAGE, BILLING_PLAN_MANAGE]) {
      await expect(decideCapability(bridge, { capability: c, reason: 't' })).resolves.toMatchObject({ allowed: false, reason: 'CAPABILITY_NOT_HELD' });
    }
  });
  it('a bridge principal holds the read-only dashboard capability (runtime-inert: the bridge hard-expired 2026-08-05)', async () => {
    await expect(decideCapability(bridge, { capability: SUPER_ADMIN_DASHBOARD_VIEW, reason: 't' })).resolves.toEqual({ allowed: true });
  });
});

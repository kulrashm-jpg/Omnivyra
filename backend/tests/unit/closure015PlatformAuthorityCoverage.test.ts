/**
 * Closure-015 — platform authority coverage beyond the platform-tier write capabilities.
 *
 * The D-3 central guard (requireCapability) refuses a holder of a platform-tier WRITE
 * capability without platform authority. Two classes it could not see are covered here:
 *  1. the eight Closure-009 WRITE requests gated on the read-only dashboard capability,
 *     whose refusal used to come from the synchronous helper AFTER the capability decision
 *     had logged `allowed` (no denial row);
 *  2. two READS of cross-tenant / credential-adjacent data gated on a platform-tier write
 *     capability (integration-health, platform-oauth-configs GET), open to direct grantees.
 * Both now use requireCapability({ requirePlatformAuthority }): refused before the decision,
 * one `elevated_route_denied`, never `allowed`. A static guard keeps the inventory exact.
 *
 * The route harness below is the Closure-009 one (real authorization chain, I/O faked),
 * with business-read tracking added. In-memory: proves ordering and decisions, NOT RLS.
 */
// ── Database fake ─────────────────────────────────────────────────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string; payload?: unknown }[] = [];
const mockReads: string[] = [];
function mockBuilder(table: string) {
  mockReads.push(table);
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
    update: (p: unknown) => { mockWrites.push({ table, op: 'update', payload: p }); return b; },
    delete: () => { mockWrites.push({ table, op: 'delete' }); return b; },
    insert: (p: unknown) => { mockWrites.push({ table, op: 'insert', payload: p }); return b; },
    upsert: (p: unknown) => { mockWrites.push({ table, op: 'upsert', payload: p }); return b; },
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
  // A bridge principal for `x-test-bridge`. 'all-caps' additionally claims every
  // capability, a SUPER_ADMIN membership and an active passkey step-up — the
  // strongest bridge principal there could be — to prove the bridge itself is
  // what is refused, not merely the capabilities it happens to hold.
  resolveLegacyCookieSuperAdminPrincipal: async (req: { headers: Record<string, string> }) => {
    const kind = req.headers['x-test-bridge'];
    if (!kind) return null;
    const sec = jest.requireActual('../../../shared/contracts/security');
    const reg = jest.requireActual('../../security/capabilityRegistry');
    const allCaps = kind === 'all-caps';
    return {
      userId: 'legacy:cookie-super-admin', supabaseUid: 'legacy:cookie-super-admin', email: '', emailVerified: false,
      sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
      organizations: allCaps ? [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }] : [],
      activeOrgId: null,
      capabilities: allCaps ? [...sec.ALL_CAPABILITIES] : [...reg.legacyCookieSuperAdminCapabilities()],
      mfa: { enrolled: allCaps, factors: allCaps ? ['webauthn'] : [], lastVerifiedAt: null, phishingResistant: allCaps },
      device: { deviceId: null, trusted: allCaps, fingerprint: 'bridge' },
      stepUp: allCaps
        ? { active: true, expiresAt: new Date(Date.now() + 300_000), factor: 'webauthn', sessionId: 'su-bridge' }
        : { active: false, expiresAt: null, factor: null, sessionId: null },
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
let mockRateLimited = false;
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }) => {
    if (mockRateLimited) { res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }); return false; }
    return true;
  },
}));

// ── Route side effects (every protected effect is a spy) ───────────────────────
const fx = {
  approveOutreachTask: jest.fn(async () => ({ ok: true, status: 'approved', reason: null })),
  runOutreachActivation: jest.fn(async () => ({ materialized: 0, tasks: [] })),
  reconcileUncertainPublish: jest.fn(async () => ({ status: 'reconciled' })),
  insertAuditLogStrict: jest.fn(async () => undefined),
  resumeThreadPublish: jest.fn(async () => ({ status: 'COMPLETED' })),
  reconcileRow: jest.fn(async () => ({ ran: true, analysis: { kind: 'ok' } })),
  connectGoogleAnalytics: jest.fn(async () => ({ authUrl: 'https://accounts.example.test/o' })),
  connectGoogleSearchConsole: jest.fn(async () => ({ authUrl: 'https://accounts.example.test/o' })),
  saveSelectedProperty: jest.fn(async () => ({ ok: true })),
  saveSelectedSearchConsoleProperty: jest.fn(async () => ({ ok: true })),
  runIngestionForCompany: jest.fn(async () => ({ ok: true })),
  runOmnivyraGscIngestion: jest.fn(async () => ({ ok: true })),
  runSerpAcquisition: jest.fn(async () => ({ status: 'completed', attempted_queries: 1, snapshots_written: 1, results_written: 1, errors: [] })),
  runQueuedSerpAcquisition: jest.fn(async () => ({ status: 'completed', attempted_queries: 1, snapshots_written: 1, results_written: 1, errors: [] })),
  seedSerpQueryQueue: jest.fn(async () => ({ seeded: 0 })),
  bootstrapCompetitorDataset: jest.fn(async () => ({ ok: true })),
  refreshSnapshot: jest.fn(async () => ({ external_competitive_intelligence: { status: 'ready', freshness: { serp_snapshot_count: 1, competitor_domain_count: 1 } } })),
  replayDeadLetterEntry: jest.fn(async (id: string) => ({ id, workerName: 'ai-heavy', targetQueue: 'ai-heavy', jobName: 'ai-heavy', jobId: 'j', enqueued: true, removed: true })),
  recordAdminAudit: jest.fn(async () => undefined),
  redisHset: jest.fn(async () => 1),
  forceLeaseReclamation: jest.fn(async () => ({ reclaimed: 0 })),
  plannerPause: jest.fn(async () => ({ mode: 'paused' })),
  registerFeature: jest.fn(async () => ({ key: 'k' })),
  setRolloutOverride: jest.fn(async () => ({ previous: null, next: { killed: true } })),
  runIntegrationHealthCheck: jest.fn(async () => ({ ok: true, attempts: 1, retried: false, retry_attempts_made: 0, result: {} })),
  invalidateAllAiCache: jest.fn(async () => 0),
  captureBaseline: jest.fn(async () => ({ key: 'k', persisted: true })),
};
const via = (k: keyof typeof fx) => (...a: unknown[]) => (fx[k] as (...x: unknown[]) => unknown)(...a);
jest.mock('../../services/leadOutreachActivation', () => ({
  approveOutreachTaskForOperator: via('approveOutreachTask'), runOutreachActivation: via('runOutreachActivation'),
}));
jest.mock('../../services/publishOutcomeReconciliation', () => ({ reconcileUncertainPublish: via('reconcileUncertainPublish') }));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: via('insertAuditLogStrict'), SYSTEM_USER_ID: 'system' }));
jest.mock('../../services/threadRuntime/threadPublishOrchestrator', () => ({ resumeThreadPublish: via('resumeThreadPublish') }));
jest.mock('../../services/providerReconciliation/reconcileRow', () => ({ reconcileRow: via('reconcileRow') }));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'https://app.example.test' }));
jest.mock('../../services/analyticsIntegrationService', () => ({
  connectGoogleAnalytics: via('connectGoogleAnalytics'), connectGoogleSearchConsole: via('connectGoogleSearchConsole'),
  saveSelectedProperty: via('saveSelectedProperty'), saveSelectedSearchConsoleProperty: via('saveSelectedSearchConsoleProperty'),
  getActiveProperty: async () => ({ id: 'prop-1' }), getActiveSearchConsoleProperty: async () => ({ id: 'gsc-1' }),
}));
jest.mock('../../services/omnivyraWebsiteCompanyService', () => ({ resolveOmnivyraWebsiteCompany: async () => ({ id: 'omnivyra-co' }) }));
jest.mock('../../services/ingestionScheduler', () => ({ runIngestionForCompany: via('runIngestionForCompany') }));
jest.mock('../../services/ingestionRunService', () => ({ getLatestCompletedRun: async () => null }));
jest.mock('../../services/omnivyraGscAnalyticsService', () => ({ runOmnivyraGscIngestion: via('runOmnivyraGscIngestion') }));
jest.mock('../../services/analyticsEnterpriseSnapshotService', () => ({
  getAnalyticsEnterpriseSnapshot: async () => ({ gsc_intelligence: null }), refreshAnalyticsEnterpriseSnapshot: via('refreshSnapshot'),
}));
jest.mock('../../services/serpAcquisitionService', () => ({
  createConfiguredSerpApiProvider: async () => ({ id: 'compliant_api', fetch: async () => null }),
  createManualSerpProvider: () => ({ id: 'manual_import', costPerQueryUsd: 0, fetch: async () => null }),
  runSerpAcquisition: via('runSerpAcquisition'), runQueuedSerpAcquisition: via('runQueuedSerpAcquisition'),
  seedSerpQueryQueue: via('seedSerpQueryQueue'), getConfiguredSerpProviderHealth: async () => [],
}));
jest.mock('../../services/competitiveDatasetBootstrapService', () => ({ bootstrapCompetitorDataset: via('bootstrapCompetitorDataset') }));
jest.mock('../../services/jobInspection', () => ({
  listDeadLetters: async () => ({ entries: [] }), summarizeDeadLetters: async () => [], getDeadLetter: async () => null,
  replayDeadLetterEntry: via('replayDeadLetterEntry'), replayableQueueNames: async () => ['ai-heavy'],
}));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: via('recordAdminAudit') }));
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => ({ hset: via('redisHset'), pexpire: async () => 1, del: async () => 1, hgetall: async () => ({}) }),
}));
jest.mock('../../services/plannerFailureRecovery', () => ({ forceSemaphoreLeaseReclamation: via('forceLeaseReclamation') }));
jest.mock('../../services/plannerRolloutOrchestrator', () => ({
  promote: jest.fn(), rollback: jest.fn(), pause: via('plannerPause'), resume: jest.fn(), reset: jest.fn(),
  ROLLOUT_ORDER: ['off', 'shadow', 'canary', 'full'],
}));
jest.mock('../../services/plannerFeatureGovernance', () => ({
  registerFeature: via('registerFeature'), addRule: jest.fn(), removeRule: jest.fn(),
  isFeatureEnabled: async () => ({ enabled: false }), listFeatures: async () => [], readFeatureAuditTrail: async () => [],
}));
jest.mock('../../../lib/platform/rollout', () => ({ getRolloutFlag: () => ({ key: 'outbound-moderation' }) }));
jest.mock('../../../lib/platform/rolloutAdmin', () => ({
  setRolloutOverride: via('setRolloutOverride'), resolveRollout: async () => ({ mode: 'off', source: 'override' }),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({}));
jest.mock('../../services/customerActivationWorkbenchService', () => ({ loadCustomerActivationInputs: async () => [{ company_id: 'co-tracked' }] }));
jest.mock('../../services/customerActivationOperationsService', () => ({
  buildOperations: () => [], isOutreachState: (s: unknown) => s === 'CONTACTED',
}));
jest.mock('../../services/integrationHealthService', () => ({ deriveIntegrationHealth: () => ({}), rollupHealth: () => ({}) }));
jest.mock('../../services/integrationHealthRetry', () => ({ runIntegrationHealthCheckWithRetry: via('runIntegrationHealthCheck') }));
jest.mock('../../services/redisExternalApiCache', () => ({ getCacheStats: async () => ({}) }));
jest.mock('../../services/aiResponseCache', () => ({ invalidateAllAiCache: via('invalidateAllAiCache') }));
jest.mock('../../observability/baseline', () => ({
  captureBaseline: via('captureBaseline'), listBaselines: async () => [], getBaseline: async () => null, compareBaselines: () => ({}),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ scan: async () => ['0', []], del: async () => 0, quit: async () => undefined })));

import dlqRoute from '../../../pages/api/super-admin/dead-letter-queue';
import forceModeRoute from '../../../pages/api/super-admin/planner-control/force-mode';
import plannerRolloutRoute from '../../../pages/api/super-admin/planner-control/rollout';
import featuresRoute from '../../../pages/api/super-admin/planner-control/features';
import customerActivationRoute from '../../../pages/api/super-admin/customer-activation-operations';
import integrationAuditRoute from '../../../pages/api/super-admin/integration-audit';
import cacheRoute from '../../../pages/api/admin/cache-management';
import baselineRoute from '../../../pages/api/super-admin/observability-baseline';
import integrationHealthRoute from '../../../pages/api/super-admin/integration-health';
import oauthConfigsRoute from '../../../pages/api/super-admin/platform-oauth-configs';
import * as fs from 'fs';
import * as path from 'path';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import type { Capability } from '../../../shared/contracts/security';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN rows
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ user_id, company_id, role: r, status });
const assign = (user_id: string, capability: string) => ({ user_id, capability, organization_id: null, expires_at: null, revoked_at: null });
const stepUp = (user_id: string, factor: string) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const trustedDevice = (user_id: string) =>
  ({ id: `dev-${user_id}`, user_id, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });

const SUPER = 'u-super';                 // active SUPER_ADMIN, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';// active SUPER_ADMIN, no step-up session
/** VIEW_ONLY with DIRECT grants of the dashboard view AND the OAuth write capability, valid passkey step-up. */
const GRANTEE = 'u-grantee';
/** The intended read delegate: VIEW_ONLY with only the dashboard-view grant. */
const VIEW_DELEGATE = 'u-view-delegate';
/** A DEACTIVATED SUPER_ADMIN row that still holds a direct dashboard-view grant, valid passkey step-up. */
const DEACT_GRANTED = 'u-deact-granted';
/** An ordinary tenant administrator with no platform grant. */
const TENANT_ADMIN = 'u-tenant-admin';

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockReads.length = 0;
  mockSecurityAudit.length = 0;
  mockRateLimited = false;
  for (const f of Object.values(fx)) f.mockClear();
  mockTables.user_company_roles = [
    role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'),
    role(GRANTEE, A, 'VIEW_ONLY'), role(VIEW_DELEGATE, A, 'VIEW_ONLY'),
    role(DEACT_GRANTED, P, 'SUPER_ADMIN', 'deactivated'), role(TENANT_ADMIN, A, 'COMPANY_ADMIN'),
  ];
  mockTables.capability_assignments = [
    assign(GRANTEE, SUPER_ADMIN_DASHBOARD_VIEW), assign(GRANTEE, INTEGRATION_PLATFORM_OAUTH_MANAGE),
    assign(VIEW_DELEGATE, SUPER_ADMIN_DASHBOARD_VIEW), assign(DEACT_GRANTED, SUPER_ADMIN_DASHBOARD_VIEW),
  ];
  mockTables.stepup_sessions = [stepUp(SUPER, 'webauthn'), stepUp(GRANTEE, 'webauthn'), stepUp(VIEW_DELEGATE, 'webauthn'), stepUp(DEACT_GRANTED, 'webauthn'), stepUp(TENANT_ADMIN, 'webauthn')];
  mockTables.trusted_devices = [trustedDevice(SUPER), trustedDevice(SUPER_NO_STEPUP), trustedDevice(GRANTEE), trustedDevice(VIEW_DELEGATE), trustedDevice(DEACT_GRANTED), trustedDevice(TENANT_ADMIN)];
  mockTables.users = [];
  mockTables.customer_activation_outreach = [{ company_id: 'co-tracked' }];
  mockTables.customer_activation_activity_log = [];
  mockTables.company_integrations = [{ id: 'int-1', company_id: 'co-1', type: 'wordpress', website_connection_id: 'wc-1' }];
  mockTables.platform_oauth_configs = [];
  mockTables.social_accounts = [];
  mockTables.analytics_integrations = [];
  mockTables.meta_oauth_connections = [];
  mockTables.companies = [];
});

type Res = { statusCode: number; body: unknown; headers: Record<string, unknown> } & Record<string, unknown>;
function fakeRes(): Res {
  const r = { statusCode: 200, body: undefined, headers: {} } as Res;
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
}
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
type Who = { user?: string; bridge?: 'plain' | 'all-caps' } | null;
async function call(handler: Handler, method: string, who: Who, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  if (who?.user) headers['x-test-user'] = who.user;
  if (who?.bridge) headers['x-test-bridge'] = who.bridge;
  const req = { headers, query, body, method, url: '/api/x', socket: {}, cookies: {} };
  const res = fakeRes();
  await handler(req, res);
  return res;
}
const code = (r: Res) => (r.body as { code?: string } | undefined)?.code;
const decisions = () => mockSecurityAudit.map((e) => String(e.decision));

interface WriteSurface { name: string; handler: Handler; body: Record<string, unknown>; effects: () => boolean }
/** The Closure-009 write requests gated on the read-only dashboard capability. */
const VIEW_WRITES: WriteSurface[] = [
  { name: 'POST dead-letter-queue (re-drive)', handler: dlqRoute as Handler, body: { id: 'e1' }, effects: () => fx.replayDeadLetterEntry.mock.calls.length > 0 },
  { name: 'POST planner-control/force-mode', handler: forceModeRoute as Handler, body: { action: 'force_degradation', mode: 'degraded' }, effects: () => fx.redisHset.mock.calls.length > 0 },
  { name: 'POST planner-control/rollout', handler: plannerRolloutRoute as Handler, body: { action: 'pause', reason: 'test' }, effects: () => fx.plannerPause.mock.calls.length > 0 },
  { name: 'POST planner-control/features (register)', handler: featuresRoute as Handler, body: { action: 'register', key: 'k' }, effects: () => fx.registerFeature.mock.calls.length > 0 },
  { name: 'POST customer-activation-operations', handler: customerActivationRoute as Handler, body: { action: 'add_activity', company_id: 'co-tracked', notes: 'n' }, effects: () => mockWrites.some((w) => w.table === 'customer_activation_activity_log') },
  { name: 'POST integration-audit (re-test)', handler: integrationAuditRoute as Handler, body: { company_id: 'co-1', integration_id: 'int-1' }, effects: () => fx.runIntegrationHealthCheck.mock.calls.length > 0 },
  { name: 'POST admin/cache-management (flush)', handler: cacheRoute as Handler, body: { action: 'flush_ai' }, effects: () => fx.invalidateAllAiCache.mock.calls.length > 0 },
  { name: 'POST observability-baseline (capture)', handler: baselineRoute as Handler, body: { label: 't' }, effects: () => fx.captureBaseline.mock.calls.length > 0 },
];
const eachWrite = VIEW_WRITES.map((s) => [s.name, s] as const);
function expectNoEffects(s: WriteSurface) {
  expect(s.effects()).toBe(false);
  expect(mockWrites).toEqual([]);
  expect(fx.recordAdminAudit).not.toHaveBeenCalled();
  expect(fx.insertAuditLogStrict).not.toHaveBeenCalled();
}
/** The Closure-015 audit contract for a refused holder: one denial, nothing that reads as access. */
function expectAuditedRefusal(capability: Capability, actor: string) {
  const d = decisions();
  expect(d.filter((x) => x === 'elevated_route_denied')).toHaveLength(1);
  expect(d).not.toContain('allowed');
  expect(d).not.toContain('elevated_route_accessed');
  const denial = mockSecurityAudit.find((e) => e.decision === 'elevated_route_denied')!;
  expect(denial).toMatchObject({ capability, actorUserId: actor });
  expect(String(denial.reason)).toContain('PLATFORM_SUPER_ADMIN_REQUIRED');
}

describe('Closure-015: dashboard-view WRITE routes need platform authority, refused through the audited central path', () => {
  it.each(eachWrite)('%s → a VIEW_ONLY holder of direct grants: 403, one elevated_route_denied, no allowed, nothing happens', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: GRANTEE }, s.body);
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expectNoEffects(s);
    expectAuditedRefusal(SUPER_ADMIN_DASHBOARD_VIEW, GRANTEE);
  });
  it.each(eachWrite)('%s → the intended read delegate (dashboard view only): 403, audited, nothing happens', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: VIEW_DELEGATE }, s.body);
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expectNoEffects(s);
    expectAuditedRefusal(SUPER_ADMIN_DASHBOARD_VIEW, VIEW_DELEGATE);
  });
  it.each(eachWrite)('%s → a deactivated SUPER_ADMIN still holding a direct view grant: 403, audited, nothing happens', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: DEACT_GRANTED }, s.body);
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expectNoEffects(s);
    expectAuditedRefusal(SUPER_ADMIN_DASHBOARD_VIEW, DEACT_GRANTED);
  });
  it.each(eachWrite)('%s → bridge principals are refused and nothing reads as access', async (_n, s) => {
    for (const bridge of ['plain', 'all-caps'] as const) {
      mockSecurityAudit.length = 0;
      const r = await call(s.handler, 'POST', { bridge }, s.body);
      expect([401, 403]).toContain(r.statusCode);
      expectNoEffects(s);
      expect(decisions()).not.toContain('allowed');
      expect(decisions()).not.toContain('elevated_route_accessed');
    }
  });
  it.each(eachWrite)('%s → an ordinary tenant administrator keeps the CAPABILITY_NOT_HELD contract', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: TENANT_ADMIN }, s.body);
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('CAPABILITY_NOT_HELD');
    expectNoEffects(s);
    expect(decisions()).not.toContain('elevated_route_denied');
  });
  it.each(eachWrite)('%s → no principal: 401, nothing happens', async (_n, s) => {
    const r = await call(s.handler, 'POST', null, s.body);
    expect(r.statusCode).toBe(401);
    expectNoEffects(s);
  });
  it.each(eachWrite)('%s → an active platform SUPER_ADMIN reaches the effect, with no denial in the trail', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: SUPER }, s.body);
    expect([401, 403, 429]).not.toContain(r.statusCode);
    expect(s.effects()).toBe(true);
    expect(decisions()).not.toContain('elevated_route_denied');
  });
  it.each(eachWrite)('%s → no step-up is registered for the view capability, so an active SUPER_ADMIN without step-up is not prompted (owner decision recorded in the report)', async (_n, s) => {
    const r = await call(s.handler, 'POST', { user: SUPER_NO_STEPUP }, s.body);
    expect([401, 403]).not.toContain(r.statusCode);
    expect(s.effects()).toBe(true);
  });
});

describe('Closure-015: delegated reads on the same routes are unchanged', () => {
  it('GET dead-letter-queue: the read delegate may still inspect', async () => {
    const r = await call(dlqRoute as Handler, 'GET', { user: VIEW_DELEGATE });
    expect(r.statusCode).toBe(200);
    expect(decisions()).not.toContain('elevated_route_denied');
  });
  it('POST planner-control/features evaluate: a read; the delegate may still evaluate and nothing is registered', async () => {
    const r = await call(featuresRoute as Handler, 'POST', { user: VIEW_DELEGATE }, { action: 'evaluate', key: 'k', ctx: {} });
    expect(r.statusCode).not.toBe(403);
    expect(fx.registerFeature).not.toHaveBeenCalled();
    expect(decisions()).not.toContain('elevated_route_denied');
  });
});

const HEALTH_TABLES = ['social_accounts', 'analytics_integrations', 'meta_oauth_connections', 'platform_oauth_configs', 'companies'];
describe('Closure-015: the two exposed GET routes are for platform operators only', () => {
  it.each([
    ['GET integration-health', integrationHealthRoute as Handler],
    ['GET platform-oauth-configs', oauthConfigsRoute as Handler],
  ])('%s → a direct grantee of the OAuth write capability: 403, audited, no business read', async (_n, h) => {
    const r = await call(h, 'GET', { user: GRANTEE });
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expect(mockReads.filter((t) => HEALTH_TABLES.includes(t))).toEqual([]);
    expectAuditedRefusal(INTEGRATION_PLATFORM_OAUTH_MANAGE, GRANTEE);
  });
  it.each([
    ['GET integration-health', integrationHealthRoute as Handler],
    ['GET platform-oauth-configs', oauthConfigsRoute as Handler],
  ])('%s → an active SUPER_ADMIN still reads it without step-up', async (_n, h) => {
    const r = await call(h, 'GET', { user: SUPER_NO_STEPUP });
    expect(r.statusCode).toBe(200);
    expect(decisions()).not.toContain('elevated_route_denied');
  });
  it.each([
    ['GET integration-health', integrationHealthRoute as Handler],
    ['GET platform-oauth-configs', oauthConfigsRoute as Handler],
  ])('%s → a dashboard-view delegate and a tenant admin do not hold the capability: CAPABILITY_NOT_HELD, no business read', async (_n, h) => {
    for (const user of [VIEW_DELEGATE, TENANT_ADMIN]) {
      mockReads.length = 0;
      const r = await call(h, 'GET', { user });
      expect(r.statusCode).toBe(403);
      expect(code(r)).toBe('CAPABILITY_NOT_HELD');
      expect(mockReads.filter((t) => HEALTH_TABLES.includes(t))).toEqual([]);
    }
  });
});

// ── Static completeness guard ───────────────────────────────────────────────
const API = path.join(__dirname, '../../../pages/api');
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const rel = (p: string) => path.relative(API, p).split(path.sep).join('/').replace(/\.(ts|tsx)$/, '');
const MUTATING = /\b(?:req\.method|method|m)\s*[!=]==?\s*['"](?:POST|PUT|PATCH|DELETE)['"]|case\s+['"](?:POST|PUT|PATCH|DELETE)['"]|methods:\s*\[[^\]]*['"](?:POST|PUT|PATCH|DELETE)['"]/;
const READ_ONLY_PLATFORM_CAP = /\b(SUPER_ADMIN_DASHBOARD_VIEW|CONSUMPTION_VIEW_AGGREGATE)\b/;

/**
 * Privileged write handlers under admin/ and super-admin/ that do NOT gate on
 * requireCapability themselves, each with the reviewed reason it is not a D-3
 * (direct-grant) exposure. Adding a route here is a security review decision.
 */
const NON_CAPABILITY_WRITE_ROUTES: Record<string, string> = {
  'admin/autonomous': 'role: active exact SUPER_ADMIN (isPlatformSuperAdmin) or company access',
  'admin/blog/brief-suggestions': 'role: enforceRole SUPER_ADMIN',
  'admin/blog/generate': 'role: enforceRole SUPER_ADMIN',
  'admin/blog/rewrite-hook': 'role: enforceRole COMPANY_ADMIN|SUPER_ADMIN (tenant-scoped)',
  'admin/create-company': 'role: requireSuperAdmin (active exact SUPER_ADMIN)',
  'admin/credits/approvals/cancel': 'finance role',
  'admin/credits/approvals/sign': 'finance role',
  'admin/credits/freeze': 'finance role (isFinanceAdmin)',
  'admin/credits/grant': 'finance role',
  'admin/credits/idempotency/reconcile': 'finance role',
  'admin/credits/idempotency/recover': 'finance role',
  'admin/credits/idempotency/safe-retry': 'finance role',
  'admin/credits/idempotency/trace': 'finance auditor (read via POST)',
  'admin/credits/index': 'finance role',
  'admin/credits/revoke': 'finance role',
  'admin/credits/unfreeze': 'finance role (isFinanceAdmin)',
  'admin/delete-activity': 'role: isSuperAdmin (active exact SUPER_ADMIN)',
  'admin/delete-campaign': 'role: isSuperAdmin (active exact SUPER_ADMIN)',
  'admin/delete-content': 'role: isSuperAdmin (active exact SUPER_ADMIN)',
  'admin/feedback': 'role: requireSuperAdmin',
  'admin/grant-super-admin': 'role: isSuperAdmin (active exact SUPER_ADMIN)',
  'admin/intelligence/api-presets': 'role: requireSuperAdmin',
  'admin/intelligence/categories': 'role: requireSuperAdmin',
  'admin/intelligence/plans': 'role: requireSuperAdmin',
  'admin/intelligence/query-templates': 'role: requireSuperAdmin',
  'admin/org/[id]/control': 'role: isPlatformSuperAdmin',
  'admin/pricing/apply': 'role: isPlatformSuperAdmin',
  'admin/pricing/update': 'role: isPlatformSuperAdmin',
  'admin/rate-limit-config': 'role: requireSuperAdminUser',
  'admin/website-intelligence/alerts': 'role: enforceRole COMPANY_ADMIN|SUPER_ADMIN (tenant-scoped)',
  'admin/website-intelligence/queue-metrics': 'role: enforceRole COMPANY_ADMIN|SUPER_ADMIN (tenant-scoped)',
  'super-admin/activity-control': 'role: isPlatformSuperAdmin',
  'super-admin/billing-exports/generate': 'finance auditor',
  'super-admin/billing-forensics/job-replay': 'finance auditor',
  'super-admin/billing-forensics/trace': 'finance auditor',
  'super-admin/content-architect-login': 'login endpoint (credential check)',
  'super-admin/creator-render-ops': 'role: isSuperAdmin',
  'super-admin/credit-packages/index': 'role: requireSuperAdmin',
  'super-admin/financial-control': 'finance role (isFinanceAdmin)',
  'super-admin/ga-connect': 'requireSuperAdminGaWriteAccess → requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE) + central guard',
  'super-admin/ga-select-property': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/ga-sync': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/gsc-connect': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/gsc-select-property': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/gsc-sync': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/llm/models': 'role: requireSuperAdmin',
  'super-admin/llm/providers': 'role: requireSuperAdmin',
  'super-admin/login': 'login endpoint (credential check)',
  'super-admin/logout': 'logout endpoint (session revoke)',
  'super-admin/serp-acquisition': 'requireSuperAdminGaWriteAccess → requireCapability + central guard',
  'super-admin/users': 'requireSuperAdminAccess + per-method capability in backend/apiHandlers (Closure-014 B)',
};

/**
 * Routes that use a read-only platform capability for their READS and select a
 * platform-tier WRITE capability for every method that writes (so the D-3 central
 * guard applies to the write); any other method answers 405 without work.
 * Reviewed in Closure-015. Adding a route here is a security review decision.
 */
const MIXED_CAPABILITY_ROUTES: Record<string, string> = {
  'admin/blog/index': 'GET view; POST BLOG_PUBLISH_MANAGE',
  'admin/blog/series/index': 'GET view; POST BLOG_PUBLISH_MANAGE',
  'admin/blog/series/[id]': 'GET view; PATCH/DELETE BLOG_PUBLISH_MANAGE',
  'admin/blog/[id]': 'GET view; PATCH/DELETE BLOG_PUBLISH_MANAGE',
  'admin/intelligence/scheduler-config': 'GET view; PUT INTELLIGENCE_OVERRIDE_MANAGE; others 405',
  'admin/intelligence/scheduler-overrides': 'GET view; POST/DELETE INTELLIGENCE_OVERRIDE_MANAGE',
  'admin/intelligence/throttle-status': 'GET view; PUT INTELLIGENCE_OVERRIDE_MANAGE; others 405',
  'super-admin/companies': 'GET view; POST/PATCH IDENTITY_ADMIN_ASSIGN; DELETE ORGANIZATION_DELETE',
  'super-admin/curated-industry-sources': 'GET view; writes INTEGRATION_PLATFORM_OAUTH_MANAGE',
};

describe('Closure-015 static guard: no privileged write handler escapes review', () => {
  const files = walk(API);
  it('every write route that mentions a READ-ONLY platform capability either sets requirePlatformAuthority or is a reviewed mixed-capability route (list is exact)', () => {
    const unguarded = files
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return /requireCapability\(/.test(src) && READ_ONLY_PLATFORM_CAP.test(src) && MUTATING.test(src) && !/status\(410\)/.test(src);
      })
      .filter((f) => !/requirePlatformAuthority:/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(unguarded).toEqual(Object.keys(MIXED_CAPABILITY_ROUTES).sort());
  });
  it('each reviewed mixed-capability route still names a platform-tier write capability', () => {
    const WRITE_CAP = /\b(BLOG_PUBLISH_MANAGE|INTELLIGENCE_OVERRIDE_MANAGE|IDENTITY_ADMIN_ASSIGN|ORGANIZATION_DELETE|INTEGRATION_PLATFORM_OAUTH_MANAGE)\b/;
    for (const r of Object.keys(MIXED_CAPABILITY_ROUTES)) {
      expect([r, WRITE_CAP.test(fs.readFileSync(path.join(API, `${r}.ts`), 'utf8'))]).toEqual([r, true]);
    }
  });
  it('every admin/super-admin write handler without its own requireCapability is a reviewed exception (list is exact)', () => {
    const found = files
      .filter((f) => /^(admin|super-admin)\//.test(rel(f)))
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return MUTATING.test(src) && !/requireCapability\(/.test(src) && !/status\(410\)/.test(src);
      })
      .map(rel)
      .sort();
    expect(found).toEqual(Object.keys(NON_CAPABILITY_WRITE_ROUTES).sort());
  });
  it('the GA/GSC/SERP write helper still routes through requireCapability (so the central guard applies)', () => {
    const helper = fs.readFileSync(path.join(__dirname, '../../services/superAdminGaAccess.ts'), 'utf8');
    const body = helper.slice(helper.indexOf('export async function requireSuperAdminGaWriteAccess'));
    expect(body).toMatch(/requireCapability\(req, res, \{\s*capability: INTEGRATION_PLATFORM_OAUTH_MANAGE/);
  });
});

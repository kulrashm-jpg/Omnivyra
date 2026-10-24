/**
 * Closure-009 — owner-approved authorization for every privileged WRITE route
 * the Closure-006/008 audits found gated on the read-only dashboard capability.
 *
 * Drives the REAL chain: route handler → requireCapability → resolvePrincipal
 * (IdentityResolver) → resolveUserCapabilities (CapabilityService, from
 * user_company_roles + capability_assignments) → decideCapability /
 * decideCapabilityWithStepUp → evaluateStepUp → requirePlatformWriteAuthority.
 * Only I/O is replaced: database rows, the identity/session lookup, the legacy
 * bridge, the security-audit sink, per-IP rate limiting, and each route's
 * downstream side effect (every one a spy that must stay untouched on denial).
 *
 * In-memory: proves the routes' ordering and decisions, NOT Postgres RLS.
 */

// ── Database fake ─────────────────────────────────────────────────────────────
const mockTables: Record<string, Record<string, unknown>[]> = {};
const mockWrites: { table: string; op: string; payload?: unknown }[] = [];
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

import approveRoute from '../../../pages/api/super-admin/outreach/approve';
import activateRoute from '../../../pages/api/super-admin/outreach/activate';
import publishReconcileRoute from '../../../pages/api/super-admin/publish/reconcile';
import threadResumeRoute from '../../../pages/api/super-admin/threads/[threadId]/resume';
import threadReconcileRoute from '../../../pages/api/super-admin/threads/[threadId]/reconcile';
import gaConnectRoute from '../../../pages/api/super-admin/ga-connect';
import gscConnectRoute from '../../../pages/api/super-admin/gsc-connect';
import gaSelectRoute from '../../../pages/api/super-admin/ga-select-property';
import gscSelectRoute from '../../../pages/api/super-admin/gsc-select-property';
import gaSyncRoute from '../../../pages/api/super-admin/ga-sync';
import gscSyncRoute from '../../../pages/api/super-admin/gsc-sync';
import serpRoute from '../../../pages/api/super-admin/serp-acquisition';
import rolloutControlRoute from '../../../pages/api/super-admin/rollout-control';
import dlqRoute from '../../../pages/api/super-admin/dead-letter-queue';
import forceModeRoute from '../../../pages/api/super-admin/planner-control/force-mode';
import plannerRolloutRoute from '../../../pages/api/super-admin/planner-control/rollout';
import featuresRoute from '../../../pages/api/super-admin/planner-control/features';
import customerActivationRoute from '../../../pages/api/super-admin/customer-activation-operations';
import integrationAuditRoute from '../../../pages/api/super-admin/integration-audit';
import cacheRoute from '../../../pages/api/admin/cache-management';
import baselineRoute from '../../../pages/api/super-admin/observability-baseline';
import { capabilitiesForRole, legacyCookieSuperAdminCapabilities } from '../../security/capabilityRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import {
  INTEGRATION_PLATFORM_OAUTH_MANAGE, OUTREACH_PLATFORM_MANAGE, PLATFORM_CONTROLS_MANAGE, PUBLISH_RECOVERY_MANAGE,
  STEP_UP_REQUIRED_CAPABILITIES, SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';
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

const SUPER = 'u-super';                       // active SUPER_ADMIN, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';      // active SUPER_ADMIN, no step-up session
const SUPER_TOTP = 'u-super-totp';             // active SUPER_ADMIN, TOTP step-up (not phishing-resistant)
const SUPER_UNTRUSTED = 'u-super-untrusted';   // active SUPER_ADMIN, passkey step-up, untrusted device
const SUPER_DEACTIVATED = 'u-super-deact';     // DEACTIVATED SUPER_ADMIN row, valid passkey step-up, trusted device
/**
 * A tenant VIEW_ONLY user holding DIRECT capability_assignments grants of the
 * dashboard capability AND every new write capability, with a valid passkey
 * step-up on a trusted device: the strongest non-super-admin there is.
 */
const GRANTEE = 'u-grantee';
const WRITE_CAPS: Capability[] = [OUTREACH_PLATFORM_MANAGE, PUBLISH_RECOVERY_MANAGE, PLATFORM_CONTROLS_MANAGE, INTEGRATION_PLATFORM_OAUTH_MANAGE];

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockWrites.length = 0;
  mockSecurityAudit.length = 0;
  mockRateLimited = false;
  for (const f of Object.values(fx)) f.mockClear();
  mockTables.user_company_roles = [
    role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_TOTP, P, 'SUPER_ADMIN'),
    role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'), role(SUPER_DEACTIVATED, P, 'SUPER_ADMIN', 'deactivated'),
    role(GRANTEE, A, 'VIEW_ONLY'),
  ];
  mockTables.capability_assignments = [assign(GRANTEE, SUPER_ADMIN_DASHBOARD_VIEW), ...WRITE_CAPS.map((c) => assign(GRANTEE, c))];
  mockTables.stepup_sessions = [
    stepUp(SUPER, 'webauthn'), stepUp(SUPER_TOTP, 'totp'), stepUp(SUPER_UNTRUSTED, 'webauthn'),
    stepUp(SUPER_DEACTIVATED, 'webauthn'), stepUp(GRANTEE, 'webauthn'),
  ];
  mockTables.trusted_devices = [
    trustedDevice(SUPER), trustedDevice(SUPER_NO_STEPUP), trustedDevice(SUPER_TOTP),
    trustedDevice(SUPER_DEACTIVATED), trustedDevice(GRANTEE),
  ];
  mockTables.users = [];
  mockTables.customer_activation_outreach = [{ company_id: 'co-tracked' }];
  mockTables.customer_activation_activity_log = [];
  mockTables.company_integrations = [{ id: 'int-1', company_id: 'co-1', type: 'wordpress', website_connection_id: 'wc-1' }];
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
type Gate = 'stepup' | 'view+platform';
interface Surface {
  name: string;
  handler: Handler;
  query?: Record<string, unknown>;
  body: Record<string, unknown>;
  gate: Gate;
  /** stepup routes: the dedicated capability. view+platform: SUPER_ADMIN_DASHBOARD_VIEW. */
  capability: Capability;
  /** The protected side effect(s) the authorized call reaches and a denied call must not. */
  effects: jest.Mock[];
  /** Business audit sinks (not the security-audit trail). */
  audits?: jest.Mock[];
}
const VALID_SERP = [{ query: 'omnivyra pricing', results: [{ position: 1, url: 'https://omnivyra.com/pricing', domain: 'omnivyra.com', title: 'Pricing' }] }];
const SURFACES: Surface[] = [
  { name: 'POST outreach/approve', handler: approveRoute as Handler, body: { companyId: 'co-1', taskId: 't-1', reason: 'reviewed' }, gate: 'stepup', capability: OUTREACH_PLATFORM_MANAGE, effects: [fx.approveOutreachTask] },
  { name: 'POST outreach/activate', handler: activateRoute as Handler, body: { companyId: 'co-1', leadId: 'l-1' }, gate: 'stepup', capability: OUTREACH_PLATFORM_MANAGE, effects: [fx.runOutreachActivation] },
  { name: 'POST publish/reconcile', handler: publishReconcileRoute as Handler, body: { scheduled_post_id: 'sp-1', resolution: 'not_published', note: 'checked the platform' }, gate: 'stepup', capability: PUBLISH_RECOVERY_MANAGE, effects: [fx.reconcileUncertainPublish], audits: [fx.insertAuditLogStrict] },
  { name: 'POST threads/[threadId]/resume', handler: threadResumeRoute as Handler, query: { threadId: 'root-1' }, body: {}, gate: 'stepup', capability: PUBLISH_RECOVERY_MANAGE, effects: [fx.resumeThreadPublish], audits: [fx.insertAuditLogStrict] },
  { name: 'POST threads/[threadId]/reconcile', handler: threadReconcileRoute as Handler, query: { threadId: 'row-1' }, body: {}, gate: 'stepup', capability: PUBLISH_RECOVERY_MANAGE, effects: [fx.reconcileRow], audits: [fx.insertAuditLogStrict] },
  { name: 'POST ga-connect', handler: gaConnectRoute as Handler, body: {}, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.connectGoogleAnalytics] },
  { name: 'POST gsc-connect', handler: gscConnectRoute as Handler, body: {}, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.connectGoogleSearchConsole] },
  { name: 'POST ga-select-property', handler: gaSelectRoute as Handler, body: { propertyId: 'prop-1' }, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.saveSelectedProperty] },
  { name: 'POST gsc-select-property', handler: gscSelectRoute as Handler, body: { propertyId: 'sc-domain:omnivyra.com' }, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.saveSelectedSearchConsoleProperty] },
  { name: 'POST ga-sync', handler: gaSyncRoute as Handler, body: {}, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.runIngestionForCompany] },
  { name: 'POST gsc-sync', handler: gscSyncRoute as Handler, body: {}, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.runOmnivyraGscIngestion] },
  { name: 'POST serp-acquisition', handler: serpRoute as Handler, body: { manual_results: VALID_SERP }, gate: 'stepup', capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, effects: [fx.runSerpAcquisition, fx.bootstrapCompetitorDataset, fx.seedSerpQueryQueue] },
  { name: 'POST rollout-control', handler: rolloutControlRoute as Handler, body: { flagKey: 'outbound-moderation', action: 'kill' }, gate: 'stepup', capability: PLATFORM_CONTROLS_MANAGE, effects: [fx.setRolloutOverride], audits: [fx.recordAdminAudit] },
  { name: 'POST dead-letter-queue', handler: dlqRoute as Handler, body: { id: 'e1' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.replayDeadLetterEntry], audits: [fx.recordAdminAudit] },
  { name: 'POST planner-control/force-mode', handler: forceModeRoute as Handler, body: { action: 'force_degradation', mode: 'degraded' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.redisHset] },
  { name: 'POST planner-control/rollout', handler: plannerRolloutRoute as Handler, body: { action: 'pause', reason: 'test' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.plannerPause] },
  { name: 'POST planner-control/features', handler: featuresRoute as Handler, body: { action: 'register', key: 'k' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.registerFeature] },
  { name: 'POST customer-activation-operations', handler: customerActivationRoute as Handler, body: { action: 'add_activity', company_id: 'co-tracked', notes: 'n' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [] },
  { name: 'POST integration-audit', handler: integrationAuditRoute as Handler, body: { company_id: 'co-1', integration_id: 'int-1' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.runIntegrationHealthCheck] },
  { name: 'POST admin/cache-management', handler: cacheRoute as Handler, body: { action: 'flush_ai' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.invalidateAllAiCache] },
  { name: 'POST observability-baseline', handler: baselineRoute as Handler, body: { label: 't' }, gate: 'view+platform', capability: SUPER_ADMIN_DASHBOARD_VIEW, effects: [fx.captureBaseline] },
];
const STEPUP = SURFACES.filter((s) => s.gate === 'stepup');

async function call(s: Surface, who: { user?: string; bridge?: 'plain' | 'all-caps' } | null, body?: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  if (who?.user) headers['x-test-user'] = who.user;
  if (who?.bridge) headers['x-test-bridge'] = who.bridge;
  const req = { headers, query: { ...(s.query ?? {}) }, body: { ...(body ?? s.body) }, method: 'POST', url: `/api/${s.name}`, socket: {}, cookies: {} };
  const res = fakeRes();
  await s.handler(req, res);
  return res;
}
const code = (r: Res) => (r.body as { code?: string } | undefined)?.code;
/** Zero protected business effects: no service call, no DB write, no business audit. */
function expectNothingHappened(s: Surface) {
  for (const e of s.effects) expect(e).not.toHaveBeenCalled();
  for (const a of s.audits ?? []) expect(a).not.toHaveBeenCalled();
  expect(fx.recordAdminAudit).not.toHaveBeenCalled();
  expect(fx.insertAuditLogStrict).not.toHaveBeenCalled();
  expect(mockWrites).toEqual([]);
}

describe('capability model (the five-step recipe)', () => {
  it.each(WRITE_CAPS)('%s: platform-tier, SUPER_ADMIN only, step-up required with a passkey + trusted-device policy', (cap) => {
    expect(PLATFORM_TIER_CAPABILITIES).toContain(cap);
    expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(cap);
    expect(getStepUpPolicy(cap)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true });
    expect(capabilitiesForRole('SUPER_ADMIN')).toContain(cap);
    for (const r of ['COMPANY_ADMIN', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER', 'CONTENT_CREATOR', 'VIEW_ONLY', 'CONTENT_ARCHITECT']) {
      expect(capabilitiesForRole(r)).not.toContain(cap);
    }
    expect(legacyCookieSuperAdminCapabilities()).not.toContain(cap);
  });
});

describe('no authenticated principal', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → 401, nothing happens', async (_n, s) => {
    const r = await call(s, null);
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
});

describe('a view-only grantee holding DIRECT grants of every write capability (valid passkey step-up, trusted device)', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → 403 PLATFORM_SUPER_ADMIN_REQUIRED, nothing happens', async (_n, s) => {
    const r = await call(s, { user: GRANTEE });
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('PLATFORM_SUPER_ADMIN_REQUIRED');
    expectNothingHappened(s);
  });
});

describe('legacy bridge principals', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → a plain bridge principal is refused, nothing happens', async (_n, s) => {
    const r = await call(s, { bridge: 'plain' });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → a bridge principal claiming every capability, a SUPER_ADMIN row and a step-up is refused, nothing happens', async (_n, s) => {
    const r = await call(s, { bridge: 'all-caps' });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
});

describe('a deactivated platform SUPER_ADMIN (valid passkey step-up, trusted device)', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → denied before any protected read or write', async (_n, s) => {
    const r = await call(s, { user: SUPER_DEACTIVATED });
    expect([401, 403]).toContain(r.statusCode);
    expectNothingHappened(s);
  });
});

describe('step-up (the dedicated write capabilities)', () => {
  it.each(STEPUP.map((s) => [s.name, s] as const))('%s → active SUPER_ADMIN WITHOUT step-up → 401 STEP_UP_REQUIRED, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_NO_STEPUP });
    expect(r.statusCode).toBe(401);
    expect(code(r)).toBe('STEP_UP_REQUIRED');
    expectNothingHappened(s);
  });
  it.each(STEPUP.map((s) => [s.name, s] as const))('%s → a TOTP (non-phishing-resistant) step-up → 401, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_TOTP });
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
  it.each(STEPUP.map((s) => [s.name, s] as const))('%s → a passkey step-up on an UNTRUSTED device → 401, nothing happens', async (_n, s) => {
    const r = await call(s, { user: SUPER_UNTRUSTED });
    expect(r.statusCode).toBe(401);
    expectNothingHappened(s);
  });
  it.each(STEPUP.map((s) => [s.name, s] as const))('%s → the denial names the dedicated capability', async (_n, s) => {
    const r = await call(s, { user: SUPER_NO_STEPUP });
    expect((r.body as { capability?: string }).capability).toBe(s.capability);
  });
});

describe('rate limiting', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → over the limit: 429 even for an authorized SUPER_ADMIN, nothing happens', async (_n, s) => {
    mockRateLimited = true;
    const r = await call(s, { user: SUPER });
    expect(r.statusCode).toBe(429);
    expectNothingHappened(s);
  });
});

describe('an active, stepped-up platform SUPER_ADMIN is not locked out', () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))('%s → authorized; the route reaches its effect', async (_n, s) => {
    const r = await call(s, { user: SUPER });
    expect([401, 403, 429]).not.toContain(r.statusCode);
    for (const e of s.effects) expect(e).toHaveBeenCalled();
  });
  it('the security audit records the dedicated capability for an elevated write', async () => {
    await call(SURFACES.find((s) => s.name === 'POST rollout-control')!, { user: SUPER });
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed' && e.capability === PLATFORM_CONTROLS_MANAGE && e.actorUserId === SUPER)).toBe(true);
  });
});

describe('identity and attribution come from the authenticated principal', () => {
  const s = (name: string) => SURFACES.find((x) => x.name === name)!;

  it('outreach/approve: a body-supplied approver is ignored; the approver is the authenticated user', async () => {
    await call(s('POST outreach/approve'), { user: SUPER }, { companyId: 'co-1', taskId: 't-1', reason: 'reviewed', approverUserId: 'someone-else', approver: 'someone-else' });
    expect(fx.approveOutreachTask).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fx.approveOutreachTask.mock.calls[0])).toContain(SUPER);
    expect(JSON.stringify(fx.approveOutreachTask.mock.calls[0])).not.toContain('someone-else');
  });

  it.each([['an address', 'attacker@example.test'], ['an empty string', ''], ['an object', { to: 'x@example.test' }]])(
    'outreach/activate: a caller-supplied recipient (%s) is refused 400 before anything runs', async (_n, recipient) => {
      const r = await call(s('POST outreach/activate'), { user: SUPER }, { companyId: 'co-1', leadId: 'l-1', recipient });
      expect(r.statusCode).toBe(400);
      expect(code(r)).toBe('RECIPIENT_OVERRIDE_NOT_PERMITTED');
      expect(fx.runOutreachActivation).not.toHaveBeenCalled();
    },
  );

  it('outreach/activate: without a recipient the run receives NO recipient override', async () => {
    await call(s('POST outreach/activate'), { user: SUPER });
    expect(fx.runOutreachActivation).toHaveBeenCalledTimes(1);
    const opts = (fx.runOutreachActivation.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('recipient');
  });

  it('customer-activation: a body-supplied owner is ignored; the activity is attributed to the authenticated user', async () => {
    const r = await call(s('POST customer-activation-operations'), { user: SUPER }, { action: 'add_activity', company_id: 'co-tracked', owner: 'someone-else' });
    expect(r.statusCode).toBe(200);
    const insert = mockWrites.find((w) => w.table === 'customer_activation_activity_log' && w.op === 'insert');
    expect(insert?.payload).toMatchObject({ owner: SUPER });
  });

  it('rollout-control: the business audit names the authenticated operator', async () => {
    await call(s('POST rollout-control'), { user: SUPER });
    expect(fx.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: SUPER, action: 'rollout.override.kill' }));
  });

  it('dead-letter re-drive: the business audit names the authenticated operator', async () => {
    await call(s('POST dead-letter-queue'), { user: SUPER });
    expect(fx.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: SUPER, action: 'dlq.redrive' }));
  });
});

describe('resource scope is still enforced for an authorized SUPER_ADMIN', () => {
  it('customer-activation: a company that is not a tracked customer → 404, nothing written', async () => {
    const r = await call(SURFACES.find((x) => x.name === 'POST customer-activation-operations')!, { user: SUPER }, { action: 'add_activity', company_id: 'co-untracked' });
    expect(r.statusCode).toBe(404);
    expect(mockWrites).toEqual([]);
  });
  it('integration-audit: an integration that does not belong to the named company → 404, no outbound check', async () => {
    const r = await call(SURFACES.find((x) => x.name === 'POST integration-audit')!, { user: SUPER }, { company_id: 'co-other', integration_id: 'int-1' });
    expect(r.statusCode).toBe(404);
    expect(fx.runIntegrationHealthCheck).not.toHaveBeenCalled();
  });
});

describe('SERP manual_results are validated before anything is acquired or written', () => {
  const serp = SURFACES.find((x) => x.name === 'POST serp-acquisition')!;
  it.each([
    ['not an array', { query: 'x' }],
    ['a row without a query', [{ results: [] }]],
    ['a row whose results is not an array', [{ query: 'q', results: 'no' }]],
    ['a non-http url', [{ query: 'q', results: [{ position: 1, url: 'javascript:alert(1)', domain: 'x.test' }] }]],
    ['a negative position', [{ query: 'q', results: [{ position: -3, url: 'https://x.test', domain: 'x.test' }] }]],
    ['an unknown result type', [{ query: 'q', results: [{ position: 1, url: 'https://x.test', domain: 'x.test', result_type: 'malware' }] }]],
    ['too many queries', Array.from({ length: 101 }, (_, i) => ({ query: `q${i}`, results: [] }))],
  ])('%s → 400 INVALID_MANUAL_RESULTS, no acquisition, no seeding', async (_n, manual_results) => {
    const r = await call(serp, { user: SUPER }, { manual_results });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe('INVALID_MANUAL_RESULTS');
    expect(fx.runSerpAcquisition).not.toHaveBeenCalled();
    expect(fx.seedSerpQueryQueue).not.toHaveBeenCalled();
    expect(fx.bootstrapCompetitorDataset).not.toHaveBeenCalled();
  });
  it('valid rows (including a null-position, null-url feature row) are accepted unchanged', async () => {
    const rows = [{ query: 'q', results: [{ position: null, url: null, domain: 'omnivyra.com', result_type: 'people_also_ask' }] }];
    const r = await call(serp, { user: SUPER }, { manual_results: rows });
    expect(r.statusCode).toBe(200);
    expect(fx.runSerpAcquisition).toHaveBeenCalledTimes(1);
  });
});

describe('publish recovery: holding the capability never makes an uncertain outcome retryable here', () => {
  it('publish/reconcile passes the AUTHENTICATED actor to the service, which still decides the outcome', async () => {
    await call(SURFACES.find((x) => x.name === 'POST publish/reconcile')!, { user: SUPER });
    expect(fx.reconcileUncertainPublish).toHaveBeenCalledTimes(1);
    const arg = (fx.reconcileUncertainPublish.mock.calls[0] as unknown[])[0] as { actor?: { userId?: string } };
    expect(arg.actor?.userId).toBe(SUPER);
  });
});

describe('planner features: evaluate stays a read', () => {
  it('a view-capability grantee may still evaluate (no write authority needed)', async () => {
    const s = SURFACES.find((x) => x.name === 'POST planner-control/features')!;
    const r = await call(s, { user: GRANTEE }, { action: 'evaluate', key: 'k', ctx: {} });
    expect(r.statusCode).not.toBe(403);
    expect(fx.registerFeature).not.toHaveBeenCalled();
  });
});

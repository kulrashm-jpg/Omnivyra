/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "Data, admin and diagnostics" family, part 2:
 * platform diagnostics (super admin) and the domain event sink.
 *
 *   admin/engagement-signal-health      requireSuperAdminUser
 *   system/diagnostics/engagement       requireSuperAdminUser
 *   system/health/metrics               requireSuperAdminUser
 *   queue/stats                         requireSuperAdminUser
 *   posts.js                            requireSuperAdminUser (all-tenant post_events)
 *   super-admin/creator-operations      requireSuperAdminUser (was: user_metadata)
 *   domain/track-event                  company = caller's active company only
 *
 * Only the database and the identity provider are faked; the real guards run.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  seed, invoke, sinkCalls, writeCalls, fakeSupabase, userForRequest,
  CO_A, CO_B, USER_A, USER_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
// domain/track-event authenticates through authResolver directly.
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: any) => {
    const u = require('../helpers/routeAuthHarness').userForRequest(req);
    return u
      ? { user: { id: u.id, supabaseUid: u.id, email: u.email, status: 'active', emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => null,
  extractBearerToken: () => null,
  extractCookieToken: () => null,
  validateAuthToken: async () => null,
}));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));

// ── sinks ─────────────────────────────────────────────────────────────────────
const mockSchedulerLastRun = jest.fn(() => 0);
jest.mock('../../jobs/engagementSignalScheduler', () => ({
  getEngagementSignalSchedulerLastRun: () => mockSchedulerLastRun(),
  getEngagementSignalSchedulerErrors: () => [],
}));
jest.mock('../../queue/engagementSignalQueue', () => ({ getEngagementSignalQueueSize: async () => 0 }));
const mockWorkerDiag = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/engagementDiagnosticsService', () => ({
  getWorkerDiagnostics: () => mockWorkerDiag(),
  getQueueDiagnostics: async () => ({}),
  getIngestionDiagnostics: async () => ({}),
  getResponseLearningDiagnostics: async () => ({}),
  getReplyIntelligenceDiagnostics: async () => ({}),
  getOpportunityDiagnostics: async () => ({}),
}));
const mockGetMetrics = jest.fn(async () => []);
jest.mock('../../services/systemHealthMetricsService', () => ({ getMetrics: (...a: any[]) => mockGetMetrics(...a) }));
const mockQueueStats = jest.fn(() => ({ processing: 0, failed: 0, total: 0 }));
jest.mock('../../../lib/services/queue', () => ({
  queue: {
    getStats: () => mockQueueStats(),
    getAllJobs: () => [],
    getJobsByStatus: () => [],
    getReadyJobs: () => [],
  },
}));
const mockCreatorMetrics = jest.fn(async () => ({ rates: {} }));
jest.mock('../../services/creatorObservabilityService', () => ({
  aggregateCreatorMetrics: (...a: any[]) => mockCreatorMetrics(...a),
  classifyWorkflowStatus: () => 'healthy',
}));
jest.mock('../../services/creatorQueueReliabilityService', () => ({ listDeadLetterJobs: async () => [] }));
jest.mock('../../services/creatorScalabilityHarnessService', () => ({
  getQueuePressure: async () => ({}),
  withCache: (_k: string, _ttl: number, fn: () => unknown) => fn(),
}));
const mockLogDomainEvent = jest.fn(async () => true);
jest.mock('../../services/domainEventLogger', () => ({ logDomainEvent: (...a: any[]) => mockLogDomainEvent(...a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const signalHealthHandler = require('../../../pages/api/admin/engagement-signal-health').default;
const diagnosticsHandler = require('../../../pages/api/system/diagnostics/engagement').default;
const metricsHandler = require('../../../pages/api/system/health/metrics').default;
const queueStatsHandler = require('../../../pages/api/queue/stats').default;
const creatorOpsHandler = require('../../../pages/api/super-admin/creator-operations').default;
const trackEventHandler = require('../../../pages/api/domain/track-event').default;
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * pages/api/posts.js is an ES-module .js route; jest here only transforms
 * .ts/.tsx. Transpile it with TypeScript and evaluate it with a require that
 * resolves the route's relative imports to absolute paths, so the jest.mock
 * registrations above (keyed by resolved path) still apply.
 */
function loadJsRoute(rel: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require('typescript');
  const abs = path.resolve(__dirname, '../../..', rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: abs,
  }).outputText;
  const mod: { exports: any } = { exports: {} };
  const localRequire = (spec: string) => require(spec.startsWith('.') ? path.resolve(path.dirname(abs), spec) : spec);
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', out)(localRequire, mod, mod.exports);
  return mod.exports.default;
}
const postsHandler = loadJsRoute('pages/api/posts.js');

beforeEach(() => {
  seed({
    campaign_activity_engagement_signals: [
      { id: 's-b', platform: 'linkedin', detected_at: new Date().toISOString(), company_id: CO_B },
    ],
    post_events: [
      { id: 'pe-b', company_id: CO_B, user_id: USER_B, event_type: 'published', payload: { secret: CANARY_B }, created_at: '2026-09-01' },
    ],
    users: [
      { id: USER_A, supabase_uid: USER_A, active_company_id: CO_A },
      { id: USER_B, supabase_uid: USER_B, active_company_id: null },
    ],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe.each([
  ['GET /api/admin/engagement-signal-health', () => signalHealthHandler, () => sinkCalls(['campaign_activity_engagement_signals']).length + mockSchedulerLastRun.mock.calls.length],
  ['GET /api/system/diagnostics/engagement', () => diagnosticsHandler, () => mockWorkerDiag.mock.calls.length],
  ['GET /api/system/health/metrics', () => metricsHandler, () => mockGetMetrics.mock.calls.length],
  ['GET /api/queue/stats', () => queueStatsHandler, () => mockQueueStats.mock.calls.length],
  ['GET /api/posts (posts.js)', () => postsHandler, () => sinkCalls(['post_events']).length],
])('%s — platform diagnostics, super admin only', (_name, handler, sinkCount) => {
  it('unauthenticated → 401, sink never reached', async () => {
    const r = await invoke(handler(), { as: null });
    expect(r.status).toBe(401);
    expect(sinkCount()).toBe(0);
  });
  it('tenant admin (COMPANY_ADMIN of A) → 403, no cross-tenant data', async () => {
    const r = await invoke(handler(), { as: 'A' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_REQUIRED' });
    expect(sinkCount()).toBe(0);
  });
  it('super admin → 200', async () => {
    const r = await invoke(handler(), { as: 'SUPER' });
    expect(r.status).toBe(200);
    expect(sinkCount()).toBeGreaterThan(0);
  });
});

describe('GET /api/super-admin/creator-operations (was: trusted user_metadata)', () => {
  const realGetUser = fakeSupabase.auth.getUser;
  afterEach(() => { fakeSupabase.auth.getUser = realGetUser; });

  it('unauthenticated → 401, metrics never aggregated', async () => {
    const r = await invoke(creatorOpsHandler, { as: null });
    expect(r.status).toBe(401);
    expect(mockCreatorMetrics).not.toHaveBeenCalled();
  });
  it('a user who set user_metadata.is_super_admin on their own account is still refused', async () => {
    // user_metadata is writable by the user via auth.updateUser; the old gate trusted it.
    fakeSupabase.auth.getUser = async (token?: string) => {
      const u = userForRequest({ headers: { authorization: `Bearer ${token}` } });
      return u
        ? { data: { user: { ...u, user_metadata: { is_super_admin: true, role: 'super_admin' } } }, error: null }
        : { data: { user: null }, error: { message: 'invalid' } };
    };
    const r = await invoke(creatorOpsHandler, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBe(403);
    expect(mockCreatorMetrics).not.toHaveBeenCalled();
  });
  it('platform super admin (user_company_roles SUPER_ADMIN) → 200', async () => {
    const r = await invoke(creatorOpsHandler, { as: 'SUPER', query: { window: '24h' } });
    expect(r.status).toBe(200);
    expect(mockCreatorMetrics).toHaveBeenCalledWith({ window: '24h', companyId: null });
  });
});

describe('POST /api/domain/track-event (company = caller\'s active company only)', () => {
  it('unauthenticated → 401, nothing logged', async () => {
    const r = await invoke(trackEventHandler, { method: 'POST', as: null, body: { event: 'CLICK_VERIFY', company_id: CO_B } });
    expect(r.status).toBe(401);
    expect(mockLogDomainEvent).not.toHaveBeenCalled();
    expect(writeCalls()).toHaveLength(0);
  });
  it('member of A naming company_id=B → event attributed to A, never B', async () => {
    const r = await invoke(trackEventHandler, { method: 'POST', as: 'A', body: { event: 'CLICK_VERIFY', company_id: CO_B } });
    expect(r.status).toBe(202);
    expect(mockLogDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ company_id: CO_A }));
    expect(JSON.stringify(mockLogDomainEvent.mock.calls)).not.toContain(CO_B);
  });
  it('user with no active company cannot borrow one from the body (was: body.company_id fallback)', async () => {
    const r = await invoke(trackEventHandler, {
      method: 'POST', as: 'B',
      body: { event: 'DOMAIN_VERIFICATION_SKIPPED', company_id: CO_A, final_domain: 'b.test' },
    });
    expect(r.status).toBe(202);
    expect(mockLogDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ company_id: null, user_id: USER_B }));
    const reminders = writeCalls(['domain_reminders']);
    expect(reminders).toHaveLength(1);
    expect((reminders[0].payload as any).company_id).toBeNull();
  });
  it('the UI\'s own request shape (no company_id) is unchanged', async () => {
    const r = await invoke(trackEventHandler, { method: 'POST', as: 'A', body: { event: 'VIEW_DOMAIN_VERIFICATION', final_domain: null, metadata: null } });
    expect(r.status).toBe(202);
    expect(mockLogDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ company_id: CO_A, user_id: USER_A }));
  });
});

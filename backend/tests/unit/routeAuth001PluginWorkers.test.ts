/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — WordPress plugin registration + worker endpoints.
 *
 * THE DEFECTS:
 *   wordpress-plugin/register — no authentication. It took company_id,
 *     website_id and connection_id from the body, upserted the registration
 *     (resetting access_token_hash / revoked_at) and returned a fresh nonce, so
 *     anyone could re-arm any company's plugin registration.
 *   publishing/worker/run, publishing/reconcile/run, website-analytics/aggregate
 *     — `if (expected) { compare }`: with the secret unset (as in production)
 *     the check never ran and anyone could drive the workers.
 *
 * NOW: register requires company membership + COMPANY_ADMIN/SUPER_ADMIN (the
 * revoke/setup-session gate) and proves website/connection belong to the
 * company. The workers fail CLOSED: secret unset → 503, wrong/missing → 401,
 * compared with crypto.timingSafeEqual.
 *
 * The real guard chain runs; only the database and identity provider are fake.
 */
import { seed, invoke, leaksB, CO_A, CO_B, USER_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockRegister = jest.fn(async (..._a: unknown[]) => ({ id: 'reg-new', nonce: 'nonce-new' }));
jest.mock('../../services/wordpressPluginService', () => ({
  registerWordPressPlugin: (...a: unknown[]) => mockRegister(...a),
}));
const mockRunPublishingWorker = jest.fn(async (..._a: unknown[]) => ({ processed: 0 }));
jest.mock('../../services/publishingJobService', () => ({
  runPublishingWorker: (...a: unknown[]) => mockRunPublishingWorker(...a),
}));
const mockEnqueueReconcile = jest.fn(async (..._a: unknown[]) => ({ queued: 0 }));
const mockRunReconcile = jest.fn(async (..._a: unknown[]) => ({ processed: 0 }));
jest.mock('../../services/publishReconciliationService', () => ({
  enqueuePublishedJobsForReconciliation: (...a: unknown[]) => mockEnqueueReconcile(...a),
  runPublishReconciliationWorker: (...a: unknown[]) => mockRunReconcile(...a),
}));
const mockAggregate = jest.fn(async (..._a: unknown[]) => ({ aggregated: 0 }));
jest.mock('../../services/websiteAnalyticsService', () => ({
  aggregateWebsiteAnalytics: (...a: unknown[]) => mockAggregate(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const register = require('../../../pages/api/wordpress-plugin/register').default;
const workerRun = require('../../../pages/api/publishing/worker/run').default;
const reconcileRun = require('../../../pages/api/publishing/reconcile/run').default;
const aggregate = require('../../../pages/api/website-analytics/aggregate').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const CO_VIEW = 'co-v-0000-0000-0000-00000000000v';

beforeEach(() => {
  seed({
    companies: [{ id: CO_VIEW, status: 'active', name: 'Company where A is only a viewer' }],
    user_company_roles: [{ user_id: USER_A, company_id: CO_VIEW, role: 'VIEWER', status: 'active' }],
    websites: [
      { id: 'web-a', company_id: CO_A },
      { id: 'web-b', company_id: CO_B },
      { id: 'web-view', company_id: CO_VIEW },
    ],
    website_connections: [
      { id: 'conn-a', website_id: 'web-a' },
      { id: 'conn-b', website_id: 'web-b' },
    ],
  });
  [mockRegister, mockRunPublishingWorker, mockEnqueueReconcile, mockRunReconcile, mockAggregate].forEach((m) => m.mockClear());
});

// ───────────────────────────────────────────── wordpress-plugin/register ──

describe('/api/wordpress-plugin/register', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    company_id: CO_A, website_id: 'web-a', site_url: 'https://a.example', plugin_site_id: 'site-1', ...over,
  });

  it('unauthenticated → 401, registration never touched', async () => {
    const r = await invoke(register, { method: 'POST', as: null, body: body() });
    expect(r.status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('member of A naming company B → 403, no nonce issued', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: body({ company_id: CO_B, website_id: 'web-b' }) });
    expect(r.status).toBe(403);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(leaksB(r.body)).toBe(false);
  });

  it('own company but B\'s website → 404, no nonce issued', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: body({ website_id: 'web-b' }) });
    expect(r.status).toBe(404);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('own company + own website but B\'s connection → 404', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: body({ connection_id: 'conn-b' }) });
    expect(r.status).toBe(404);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('non-admin member → 403 (same admin gate as revoke / setup-session)', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: body({ company_id: CO_VIEW, website_id: 'web-view' }) });
    expect(r.status).toBe(403);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('company admin with own website + connection → 201, registered for the authorized company', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: body({ connection_id: 'conn-a' }) });
    expect(r.status).toBe(201);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister.mock.calls[0][0]).toMatchObject({ companyId: CO_A, websiteId: 'web-a', connectionId: 'conn-a' });
  });

  it('missing fields → 400 unchanged', async () => {
    const r = await invoke(register, { method: 'POST', as: 'A', body: { company_id: CO_A } });
    expect(r.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────── worker endpoints ──

const WORKERS: Array<[string, (req: any, res: any) => unknown, string, () => jest.Mock[]]> = [
  ['publishing/worker/run', workerRun, 'PUBLISHING_WORKER_SECRET', () => [mockRunPublishingWorker]],
  ['publishing/reconcile/run', reconcileRun, 'PUBLISHING_WORKER_SECRET', () => [mockEnqueueReconcile, mockRunReconcile]],
  ['website-analytics/aggregate', aggregate, 'ANALYTICS_WORKER_SECRET', () => [mockAggregate]],
];

describe.each(WORKERS)('/api/%s fails closed', (_name, handler, envName, sinks) => {
  const saved = process.env[envName];
  afterEach(() => {
    if (saved === undefined) delete process.env[envName];
    else process.env[envName] = saved;
  });
  const notCalled = () => sinks().forEach((m) => expect(m).not.toHaveBeenCalled());

  it('secret UNSET → 503 even with a header; worker never runs (was: open to anyone)', async () => {
    delete process.env[envName];
    const r = await invoke(handler, { method: 'POST', as: null, headers: { 'x-worker-secret': 'anything' }, body: {} });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'Worker secret not configured' });
    notCalled();
  });

  it('secret unset → 503 for a logged-in user too (a session is not a worker credential)', async () => {
    delete process.env[envName];
    const r = await invoke(handler, { method: 'POST', as: 'A', body: {} });
    expect(r.status).toBe(503);
    notCalled();
  });

  it('wrong secret → 401', async () => {
    process.env[envName] = 'the-real-worker-secret';
    const r = await invoke(handler, { method: 'POST', as: null, headers: { 'x-worker-secret': 'the-real-worker-secreX' }, body: {} });
    expect(r.status).toBe(401);
    notCalled();
  });

  it('wrong-length secret → 401 (no timingSafeEqual length throw)', async () => {
    process.env[envName] = 'the-real-worker-secret';
    const r = await invoke(handler, { method: 'POST', as: null, headers: { 'x-worker-secret': 'short' }, body: {} });
    expect(r.status).toBe(401);
    notCalled();
  });

  it('missing secret header → 401', async () => {
    process.env[envName] = 'the-real-worker-secret';
    const r = await invoke(handler, { method: 'POST', as: null, body: {} });
    expect(r.status).toBe(401);
    notCalled();
  });

  it('right secret → 200 and the worker runs', async () => {
    process.env[envName] = 'the-real-worker-secret';
    const r = await invoke(handler, { method: 'POST', as: null, headers: { 'x-worker-secret': 'the-real-worker-secret' }, body: {} });
    expect(r.status).toBe(200);
    sinks().forEach((m) => expect(m).toHaveBeenCalled());
  });

  it('non-POST → 405 unchanged', async () => {
    const r = await invoke(handler, { method: 'GET', as: null });
    expect(r.status).toBe(405);
    notCalled();
  });
});

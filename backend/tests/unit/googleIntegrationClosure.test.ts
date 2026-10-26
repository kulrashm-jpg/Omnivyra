/**
 * Integration-gap closure: manual "Sync now" queued on the worker, platform configuration vs tenant
 * connection vs data vs freshness, the OAuth connect URLs per product, and the SEO confidence regression
 * (a configured key alone never raises confidence). Fake queue, recording DB, mocked Google: no network.
 */
process.env.OAUTH_STATE_HMAC_KEY = process.env.OAUTH_STATE_HMAC_KEY || 'f'.repeat(64);

// ── recording DB mock ────────────────────────────────────────────────────────
type Op = { table: string; calls: Array<[string, unknown[]]> };
const dbOps: Op[] = [];
let dbResult: (op: Op) => unknown = () => ({ data: null, error: null });
function fakeTable(table: string) {
  const op: Op = { table, calls: [] };
  dbOps.push(op);
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(dbResult(op)).then(res, rej);
      return (...args: unknown[]) => { op.calls.push([String(prop), args]); return proxy; };
    },
  });
  return proxy;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeTable(t) } }));

// ── fake BullMQ queue ────────────────────────────────────────────────────────
type FakeJob = { id: string; data: any; state: string; returnvalue?: unknown; failedReason?: string; removed?: boolean };
const queueJobs = new Map<string, FakeJob>();
let queueDown = false;
const fakeQueue = {
  async getJob(id: string) {
    if (queueDown) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const j = queueJobs.get(id);
    return j ? { ...j, getState: async () => j.state, remove: async () => { queueJobs.delete(id); } } : undefined;
  },
  async add(_name: string, data: any, opts: any) {
    if (queueDown) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const job: FakeJob = queueJobs.get(opts.jobId) ?? { id: opts.jobId, data, state: 'waiting' };
    queueJobs.set(opts.jobId, job);
    return { ...job, getState: async () => job.state };
  },
};
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => fakeQueue }));

// ── route collaborators ──────────────────────────────────────────────────────
let currentUser: { id: string } | null = { id: 'user-a' };
const allowed = new Set(['tenant-a']);
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: currentUser, error: currentUser ? null : 'no' }) }));
jest.mock('../../middleware/authMiddleware', () => ({
  requireCompanyAccess: async (_u: string, companyId: string, res: any) => { if (allowed.has(companyId)) return true; res.status(403).json({ error: 'forbidden' }); return false; },
}));
jest.mock('../../services/analyticsIntegrationService', () => ({
  getActiveProperty: async (companyId: string) => (companyId === 'tenant-a' ? { property_id: 'properties/1' } : null),
  getActiveSearchConsoleProperty: async (companyId: string) => (companyId === 'tenant-a' ? { property_id: 'sc-domain:acme.test' } : null),
}));
jest.mock('../../services/analyticsProviderConfigService', () => ({
  getAnalyticsProviderConfig: async () => ({
    enabled: true,
    oauth_client_id: 'fixture-client-id.apps.googleusercontent.com',
    oauth_client_secret: ['fixture', 'client', 'secret'].join('-'),
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'],
    redirect_uri: 'https://www.omnivyra.com/api/analytics/connect/google/callback',
    capability_redirect_uris: { google_analytics: null, google_search_console: null },
  }),
}));

// ── SEO engine collaborators ─────────────────────────────────────────────────
const confidenceInputs: any[] = [];
jest.mock('../../services/evidencePlatform', () => {
  const actual = jest.requireActual('../../services/evidencePlatform');
  return { ...actual, deriveDecisionConfidence: (input: any) => { confidenceInputs.push(input); return actual.deriveDecisionConfidence(input); } };
});
jest.mock('../../services/decisionObjectService', () => ({ archiveDecisionSourceEntityType: async () => undefined, createDecisionObjects: async () => [] }));
jest.mock('../../services/intelligenceExecutionContext', () => {
  const actual = jest.requireActual('../../services/intelligenceExecutionContext');
  return { ...actual, assertBackgroundJobContext: () => undefined };
});

import { enqueueManualSync, getManualSyncStatus, runManualSyncJob, manualSyncJobId, manualSyncWindow } from '../../services/analyticsManualSync';
import forceSyncRoute from '../../../pages/api/analytics/force-sync';
import { googleSourceStatesFrom, getGoogleSourceStates, isGooglePlatformOauthConfigured, type TenantSnapshot } from '../../services/googleTenantSourceAvailability';
import { buildProviderActivationMatrix } from '../../services/evidencePlatform/presentation/providerActivationMatrix';
import { googleHealthStatus } from '../../services/evidencePlatform/presentation/providerHealthDashboard';
import { getProviderHealth } from '../../services/providers/providerHealthService';
import { connectGoogleAnalytics, connectGoogleSearchConsole } from '../../services/analyticsIntegrationServiceProviders';
import { setDataSourceStatus } from '../../services/ingestionRunService';
import { generateSeoIntelligenceDecisions } from '../../services/seoIntelligenceService';
import { UnrecoverableError } from 'bullmq';

const NOW = new Date('2026-10-26T06:00:00Z');
beforeEach(() => { dbOps.length = 0; dbResult = () => ({ data: null, error: null }); queueJobs.clear(); queueDown = false; currentUser = { id: 'user-a' }; confidenceInputs.length = 0; });

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = () => res;
  return res;
}
const req = (method: string, payload: Record<string, unknown>) => ({ method, headers: {}, query: method === 'GET' ? payload : {}, body: method === 'GET' ? undefined : payload } as any);

// ── 1. manual sync: queue, duplicates, outage, status, worker ────────────────
describe('manual "Sync now": queued on the worker, accurate status, never lost', () => {
  it('windows: GSC = bounded 90-day backfill, GA4 = last 7 days; one job id per tenant + source + window', () => {
    expect(manualSyncWindow('gsc', NOW)).toEqual({ startDate: '2026-07-26', endDate: '2026-10-23' });
    expect(manualSyncWindow('ga4', NOW)).toEqual({ startDate: '2026-10-19', endDate: '2026-10-26' });
    expect(manualSyncJobId('tenant-a', 'gsc', manualSyncWindow('gsc', NOW))).toBe('manual-sync-gsc-tenant-a-2026-07-26-2026-10-23');
  });

  it('queues once; a second request while queued or running returns the same job', async () => {
    const first = await enqueueManualSync('tenant-a', 'gsc', { now: () => NOW });
    expect(first).toMatchObject({ status: 'queued', duplicate: false });
    const second = await enqueueManualSync('tenant-a', 'gsc', { now: () => NOW });
    expect(second).toMatchObject({ status: 'queued', duplicate: true, jobId: first.jobId });
    queueJobs.get(first.jobId)!.state = 'active';
    expect(await enqueueManualSync('tenant-a', 'gsc', { now: () => NOW })).toMatchObject({ status: 'running', duplicate: true });
    expect(queueJobs.size).toBe(1);
    // Another tenant, or another source, is a different job.
    await enqueueManualSync('tenant-b', 'gsc', { now: () => NOW });
    await enqueueManualSync('tenant-a', 'ga4', { now: () => NOW });
    expect(queueJobs.size).toBe(3);
  });

  it('a failed job is replaced on retry; a completed one reports its own result', async () => {
    const t = await enqueueManualSync('tenant-a', 'ga4', { now: () => NOW });
    queueJobs.get(t.jobId)!.state = 'failed';
    expect(await enqueueManualSync('tenant-a', 'ga4', { now: () => NOW })).toMatchObject({ status: 'queued', duplicate: false });
    queueJobs.get(t.jobId)!.state = 'completed';
    queueJobs.get(t.jobId)!.returnvalue = { success: true, skipped: false, reason: null, recordsWritten: 12, error: null };
    const done = await enqueueManualSync('tenant-a', 'ga4', { now: () => NOW });
    expect(done).toMatchObject({ status: 'completed', duplicate: true, result: { recordsWritten: 12 } });
  });

  it('queue outage → queue_unavailable; nothing runs, nothing is reported synced', async () => {
    queueDown = true;
    expect(await enqueueManualSync('tenant-a', 'gsc', { now: () => NOW })).toMatchObject({ status: 'queue_unavailable' });
    expect(await getManualSyncStatus('tenant-a', 'gsc', { now: () => NOW })).toMatchObject({ status: 'queue_unavailable' });
  });

  it('status reflects the job: none → queued → running → failed (with reason)', async () => {
    expect((await getManualSyncStatus('tenant-a', 'gsc', { now: () => NOW })).status).toBe('none');
    const t = await enqueueManualSync('tenant-a', 'gsc', { now: () => NOW });
    expect((await getManualSyncStatus('tenant-a', 'gsc', { now: () => NOW })).status).toBe('queued');
    queueJobs.get(t.jobId)!.state = 'active';
    expect((await getManualSyncStatus('tenant-a', 'gsc', { now: () => NOW })).status).toBe('running');
    Object.assign(queueJobs.get(t.jobId)!, { state: 'failed', failedReason: 'Search Console API failed (403): no permission' });
    expect(await getManualSyncStatus('tenant-a', 'gsc', { now: () => NOW })).toMatchObject({ status: 'failed', error: 'Search Console API failed (403): no permission' });
  });

  const job = { type: 'analytics-manual-sync' as const, companyId: 'tenant-a', source: 'gsc' as const, startDate: '2026-07-26', endDate: '2026-10-23' };
  const summary = (r: any) => async () => ({ companyId: 'tenant-a', sources: [r], validation: {} as any, ready: false });

  it('worker: forces a run of exactly that window and returns its result', async () => {
    let params: any;
    const result = await runManualSyncJob(job, { runCompany: (async (p: any) => { params = p; return summary({ source: 'gsc', success: true, details: { metricsInserted: 40 } })(); }) as any });
    expect(params).toMatchObject({ companyId: 'tenant-a', sources: ['gsc'], force: true, overrides: { gsc: { startDate: '2026-07-26', endDate: '2026-10-23' } } });
    expect(result).toEqual({ success: true, skipped: false, reason: null, recordsWritten: 40, error: null });
  });

  it('worker: a failed or partial run throws (BullMQ retries) — never completes as success', async () => {
    await expect(runManualSyncJob(job, { runCompany: summary({ source: 'gsc', success: false, error: 'Search Console API failed (429): Quota exceeded' }) as any })).rejects.toThrow(/429/);
  });

  it('worker: a company that is not connected fails once, without pointless retries', async () => {
    const err = await runManualSyncJob(job, { runCompany: summary({ source: 'gsc', success: false, missingIntegration: true, error: 'Search Console integration is not ready' }) as any }).catch((e) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
  });

  it('worker: another run already in progress is reported as such, not as a fresh sync', async () => {
    expect(await runManualSyncJob(job, { runCompany: summary({ source: 'gsc', success: true, skipped: true, details: { reason: 'already_running' } }) as any }))
      .toMatchObject({ success: true, skipped: true, reason: 'already_running' });
  });

  it('a failed status write keeps the last successful sync time (last_synced_at not overwritten)', async () => {
    await setDataSourceStatus({ companyId: 'tenant-a', source: 'gsc', status: 'error', errorMessage: 'boom' });
    const payload = dbOps.find((o) => o.table === 'data_source_status')!.calls.find(([m]) => m === 'upsert')![1][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('last_synced_at');
    dbOps.length = 0;
    await setDataSourceStatus({ companyId: 'tenant-a', source: 'gsc', status: 'connected', lastSyncedAt: '2026-10-26T06:00:00Z' });
    expect((dbOps[0].calls.find(([m]) => m === 'upsert')![1][0] as any).last_synced_at).toBe('2026-10-26T06:00:00Z');
  });
});

describe('manual sync route', () => {
  it('POST → 202 queued; repeat → same job, duplicate; GET → the job state', async () => {
    const r1 = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-a', capability: 'google_search_console' }), r1);
    expect(r1.statusCode).toBe(202);
    expect(r1.body).toMatchObject({ status: 'queued', duplicate: false });
    const r2 = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-a', capability: 'google_search_console' }), r2);
    expect(r2.body).toMatchObject({ status: 'queued', duplicate: true, job_id: r1.body.job_id });
    const g = mockRes();
    await forceSyncRoute(req('GET', { companyId: 'tenant-a', capability: 'google_search_console' }), g);
    expect(g.statusCode).toBe(200);
    expect(g.body).toMatchObject({ status: 'queued', job_id: r1.body.job_id });
  });

  it('queue outage → 503 queue_unavailable', async () => {
    queueDown = true;
    const r = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-a' }), r);
    expect(r.statusCode).toBe(503);
    expect(r.body.status).toBe('queue_unavailable');
  });

  it('tenant isolation: another company is refused; no property → 400; unauthenticated → 401', async () => {
    const other = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-b' }), other);
    expect(other.statusCode).toBe(403);
    allowed.add('tenant-c');
    const noProp = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-c' }), noProp);
    expect(noProp.body).toMatchObject({ error: 'no_active_property' });
    currentUser = null;
    const anon = mockRes();
    await forceSyncRoute(req('POST', { companyId: 'tenant-a' }), anon);
    expect(anon.statusCode).toBe(401);
    expect(queueJobs.size).toBe(0);
  });
});

// ── 2. four states; platform view vs tenant view ─────────────────────────────
describe('availability: configured ≠ connected ≠ data ≠ fresh', () => {
  const snap = (o: Partial<TenantSnapshot> = {}): TenantSnapshot => ({ integration: { id: 'i', status: 'connected', connection_state: 'CONNECTED' }, hasActiveProperty: true, lastCompletedAt: '2026-10-25T06:00:00Z', ...o });

  it.each([
    ['platform view: configured only', true, null, { providerConfigured: true, tenantConnected: null, dataAvailable: null, dataFresh: null, state: 'platform_only' }],
    ['configured, company never connected', true, snap({ integration: null, hasActiveProperty: false, lastCompletedAt: null }), { providerConfigured: true, tenantConnected: false, dataAvailable: false, dataFresh: false, state: 'not_connected' }],
    // Disconnected later: earlier imports still exist (available) but are not usable (not fresh).
    ['configured, company disconnected after an import', true, snap({ integration: null }), { providerConfigured: true, tenantConnected: false, dataAvailable: true, dataFresh: false, state: 'not_connected' }],
    ['connected, no import yet', true, snap({ lastCompletedAt: null }), { tenantConnected: true, dataAvailable: false, dataFresh: false, state: 'never_synced' }],
    ['connected, stale import', true, snap({ lastCompletedAt: '2026-10-10T06:00:00Z' }), { tenantConnected: true, dataAvailable: true, dataFresh: false, state: 'stale' }],
    ['connected and fresh', true, snap(), { tenantConnected: true, dataAvailable: true, dataFresh: true, state: 'connected' }],
    ['not configured, connection left over', false, snap(), { providerConfigured: false, tenantConnected: true, dataFresh: true }],
  ])('%s', (_label, configured, s, expected) => {
    expect(googleSourceStatesFrom('gsc', configured as boolean, s as TenantSnapshot | null, NOW)).toMatchObject(expected as object);
  });

  it('per-company health: configured is never "connected" for a company without its own fresh import', () => {
    const states = (o: object) => ({ ...googleSourceStatesFrom('gsc', true, snap(), NOW), ...o });
    expect(googleHealthStatus(states({ providerConfigured: false }))).toBe('awaiting_credentials');
    expect(googleHealthStatus(states({ tenantConnected: false }))).toBe('awaiting_connection');
    expect(googleHealthStatus(states({ dataAvailable: false, dataFresh: false }))).toBe('no_data');
    expect(googleHealthStatus(states({ dataFresh: false }))).toBe('stale');
    expect(googleHealthStatus(states({}))).toBe('connected');
  });

  it('the platform matrix reports the Super Admin OAuth client — env vars are not evidence', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { GSC_OAUTH_CLIENT_ID: 'x', GSC_OAUTH_CLIENT_SECRET: 'x', GA4_PROPERTY_ID: 'x', GA4_OAUTH: 'x' });
    try {
      const off = buildProviderActivationMatrix({ googleOauthConfigured: false }).filter((r) => ['search_console', 'analytics.ga4'].includes(r.providerId));
      expect(off.map((r) => [r.providerId, r.configured, r.configurationSource, r.requiredEnvKeys])).toEqual([
        ['search_console', false, 'super_admin_oauth_client', []],
        ['analytics.ga4', false, 'super_admin_oauth_client', []],
      ]);
      const on = buildProviderActivationMatrix({ googleOauthConfigured: true }).find((r) => r.providerId === 'search_console')!;
      expect(on).toMatchObject({ configured: true, status: 'active' });
      expect(on.activationChecklist.join(' ')).toMatch(/each company connects its own Google account/);
      expect(getProviderHealth('search_console')!.authenticated).toBe(false);
    } finally {
      for (const k of ['GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET', 'GA4_PROPERTY_ID', 'GA4_OAUTH']) if (saved[k] === undefined) delete process.env[k];
    }
  });

  it('platform OAuth configured = enabled + client id + secret (booleans only)', async () => {
    expect(await isGooglePlatformOauthConfigured({ loadConfig: async () => ({ enabled: true, oauth_client_id: 'a', oauth_client_secret: 'b' }) })).toBe(true);
    expect(await isGooglePlatformOauthConfigured({ loadConfig: async () => ({ enabled: false, oauth_client_id: 'a', oauth_client_secret: 'b' }) })).toBe(false);
    expect(await isGooglePlatformOauthConfigured({ loadConfig: async () => ({ enabled: true, oauth_client_id: 'a', oauth_client_secret: null }) })).toBe(false);
    expect(await isGooglePlatformOauthConfigured({ loadConfig: async () => { throw new Error('db'); } })).toBe(false);
  });

  it('tenant view reads that company only; platform view reads no tenant rows', async () => {
    await getGoogleSourceStates(null, 'ga4', { platformConfigured: async () => true });
    expect(dbOps).toHaveLength(0);
    const r = await getGoogleSourceStates('tenant-a', 'ga4', { now: () => NOW, platformConfigured: async () => true, load: async (id) => (id === 'tenant-a' ? snap() : snap({ integration: null })) });
    expect(r).toMatchObject({ tenantConnected: true, dataFresh: true });
  });
});

// ── 3. OAuth connect URLs per product; reconnect never demotes ───────────────
describe('connect flows request only their own product scope', () => {
  const scopesOf = (url: string) => new URL(url).searchParams.get('scope')!.split(' ');
  beforeEach(() => {
    dbResult = (op) => (op.calls.some(([m]) => m === 'maybeSingle') ? { data: { id: 'int-1', status: 'connected', provider: 'GSC' }, error: null } : { data: null, error: null });
  });

  it('Search Console: webmasters.readonly + sign-in scopes, no Analytics', async () => {
    const { authorizationUrl } = await connectGoogleSearchConsole('tenant-a', { userId: 'user-a', requestBaseUrl: 'https://www.omnivyra.com' });
    expect(scopesOf(authorizationUrl)).toEqual(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/webmasters.readonly']);
    expect(new URL(authorizationUrl).searchParams.get('access_type')).toBe('offline');
  });

  it('Google Analytics: analytics.readonly + sign-in scopes, no Search Console', async () => {
    const { authorizationUrl } = await connectGoogleAnalytics('tenant-a', { userId: 'user-a', requestBaseUrl: 'https://www.omnivyra.com' });
    expect(scopesOf(authorizationUrl)).toEqual(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/analytics.readonly']);
  });

  it('starting a reconnect leaves a working connection as it is (no status write)', async () => {
    await connectGoogleSearchConsole('tenant-a', { userId: 'user-a', requestBaseUrl: 'https://www.omnivyra.com' });
    const writes = dbOps.filter((o) => o.table === 'analytics_integrations').flatMap((o) => o.calls.filter(([m]) => m === 'update' || m === 'insert'));
    expect(writes).toEqual([]);
  });

  it('a company with no row gets one created as disconnected', async () => {
    dbResult = (op) => (op.calls.some(([m]) => m === 'maybeSingle') ? { data: null, error: null } : { data: { id: 'new' }, error: null });
    await connectGoogleSearchConsole('tenant-a', { userId: 'user-a', requestBaseUrl: 'https://www.omnivyra.com' });
    const insert = dbOps.flatMap((o) => o.calls.filter(([m]) => m === 'insert'))[0];
    expect(insert[1][0]).toMatchObject({ company_id: 'tenant-a', provider: 'GSC', status: 'disconnected' });
  });
});

// ── 4. SEO confidence regression ─────────────────────────────────────────────
describe('SEO confidence: only this company’s own fresh Search Console data lifts it', () => {
  const seedSeoData = (integration: unknown, lastCompleted: string | null) => {
    dbResult = (op) => {
      if (op.table === 'canonical_keywords') return { data: [{ id: 'k1', company_id: 'tenant-a', keyword: 'crm', keyword_normalized: 'crm', landing_page_url: 'https://acme.test/' }], error: null };
      if (op.table === 'keyword_metrics') return { data: [{ keyword_id: 'k1', metric_date: '2026-10-20', impressions: 100, clicks: 5, ctr: 0.05, avg_position: 8, page_url: 'https://acme.test/' }], error: null };
      if (op.table === 'analytics_integrations') return { data: integration, error: null };
      if (op.table === 'analytics_properties') return { data: integration ? { id: 'p' } : null, error: null };
      if (op.table === 'ingestion_runs') return { data: lastCompleted ? { completed_at: lastCompleted } : null, error: null };
      return { data: null, error: null };
    };
  };

  it('a configured Bing key and GSC env vars alone add nothing', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { BING_WEBMASTER_API_KEY: 'fixture', GSC_OAUTH_CLIENT_ID: 'x', GSC_OAUTH_CLIENT_SECRET: 'x' });
    try {
      seedSeoData(null, null);
      await generateSeoIntelligenceDecisions('tenant-a');
      expect(confidenceInputs.length).toBeGreaterThan(0);
      expect(confidenceInputs[0].providerReliability).toBeNull();
    } finally {
      for (const k of ['BING_WEBMASTER_API_KEY', 'GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET']) if (saved[k] === undefined) delete process.env[k];
    }
  });

  it('this company connected with a fresh import → the Search Console reliability, and only that', async () => {
    seedSeoData({ id: 'int-a', status: 'connected', connection_state: 'CONNECTED' }, new Date(Date.now() - 86_400_000).toISOString());
    await generateSeoIntelligenceDecisions('tenant-a');
    expect(confidenceInputs[0].providerReliability).toBeCloseTo(0.95);
  });

  it('connected but stale → no lift', async () => {
    seedSeoData({ id: 'int-a', status: 'connected', connection_state: 'CONNECTED' }, new Date(Date.now() - 10 * 86_400_000).toISOString());
    await generateSeoIntelligenceDecisions('tenant-a');
    expect(confidenceInputs[0].providerReliability).toBeNull();
  });
});

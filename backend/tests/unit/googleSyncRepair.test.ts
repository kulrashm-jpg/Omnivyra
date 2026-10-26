/**
 * Google Analytics (GA4) + Search Console (GSC) sync repair — regression suite.
 *
 * Pagination, aggregation, idempotent scheduled sync, tenant-specific availability, stale data, GA4 date
 * windows, token-refresh outcomes, OAuth scopes and queued post-connect imports. Every Google call goes
 * through an injected fake fetch and every database call through a recording mock: no network, no
 * real credentials (fixture strings are assembled at runtime).
 */

// ── recording DB mock (ownedDbTable) ─────────────────────────────────────────
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
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: () => ({ allowed: true }),
  recordProviderUsage: async () => undefined,
}));
jest.mock('../../services/ingestionUtils', () => {
  const actual = jest.requireActual('../../services/ingestionUtils');
  return { ...actual, resolveCompanyWebsite: async () => null, ensureCanonicalDomain: async () => undefined };
});
const tokenRecord: { current: any } = { current: null };
jest.mock('../../services/analyticsIntegrationServiceProviders', () => {
  const actual = jest.requireActual('../../services/analyticsIntegrationServiceProviders');
  return {
    ...actual,
    getAnalyticsTokenRecord: async () => tokenRecord.current,
    getGoogleAnalyticsOauthConfig: async () => ({ client_id: 'fixture-client-id', client_secret: ['fixture', 'client', 'secret'].join('-'), scopes: [], redirect_uri: null, capability_redirect_uris: { google_analytics: null, google_search_console: null } }),
    saveAnalyticsTokens: async () => undefined,
  };
});

import { fetchAllSearchAnalyticsRows, requestSearchAnalyticsPage, GscApiError, classifyGscStatus } from '../../services/gscSearchAnalyticsClient';
import { aggregateGscRows, ingestGscData, buildGscRunKey } from '../../services/gscIngestionService';
import { buildGa4RunKey } from '../../services/ga4IngestionService';
import { planGscWindow, planGa4Window, syncedRecently, runScheduledAnalyticsSync, GSC_MAX_BACKFILL_DAYS } from '../../services/scheduledAnalyticsSync';
import { decideTenantSourceAvailability, getTenantSourceAvailability, tenantProviderReliability, type TenantSnapshot } from '../../services/googleTenantSourceAvailability';
import { classifyTokenRefreshFailure, refreshAccessToken, TokenRefreshError } from '../../services/analyticsIntegrationServiceSync';
import { scopesForCapability } from '../../services/analyticsIntegrationServiceProviders';
import { schedulePostConnectImport } from '../../services/analyticsPostConnectImport';
import { runIngestionForAllCompanies, runIngestionForCompany } from '../../services/ingestionScheduler';

const ACCESS = ['fixture', 'access', 'token'].join('-');
const REFRESH = ['fixture', 'refresh', 'token'].join('-');
const SITE = 'sc-domain:acme.test';
const noSleep = async () => {};

beforeEach(() => { dbOps.length = 0; dbResult = () => ({ data: null, error: null }); tokenRecord.current = null; });

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'network';
function fakeFetch(replies: Reply[] | ((body: any, i: number) => Reply), seen: any[] = []): typeof fetch {
  let i = 0;
  return (async (_url: any, init: any) => {
    const body = init?.body && typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init?.body;
    seen.push({ url: String(_url), body, headers: init?.headers });
    const r = typeof replies === 'function' ? replies(body, i) : replies[Math.min(i, replies.length - 1)];
    i++;
    if (r === 'network') throw new Error('socket hang up');
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
}
const row = (q: string, page: string, date: string, impressions: number, clicks: number, position: number) => ({ keys: [q, page, date], impressions, clicks, ctr: impressions ? clicks / impressions : 0, position });

// ── 1. Search Console pagination + retries ───────────────────────────────────
describe('Search Console client: pagination and retries', () => {
  const req = { accessToken: ACCESS, propertyUrl: SITE, startDate: '2026-10-01', endDate: '2026-10-07', dimensions: ['query', 'page', 'date'] };

  it('pages with startRow until a short page', async () => {
    const seen: any[] = [];
    const pages = [[row('a', '/x', '2026-10-01', 1, 0, 1), row('b', '/x', '2026-10-01', 1, 0, 1)], [row('c', '/y', '2026-10-02', 1, 0, 1), row('d', '/y', '2026-10-02', 1, 0, 1)], [row('e', '/z', '2026-10-03', 1, 0, 1)]];
    const r = await fetchAllSearchAnalyticsRows(req, { rowLimit: 2, sleep: noSleep, fetchImpl: fakeFetch((_b, i) => ({ status: 200, body: { rows: pages[i] } }), seen) });
    expect(seen.map((s) => s.body.startRow)).toEqual([0, 2, 4]);
    expect(seen.every((s) => s.body.rowLimit === 2)).toBe(true);
    expect(r).toMatchObject({ pages: 3, partialFailure: null, error: null });
    expect(r.rows).toHaveLength(5);
  });

  it('stops at the page cap and reports it, never silently truncating', async () => {
    const r = await fetchAllSearchAnalyticsRows(req, { rowLimit: 1, maxPages: 3, sleep: noSleep, fetchImpl: fakeFetch([{ status: 200, body: { rows: [row('a', '/x', '2026-10-01', 1, 0, 1)] } }]) });
    expect(r.rows).toHaveLength(3);
    expect(r.partialFailure).toMatch(/page cap/);
  });

  it('retries 429 (honouring Retry-After), 5xx and network errors; returns the page', async () => {
    const waits: number[] = [];
    const r = await requestSearchAnalyticsPage({ ...req, startRow: 0 }, {
      sleep: async (ms) => { waits.push(ms); },
      fetchImpl: fakeFetch([{ status: 429, headers: { 'retry-after': '2' }, body: { error: { message: 'Quota exceeded' } } }, { status: 503 }, 'network', { status: 200, body: { rows: [] } }]),
    });
    expect(r.retries).toBe(3);
    expect(waits).toEqual([2000, 1000, 2000]);
  });

  it.each([[401, 'unauthorized'], [403, 'permission_denied'], [404, 'not_found'], [400, 'bad_request']])('HTTP %i fails at once as %s; Google message only, never token or raw body', async (status, kind) => {
    const seen: any[] = [];
    const err = await requestSearchAnalyticsPage({ ...req, startRow: 0 }, { sleep: noSleep, fetchImpl: fakeFetch([{ status, body: { error: { message: 'User does not have sufficient permission' }, echo: ACCESS } }], seen) }).catch((e) => e);
    expect(err).toBeInstanceOf(GscApiError);
    expect(err).toMatchObject({ kind, httpStatus: status });
    expect(seen).toHaveLength(1);
    expect(err.message).toContain('sufficient permission');
    expect(err.message).not.toContain(ACCESS);
    expect(classifyGscStatus(429)).toBe('quota');
  });

  it('a failure after some pages is a partial failure carrying the rows read so far', async () => {
    const r = await fetchAllSearchAnalyticsRows(req, { rowLimit: 1, maxRetries: 0, sleep: noSleep, fetchImpl: fakeFetch((_b, i) => (i === 0 ? { status: 200, body: { rows: [row('a', '/x', '2026-10-01', 1, 0, 1)] } } : { status: 403, body: { error: { message: 'gone' } } })) });
    expect(r.rows).toHaveLength(1);
    expect(r.error?.kind).toBe('permission_denied');
  });
});

// ── 2. aggregation + ingestion ───────────────────────────────────────────────
describe('Search Console ingestion: aggregate totals, one row per stored key', () => {
  it('merges rows that normalise to the same keyword / page / date', () => {
    const merged = aggregateGscRows([
      { keyword: 'CRM Tool', pageUrl: 'https://acme.test/crm/', date: '2026-10-01', impressions: 100, clicks: 10, avgPosition: 2 },
      { keyword: 'crm tool', pageUrl: 'https://acme.test/crm', date: '2026-10-01', impressions: 300, clicks: 5, avgPosition: 6 },
      { keyword: 'crm tool', pageUrl: 'https://acme.test/crm', date: '2026-10-02', impressions: 50, clicks: 1, avgPosition: 3 },
      { keyword: '  ', pageUrl: null, date: '2026-10-01', impressions: 9, clicks: 9, avgPosition: 1 },
    ]);
    expect(merged).toHaveLength(2);
    const day1 = merged.find((m) => m.date === '2026-10-01')!;
    expect(day1).toMatchObject({ impressions: 400, clicks: 15 });
    expect(day1.ctr).toBeCloseTo(15 / 400);
    expect(day1.avgPosition).toBeCloseTo((2 * 100 + 6 * 300) / 400);
  });

  it('asks Google for query/page/date only (no country/device) and writes aggregate totals', async () => {
    const seen: any[] = [];
    dbResult = (op) => (op.calls.some(([m]) => m === 'single') ? { data: { id: `kw-${dbOps.indexOf(op)}` }, error: null } : { data: null, error: null });
    const result = await ingestGscData(
      { companyId: 'company-a', siteUrl: SITE, accessToken: ACCESS, startDate: '2026-10-01', endDate: '2026-10-07' },
      { sleep: noSleep, fetchImpl: fakeFetch([{ status: 200, body: { rows: [row('crm', 'https://acme.test/a', '2026-10-01', 10, 1, 3), row('CRM', 'https://acme.test/a/', '2026-10-01', 30, 2, 5)] } }], seen) },
    );
    expect(seen[0].body.dimensions).toEqual(['query', 'page', 'date']);
    expect(seen[0].body).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-07', startRow: 0 });
    const metrics = dbOps.filter((o) => o.table === 'keyword_metrics');
    expect(metrics).toHaveLength(1);
    const payload = metrics[0].calls.find(([m]) => m === 'upsert')![1][0] as any;
    expect(payload).toMatchObject({ company_id: 'company-a', impressions: 40, clicks: 3, dimension_values: {} });
    expect(result).toMatchObject({ keywordsProcessed: 2, metricsInserted: 1 });
  });

  it('a partial read fails the run before anything is written (the next run re-reads those dates)', async () => {
    const err = await ingestGscData(
      { companyId: 'company-a', siteUrl: SITE, accessToken: ACCESS, startDate: '2026-10-01', endDate: '2026-10-07' },
      { sleep: noSleep, maxRetries: 0, fetchImpl: fakeFetch([{ status: 429, body: { error: { message: 'Quota exceeded' } } }]) },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GscApiError);
    expect(err.kind).toBe('quota');
    expect(dbOps.some((o) => o.table === 'keyword_metrics')).toBe(false);
  });
});

// ── 3. scheduled sync: windows, idempotency, isolation ───────────────────────
describe('scheduled sync: dated windows, watermark, minimum interval', () => {
  const now = new Date('2026-10-26T06:00:00Z');

  it('GA4: last 7 days through today; a new day gives a new idempotency key, the same day the same one', () => {
    expect(planGa4Window(now)).toEqual({ startDate: '2026-10-19', endDate: '2026-10-26' });
    const k = (d: Date) => buildGa4RunKey({ companyId: 'c', ...planGa4Window(d) });
    expect(k(now)).toBe(k(new Date('2026-10-26T23:00:00Z')));
    expect(k(now)).not.toBe(k(new Date('2026-10-27T06:00:00Z')));
    // The old undated call produced ONE key forever — the reason the 6-hour job never re-ran.
    expect(buildGa4RunKey({ companyId: 'c' })).toBe(buildGa4RunKey({ companyId: 'c' }));
  });

  it('GSC: never synced → bounded backfill; recent watermark → 7-day revision window; gap → from the watermark; never past the floor', () => {
    const back = planGscWindow(now, null);
    expect(back).toEqual({ startDate: '2026-07-26', endDate: '2026-10-23', mode: 'backfill' });
    expect((Date.parse(back.endDate) - Date.parse(back.startDate)) / 86_400_000 + 1).toBe(GSC_MAX_BACKFILL_DAYS);
    expect(planGscWindow(now, { completedAt: '2026-10-25T06:00:00Z', window: { endDate: '2026-10-22' } })).toEqual({ startDate: '2026-10-16', endDate: '2026-10-23', mode: 'incremental' });
    expect(planGscWindow(now, { completedAt: '2026-10-01T06:00:00Z', window: { endDate: '2026-09-28' } }).startDate).toBe('2026-09-22');
    expect(planGscWindow(now, { completedAt: '2026-01-01T06:00:00Z', window: { endDate: '2025-12-29' } }).startDate).toBe('2026-07-26');
    expect(planGscWindow(now, { completedAt: '2026-10-25T06:00:00Z', window: null }).startDate).toBe('2026-10-16');
    expect(buildGscRunKey({ companyId: 'c', siteUrl: SITE, startDate: '2026-10-16', endDate: '2026-10-23' }))
      .toBe(buildGscRunKey({ companyId: 'c', siteUrl: SITE, startDate: '2026-10-16', endDate: '2026-10-23' }));
  });

  it('minimum interval: a company synced recently is skipped', () => {
    expect(syncedRecently(now, { completedAt: '2026-10-26T02:00:00Z', window: null }, 5)).toBe(true);
    expect(syncedRecently(now, { completedAt: '2026-10-25T23:59:00Z', window: null }, 5)).toBe(false);
    expect(syncedRecently(now, null, 5)).toBe(false);
  });

  it('GSC pass: each company gets its own window or skip; the platform company goes to its own pipeline', async () => {
    const plans: Record<string, unknown> = {};
    let platformRuns = 0;
    const runAll: any = async (params: any) => {
      expect(params.sources).toEqual(['gsc']);
      for (const id of ['tenant-a', 'tenant-b', 'tenant-c', 'platform']) plans[id] = await params.planFor(id);
      return { attempted: 4, succeeded: 4, failed: 0, companies: [] };
    };
    const last: Record<string, any> = {
      'tenant-a': { completedAt: '2026-10-25T06:00:00Z', window: { endDate: '2026-10-22' } },
      'tenant-b': { completedAt: '2026-10-26T02:00:00Z', window: { endDate: '2026-10-23' } },
      'tenant-c': null,
    };
    await runScheduledAnalyticsSync('gsc', {}, { now: () => now, runAll, lastRun: async (id) => last[id] ?? null, platformCompanyId: async () => 'platform', runPlatformGsc: async () => { platformRuns++; } });
    expect(plans['tenant-a']).toEqual({ overrides: { gsc: { startDate: '2026-10-16', endDate: '2026-10-23' } } });
    expect(plans['tenant-b']).toEqual({ skip: 'recently_synced' });
    expect(plans['tenant-c']).toEqual({ overrides: { gsc: { startDate: '2026-07-26', endDate: '2026-10-23' } } });
    expect(plans.platform).toEqual({ skip: 'platform_pipeline' });
    expect(platformRuns).toBe(1);
  });

  it('GA4 pass: a dated window for every company; an explicit window (the queued daily job) is honoured', async () => {
    const plans: any[] = [];
    const runAll: any = async (params: any) => { plans.push(await params.planFor('tenant-a'), await params.planFor('tenant-b')); return { attempted: 2, succeeded: 2, failed: 0, companies: [] }; };
    const last: Record<string, any> = { 'tenant-b': { completedAt: '2026-10-26T04:00:00Z', window: null } };
    await runScheduledAnalyticsSync('ga4', {}, { now: () => now, runAll, lastRun: async (id) => last[id] ?? null });
    expect(plans).toEqual([{ overrides: { ga4: { startDate: '2026-10-19', endDate: '2026-10-26' } } }, { skip: 'recently_synced' }]);
    plans.length = 0;
    await runScheduledAnalyticsSync('ga4', { startDate: '2026-10-10', endDate: '2026-10-17' }, { now: () => now, runAll, lastRun: async () => null });
    expect(plans[0]).toEqual({ overrides: { ga4: { startDate: '2026-10-10', endDate: '2026-10-17' } } });
  });
});

// ── 4. tenant-specific availability + stale data ─────────────────────────────
describe('availability is the company’s own state, not an environment variable', () => {
  const now = new Date('2026-10-26T06:00:00Z');
  const snap = (o: Partial<TenantSnapshot> = {}): TenantSnapshot => ({ integration: { id: 'i', status: 'connected', connection_state: 'CONNECTED' }, hasActiveProperty: true, lastCompletedAt: '2026-10-25T06:00:00Z', ...o });

  it.each([
    ['no integration row → not_connected', snap({ integration: null }), 'not_connected'],
    ['disconnected → not_connected', snap({ integration: { id: 'i', status: 'disconnected' } }), 'not_connected'],
    ['status error → reauth_required', snap({ integration: { id: 'i', status: 'error' } }), 'reauth_required'],
    ['reauth state → reauth_required', snap({ integration: { id: 'i', status: 'connected', connection_state: 'PROVIDER_REAUTH_REQUIRED' } }), 'reauth_required'],
    ['no active property → no_property', snap({ hasActiveProperty: false }), 'no_property'],
    ['no completed import → never_synced', snap({ lastCompletedAt: null }), 'never_synced'],
    ['last import 7 days ago → stale', snap({ lastCompletedAt: '2026-10-19T06:00:00Z' }), 'stale'],
    ['fresh → connected', snap(), 'connected'],
  ])('%s', (_label, s, state) => {
    const r = decideTenantSourceAvailability('gsc', s as TenantSnapshot, now);
    expect(r.state).toBe(state);
    expect(r.available).toBe(state === 'connected');
  });

  it('GA4 goes stale sooner than GSC (GSC data itself lags ~3 days)', () => {
    const fourDays = snap({ lastCompletedAt: '2026-10-22T06:00:00Z' });
    expect(decideTenantSourceAvailability('ga4', fourDays, now).state).toBe('stale');
    expect(decideTenantSourceAvailability('gsc', fourDays, now).state).toBe('connected');
  });

  it('two tenants on the same platform get their own answers; env vars play no part', async () => {
    process.env.GSC_OAUTH_CLIENT_ID = 'set'; process.env.GSC_OAUTH_CLIENT_SECRET = 'set';
    try {
      const load = async (companyId: string) => (companyId === 'tenant-a' ? snap() : snap({ integration: null }));
      const a = await tenantProviderReliability('tenant-a', 'gsc', { now: () => now, load: load as any });
      const b = await tenantProviderReliability('tenant-b', 'gsc', { now: () => now, load: load as any });
      expect(typeof a).toBe('number');
      expect(b).toBeNull();
    } finally { delete process.env.GSC_OAUTH_CLIENT_ID; delete process.env.GSC_OAUTH_CLIENT_SECRET; }
  });

  it('a read failure is "not available", never an exception', async () => {
    const r = await getTenantSourceAvailability('tenant-a', 'ga4', { load: async () => { throw new Error('db down'); } });
    expect(r).toMatchObject({ available: false, state: 'not_connected' });
  });

  it('reads only the requesting company’s rows (company and provider filters on every query)', async () => {
    dbResult = (op) => (op.table === 'analytics_integrations' ? { data: { id: 'int-a', status: 'connected', connection_state: 'CONNECTED' }, error: null } : op.table === 'analytics_properties' ? { data: { id: 'p' }, error: null } : { data: { completed_at: '2026-10-25T06:00:00Z' }, error: null });
    const r = await getTenantSourceAvailability('tenant-a', 'gsc', { now: () => now });
    expect(r.state).toBe('connected');
    const integ = dbOps.find((o) => o.table === 'analytics_integrations')!;
    expect(integ.calls).toEqual(expect.arrayContaining([['eq', ['company_id', 'tenant-a']], ['eq', ['provider', 'GSC']]]));
    expect(dbOps.find((o) => o.table === 'analytics_properties')!.calls).toEqual(expect.arrayContaining([['eq', ['integration_id', 'int-a']]]));
    expect(dbOps.find((o) => o.table === 'ingestion_runs')!.calls).toEqual(expect.arrayContaining([['eq', ['company_id', 'tenant-a']], ['eq', ['source', 'gsc']]]));
  });
});

// ── 5. token refresh outcomes ────────────────────────────────────────────────
describe('token refresh: only a revoked grant breaks the connection', () => {
  const updates = () => dbOps.filter((o) => o.table === 'analytics_integrations').flatMap((o) => o.calls.filter(([m]) => m === 'update').map(([, a]) => a[0] as Record<string, unknown>));
  beforeEach(() => {
    tokenRecord.current = { access_token: ACCESS, refresh_token: REFRESH, expiry_date: '2026-10-26T00:00:00Z', scope: 'x' };
    dbResult = (op) => (op.calls.some(([m]) => m === 'maybeSingle') ? { data: { provider: 'GSC' }, error: null } : { data: null, error: null });
  });

  it('classifies outcomes', () => {
    expect(classifyTokenRefreshFailure(400, 'invalid_grant')).toBe('revoked');
    expect(classifyTokenRefreshFailure(401, 'invalid_client')).toBe('client_misconfigured');
    expect(classifyTokenRefreshFailure(503, null)).toBe('transient');
    expect(classifyTokenRefreshFailure(429, null)).toBe('transient');
    expect(classifyTokenRefreshFailure(null, null)).toBe('transient');
    expect(classifyTokenRefreshFailure(400, 'invalid_request')).toBe('failed');
  });

  it('invalid_grant → status error + PROVIDER_REAUTH_REQUIRED; labelled Search Console; no secrets in the message', async () => {
    const err = await refreshAccessToken('int-1', { fetchImpl: fakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.', echo: REFRESH } }]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TokenRefreshError);
    expect(err.outcome).toBe('revoked');
    expect(err.message).toMatch(/^Search Console token refresh failed \(400, invalid_grant\)/);
    for (const secret of [REFRESH, ACCESS, 'fixture-client-secret']) expect(err.message).not.toContain(secret);
    expect(updates()).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'error' }), expect.objectContaining({ connection_state: 'PROVIDER_REAUTH_REQUIRED' })]));
  });

  it.each([[{ status: 503 } as Reply], ['network' as Reply], [{ status: 429 } as Reply]])('a transient failure (%#) keeps the connection usable', async (reply) => {
    const err = await refreshAccessToken('int-1', { fetchImpl: fakeFetch([reply]) }).catch((e) => e);
    expect(err.outcome).toBe('transient');
    expect(updates().some((u) => 'status' in u)).toBe(false);
    expect(updates()).toEqual([expect.objectContaining({ last_live_check_status: 'server_error' })]);
  });

  it('a platform OAuth client problem does not mark the tenant broken', async () => {
    const err = await refreshAccessToken('int-1', { fetchImpl: fakeFetch([{ status: 401, body: { error: 'invalid_client' } }]) }).catch((e) => e);
    expect(err.outcome).toBe('client_misconfigured');
    expect(updates().some((u) => 'status' in u)).toBe(false);
  });

  it('a missing refresh token is a revoked grant (the sweep recognises invalid_grant)', async () => {
    tokenRecord.current = { access_token: ACCESS, refresh_token: null };
    const err = await refreshAccessToken('int-1', { fetchImpl: fakeFetch([{ status: 200 }]) }).catch((e) => e);
    expect(err).toMatchObject({ outcome: 'revoked' });
    expect(err.message).toMatch(/invalid_grant/);
  });

  it('success → connected, connection state CONNECTED, timeout signal sent', async () => {
    const seen: any[] = [];
    tokenRecord.current = { access_token: ACCESS, refresh_token: REFRESH, expiry_date: null, scope: 'x' };
    const fetchImpl = (async (url: any, init: any) => { seen.push(init); return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 }); }) as typeof fetch;
    await refreshAccessToken('int-1', { fetchImpl });
    expect(seen[0].signal).toBeDefined();
    expect(updates()).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'connected' }), expect.objectContaining({ connection_state: 'CONNECTED', last_provider_error: null })]));
  });
});

// ── 6. OAuth scopes per flow ─────────────────────────────────────────────────
describe('OAuth scopes: each flow asks only for its own product', () => {
  const GA = 'https://www.googleapis.com/auth/analytics.readonly';
  const GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
  it('defaults', () => {
    expect(scopesForCapability([], 'gsc')).toEqual(['openid', 'email', 'profile', GSC]);
    expect(scopesForCapability([], 'ga4')).toEqual(['openid', 'email', 'profile', GA]);
  });
  it('an admin-configured list that includes both is split per flow; other scopes are kept', () => {
    const configured = ['openid', 'email', GA, GSC, 'https://www.googleapis.com/auth/analytics', 'https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/userinfo.profile'];
    expect(scopesForCapability(configured, 'gsc')).toEqual(['openid', 'email', GSC, 'https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/userinfo.profile']);
    expect(scopesForCapability(configured, 'ga4')).toEqual(['openid', 'email', GA, 'https://www.googleapis.com/auth/analytics', 'https://www.googleapis.com/auth/userinfo.profile']);
  });
  it('the required scope is added when the configured list lacks it', () => {
    expect(scopesForCapability(['openid'], 'gsc')).toEqual(['openid', GSC]);
  });
});

// ── 7. post-connect import is queued, with a safe fallback ───────────────────
describe('post-connect import: queued for the worker, never lost', () => {
  it('queues one job per company + source + minute', async () => {
    const jobs: any[] = [];
    const inline = jest.fn(async () => undefined);
    const enqueue = async (data: any, jobId: string) => { jobs.push({ data, jobId }); return { id: jobId }; };
    expect(await schedulePostConnectImport('tenant-a', 'gsc', { enqueue, runInline: inline, now: () => 120_000 })).toBe('queued');
    await schedulePostConnectImport('tenant-a', 'gsc', { enqueue, runInline: inline, now: () => 150_000 });
    await schedulePostConnectImport('tenant-b', 'gsc', { enqueue, runInline: inline, now: () => 150_000 });
    expect(jobs.map((j) => j.jobId)).toEqual(['post-connect-gsc-tenant-a-2', 'post-connect-gsc-tenant-a-2', 'post-connect-gsc-tenant-b-2']);
    expect(jobs[0].data).toEqual({ type: 'analytics-post-connect-import', companyId: 'tenant-a', source: 'gsc' });
    expect(inline).not.toHaveBeenCalled();
  });

  it('queue unavailable or refusing → imports in-process instead of dropping the import', async () => {
    const inline = jest.fn(async () => undefined);
    expect(await schedulePostConnectImport('tenant-a', 'ga4', { enqueue: async () => { throw new Error('ECONNREFUSED'); }, runInline: inline })).toBe('inline');
    expect(await schedulePostConnectImport('tenant-a', 'ga4', { enqueue: async () => null, runInline: inline })).toBe('inline');
    expect(inline).toHaveBeenCalledTimes(2);
    expect(inline).toHaveBeenCalledWith('tenant-a', 'ga4');
  });
});

// ── 8. scheduler wiring ──────────────────────────────────────────────────────
describe('scheduler: companies selected by provider; a dates-only override never bypasses readiness', () => {
  it('a GSC pass loads GSC integrations (not GA4) and applies each company plan', async () => {
    dbResult = (op) => (op.table === 'analytics_integrations'
      ? { data: [{ id: 'int-a', company_id: 'tenant-a' }, { id: 'int-b', company_id: 'tenant-b' }], error: null }
      : op.table === 'analytics_properties' ? { data: [{ integration_id: 'int-a' }, { integration_id: 'int-b' }], error: null } : { data: null, error: null });
    const planned: string[] = [];
    const summary = await runIngestionForAllCompanies({ sources: ['gsc'], planFor: async (id) => { planned.push(id); return { skip: 'recently_synced' }; } });
    const integ = dbOps.find((o) => o.table === 'analytics_integrations')!;
    expect(integ.calls).toEqual(expect.arrayContaining([['eq', ['provider', 'GSC']], ['eq', ['status', 'connected']]]));
    expect(planned).toEqual(['tenant-a', 'tenant-b']);
    expect(summary.companies.map((c) => c.sources[0])).toEqual([
      { source: 'gsc', success: true, skipped: true, details: { reason: 'recently_synced' } },
      { source: 'gsc', success: true, skipped: true, details: { reason: 'recently_synced' } },
    ]);
  });

  it('a company without a connected GSC integration is reported missing even when a sync window is supplied', async () => {
    dbResult = (op) => (op.table === 'company_integrations' ? { data: [], error: null } : { data: null, error: null });
    const summary = await runIngestionForCompany({ companyId: 'tenant-x', sources: ['gsc'], overrides: { gsc: { startDate: '2026-10-16', endDate: '2026-10-23' } } });
    expect(summary.sources[0]).toMatchObject({ source: 'gsc', success: false, missingIntegration: true, error: 'Search Console integration is not ready' });
    expect(dbOps.some((o) => o.table === 'ingestion_runs' && o.calls.some(([m]) => m === 'upsert'))).toBe(false);
  });
});

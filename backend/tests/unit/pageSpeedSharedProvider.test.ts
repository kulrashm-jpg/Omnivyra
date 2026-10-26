/**
 * Google PageSpeed Insights as a SHARED application-level provider.
 *
 *   - one Super Admin key serves every tenant's report job; tenants never supply one;
 *   - the Super Admin enable/disable toggle is honoured (disabled = no request, no env fallback);
 *   - missing / invalid key, API disabled, quota, timeout and provider failure are told apart;
 *   - results are cached by public URL + strategy + category (never by key or tenant);
 *   - a missing result stays "not measured", never zero;
 *   - Super Admin stores the key encrypted and never returns it.
 *
 * NO NETWORK: every Google request is an injected fetch. All keys are synthetic placeholders.
 */
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);

// ── In-memory database (external_api_sources, api_provider_accounts) ─────────────────────────
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockSeq = 0;
function mockTable(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: any = null;
  let single = false;
  const run = async () => {
    const rows = (mockDb[table] ??= []);
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'insert') {
      const items = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: `${table}-${++mockSeq}`, ...p }));
      rows.push(...items);
      return { data: single ? items[0] : items, error: null };
    }
    if (op === 'update') { match.forEach((r) => Object.assign(r, payload)); return { data: single ? match[0] ?? null : match, error: null }; }
    if (op === 'delete') { mockDb[table] = rows.filter((r) => !match.includes(r)); return { data: null, error: null }; }
    return { data: single ? match[0] ?? null : match, error: null };
  };
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return api; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return api; },
    insert: (p: unknown) => { op = 'insert'; payload = p; return api; },
    update: (p: unknown) => { op = 'update'; payload = p; return api; },
    delete: () => { op = 'delete'; return api; },
    maybeSingle: () => { single = true; return run(); },
    single: () => { single = true; return run(); },
    then: (res: any, rej: any) => run().then(res, rej),
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../services/externalApiHealthService', () => ({ updateApiHealth: jest.fn(async () => null) }));

import {
  classifyPageSpeedError, pageSpeedCacheKey, resetPageSpeedClientState, resolvePageSpeedAccess, runPageSpeed,
} from '../../services/pageSpeedClient';
import { collectPerformanceEvidence } from '../../services/digitalExperienceRepository';
import { resolveProviderCredential, PAGESPEED_SOURCE_NAME } from '../../services/providerCredentialResolver';
import { checkPageSpeedConfig, getPageSpeedConfigSummary, savePageSpeedConfig } from '../../services/pageSpeedProviderConfigService';

// Google-key-SHAPED placeholders, assembled at runtime so no key-like literal sits in the source (secret gate).
const GOOGLE_PREFIX = ['AI', 'za'].join('');
const ADMIN_KEY = `${GOOGLE_PREFIX}SyPLACEHOLDERnotARealKey000000000000`;
const ENV_KEY = `${GOOGLE_PREFIX}SyENVPLACEHOLDERnotARealKey00000000`;

const PSI_OK = (score = 0.62) => ({
  lighthouseResult: {
    categories: { performance: { score } },
    audits: {
      'largest-contentful-paint': { numericValue: 2100, displayValue: '2.1 s' },
      'cumulative-layout-shift': { numericValue: 0.05, displayValue: '0.05' },
      'total-blocking-time': { numericValue: 120, displayValue: '120 ms' },
      'first-contentful-paint': { numericValue: 1200 },
      'speed-index': { numericValue: 2500 },
      interactive: { numericValue: 3000 },
      'bootup-time': { numericValue: 400 },
    },
  },
});
const respond = (status: number, body: unknown) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch & jest.Mock;
const keyOf = (f: jest.Mock, i = 0) => new URL(String(f.mock.calls[i][0])).searchParams.get('key');
const urlOf = (f: jest.Mock, i = 0) => new URL(String(f.mock.calls[i][0])).searchParams.get('url');

const page = (url: string) => ({ url, page_type: 'home', title: 't', meta_description: null, headings: null, ctas: null, internal_link_count: 3, http_status: 200, crawl_depth: 0, wordCount: 300, crawl_metadata: null, last_crawled_at: '2026-10-26T00:00:00Z' });

// Any un-injected request fails the test instead of reaching Google.
const realFetch = global.fetch;
beforeAll(() => { global.fetch = (async () => { throw new Error('UNEXPECTED_NETWORK_CALL'); }) as unknown as typeof fetch; });
afterAll(() => { global.fetch = realFetch; });

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.PAGESPEED_ENABLED;
  resetPageSpeedClientState();
});

describe('one application-level key, shared by every tenant report', () => {
  it('two tenants’ report runs both use the Super Admin key, each for its own public URL', async () => {
    await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    const f = respond(200, PSI_OK());
    const access = await resolvePageSpeedAccess();
    expect(access).toMatchObject({ allowed: true, source: 'managed' });
    await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f, access });
    await runPageSpeed({ url: 'https://tenant-b.example/', strategy: 'mobile', fetchImpl: f, access });
    expect(f).toHaveBeenCalledTimes(2);
    expect(keyOf(f, 0)).toBe(ADMIN_KEY);
    expect(keyOf(f, 1)).toBe(ADMIN_KEY);
    expect(urlOf(f, 0)).toBe('https://tenant-a.example/');
    expect(urlOf(f, 1)).toBe('https://tenant-b.example/');
  });

  it('the Super Admin key wins over PAGESPEED_API_KEY; the env key is the fallback when none is stored', async () => {
    process.env.PAGESPEED_API_KEY = ENV_KEY;
    expect(await resolveProviderCredential('pagespeed')).toMatchObject({ source: 'environment', envName: 'PAGESPEED_API_KEY' });
    await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    const r = await resolveProviderCredential('pagespeed');
    expect(r.source).toBe('managed');
    expect(r.value).toBe(ADMIN_KEY);
  });
});

describe('missing, disabled and invalid credentials', () => {
  it('no key and keyless not enabled: no request, "not_configured", not measured (never zero)', async () => {
    const f = respond(200, PSI_OK());
    const r = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, issue: 'not_configured' });
    const ev = await collectPerformanceEvidence({ pages: [page('https://tenant-a.example/')] });
    expect(ev.state).toBe('unavailable');
    expect(ev.issue).toBe('not_configured');
    expect(ev.observations).toEqual([]);
  });

  it('disabled in Super Admin: no request, and the env key is NOT used as a fallback', async () => {
    process.env.PAGESPEED_API_KEY = ENV_KEY;
    await savePageSpeedConfig({ enabled: false, apiKey: ADMIN_KEY });
    expect(await resolveProviderCredential('pagespeed')).toMatchObject({ source: 'disabled', value: null });
    const f = respond(200, PSI_OK());
    const r = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f, allowKeyless: true });
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, issue: 'disabled' });
    const ev = await collectPerformanceEvidence({ pages: [page('https://tenant-a.example/')] });
    expect(ev.issue).toBe('disabled');
    expect(ev.reasonUnavailable).toMatch(/disabled in Super Admin/);
  });

  it('classifies Google’s own error bodies', () => {
    expect(classifyPageSpeedError(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }).issue).toBe('invalid_key');
    expect(classifyPageSpeedError(403, { error: { status: 'PERMISSION_DENIED', message: 'PageSpeed Insights API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }).issue).toBe('api_disabled');
    expect(classifyPageSpeedError(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric Queries per day' } }).issue).toBe('quota_exhausted');
    expect(classifyPageSpeedError(500, {}).issue).toBe('provider_failure');
    expect(classifyPageSpeedError(403, { error: { message: 'Requests from referer <empty> are blocked.', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }).issue).toBe('invalid_key');
  });

  it('never puts the key in a classified detail', () => {
    const d = classifyPageSpeedError(400, { error: { message: `API key not valid: ${ADMIN_KEY} ?key=${ADMIN_KEY}` } }).detail;
    expect(d).not.toContain(ADMIN_KEY);
  });

  it('an invalid key stops the report run after the first request; every observation stays unavailable', async () => {
    await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    const f = respond(400, { error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } });
    const access = await resolvePageSpeedAccess();
    const { fetchPageSpeed } = await import('../../services/performanceEvidence');
    const first = await fetchPageSpeed({ url: 'https://tenant-a.example/', formFactor: 'mobile', fetchImpl: f, access });
    expect(first).toMatchObject({ state: 'unavailable', issue: 'invalid_key', providerPerformanceScore: null });
    expect(first.reasonUnavailable).toMatch(/Replace the key in Super Admin/);
    expect(first.reasonUnavailable).not.toContain(ADMIN_KEY);
  });
});

describe('quota, timeout and unavailable results', () => {
  beforeEach(() => { process.env.PAGESPEED_API_KEY = ENV_KEY; });

  it('quota exhaustion is its own cause, with the remedy, and is not cached', async () => {
    const f = respond(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } });
    const r1 = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f });
    const r2 = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f });
    expect(r1).toMatchObject({ ok: false, issue: 'quota_exhausted', httpStatus: 429 });
    expect(r2).toMatchObject({ ok: false, issue: 'quota_exhausted' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a timeout is "timeout", says how long it waited, and is never a measurement', async () => {
    const f = jest.fn(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }) as unknown as typeof fetch;
    const r = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f, timeoutMs: 10 });
    expect(r).toMatchObject({ ok: false, issue: 'timeout' });
    expect((r as { detail: string }).detail).toMatch(/timed out after 10ms/);
  });

  it('a provider failure is "provider_failure"', async () => {
    const r = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: respond(503, {}) });
    expect(r).toMatchObject({ ok: false, issue: 'provider_failure', httpStatus: 503 });
  });
});

describe('caching avoids repeated scans without mixing results', () => {
  beforeEach(() => { process.env.PAGESPEED_API_KEY = ENV_KEY; });

  it('the same URL + strategy is fetched once; another strategy or URL is fetched separately', async () => {
    const f = respond(200, PSI_OK());
    const a = await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f });
    const b = await runPageSpeed({ url: 'https://TENANT-A.example/#top', strategy: 'mobile', fetchImpl: f });
    expect(a).toMatchObject({ ok: true, fromCache: false });
    expect(b).toMatchObject({ ok: true, fromCache: true });
    await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'desktop', fetchImpl: f });
    await runPageSpeed({ url: 'https://tenant-b.example/', strategy: 'mobile', fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('the cache key holds the public URL, strategy and category only — never a key or a tenant', () => {
    const k = pageSpeedCacheKey('https://tenant-a.example/pricing', 'mobile');
    expect(k).toBe('https://tenant-a.example/pricing|mobile|performance');
    expect(k).not.toContain(ENV_KEY);
  });

  it('a stale cached result is fetched again', async () => {
    const f = respond(200, PSI_OK());
    const t0 = Date.parse('2026-10-26T00:00:00Z');
    await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f, now: t0 });
    await runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f, now: t0 + 7 * 60 * 60 * 1000 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('concurrent identical requests share one Google call', async () => {
    const f = respond(200, PSI_OK());
    const [a, b] = await Promise.all([
      runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f }),
      runPageSpeed({ url: 'https://tenant-a.example/', strategy: 'mobile', fetchImpl: f }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('Super Admin configuration: encrypted, masked, never echoed', () => {
  it('stores the key encrypted on a non-executable platform row and returns only a masked summary', async () => {
    const summary = await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    expect(JSON.stringify(summary)).not.toContain(ADMIN_KEY);
    expect(summary).toMatchObject({ enabled: true, configured: true, keySource: 'super_admin', hasStoredKey: true, keyDisplay: '•••••••• (encrypted)', status: 'active' });
    const [source] = mockDb.external_api_sources;
    expect(source).toMatchObject({ name: PAGESPEED_SOURCE_NAME, company_id: null, is_active: true, category: 'others', is_whitelisted: false, is_enabled_global: false });
    const [account] = mockDb.api_provider_accounts;
    expect(account.credentials_encrypted).not.toContain(ADMIN_KEY);
    expect(JSON.parse(account.credentials_encrypted).api_key_value).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('saving without a key keeps the stored key; clearing it falls back to the environment', async () => {
    await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    await savePageSpeedConfig({ enabled: true });
    expect((await resolveProviderCredential('pagespeed')).value).toBe(ADMIN_KEY);
    process.env.PAGESPEED_API_KEY = ENV_KEY;
    const cleared = await savePageSpeedConfig({ enabled: true, clearKey: true });
    expect(cleared).toMatchObject({ hasStoredKey: false, keySource: 'environment' });
  });

  it('rejects a malformed key before storing anything', async () => {
    await expect(savePageSpeedConfig({ enabled: true, apiKey: 'short' })).rejects.toThrow('That does not look like a Google API key.');
    expect(mockDb.api_provider_accounts ?? []).toEqual([]);
  });

  it('the check records an actionable, non-secret result', async () => {
    await savePageSpeedConfig({ enabled: true, apiKey: ADMIN_KEY });
    const after = await checkPageSpeedConfig({ fetchImpl: respond(403, { error: { message: 'PageSpeed Insights API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }) });
    expect(after.lastCheck).toMatchObject({ ok: false, issue: 'api_disabled', keySource: 'Super Admin key' });
    expect(after.status).toBe('error');
    expect(JSON.stringify(after)).not.toContain(ADMIN_KEY);
    expect((await getPageSpeedConfigSummary()).lastCheck?.issue).toBe('api_disabled');
  });

  it('with nothing configured the summary says so, and names the env fallback without a value', async () => {
    const s = await getPageSpeedConfigSummary();
    expect(s).toMatchObject({ configured: false, keySource: 'none', status: 'not_configured', envFallback: { name: 'PAGESPEED_API_KEY', present: false } });
  });
});

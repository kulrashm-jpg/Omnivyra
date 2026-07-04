import {
  bingEvidenceAdapter, BING_EVIDENCE_KEYS, type BingSearchEvidenceInput,
} from '../../services/evidencePlatform/providers/bing/bingEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isBingProviderConfigured, registerBingProvider, isBingProviderAvailable,
  bingProviderReliability, aggregateBingRows, fetchBingEvidence,
  type BingQueryRow, type BingCrawlStats,
} from '../../services/bingWebmasterProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';

const OBSERVED = '2026-01-01T00:00:00.000Z';

const input: BingSearchEvidenceInput = {
  siteUrl: 'https://example.com',
  totalImpressions: 4000, totalClicks: 120, avgCtr: null, avgPosition: 11.2,
  indexedPages: 340, crawledPages: 400, crawlErrors: 12, blockedPages: 5,
  indexedQueries: 90, landingPages: 22, deviceSegments: 3, countrySegments: 8,
  observedAt: OBSERVED, providerReliability: 0.8,
};

describe('Bing Provider — canonical adapter (BETA-PROVIDER-004)', () => {
  it('converts a Bing payload to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = bingEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['bing_impressions'].value).toBe(4000);
    expect(byKey['bing_impressions'].maturity).toBe('MEASURED');
    expect(byKey['bing_clicks'].value).toBe(120);
    expect(byKey['bing_avg_position'].value).toBe(11.2);
    expect(byKey['bing_indexed_pages'].value).toBe(340);
    expect(byKey['bing_crawl_errors'].value).toBe(12);
    expect(byKey['bing_blocked_pages'].value).toBe(5);
    // ctr derived from clicks/impressions (avgCtr was null) → CALCULATED
    expect(byKey['bing_ctr'].value).toBe(0.03); // 120/4000
    expect(byKey['bing_ctr'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('all emitted keys are bing_-prefixed (never collide with GSC search keys)', () => {
    const ev = bingEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    for (const e of ev) expect(e.id.split(':').pop()!.startsWith('bing_')).toBe(true);
  });

  it('emits Bing-supplied ctr as MEASURED when present (not re-derived)', () => {
    const ev = bingEvidenceAdapter.toEvidence({ ...input, avgCtr: 0.028 }, { observedAt: OBSERVED });
    const ctr = ev.find((e) => e.id.endsWith(':bing_ctr'))!;
    expect(ctr.value).toBe(0.028);
    expect(ctr.maturity).toBe('MEASURED');
  });

  it('never fabricates: omits metrics Bing did not return, and every value traces to input', () => {
    const sparse: BingSearchEvidenceInput = {
      siteUrl: 'https://example.com', totalImpressions: 700, totalClicks: null, avgCtr: null,
      avgPosition: null, indexedPages: null, crawledPages: null, crawlErrors: null, blockedPages: null,
      indexedQueries: 10, landingPages: null, deviceSegments: null, countrySegments: null,
      observedAt: OBSERVED, providerReliability: 0.8,
    };
    const ev = bingEvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('bing_impressions');
    expect(keys).toContain('bing_indexed_queries');
    expect(keys).not.toContain('bing_clicks'); // null → omitted
    expect(keys).not.toContain('bing_ctr'); // no clicks → cannot derive → omitted
    expect(keys).not.toContain('bing_indexed_pages');
    const allowed = new Set([700, 10]);
    for (const e of ev) if (typeof e.value === 'number') expect(allowed.has(e.value)).toBe(true);
  });

  it('is deterministic', () => {
    expect(bingEvidenceAdapter.toEvidence(input, {})).toEqual(bingEvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = bingEvidenceAdapter.onFailure({
      providerId: 'bing_webmaster', state: PROVIDER_FAILURE.UNAUTHORIZED,
      reason: 'site not verified', evidenceKey: 'bing_impressions', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_UNAUTHORIZED');
  });

  it('exposes exactly the declared Bing evidence keys', () => {
    expect(bingEvidenceAdapter.supportedEvidence).toEqual([...BING_EVIDENCE_KEYS]);
  });
});

describe('Bing Provider — row + crawl aggregation', () => {
  it('aggregates query rows + crawl stats: sums, distinct counts, impression-weighted position', () => {
    const rows: BingQueryRow[] = [
      { query: 'omnivyra', page: '/', impressions: 1000, clicks: 30, avgPosition: 8, device: 'desktop', country: 'usa' },
      { query: 'omnivyra', page: '/', impressions: 500, clicks: 5, avgPosition: 14, device: 'mobile', country: 'gbr' },
      { query: 'marketing os', page: '/product', impressions: 300, clicks: 3, avgPosition: 10, device: 'desktop', country: 'usa' },
    ];
    const crawl: BingCrawlStats = { inIndex: 340, crawledPages: 400, crawlErrors: 12, blockedByRobotsTxt: 5 };
    const agg = aggregateBingRows('https://example.com', rows, crawl, OBSERVED);
    expect(agg.totalImpressions).toBe(1800);
    expect(agg.totalClicks).toBe(38);
    expect(agg.indexedQueries).toBe(2);
    expect(agg.landingPages).toBe(2);
    expect(agg.deviceSegments).toBe(2);
    expect(agg.countrySegments).toBe(2);
    expect(agg.indexedPages).toBe(340);
    expect(agg.crawlErrors).toBe(12);
    // impression-weighted position: (8*1000 + 14*500 + 10*300)/1800 = 18000/1800 = 10
    expect(agg.avgPosition).toBeCloseTo(10, 5);
  });

  it('returns null crawl fields when no crawl stats supplied (not fabricated 0)', () => {
    const rows: BingQueryRow[] = [{ query: 'x', impressions: 5 }];
    const agg = aggregateBingRows('https://example.com', rows, null, OBSERVED);
    expect(agg.totalImpressions).toBe(5);
    expect(agg.indexedPages).toBeNull();
    expect(agg.crawledPages).toBeNull();
    expect(agg.totalClicks).toBeNull();
  });
});

describe('Bing Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('is UNAVAILABLE without credentials (backward compatible)', () => {
    delete process.env.BING_WEBMASTER_API_KEY;
    expect(isBingProviderConfigured()).toBe(false);
    const d = registerBingProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isBingProviderAvailable()).toBe(false);
  });

  it('flips to authenticated/connected when the credential is present', () => {
    process.env.BING_WEBMASTER_API_KEY = 'test-key';
    const d = registerBingProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isBingProviderAvailable()).toBe(true);
    expect(bingProviderReliability()).toBe(0.8);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no network, no DB, no fabrication)', () => {
    delete process.env.BING_WEBMASTER_API_KEY;
    const ev = fetchBingEvidence('https://example.com', null, null, OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected-but-empty-site returns UNAVAILABLE evidence (honest, not fabricated zeros)', () => {
    process.env.BING_WEBMASTER_API_KEY = 'test-key';
    const ev = fetchBingEvidence('https://example.com', [], null, OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected with rows converts through the canonical adapter to MEASURED evidence', () => {
    process.env.BING_WEBMASTER_API_KEY = 'test-key';
    registerBingProvider();
    const rows: BingQueryRow[] = [
      { query: 'a', page: '/a', impressions: 200, clicks: 6, avgPosition: 9, device: 'desktop', country: 'usa' },
    ];
    const ev = fetchBingEvidence('https://example.com', rows, null, OBSERVED);
    const impressions = ev.find((e) => e.id.endsWith(':bing_impressions'))!;
    expect(impressions.value).toBe(200);
    expect(impressions.maturity).toBe('MEASURED');
  });
});

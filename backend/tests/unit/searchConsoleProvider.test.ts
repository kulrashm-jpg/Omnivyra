import {
  gscEvidenceAdapter, GSC_EVIDENCE_KEYS, type GscSearchEvidenceInput,
} from '../../services/evidencePlatform/providers/searchConsole/gscEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isSearchConsoleProviderConfigured, registerSearchConsoleProvider, isSearchConsoleProviderAvailable,
  searchConsoleProviderReliability, aggregateGscRows, fetchSearchConsoleEvidence,
} from '../../services/searchConsoleProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';
import type { GscKeywordRow } from '../../services/gscIngestionService';

const OBSERVED = '2026-01-01T00:00:00.000Z';

const input: GscSearchEvidenceInput = {
  siteUrl: 'https://example.com',
  totalImpressions: 12000, totalClicks: 480, avgCtr: null, avgPosition: 8.4,
  indexedQueries: 320, indexedPages: 44, deviceSegments: 3, countrySegments: 12,
  observedAt: OBSERVED, providerReliability: 0.95,
};

describe('Search Console Provider — canonical adapter (BETA-PROVIDER-002)', () => {
  it('converts a GSC payload to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = gscEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['impressions'].value).toBe(12000);
    expect(byKey['impressions'].maturity).toBe('MEASURED');
    expect(byKey['clicks'].value).toBe(480);
    expect(byKey['avg_position'].value).toBe(8.4);
    expect(byKey['avg_position'].maturity).toBe('MEASURED');
    expect(byKey['indexed_queries'].value).toBe(320);
    expect(byKey['indexed_pages'].value).toBe(44);
    // ctr derived from clicks/impressions (avgCtr was null) → CALCULATED
    expect(byKey['ctr'].value).toBe(0.04); // 480/12000
    expect(byKey['ctr'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('emits Google-supplied ctr as MEASURED when present (not re-derived)', () => {
    const ev = gscEvidenceAdapter.toEvidence({ ...input, avgCtr: 0.037 }, { observedAt: OBSERVED });
    const ctr = ev.find((e) => e.id.endsWith(':ctr'))!;
    expect(ctr.value).toBe(0.037);
    expect(ctr.maturity).toBe('MEASURED');
  });

  it('never fabricates: omits metrics GSC did not return, and every value traces to input', () => {
    const sparse: GscSearchEvidenceInput = {
      siteUrl: 'https://example.com', totalImpressions: 900, totalClicks: null, avgCtr: null,
      avgPosition: null, indexedQueries: 15, indexedPages: null, deviceSegments: null,
      countrySegments: null, observedAt: OBSERVED, providerReliability: 0.95,
    };
    const ev = gscEvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('impressions');
    expect(keys).toContain('indexed_queries');
    expect(keys).not.toContain('clicks'); // null → omitted
    expect(keys).not.toContain('avg_position'); // null → omitted
    expect(keys).not.toContain('ctr'); // no clicks → cannot derive → omitted (not fabricated)
    expect(keys).not.toContain('indexed_pages');
    const allowed = new Set([900, 15]);
    for (const e of ev) if (typeof e.value === 'number') expect(allowed.has(e.value)).toBe(true);
  });

  it('is deterministic', () => {
    expect(gscEvidenceAdapter.toEvidence(input, {})).toEqual(gscEvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = gscEvidenceAdapter.onFailure({
      providerId: 'search_console', state: PROVIDER_FAILURE.UNAUTHORIZED,
      reason: 'expired token', evidenceKey: 'impressions', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_UNAUTHORIZED');
  });

  it('exposes exactly the declared GSC evidence keys', () => {
    expect(gscEvidenceAdapter.supportedEvidence).toEqual([...GSC_EVIDENCE_KEYS]);
  });
});

describe('Search Console Provider — row aggregation (reuses gscIngestionService shape)', () => {
  it('aggregates GSC rows: sums impressions/clicks, counts distinct dimensions, impression-weighted position', () => {
    const rows: GscKeywordRow[] = [
      { keyword: 'omnivyra pricing', pageUrl: '/pricing', impressions: 1000, clicks: 50, ctr: 0.05, avgPosition: 4, device: 'DESKTOP', country: 'usa' },
      { keyword: 'omnivyra pricing', pageUrl: '/pricing', impressions: 500, clicks: 10, ctr: 0.02, avgPosition: 10, device: 'MOBILE', country: 'gbr' },
      { keyword: 'marketing os', pageUrl: '/product', impressions: 300, clicks: 6, ctr: 0.02, avgPosition: 7, device: 'DESKTOP', country: 'usa' },
    ];
    const agg = aggregateGscRows('https://example.com', rows, OBSERVED);
    expect(agg.totalImpressions).toBe(1800);
    expect(agg.totalClicks).toBe(66);
    expect(agg.indexedQueries).toBe(2); // distinct keywords
    expect(agg.indexedPages).toBe(2); // /pricing, /product
    expect(agg.deviceSegments).toBe(2); // desktop, mobile
    expect(agg.countrySegments).toBe(2); // usa, gbr
    // impression-weighted position: (4*1000 + 10*500 + 7*300)/1800 = 11100/1800 = 6.1666...
    expect(agg.avgPosition).toBeCloseTo(6.1667, 3);
    expect(agg.avgCtr).toBeNull(); // ctr is derived downstream, not summed
  });

  it('returns nulls (never zeros-as-data) when a dimension is entirely absent', () => {
    const rows: GscKeywordRow[] = [{ keyword: 'x', pageUrl: null, impressions: 5, clicks: null, ctr: null, avgPosition: null }];
    const agg = aggregateGscRows('https://example.com', rows, OBSERVED);
    expect(agg.totalImpressions).toBe(5);
    expect(agg.totalClicks).toBeNull();
    expect(agg.avgPosition).toBeNull();
    expect(agg.indexedPages).toBeNull();
    expect(agg.deviceSegments).toBeNull();
  });
});

describe('Search Console Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('is UNAVAILABLE without OAuth credentials (backward compatible)', () => {
    delete process.env.GSC_OAUTH_CLIENT_ID; delete process.env.GSC_OAUTH_CLIENT_SECRET;
    expect(isSearchConsoleProviderConfigured()).toBe(false);
    const d = registerSearchConsoleProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isSearchConsoleProviderAvailable()).toBe(false);
  });

  it('requires BOTH client id and secret to be considered connected', () => {
    process.env.GSC_OAUTH_CLIENT_ID = 'id-only'; delete process.env.GSC_OAUTH_CLIENT_SECRET;
    expect(isSearchConsoleProviderConfigured()).toBe(false);
    expect(isSearchConsoleProviderAvailable()).toBe(false);
  });

  it('flips to authenticated/connected when both credentials are present', () => {
    process.env.GSC_OAUTH_CLIENT_ID = 'cid'; process.env.GSC_OAUTH_CLIENT_SECRET = 'secret';
    const d = registerSearchConsoleProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isSearchConsoleProviderAvailable()).toBe(true);
    expect(searchConsoleProviderReliability()).toBe(0.95);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no network, no DB, no fabrication)', () => {
    delete process.env.GSC_OAUTH_CLIENT_ID; delete process.env.GSC_OAUTH_CLIENT_SECRET;
    const ev = fetchSearchConsoleEvidence('https://example.com', null, OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected-but-empty-property returns UNAVAILABLE evidence (honest, not fabricated zeros)', () => {
    process.env.GSC_OAUTH_CLIENT_ID = 'cid'; process.env.GSC_OAUTH_CLIENT_SECRET = 'secret';
    const ev = fetchSearchConsoleEvidence('https://example.com', [], OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected with rows converts through the canonical adapter to MEASURED evidence', () => {
    process.env.GSC_OAUTH_CLIENT_ID = 'cid'; process.env.GSC_OAUTH_CLIENT_SECRET = 'secret';
    registerSearchConsoleProvider();
    const rows: GscKeywordRow[] = [
      { keyword: 'a', pageUrl: '/a', impressions: 200, clicks: 8, ctr: 0.04, avgPosition: 5, device: 'DESKTOP', country: 'usa' },
    ];
    const ev = fetchSearchConsoleEvidence('https://example.com', rows, OBSERVED);
    const impressions = ev.find((e) => e.id.endsWith(':impressions'))!;
    expect(impressions.value).toBe(200);
    expect(impressions.maturity).toBe('MEASURED');
  });
});

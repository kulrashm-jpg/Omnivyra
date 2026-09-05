/**
 * GAP-06 — public-domain search visibility.
 *
 * THE DEFECT. Report 1 already pays for public search evidence on every run: competitor discovery
 * issues up to 8 SERP queries. But `fetchSerpDomainsForKeyword` mapped the response straight to
 * `string[]` of domains — discarding `position`, `url`, `title` and `snippet` at the moment of
 * parsing — and `isBlockedSerpDomain` then dropped the company's OWN row as "not a competitor".
 * The one thing that could answer "is this company findable in public search?" was thrown away,
 * and the report's only rank signal was `rank_tracking_score`, tagged `['GSC']` — private,
 * customer-granted analytics, which is not a public-domain reading at all.
 *
 * THE FIX. `fetchSerpResultsForKeyword` returns the provider's rows intact; the domain-only helper
 * is now a projection of it, so competitor discovery sees byte-identical input and there is still
 * exactly ONE request per keyword. The own-domain scan reads the same responses.
 *
 * TEST SEAM. Only the HTTP client (`axios`) is replaced, so credential resolution, the scan-budget
 * gate, parsing, normalisation, competitor filtering, composition and rendering are all real.
 */
const serpCalls: Array<{ q: string; num: unknown }> = [];
let serpHandler: (query: string) => { data: unknown } | Promise<{ data: unknown }> = () => ({ data: { organic_results: [] } });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: async (_url: string, cfg: { params?: { q?: string; num?: unknown } }) => {
      serpCalls.push({ q: String(cfg?.params?.q ?? ''), num: cfg?.params?.num });
      return serpHandler(String(cfg?.params?.q ?? ''));
    },
  },
}));

// A managed credential is not present in the test environment, so the env fallback is what
// resolves. Setting it here exercises the real `resolveProviderCredential` path rather than
// stubbing it out.
process.env.SERP_API_KEY = process.env.SERP_API_KEY || 'test-serp-key';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { discoverCompetitorDomainsFromSerp, fetchSerpResultsForKeyword, fetchSerpDomainsForKeyword } =
  require('../../services/reportCompetitorIntelligenceServiceHelpers');

jest.setTimeout(180_000);

const OWN = 'northwind-analytics.test';

/** A SERP page where the company sits at rank 4, behind three unrelated domains. */
const pageWithOwnAtFour = {
  organic_results: [
    { position: 1, link: 'https://contoso-insight.test/', title: 'Contoso Insight', snippet: 'Dashboards for ops teams.' },
    { position: 2, link: 'https://fabrikam-data.test/pricing', title: 'Fabrikam Data', snippet: 'Pricing.' },
    { position: 3, link: 'https://adventure-works.test/', title: 'Adventure Works', snippet: 'Analytics.' },
    { position: 4, link: `https://${OWN}/solutions`, title: 'Northwind Analytics — Solutions', snippet: 'Self-serve analytics for mid-market operations.' },
    { position: 5, link: 'https://tailspin.test/', title: 'Tailspin', snippet: 'BI.' },
  ],
};

const pageWithoutOwn = {
  organic_results: [
    { position: 1, link: 'https://contoso-insight.test/', title: 'Contoso Insight', snippet: 'a' },
    { position: 2, link: 'https://fabrikam-data.test/', title: 'Fabrikam Data', snippet: 'b' },
    { position: 3, link: 'https://adventure-works.test/', title: 'Adventure Works', snippet: 'c' },
  ],
};

beforeEach(() => {
  serpCalls.length = 0;
  serpHandler = () => ({ data: pageWithOwnAtFour });
});

describe('GAP-06 · Test A — the company\'s own domain is retained', () => {
  it('keeps the own-domain row that competitor discovery filters out', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null,
    });
    expect(result.searchObservations).toHaveLength(1);
    const observation = result.searchObservations[0];
    expect(observation.query).toBe('mid market analytics');
    expect(observation.url).toBe(`https://${OWN}/solutions`);
    expect(observation.title).toContain('Northwind Analytics');
    expect(observation.snippet).toContain('mid-market operations');

    // Competitor discovery still drops the own domain — the two purposes coexist.
    expect(result.domains).not.toContain(OWN);
  });

  it('matches the canonical domain convention without weakening it', async () => {
    // www. and a path must match; a different domain that merely contains the name must not.
    serpHandler = () => ({
      data: {
        organic_results: [
          { position: 1, link: `https://www.${OWN}/pricing`, title: 'With www', snippet: 's' },
          { position: 2, link: `https://not-${OWN}.evil.test/`, title: 'Impostor', snippet: 's' },
        ],
      },
    });
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: `https://${OWN}/path`, geography: null });
    expect(result.searchObservations[0].position).toBe(1);
    expect(result.searchObservations[0].url).toContain(`www.${OWN}`);
  });

  it('does not mistake an unrelated domain for the company', async () => {
    serpHandler = () => ({ data: { organic_results: [{ position: 1, link: 'https://northwind-analytics.example.org/', title: 'Different org', snippet: 's' }] } });
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    expect(result.searchObservations[0].position).toBeNull();
  });
});

describe('GAP-06 · Test B — the provider position is preserved, never re-derived', () => {
  it('reports rank 4, not the index after competitor filtering', async () => {
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    // Filtering removes rows above it; a naive implementation would renumber this to 1 or 2.
    expect(result.searchObservations[0].position).toBe(4);
  });

  it('trusts the provider rank even when it disagrees with array order', async () => {
    serpHandler = () => ({ data: { organic_results: [{ position: 9, link: `https://${OWN}/`, title: 't', snippet: 's' }] } });
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    expect(result.searchObservations[0].position).toBe(9);
  });
});

describe('GAP-06 · Test C — absence is an observation, not a zero', () => {
  it('records null when the domain does not appear', async () => {
    serpHandler = () => ({ data: pageWithoutOwn });
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    const observation = result.searchObservations[0];
    expect(observation.position).toBeNull();
    expect(observation.position).not.toBe(0);
    expect(observation.resultCount).toBe(3);
  });
});

describe('GAP-06 · Test D — multiple queries all survive', () => {
  it('keeps one observation per query, ranked and unranked alike', async () => {
    serpHandler = (q) => ({ data: q.includes('found') ? pageWithOwnAtFour : pageWithoutOwn });
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['found one', 'missing one', 'found two'], ownDomain: OWN, geography: null,
    });
    expect(result.searchObservations).toHaveLength(3);
    expect(result.searchObservations.filter((o: { position: number | null }) => o.position !== null)).toHaveLength(2);
    expect(result.searchObservations.map((o: { query: string }) => o.query))
      .toEqual(['found one', 'missing one', 'found two']);
  });
});

describe('GAP-06 · Test E — provider unavailable and provider failure are distinguishable', () => {
  it('reports failed with the provider error when the request throws', async () => {
    serpHandler = () => { throw new Error('connect ETIMEDOUT serpapi.com'); };
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    expect(result.acquisitionStatus).toBe('failed');
    expect(result.acquisitionReason).toContain('ETIMEDOUT');
    expect(result.searchObservations).toHaveLength(0);
  });

  it('reports unavailable, not failed, when no credential resolves', async () => {
    // `serpapi` is SUPER_ADMIN_MANAGED, so the resolver consults a managed account BEFORE the
    // environment — clearing env vars cannot force the unavailable branch. The resolver is
    // therefore mocked for this one case, in an isolated module registry so the rest of the file
    // keeps using the real one.
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../services/providerCredentialResolver', () => ({
        resolveProviderCredential: async () => ({ value: null, source: 'none', reason: 'No SerpAPI credential is configured for this environment.' }),
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const helpers = require('../../services/reportCompetitorIntelligenceServiceHelpers');
      const result = await helpers.fetchSerpResultsForKeyword('k', null);
      expect(result.status).toBe('unavailable');
      expect(result.rows).toHaveLength(0);
      expect(typeof result.reason).toBe('string');
      // The reason describes the shape of the problem — never a key, never an env-var value.
      expect(result.reason).not.toMatch(/test-serp-key/);
      expect(result.reason).not.toMatch(/SERPAPI_API_KEY|SERP_API_KEY|SERPAPI_KEY/);
    });
  });
});

describe('GAP-06 · Test F — public search visibility exists without GSC', () => {
  it('produces observations with no Search Console data anywhere in the path', async () => {
    // Nothing in this test provides GSC data: no `keyword_metrics`, no impressions, no connected
    // property. The evidence comes solely from the mocked public SERP response.
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['public query'], ownDomain: OWN, geography: null });
    expect(result.searchObservations[0].position).toBe(4);
    expect(result.acquisitionStatus).toBe('ok');

    // And the evidence carries no private-source marker.
    expect(JSON.stringify(result.searchObservations)).not.toMatch(/gsc|search_console|impressions/i);
  });
});

describe('GAP-06 · Test G — request volume stays bounded and attributable', () => {
  it('issues exactly one request per keyword, capped by the discovery limit', async () => {
    const manyKeywords = Array.from({ length: 20 }, (_, i) => `keyword ${i}`);
    const result = await discoverCompetitorDomainsFromSerp({ keywords: manyKeywords, ownDomain: OWN, geography: null });
    // MAX_DISCOVERY_KEYWORDS caps the batch at 8 — 20 keywords must not become 20 requests.
    expect(serpCalls.length).toBeLessThanOrEqual(8);
    expect(result.requestsMade).toBe(serpCalls.length);
    expect(result.searchObservations.length).toBe(serpCalls.length);
  });

  it('adds no request for the own-domain scan — it reads the same responses', async () => {
    await discoverCompetitorDomainsFromSerp({ keywords: ['a', 'b'], ownDomain: OWN, geography: null });
    // Two keywords, two requests. The own-domain evidence is free.
    expect(serpCalls).toHaveLength(2);
  });

  it('requests a page-one window without issuing more searches', async () => {
    await fetchSerpResultsForKeyword('k', null);
    // SerpApi bills per search, not per result, so a wider window costs nothing extra.
    expect(serpCalls[serpCalls.length - 1].num).toBe(10);
  });
});

describe('GAP-06 · competitor discovery behaviour is unchanged', () => {
  it('still returns the same top-5 competitor window from the projection helper', async () => {
    const domains = await fetchSerpDomainsForKeyword('k', null);
    // Own domain is present in the fixture at rank 4 and IS returned by the raw projection —
    // the own-domain exclusion happens in `discoverCompetitorDomainsFromSerp`, exactly as before.
    expect(domains).toContain('contoso-insight.test');
    expect(domains.length).toBeLessThanOrEqual(5);
  });

  it('excludes the own domain from competitor candidates', async () => {
    const result = await discoverCompetitorDomainsFromSerp({ keywords: ['k'], ownDomain: OWN, geography: null });
    expect(result.domains).not.toContain(OWN);
    expect(result.domains).toContain('contoso-insight.test');
  });
});

// ── Composition, persistence and render ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composeSnapshotReportFromDecisions } = require('../../services/snapshotReportService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderCanonicalReportHtml } = require('../../services/export/canonicalReportPipeline');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapComposedReport } = require('../../../pages/api/reports/reportComposedMapper');

function resolvedInput() {
  return {
    companyId: 'gap06-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: 'Northwind Analytics', websiteDomain: OWN,
      businessType: 'analytics software', geography: null, socialLinks: [], competitors: [],
      source: 'manual-entry', uploadedFileName: null, manualData: null,
      companyContext: {
        marketFocus: 'mid-market operations analytics', productServices: ['analytics dashboards'],
        targetCustomer: null, idealCustomerProfile: null, brandPositioning: null,
        competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null,
      },
    },
    integrations: Object.fromEntries(
      ['google_analytics', 'google_search_console', 'google_ads', 'linkedin_ads', 'meta_ads', 'shopify',
        'woocommerce', 'social_accounts', 'wordpress', 'custom_blog_api', 'lead_webhook', 'website_crawl',
        'data_upload', 'manual_entry'].map((k) => [k, { connected: k === 'website_crawl', source: 'system', label: k }]),
    ),
  };
}

/** A competitor result carrying only the own-domain search evidence this gap adds. */
const withObservations = (
  observations: Array<Record<string, unknown>>,
  acquisition: { status: string; reason: string | null; requests_made: number },
) => ({
  summary: '', detected_competitors: [], market_alternatives: [],
  competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
  comparison: { company: {}, competitors: [] }, generated_gaps: [],
  competitive_summary: { top_threats: [], key_advantage: '', key_risk: '', positioning_statement: '' },
  own_domain_search_observations: observations,
  search_acquisition: acquisition,
});

const composeWith = (override: unknown) => composeSnapshotReportFromDecisions({
  companyId: 'gap06-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
  resolvedInput: resolvedInput(), competitorIntelligenceOverride: override,
});

function renderOf(report: Record<string, unknown>): string {
  const stored = JSON.parse(JSON.stringify(report));
  const payload = mapComposedReport(stored, 'snapshot', 'r', 'gap06-company', OWN, 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2');
  if (!payload) throw new Error('mapComposedReport returned null');
  return renderCanonicalReportHtml(payload);
}

const RANKED = { query: 'mid market analytics', position: 4, url: `https://${OWN}/solutions`, title: 'Northwind Analytics — Solutions', snippet: 'Self-serve analytics for mid-market operations.', resultCount: 10 };
const ABSENT = { query: 'analytics dashboards', position: null, url: null, title: null, snippet: null, resultCount: 10 };

describe('GAP-06 · Test H — the surface survives the JSONB round trip', () => {
  it('carries search_visibility from composition through composed_report to the payload', async () => {
    const report = await composeWith(withObservations([RANKED, ABSENT], { status: 'ok', reason: null, requests_made: 2 }));
    const surface = report.search_visibility;
    expect(surface).toBeTruthy();
    expect(surface.state).toBe('measured');
    expect(surface.queriesRun).toBe(2);
    expect(surface.queriesRanked).toBe(1);
    expect(surface.bestPosition).toBe(4);
    expect(surface.provider).toBe('serpapi');
    expect(surface.requestsMade).toBe(2);

    const stored = JSON.parse(JSON.stringify(report));
    expect(stored.search_visibility).toEqual(surface);
    const payload = mapComposedReport(stored, 'snapshot', 'r', 'gap06-company', OWN, 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2');
    expect(payload.searchVisibility).toEqual(surface);
  });

  it('records insufficient_signal — never a zero position — when nothing ranked', async () => {
    const report = await composeWith(withObservations([ABSENT], { status: 'ok', reason: null, requests_made: 1 }));
    expect(report.search_visibility.state).toBe('insufficient_signal');
    expect(report.search_visibility.bestPosition).toBeNull();
    expect(report.search_visibility.bestPosition).not.toBe(0);
    expect(report.search_visibility.reason).toContain('did not appear');
  });

  it('reports unavailable when acquisition could not run', async () => {
    const report = await composeWith(withObservations([], { status: 'unavailable', reason: 'No SerpAPI credential is configured for this environment.', requests_made: 0 }));
    expect(report.search_visibility.state).toBe('unavailable');
    expect(report.search_visibility.reason).toContain('credential');
    expect(report.search_visibility.provider).toBeNull();
  });

  it('reports failed when acquisition errored', async () => {
    const report = await composeWith(withObservations([], { status: 'failed', reason: 'connect ETIMEDOUT serpapi.com', requests_made: 0 }));
    expect(report.search_visibility.state).toBe('failed');
    expect(report.search_visibility.reason).toContain('ETIMEDOUT');
  });
});

describe('GAP-06 · Test I — the customer-facing report shows the evidence', () => {
  let measuredHtml: string;
  beforeAll(async () => {
    const report = await composeWith(withObservations([RANKED, ABSENT], { status: 'ok', reason: null, requests_made: 2 }));
    measuredHtml = renderOf(report as unknown as Record<string, unknown>);
    try {
      const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs');
      const { join } = require('path') as typeof import('path');
      const outDir = join(process.cwd(), 'tmp', 'gap06');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'search-visibility.html'), measuredHtml, 'utf-8');
    } catch { /* artifact only */ }
  });

  it('renders the section, the position and the observed result', () => {
    expect(measuredHtml).toContain('Public Search Visibility');
    expect(measuredHtml).toContain('mid market analytics');
    expect(measuredHtml).toContain('Position 4');
    expect(measuredHtml).toContain('Northwind Analytics');
  });

  it('shows checked-but-absent queries without inventing a rank', () => {
    expect(measuredHtml).toContain('Checked, not found');
    expect(measuredHtml).toContain('analytics dashboards');
    expect(measuredHtml).not.toMatch(/Position\s*0\b/);
  });

  it('names the provider and never leaks a credential or env-var name', () => {
    expect(measuredHtml).toContain('serpapi');
    for (const secret of ['test-serp-key', 'SERP_API_KEY', 'SERPAPI_API_KEY', 'SERPAPI_KEY', 'api_key']) {
      expect(measuredHtml).not.toContain(secret);
    }
  });

  it('renders an honest unavailable state rather than a poor result', async () => {
    const report = await composeWith(withObservations([], { status: 'unavailable', reason: 'No SerpAPI credential is configured for this environment.', requests_made: 0 }));
    const html = renderOf(report as unknown as Record<string, unknown>);
    expect(html).toContain('Public Search Visibility');
    expect(html).toContain('an unavailable check is not a poor result');

    // Scope the negative assertions to THIS section. A document-wide "Position" match would be
    // wrong — the dossier legitimately contains Authority Position, Market Position and
    // Comparative Positioning, none of which are search ranks.
    const start = html.indexOf('Public Search Visibility');
    const section = html.slice(start, html.indexOf('</section>', start));
    expect(section).not.toMatch(/Position\s*\d/);
    expect(section).not.toContain('Where the domain appears');
    expect(section).not.toContain('Checked, not found');
  });
});

describe('GAP-06 · GSC boundary', () => {
  it('builds the surface from SERP alone, with no Search Console contribution', async () => {
    const report = await composeWith(withObservations(
      [{ query: 'q', position: 2, url: `https://${OWN}/`, title: 't', snippet: 's', resultCount: 10 }],
      { status: 'ok', reason: null, requests_made: 1 },
    ));
    // The GSC-derived rank signal is unavailable in this run...
    expect(report.visual_intelligence.seo_capability_radar.rank_tracking_score).toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.source_tags?.rank_tracking_score).toBeNull();
    // ...yet public search visibility is measured. It therefore cannot be sourced from GSC.
    expect(report.search_visibility.state).toBe('measured');
    expect(report.search_visibility.provider).toBe('serpapi');
    expect(JSON.stringify(report.search_visibility)).not.toMatch(/gsc|search_console|impressions/i);
  });
});

describe('GAP-06 · Test J — prior invariants hold', () => {
  it('keeps GAP-02, GAP-04 and GAP-05 intact', async () => {
    const report = await composeWith(withObservations([RANKED], { status: 'ok', reason: null, requests_made: 1 }));
    // GAP-02
    expect(report.visual_intelligence.seo_capability_radar.technical_seo_score).toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
    // GAP-04
    const overall = report.canonical.authority_overview.overall_score;
    if (overall.state === 'insufficient_signal' || overall.state === 'unavailable') {
      expect(overall.value).toBeNull();
    }
    // GAP-05 — an empty decision layer keeps the honest legacy message.
    expect(report.digital_snapshot.empty).toBe(true);
    expect(renderOf(report as unknown as Record<string, unknown>)).toContain('No actions could be derived');
  });
});

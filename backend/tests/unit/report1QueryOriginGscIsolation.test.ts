/**
 * R1-L2 — GSC ISOLATION AND QUERY-ORIGIN PROVENANCE.
 *
 * Report 1's SERP query universe used to be seeded from `canonical_keywords` — a table only GSC
 * ingestion writes — ordered by `keyword_metrics.impressions`, with canonical membership carrying
 * the largest term in the scorer. Private Search Console history therefore decided which public
 * queries were checked, two tenants with identical public sites could be asked different
 * questions, and nothing recorded the difference.
 *
 * These controls pin the invariant that fixes it:
 *
 *     changing private GSC state cannot change the Report 1 query universe.
 *
 * They prove it TWO independent ways, because either alone is weak:
 *
 *   1. ACCESS. The real production path is driven against a Supabase mock that records every
 *      table it touches. Reintroducing a `canonical_keywords` or `keyword_metrics` read trips the
 *      assertion even if the read changes no output.
 *   2. OUTPUT. The same path is run against two radically different GSC datasets and the universe
 *      must be byte-identical. Reintroducing impression ordering trips this even if the read were
 *      somehow hidden from the access log.
 *
 * A control that only grepped source text would pass for a developer who reintroduced the read
 * through a helper, so neither of these is a text assertion.
 */

/** Recorded table access and swappable fixtures. `mock`-prefixed so jest's hoisting permits them. */
const mockTableAccess: string[] = [];
let mockFixtures: Record<string, unknown[]> = {};

jest.mock('../../db/supabaseClient', () => {
  const buildQuery = (table: string) => {
    const rows = () => Promise.resolve({ data: mockFixtures[table] ?? [], error: null });
    const query: Record<string, unknown> = {};
    const chain = () => query;
    query.select = chain;
    query.eq = chain;
    query.in = chain;
    query.order = chain;
    // Every read in this path terminates on `.limit(...)`, scoped or unscoped.
    query.limit = rows;
    query.then = (resolve: (value: unknown) => unknown) => rows().then(resolve);
    return query;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockTableAccess.push(table);
        return buildQuery(table);
      },
    },
  };
});

// Hermetic network for the producer-level control below: serpapi is answered locally and every
// other request is refused before it is sent.
jest.mock('../../../lib/security/safeFetch', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/hermeticNetwork').hermeticSafeFetchModule());
jest.mock('axios', () => {
  const refuse = async () => { throw new Error('axios is not a SERP seam (DG-001) -- use fetch'); };
  return { __esModule: true, default: { get: refuse, post: refuse }, get: refuse, post: refuse };
});

import { installHermeticFetch, type HermeticFetchHandle } from '../helpers/hermeticNetwork';
import { discoverCompetitorDomainsFromSerp } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { extractPublicQueryTerms } from '../../services/reportCompetitorIntelligenceServiceModel';
import {
  QUERY_ORIGIN_LABEL,
  indexQueryOrigins,
  mergeReport1QueryUniverse,
  queryTexts,
  type Report1Query,
  type Report1QueryCandidate,
} from '../../services/report1QueryUniverse';
import { generateDiscoveryQueryCandidates } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { renderSearchVisibility } from '../../services/intelligence/exportRendererReport1';
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import type { SnapshotSearchObservation } from '../../services/snapshotReportTypes';

const network: HermeticFetchHandle = installHermeticFetch(async ({ url }) => {
  if (url.hostname !== 'serpapi.com') return undefined; // refused, never sent
  const query = url.searchParams.get('q') ?? '';
  return { body: { organic_results: [{ position: 1, link: `https://northwind-analytics.test/${encodeURIComponent(query)}`, title: 'Northwind', snippet: 's' }] } };
});
afterAll(() => network.restore());
process.env.SERP_API_KEY = process.env.SERP_API_KEY || 'test-serp-key';

/** The private tables that must never be reachable from Report 1 query selection. */
const GSC_TABLES = ['canonical_keywords', 'keyword_metrics'];

/** Identical PUBLIC evidence for every run — only the GSC fixtures vary between them. */
const PUBLIC_PAGES = [
  { id: 'p1', title: 'Mid-market analytics platform', headings: [{ text: 'Revenue analytics' }], crawl_depth: 0 },
  { id: 'p2', title: 'Pricing', headings: [{ text: 'Plans for analytics teams' }], crawl_depth: 1 },
];
const PUBLIC_LINKS = [{ anchor_text: 'revenue analytics' }, { anchor_text: 'analytics platform' }];
const PUBLIC_CONTENT = [{ content_text: 'Revenue analytics for mid-market teams. Analytics platform for operations.' }];

/** A GSC dataset. Nothing in Report 1 may read it; these exist to prove exactly that. */
const gscDataset = (variant: 'absent' | 'huge' | 'reversed') => {
  if (variant === 'absent') return { canonical_keywords: [], keyword_metrics: [] };
  const keywords = [
    { id: 'k1', keyword: 'enterprise data warehouse consolidation' },
    { id: 'k2', keyword: 'quarterly board reporting pack' },
    { id: 'k3', keyword: 'headcount planning spreadsheet' },
    { id: 'k4', keyword: 'vendor renewal negotiation checklist' },
    { id: 'k5', keyword: 'soc2 audit evidence collection' },
    { id: 'k6', keyword: 'payroll reconciliation workflow' },
    { id: 'k7', keyword: 'procurement approval routing' },
    { id: 'k8', keyword: 'expense policy exception handling' },
  ];
  const impressions = variant === 'huge'
    ? [900000, 800000, 700000, 600000, 500000, 400000, 300000, 200000]
    : [200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000];
  return {
    canonical_keywords: keywords,
    keyword_metrics: keywords.map((k, i) => ({ keyword_id: k.id, impressions: impressions[i] })),
  };
};

const setFixtures = (variant: 'absent' | 'huge' | 'reversed'): void => {
  mockTableAccess.length = 0;
  mockFixtures = {
    canonical_pages: PUBLIC_PAGES,
    page_links: PUBLIC_LINKS,
    page_content: PUBLIC_CONTENT,
    ...gscDataset(variant),
  };
};

const DECLARED = {
  resolved: {
    websiteDomain: 'northwind-analytics.test',
    businessType: 'analytics software',
    companyContext: { marketFocus: 'revenue analytics', primaryService: 'analytics platform' },
  },
};

/** The REAL Report 1 universe construction, exactly as the engine performs it. */
async function buildUniverse(variant: 'absent' | 'huge' | 'reversed'): Promise<Report1Query[]> {
  setFixtures(variant);
  const publicCandidates = await extractPublicQueryTerms({
    companyId: 'company-1',
    domain: 'northwind-analytics.test',
    businessType: 'analytics software',
  });
  const declaredCandidates = generateDiscoveryQueryCandidates(DECLARED);
  return mergeReport1QueryUniverse([...publicCandidates, ...declaredCandidates], {
    limit: 10,
    normalize: (value) => {
      const text = String(value ?? '').trim().replace(/\s+/g, ' ');
      return text.length >= 3 ? text : null;
    },
  });
}

// ── CONTROL 1-4. GSC CANNOT REACH REPORT 1 QUERY SELECTION ─────────────────

describe('CONTROL 1-4 — GSC cannot enter, order, rank or crowd out', () => {
  it('CONTROL 1 — the production path never reads a GSC table', async () => {
    await buildUniverse('huge');
    // The public sources WERE read, so the path genuinely ran rather than short-circuiting.
    expect(mockTableAccess).toContain('canonical_pages');
    for (const table of GSC_TABLES) expect(mockTableAccess).not.toContain(table);
  });

  it('CONTROL 2 — reversing impression ordering changes nothing', async () => {
    const huge = await buildUniverse('huge');
    const reversed = await buildUniverse('reversed');
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(huge));
  });

  it('CONTROL 3 — a keyword present ONLY in canonical_keywords never appears', async () => {
    const universe = await buildUniverse('huge');
    const text = queryTexts(universe).join(' | ').toLowerCase();
    for (const absent of [
      'enterprise data warehouse consolidation',
      'soc2 audit evidence collection',
      'payroll reconciliation workflow',
    ]) expect(text).not.toContain(absent);
  });

  it('CONTROL 4 — high-impression GSC keywords cannot crowd out the allowed sources', async () => {
    const universe = await buildUniverse('huge');
    // Every surviving query came from a permitted origin; the taxonomy has no private member,
    // so this is also a type-level guarantee rather than only a runtime one.
    expect(universe.length).toBeGreaterThan(0);
    for (const entry of universe) {
      expect(['observed_public', 'declared', 'derived_template', 'derived_fallback'])
        .toContain(entry.origin);
    }
    // The declared/public set still reaches the dispatched queries rather than being displaced.
    expect(queryTexts(universe).join(' ').toLowerCase()).toContain('revenue analytics');
  });
});

// ── CONTROL 9. THE DETERMINISM INVARIANT ───────────────────────────────────

describe('CONTROL 9 — identical public/declared inputs, different GSC: identical universe', () => {
  it('query set, order, origins and rationale are all identical', async () => {
    const withoutGsc = await buildUniverse('absent');
    const withGsc = await buildUniverse('huge');

    expect(queryTexts(withGsc)).toEqual(queryTexts(withoutGsc));
    expect(withGsc.map((q) => q.origin)).toEqual(withoutGsc.map((q) => q.origin));
    expect(withGsc.map((q) => q.rationale)).toEqual(withoutGsc.map((q) => q.rationale));
    expect(withGsc.map((q) => q.basis)).toEqual(withoutGsc.map((q) => q.basis));
    // Byte-identical, which is the claim the longitudinal-comparability argument rests on.
    expect(JSON.stringify(withGsc)).toBe(JSON.stringify(withoutGsc));
  });

  it('the universe is non-empty, so the equality above is not vacuous', async () => {
    const universe = await buildUniverse('absent');
    expect(universe.length).toBeGreaterThan(3);
  });
});

// ── CONTROL 5. ORIGIN SURVIVES MERGE, NORMALIZATION, DEDUPE AND CAP ────────

describe('CONTROL 5 — origin survives the merge', () => {
  const normalize = (value: string | null | undefined): string | null => {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text.length >= 3 ? text : null;
  };

  it('first-origin-wins on a duplicate across two origins', () => {
    const candidates: Report1QueryCandidate[] = [
      { value: 'revenue analytics', origin: 'observed_public', rationale: 'from page text', basis: 'titles' },
      { value: 'Revenue  Analytics', origin: 'declared', rationale: 'from the profile', basis: 'category' },
    ];
    const universe = mergeReport1QueryUniverse(candidates, { limit: 10, normalize });
    expect(universe).toHaveLength(1);
    expect(universe[0].origin).toBe('observed_public');
    expect(universe[0].rationale).toBe('from page text');
  });

  it('the cap preserves each surviving entry with its own origin', () => {
    const candidates: Report1QueryCandidate[] = [
      { value: 'alpha query', origin: 'observed_public', rationale: 'a', basis: null },
      { value: 'beta query', origin: 'declared', rationale: 'b', basis: null },
      { value: 'gamma query', origin: 'derived_template', rationale: 'c', basis: null },
      { value: 'delta query', origin: 'derived_fallback', rationale: 'd', basis: null },
    ];
    const universe = mergeReport1QueryUniverse(candidates, { limit: 3, normalize });
    expect(universe.map((q) => q.origin)).toEqual(['observed_public', 'declared', 'derived_template']);
  });

  it('the dispatched query list and the origin index stay in agreement', () => {
    const candidates: Report1QueryCandidate[] = [
      { value: 'revenue analytics', origin: 'observed_public', rationale: 'a', basis: null },
      { value: 'analytics competitors', origin: 'derived_template', rationale: 'b', basis: null },
    ];
    const universe = mergeReport1QueryUniverse(candidates, { limit: 10, normalize });
    const index = indexQueryOrigins(universe);
    for (const query of queryTexts(universe)) {
      expect(index.get(query.toLowerCase())?.query).toBe(query);
    }
  });
});

// ── CONTROL 6-8. THE RENDERER USES RECORDED ORIGIN ONLY ────────────────────

const observation = (over: Partial<SnapshotSearchObservation> = {}): SnapshotSearchObservation => ({
  query: 'revenue analytics',
  position: 4,
  url: 'https://northwind-analytics.test/solutions',
  title: 'Northwind Analytics',
  snippet: 'Analytics for mid-market teams.',
  resultCount: 10,
  engine: 'google',
  provider: 'provider-a',
  observedAt: '2026-02-01T09:30:00.000Z',
  ...over,
});

const render = (observations: SnapshotSearchObservation[], surface: Record<string, unknown> = {}): string =>
  renderSearchVisibility({
    report1: {
      search_visibility: {
        state: 'measured',
        provider: 'provider-a',
        source: 'serp',
        provenance: 'PUBLIC_OBSERVED',
        observedAt: '2026-02-01T00:00:00.000Z',
        queriesRun: observations.length,
        queriesRanked: observations.filter((o) => typeof o.position === 'number').length,
        bestPosition: 4,
        observations,
        requestsMade: observations.length,
        reason: null,
        ...surface,
      },
    },
  } as unknown as CanonicalExportPayload, 'EV');

describe('CONTROL 6 — rationale is construction-time, never inferred from query text', () => {
  it('a query that READS like a template renders its RECORDED origin instead', () => {
    // The text matches the competitor template exactly; the recorded origin says otherwise.
    const html = render([observation({
      query: 'revenue analytics competitors',
      queryOrigin: 'observed_public',
      queryRationale: 'Term taken from this site\'s public page titles and headings.',
    })]);
    expect(html).toContain(QUERY_ORIGIN_LABEL.observed_public);
    expect(html).toContain('Term taken from this site');
    // The renderer did not reclassify it from its wording.
    expect(html).not.toContain(QUERY_ORIGIN_LABEL.derived_template);
  });

  it('an observation with NO recorded origin says so and is never classified', () => {
    const html = render([observation()]);
    expect(html).toContain('Why this query was checked: not recorded for this observation');
    for (const label of Object.values(QUERY_ORIGIN_LABEL)) {
      expect(html).not.toContain(`Why this query was checked: ${label}.`);
    }
  });

  it('query rationale and search provenance stay SEPARATE statements', () => {
    const html = render([observation({
      queryOrigin: 'declared',
      queryRationale: 'Declared category from the company profile.',
    })]);
    // Both axes are present...
    expect(html).toContain(QUERY_ORIGIN_LABEL.declared);
    expect(html).toContain('engine google');
    expect(html).toContain('via provider-a');
    // ...and neither is described as the other.
    expect(html).not.toMatch(/search provenance[^<]*declared in the company profile/i);
    expect(html).not.toMatch(/Why this query was checked:[^<]*engine google/i);
  });
});

describe('CONTROL 7 — no private GSC metric can reach the rendered report', () => {
  it('GSC-shaped metadata on the observation is never rendered', () => {
    const contaminated = {
      ...observation({ queryOrigin: 'observed_public', queryRationale: 'from public page text' }),
      impressions: 918273,
      clicks: 4242,
      ctr: 0.37,
      gscPosition: 2.4,
      keywordVolume: 60500,
    } as unknown as SnapshotSearchObservation;
    const html = render([contaminated]);
    for (const leak of ['918273', '4242', '0.37', '60500', 'impression', 'clicks', 'ctr', 'volume']) {
      expect(html.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('the section never implies demand, and never calls a query observed', () => {
    const html = render([observation({
      queryOrigin: 'observed_public',
      queryRationale: 'Term taken from public page titles.',
    })]);
    expect(html).not.toMatch(/search demand|public demand|users search for|people search for/i);
    // The page text was observed; the QUERY was derived from it. "Observed query" would overclaim.
    expect(html).not.toMatch(/observed quer(y|ies)/i);
    // The existing honest statement about connected analytics must survive.
    expect(html).toContain('not a reading of any connected analytics property');
  });
});

describe('CONTROL 8 — the generic fallback is disclosed, never presented as the company', () => {
  it('a fallback-origin query is labelled fallback and explained', () => {
    const html = render([observation({
      query: 'business software competitors',
      queryOrigin: 'derived_fallback',
      queryRationale: 'Generic category template. No declared or public subject context was available for this company.',
    })]);
    expect(html).toContain(QUERY_ORIGIN_LABEL.derived_fallback);
    expect(html).toContain('No declared or public subject context was available');
    // It is disclosed at the section level too, so a skimming reader cannot miss it.
    expect(html).toContain('fell back to generic category wording');
    expect(html).toContain('not evidence about what this company does');
  });

  it('a fallback query is never rendered as declared or as observed', () => {
    const html = render([observation({
      query: 'business software competitors',
      queryOrigin: 'derived_fallback',
      queryRationale: 'Generic category template.',
    })]);
    expect(html).not.toContain(QUERY_ORIGIN_LABEL.declared);
    expect(html).not.toContain(QUERY_ORIGIN_LABEL.observed_public);
  });

  it('with no fallback present, no fallback disclosure appears', () => {
    const html = render([observation({ queryOrigin: 'declared', queryRationale: 'Declared category.' })]);
    expect(html).not.toContain('fell back to generic category wording');
  });
});

// ── CAP DISCLOSURE ─────────────────────────────────────────────────────────

describe('the bounded query set is disclosed', () => {
  it('the report states the set is bounded and not complete market coverage', () => {
    const html = render([observation({ queryOrigin: 'declared', queryRationale: 'Declared category.' })]);
    expect(html).toContain('bounded set, not a claim of complete market search coverage');
  });

  it('a pre-L-2 report, carrying no origins at all, gets no disclosure it cannot support', () => {
    const html = render([observation()]);
    expect(html).not.toContain('bounded set, not a claim of complete market search coverage');
    // ...and the pre-existing section contract is untouched.
    expect(html).toContain('Position 4');
    expect(html).toContain("Positions are the search provider's own ranks");
  });
});

// ── CONTROL 6b. THE CONTROL THAT CATCHES TEXT-BASED INFERENCE ──────────────
//
// Added because injecting a text-inference fallback into the renderer did NOT trip CONTROL 6:
// its no-origin case used a query ('revenue analytics') that no template pattern would match, so
// an inferring renderer had nothing to infer FROM. This case uses a query whose wording is exactly
// what a template produces while carrying NO recorded origin -- the only shape that catches it.

describe('CONTROL 6b — template-shaped text with no recorded origin stays unclassified', () => {
  for (const query of ['revenue analytics competitors', 'analytics platform alternatives']) {
    it(`"${query}" is reported as not recorded, never as a template`, () => {
      const html = render([observation({ query, position: null, url: null, title: null, snippet: null })]);
      expect(html).toContain('Why this query was checked: not recorded for this observation');
      expect(html).not.toContain(QUERY_ORIGIN_LABEL.derived_template);
      expect(html).not.toContain(QUERY_ORIGIN_LABEL.observed_public);
      expect(html).not.toContain(QUERY_ORIGIN_LABEL.declared);
      expect(html).not.toContain(QUERY_ORIGIN_LABEL.derived_fallback);
    });
  }
});

// ── CONTROL 8b. THE REAL CLASSIFIER, NOT A HAND-BUILT FIXTURE ──────────────
//
// Added because relabelling the fallback as `derived_template` in the production classifier did
// NOT trip CONTROL 8: those tests drove the renderer with a hand-written `derived_fallback`, so
// they never exercised the code that DECIDES it. This drives the real classifier.

describe('CONTROL 8b — the real classifier marks an ungrounded base as fallback', () => {
  it('a profile with no category, product, problem or usable domain yields ONLY fallback origins', () => {
    const candidates = generateDiscoveryQueryCandidates({ resolved: { websiteDomain: null } });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(candidate.origin).toBe('derived_fallback');
    // And it says why, rather than presenting a generic term as the company's category.
    expect(candidates[0].rationale).toContain('No declared or public subject context was available');
  });

  it('a declared category yields template origins, never fallback — the contrast', () => {
    const candidates = generateDiscoveryQueryCandidates({
      resolved: { websiteDomain: 'northwind-analytics.test', companyContext: { marketFocus: 'revenue analytics' } },
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.origin === 'derived_fallback')).toBe(false);
    expect(candidates.some((c) => c.origin === 'derived_template')).toBe(true);
  });

  it('BASE SELECTION IS UNCHANGED: the empty base still produces the same queries as before', () => {
    // L-2 discloses provenance; it does not alter which queries are dispatched.
    //
    // A profile with no `resolved` key never reaches the sparse-identity substitution, so it
    // exercises the genuinely EMPTY base. That base has always been '' rather than the
    // 'business software' literal -- `extractDomainKeywords(...).join(' ')` returns '' and '' is
    // not nullish, so the literal in the `??` chain is unreachable -- producing bare template
    // wording. That behaviour is preserved exactly; only its label is new.
    const candidates = generateDiscoveryQueryCandidates({});
    const values = candidates.map((c) => String(c.value ?? '').trim());
    expect(values).toContain('competitors');
    expect(values).toContain('alternatives');
    expect(values.join(' | ')).not.toContain('business software');
    for (const candidate of candidates) expect(candidate.origin).toBe('derived_fallback');
  });

  it('a FABRICATED sparse identity is reported as fallback, never as declared', () => {
    // When the profile is too sparse, `extractCompetitiveContextFromResolvedInput` substitutes a
    // hard-coded identity ('business software and marketing automation', ...). Those queries are
    // still dispatched unchanged, but they describe a placeholder rather than this company, so
    // every one of them must read as a generic fallback.
    const candidates = generateDiscoveryQueryCandidates({ resolved: { websiteDomain: null } });
    expect(candidates.length).toBeGreaterThan(0);
    // The substituted base really is in use -- otherwise this test proves nothing.
    expect(candidates.map((c) => String(c.value ?? '')).join(' | '))
      .toContain('business software and marketing automation');
    for (const candidate of candidates) {
      expect(candidate.origin).toBe('derived_fallback');
      expect(candidate.rationale).toContain('not a statement about this company');
    }
  });
});

// ── CONTROL 10. ORIGIN REACHES THE OBSERVATION ─────────────────────────────
//
// Drives the REAL SERP producer over a local transport. Catches an origin that is computed and
// then dropped before it reaches the observation -- the failure the persistence chain depends on.

describe('CONTROL 10 — the recorded origin reaches the observation', () => {
  const universe: Report1Query[] = [
    { query: 'revenue analytics', origin: 'observed_public', rationale: 'From public page titles.', basis: 'titles' },
    { query: 'analytics competitors', origin: 'derived_template', rationale: 'Category template.', basis: 'category' },
  ];

  it('each observation carries the origin recorded for ITS query', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: queryTexts(universe),
      ownDomain: 'northwind-analytics.test',
      geography: null,
      queryOrigins: indexQueryOrigins(universe),
    });
    // The producer also runs its own simplified-keyword retry batch when nothing ranked, so the
    // set is a superset of the two dispatched queries. Every entry must still carry an origin:
    // the retry's queries INHERIT their parent's, rather than arriving unattributed.
    expect(result.searchObservations.length).toBeGreaterThanOrEqual(2);
    const byQuery = new Map(result.searchObservations.map((o) => [o.query, o]));
    expect(byQuery.get('revenue analytics')?.queryOrigin).toBe('observed_public');
    expect(byQuery.get('revenue analytics')?.queryRationale).toBe('From public page titles.');
    expect(byQuery.get('analytics competitors')?.queryOrigin).toBe('derived_template');
    expect(byQuery.get('analytics competitors')?.queryRationale).toBe('Category template.');
    // No observation reaches the report unattributed.
    for (const o of result.searchObservations) {
      expect(o.queryOrigin).not.toBeNull();
      expect(o.queryRationale).not.toBeNull();
    }
    // A simplified retry query is present and inherited rather than invented.
    const inherited = result.searchObservations.find((o) => o.query === 'analytics');
    if (inherited) {
      expect(inherited.queryOrigin).toBe('derived_template');
      expect(inherited.queryRationale).toContain('Broadened form of the same term.');
    }
  });

  it('observation provenance is untouched by carrying query origin', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: queryTexts(universe),
      ownDomain: 'northwind-analytics.test',
      geography: null,
      queryOrigins: indexQueryOrigins(universe),
    });
    for (const o of result.searchObservations) {
      expect(o.engine).toBeTruthy();
      expect(o.provider).toBeTruthy();
      expect(typeof o.observedAt).toBe('string');
    }
  });

  it('WITHOUT a universe the origin is null — never guessed from the query text', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['analytics competitors'],
      ownDomain: 'northwind-analytics.test',
      geography: null,
    });
    expect(result.searchObservations.length).toBeGreaterThanOrEqual(1);
    // Including the simplified retry query, which must not acquire an origin either.
    for (const o of result.searchObservations) {
      expect(o.queryOrigin).toBeNull();
      expect(o.queryRationale).toBeNull();
    }
    expect(result.searchObservations.some((o) => o.query === 'analytics competitors')).toBe(true);
  });
});

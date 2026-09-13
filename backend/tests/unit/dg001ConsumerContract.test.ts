/**
 * DG-001 — what the two report consumers ask the canonical client for.
 *
 * WHY THIS SUITE EXISTS. The client suite proves the client, and the parser
 * suite proves the parser — and both passed while three defects went
 * undetected: feature rows could be merged into the organic ranking array, and
 * either consumer's depth could be changed silently. Every one of those lives in
 * the CALLER, so the caller is what has to be observed.
 *
 * The canonical client is mocked here on purpose. The question is not what
 * SerpAPI returns; it is what Report 1 and competitor enrichment ASK FOR, and
 * what they do with the answer.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

const fetchCanonicalSerp = jest.fn();
jest.mock('../../services/serp/canonicalSerpClient', () => ({
  fetchCanonicalSerp: (...args: unknown[]) => fetchCanonicalSerp(...args),
  REPORT_SERP_PROVIDER: 'serpapi',
}));

import { fetchSerpResultsForKeyword, featureOwnership } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { enrichCompetitorCandidate } from '../../services/competitorEnrichmentService';

/** One organic row and one of every feature the client can return. */
const MIXED_ROWS = [
  { position: 1, url: 'https://northwind.test/a', domain: 'northwind.test', title: 'A', snippet: 'Snip A', result_type: 'organic' },
  { position: 2, url: 'https://rival.test/b', domain: 'rival.test', title: 'B', snippet: 'Snip B', result_type: 'organic' },
  { position: null, url: null, domain: null, title: 'What is Northwind?', snippet: null, result_type: 'people_also_ask' },
  { position: null, url: null, domain: null, title: 'Northwind Ltd', snippet: null, result_type: 'knowledge_panel' },
  { position: 1, url: 'https://ad.test/x', domain: 'ad.test', title: 'Ad', snippet: null, result_type: 'paid' },
];

const okWith = (rows: unknown[]) => ({ status: 'ok', refusedBy: null, rows, reason: null, provider: 'serpapi' });

beforeEach(() => {
  fetchCanonicalSerp.mockReset();
  fetchCanonicalSerp.mockResolvedValue(okWith(MIXED_ROWS));
});

const argsOf = (call = 0) => fetchCanonicalSerp.mock.calls[call][0] as Record<string, unknown>;

// ── Report 1's consumer ─────────────────────────────────────────────────────

describe('DG-001 — Report 1 asks for depth 10 and separates organic from features', () => {
  it('requests EXACTLY depth 10 — the report ranking window', async () => {
    // Ten is page one. At fifty an own-domain rank of 11–50 would appear where
    // the report previously said "not found", flipping a customer-facing state.
    await fetchSerpResultsForKeyword('northwind crm', null);
    expect(argsOf().depth).toBe(10);
  });

  it('puts ONLY organic rows in `rows` — the array that feeds ranking', async () => {
    const out = await fetchSerpResultsForKeyword('northwind crm', null);
    expect(out.rows).toHaveLength(2);
    expect(out.rows.map((r) => r.domain)).toEqual(['northwind.test', 'rival.test']);
    // Not one feature reached the ranking array.
    expect(out.rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('puts every non-organic row in `features`, and nowhere else', async () => {
    const out = await fetchSerpResultsForKeyword('northwind crm', null);
    expect(out.features.map((f) => f.result_type).sort())
      .toEqual(['knowledge_panel', 'paid', 'people_also_ask']);
  });

  it('a page of nothing but features produces ZERO ranking rows', async () => {
    // The decisive case: if features could leak into `rows`, this would report
    // ranked positions for a page where the domain ranks nowhere.
    fetchCanonicalSerp.mockResolvedValue(okWith(MIXED_ROWS.filter((r) => r.result_type !== 'organic')));
    const out = await fetchSerpResultsForKeyword('northwind crm', null);
    expect(out.rows).toEqual([]);
    expect(out.features).toHaveLength(3);
  });

  it('preserves the snippet on organic rows', async () => {
    const out = await fetchSerpResultsForKeyword('northwind crm', null);
    expect(out.rows[0].snippet).toBe('Snip A');
  });

  it('derives the row domain from the URL, not from the client\'s field', async () => {
    // The client's `domain` is deliberately not trusted here: adopting it would
    // change which five domains competitor discovery sees, and that window is a
    // frozen invariant of this consolidation.
    fetchCanonicalSerp.mockResolvedValue(okWith([
      { position: 1, url: 'https://real.test/a', domain: 'breadcrumb.test › a', title: 'A', snippet: null, result_type: 'organic' },
    ]));
    const out = await fetchSerpResultsForKeyword('q', null);
    expect(out.rows[0].domain).toBe('real.test');
  });

  it('reports a refusal without rows or features, and never as success', async () => {
    for (const status of ['unavailable', 'failed'] as const) {
      fetchCanonicalSerp.mockResolvedValue({ status, refusedBy: null, rows: [], reason: 'nope', provider: null });
      const out = await fetchSerpResultsForKeyword('q', null);
      expect(out).toMatchObject({ status, rows: [], features: [] });
    }
  });
});

// ── competitor enrichment's consumer ────────────────────────────────────────

describe('DG-001 — competitor enrichment asks for depth 5 and keeps snippets', () => {
  const candidate = { name: 'Rival Inc', domain: 'rival.test' };

  it('requests EXACTLY depth 5 — it needs prose, not ranks', async () => {
    await enrichCompetitorCandidate({ candidate, useNetwork: true, useStoredCache: false });
    // The homepage fetch may also run; find the SERP call by its operation.
    const serpCall = fetchCanonicalSerp.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((a) => a.operation === 'competitor_enrichment');
    expect(serpCall).toBeTruthy();
    expect(serpCall!.depth).toBe(5);
  });

  it('goes through the canonical client rather than its own provider call', async () => {
    await enrichCompetitorCandidate({ candidate, useNetwork: true, useStoredCache: false });
    expect(fetchCanonicalSerp).toHaveBeenCalled();
  });

  it('builds its profile from title AND snippet', async () => {
    // Dropping the snippet would not fail — it would quietly produce a thinner
    // profile at the same stated confidence, which is worse than an error.
    fetchCanonicalSerp.mockResolvedValue(okWith([
      { position: 1, url: 'https://rival.test/a', domain: 'rival.test', title: 'Rival Inc', snippet: 'a CRM for field service teams', result_type: 'organic' },
    ]));
    const out = await enrichCompetitorCandidate({ candidate, useNetwork: true, useStoredCache: false });
    // The enrichment profile is derived from the joined text; proving the
    // snippet reached it is enough — the derivation itself is A3's, not DG-001's.
    expect(JSON.stringify(out).toLowerCase()).toContain('field service');
  });

  it('ignores non-organic rows when building prose', async () => {
    fetchCanonicalSerp.mockResolvedValue(okWith([
      { position: null, url: null, domain: null, title: 'PAA question about something else', snippet: null, result_type: 'people_also_ask' },
    ]));
    const out = await enrichCompetitorCandidate({ candidate, useNetwork: true, useStoredCache: false });
    expect(JSON.stringify(out)).not.toContain('PAA question');
  });
});

// ── the consolidation itself ────────────────────────────────────────────────

describe('DG-001 — the three depths are distinct, stated boundaries', () => {
  /**
   * Depth 10 and depth 5 are asserted behaviourally above, from what each
   * consumer ASKS the client for. The warehouse depth of 50 had no assertion at
   * all — it was documented in a comment and nowhere else, so it could be
   * changed silently, which is exactly what the comment says must not happen.
   *
   * It lives inside a provider closure that only runs against a live endpoint,
   * so it is pinned at the source, in the same idiom this suite already uses for
   * the call-site guard below.
   */
  const fsm = require('fs');

  it('the warehouse path still requests depth 50 by default', () => {
    const source: string = fsm.readFileSync('backend/services/serpAcquisitionService.ts', 'utf8');
    expect(source).toContain('depth: Number(process.env.SERP_RESULT_DEPTH ?? 50)');
  });

  it('the three depths are different numbers, and each is named once', () => {
    // Collapsing any two would erase a semantic boundary: the report ranking
    // window, the enrichment prose window, and the warehouse crawl are not the
    // same question and must not silently become the same request.
    const report: string = fsm.readFileSync('backend/services/reportCompetitorIntelligenceServiceHelpers.ts', 'utf8');
    const enrichment: string = fsm.readFileSync('backend/services/competitorEnrichmentService.ts', 'utf8');
    const warehouse: string = fsm.readFileSync('backend/services/serpAcquisitionService.ts', 'utf8');

    expect(report).toContain('const SERP_RESULTS_PER_QUERY = 10;');
    expect(enrichment).toContain('const SERP_ENRICHMENT_DEPTH = 5;');
    expect(warehouse).toContain('SERP_RESULT_DEPTH ?? 50');

    expect(report).not.toContain('const SERP_RESULTS_PER_QUERY = 50;');
    expect(enrichment).not.toContain('const SERP_ENRICHMENT_DEPTH = 10;');
  });
});

describe('DG-001 — feature ownership is three-valued', () => {
  it('a feature with no domain yields NULL, never false', () => {
    // A People Also Ask entry and a knowledge panel carry no link. `false` would
    // assert the feature is NOT the company's, which the evidence cannot support.
    expect(featureOwnership(null, 'northwind.test')).toBeNull();
    expect(featureOwnership(undefined, 'northwind.test')).toBeNull();
    expect(featureOwnership('', 'northwind.test')).toBeNull();
    expect(featureOwnership(null, 'northwind.test')).not.toBe(false);
  });

  it('ownership is only decided when BOTH domains are known', () => {
    expect(featureOwnership('northwind.test', 'northwind.test')).toBe(true);
    expect(featureOwnership('rival.test', 'northwind.test')).toBe(false);
    // No own-domain to compare against is equally undecidable.
    expect(featureOwnership('rival.test', null)).toBeNull();
  });
});

describe('DG-001 — the sanctioned SERP call sites, and no others', () => {
  /**
   * The exit criterion for this consolidation: no direct provider call from
   * REPORT code. Three paths used to reach SerpAPI — two with their own inline
   * parser, one with no governance at all. Nothing stops a fourth appearing
   * except an assertion that looks.
   *
   * Two call sites are sanctioned, for stated reasons:
   *
   *   canonicalSerpClient.ts   the report path — governed, pinned, one parser
   *   serpAcquisitionService.ts the WAREHOUSE path — the cron/enterprise
   *                            acquisition the consolidation deliberately left
   *                            alone (its own provider priority and depth 50)
   *
   * Comments are stripped first, so a module may DISCUSS the endpoint — several
   * necessarily do — without counting as calling it. A base-URL string in a
   * preset table or a type file is not a request either, so the check requires
   * the endpoint to appear beside an actual HTTP call.
   */
  const executable = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const SANCTIONED_REQUEST_SITES = [
    'backend/services/serp/canonicalSerpClient.ts',
    'backend/services/serpAcquisitionService.ts',
  ];

  const productionFilesMatching = (pattern: string): string[] => {
    const { execSync } = require('child_process');
    const fsm = require('fs');
    // `--untracked`: a plain `git grep` searches only TRACKED files, so a
    // brand-new module — exactly the shape a reintroduced provider call takes —
    // would be invisible to this guard until someone committed it.
    return execSync(`git grep -l --untracked "${pattern}" -- "backend" "pages" || true`, { encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f: string) => !f.includes('/tests/'))
      .filter((f: string) => new RegExp(pattern).test(executable(fsm.readFileSync(f, 'utf8'))));
  };

  it('only the two sanctioned modules ISSUE a request to the provider', () => {
    const fsm = require('fs');
    const requestSites = productionFilesMatching('serpapi\\.com').filter((f: string) => {
      const code = executable(fsm.readFileSync(f, 'utf8'));
      // A URL that is fetched, not a URL that is merely named.
      return /(fetch|axios)/.test(code);
    });
    expect(requestSites.sort()).toEqual([...SANCTIONED_REQUEST_SITES].sort());
  });

  it('only those two modules know the provider response shape', () => {
    const ALLOWED = new Set([
      ...SANCTIONED_REQUEST_SITES,
      // Pre-existing and unrelated: a generic trends normaliser that sniffs many
      // response shapes and happens to recognise this one. Not a SERP path.
      'backend/services/trendNormalizationService.ts',
      // The vocabulary itself names the provider labels it translates.
      'backend/services/serp/serpResultTypes.ts',
    ]);
    expect(productionFilesMatching('organic_results').filter((f: string) => !ALLOWED.has(f))).toEqual([]);
  });
});

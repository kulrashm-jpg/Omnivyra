/**
 * 3AH-144 — rank provenance must survive the DISCOVERY consumers.
 *
 * The parser remediation (642bd5aa) stops fabricating a SERP rank and yields
 * `position: null` when the provider declared none. Two downstream consumers
 * then re-fabricated one from the array index:
 *
 *   discoveryProviders.ts   rank: r.position || i + 1
 *   webDiscovery.ts         rank: r.rank     || i + 1
 *
 * These are FIXTURE tests. No network, no provider credential, no DB.
 */

import {
  discover,
  filterCandidates,
  parseKeylessResults,
  type DiscoveryProvider,
  type RawSearchResult,
} from './dg001DiscoveryRankProvenance.helpers';

const CTX = {
  query: 'q', provider: 'serp_api' as const, retrievedAt: '2026-09-20T00:00:00.000Z',
  companyDomain: null, limit: 50,
};

const raw = (url: string, rank: number, serpPosition: number | null): RawSearchResult =>
  ({ url, title: null, snippet: null, rank, serpPosition });

describe('3AH-144 — an absent SERP rank stays absent through discovery', () => {
  // A / B — an authoritative organic rank is preserved exactly.
  it.each([[1], [10]])('preserves an explicitly declared organic rank (%i)', (pos) => {
    const { candidates } = filterCandidates([raw('https://a.example/x', 1, pos)], CTX);
    expect(candidates[0].serpPosition).toBe(pos);
  });

  // C — a ranked FEATURE that declared its own rank keeps it.
  it('preserves a provider-declared rank on a feature block', () => {
    const { candidates } = filterCandidates([raw('https://news.example/y', 3, 7)], CTX);
    expect(candidates[0].serpPosition).toBe(7);
  });

  // D — rankless feature stays rankless.
  it('keeps a rankless feature rankless', () => {
    const { candidates } = filterCandidates([raw('https://f.example/z', 1, null)], CTX);
    expect(candidates[0].serpPosition).toBeNull();
  });

  // E / F / G — the array index must never become a rank, at any offset.
  it.each([[0], [5], [20]])('index %i does not become a SERP rank', (i) => {
    const rows = Array.from({ length: i + 1 }, (_, n) =>
      raw(`https://h${n}.example/p`, n + 1, null));
    const { candidates } = filterCandidates(rows, CTX);
    expect(candidates[i].serpPosition).toBeNull();
    expect(candidates[i].serpPosition).not.toBe(i + 1);
  });

  // H — zero must not be swallowed by a truthy fallback.
  it('does not let a zero rank fall through to an index', () => {
    const { candidates } = filterCandidates([raw('https://z.example/0', 0, null)], CTX);
    expect(candidates[0].rank).toBe(0);          // `??`, not `||`
    expect(candidates[0].serpPosition).toBeNull();
  });

  // I — an invalid provider value is not silently converted into an index.
  it('does not convert NaN into an array position', () => {
    const { candidates } = filterCandidates(
      [{ url: 'https://n.example/n', title: null, snippet: null, rank: 1, serpPosition: Number.NaN }],
      CTX,
    );
    expect(candidates[0].serpPosition === null || Number.isNaN(candidates[0].serpPosition)).toBe(true);
    expect(candidates[0].serpPosition).not.toBe(1);
  });

  // L — the narrative must not claim a rank it does not have.
  it('never narrates "search rank N" without an authoritative rank', () => {
    const { candidates } = filterCandidates(
      [raw('https://a.example/1', 1, null), raw('https://b.example/2', 2, 4)],
      CTX,
    );
    expect(candidates[0].discoveryReason).not.toMatch(/search rank/);
    expect(candidates[0].discoveryReason).toMatch(/discovery position 1/);
    expect(candidates[1].discoveryReason).toBe('independent host at search rank 4');
  });

  // The keyless HTML scrape declares no SERP rank of its own.
  it('keyless parsing records discovery order and no SERP rank', () => {
    const fixture = ['https://k1.example/a', 'https://k2.example/b']
      .map((u) => `<a href="/l/?uddg=${encodeURIComponent(u)}">x</a>`).join('');
    const rows = parseKeylessResults(fixture, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const [i, r] of rows.entries()) {
      expect(r.rank).toBe(i + 1);
      expect(r.serpPosition).toBeNull();
    }
  });
});

/**
 * The SERP bridge provider is the site that consumed the parser's `position`
 * and re-fabricated a rank from the array index. Exercised directly so that
 * reintroducing the fallback there cannot pass unnoticed.
 */
describe('3AH-144 — the SERP bridge provider does not invent a rank', () => {
  const ENV_KEY = 'SERPAPI_API_KEY';
  let hadKey: string | undefined;

  beforeAll(() => {
    hadKey = process.env[ENV_KEY];
    (process.env as Record<string, string | undefined>)[ENV_KEY] = 'fixture-key-not-a-real-credential';
  });
  afterAll(() => {
    (process.env as Record<string, string | undefined>)[ENV_KEY] = hadKey;
  });

  const withParserRows = (rows: { url: string; position: number | null }[]) => {
    jest.resetModules();
    jest.doMock('../../services/serpAcquisitionService', () => ({
      createConfiguredSerpApiProvider: async () => ({
        id: 'serpapi',
        async fetch() {
          return { results: rows.map((r) => ({ ...r, title: null })) };
        },
      }),
    }));
    return require('../../services/companyProfile/grounding/discovery/discoveryProviders')
      .createSerpBridgeProvider();
  };

  afterEach(() => { jest.dontMock('../../services/serpAcquisitionService'); jest.resetModules(); });

  it('carries an authoritative position through untouched', async () => {
    const provider = withParserRows([{ url: 'https://a.example/1', position: 4 }]);
    const rows = await provider.search('q', 10);
    expect(rows![0].serpPosition).toBe(4);
  });

  it('leaves a rankless row rankless instead of using its array index', async () => {
    const provider = withParserRows([
      { url: 'https://a.example/1', position: 1 },
      { url: 'https://b.example/2', position: null },
      { url: 'https://c.example/3', position: null },
    ]);
    const rows = await provider.search('q', 10);
    expect(rows![0].serpPosition).toBe(1);
    expect(rows![1].serpPosition).toBeNull();
    expect(rows![2].serpPosition).toBeNull();
    // the defect: index+1 would have made these 2 and 3
    expect(rows![1].serpPosition).not.toBe(2);
    expect(rows![2].serpPosition).not.toBe(3);
    // discovery ORDER is still recorded, and is not a rank
    expect(rows!.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
  });

  it('refuses a non-positive or non-finite provider position rather than indexing', async () => {
    const provider = withParserRows([
      { url: 'https://a.example/z', position: 0 },
      { url: 'https://b.example/n', position: Number.NaN },
      { url: 'https://c.example/neg', position: -3 },
    ]);
    const rows = await provider.search('q', 10);
    for (const r of rows!) expect(r.serpPosition).toBeNull();
  });
});

/**
 * discover() re-maps provider rows before filtering. That mapping also used a
 * truthy fallback, so a provider-supplied rank of 0 was replaced by an index.
 */
describe('3AH-144 — discover() does not index-fill a provider rank', () => {
  const fixture = (rows: RawSearchResult[]): DiscoveryProvider => ({
    id: 'keyless_web', isAvailable: () => true, async search() { return rows; },
  });

  it('keeps a provider-supplied rank of 0 instead of substituting the index', async () => {
    const res = await discover({
      companyName: 'Acme', companyDomain: null, field: 'about',
      queries: ['q'], asOf: '2026-09-20T00:00:00.000Z',
      provider: fixture([
        { url: 'https://a.example/zero', title: null, snippet: null, rank: 0, serpPosition: null },
      ]),
    });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].rank).toBe(0);
    expect(res.candidates[0].serpPosition).toBeNull();
    expect(res.candidates[0].discoveryReason).not.toMatch(/search rank/);
  });
});

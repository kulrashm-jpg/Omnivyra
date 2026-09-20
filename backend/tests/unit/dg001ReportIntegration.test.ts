/**
 * DG-001 — SERP consolidation, end to end into Report 1.
 *
 * WHAT THIS SUITE IS FOR. DG-001's earlier suite proved the parser. This one
 * proves the thing that actually matters to the product: that a SERP feature
 * travels from a provider response, through the ONE canonical client, into
 * Report 1's evidence, and out through the renderer — while the organic
 * ranking numbers a customer already sees do not move by a single position.
 *
 * The second half is the load-bearing half. This change touches the acquisition
 * path every Report 1 run uses, so "features appeared" is worth nothing next to
 * "and nothing else changed".
 *
 * SECRETS: all synthetic. The transport is replaced; no network, no credential,
 * no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));
jest.mock('../../services/providerCredentialResolver', () => ({
  resolveProviderCredential: jest.fn(async () => ({ value: 'synthetic-key', reason: null })),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: jest.fn(() => ({ allowed: true, reason: 'allowed' })),
  recordProviderUsage: jest.fn(async () => undefined),
}));

import { fetchCanonicalSerp, REPORT_SERP_PROVIDER } from '../../services/serp/canonicalSerpClient';
import { __parseProviderResultsForTest as parse } from '../../services/serpAcquisitionService';
import { buildSearchFeatures } from '../../services/snapshotReport/searchFeatureHelpers';
import { resolveProviderCredential } from '../../services/providerCredentialResolver';
import { authorizeProviderCall, recordProviderUsage } from '../../services/providers/providerCostGovernor';

/**
 * A realistic SerpAPI page-one response: ten organic results plus the feature
 * blocks that sit beside them.
 */
const SERPAPI_RESPONSE = {
  organic_results: Array.from({ length: 10 }, (_, i) => ({
    position: i + 1,
    link: `https://site${i + 1}.test/page`,
    title: `Result ${i + 1}`,
    snippet: `Snippet for result ${i + 1}`,
    displayed_link: `site${i + 1}.test › page`,
    ...(i === 2 ? { sitelinks: { inline: [{ title: 'Pricing', link: 'https://site3.test/pricing' }] } } : {}),
  })),
  related_questions: [
    { question: 'What is Northwind CRM?' },
    { question: 'How much does Northwind cost?' },
  ],
  knowledge_graph: { title: 'Northwind Ltd', type: 'Software company' },
  local_results: [{ title: 'Northwind Office', link: 'https://northwind.test/contact' }],
  inline_videos: [{ title: 'Northwind demo', link: 'https://video.test/demo' }],
  top_stories: [{ title: 'Northwind raises Series B', link: 'https://news.test/northwind' }],
  shopping_results: [{ title: 'Northwind Pro', link: 'https://shop.test/pro' }],
  ads: [{ title: 'Try RivalCRM', link: 'https://rival.test/ad' }],
};

const transportReturning = (body: unknown, ok = true, status = 200) =>
  (async () => ({ ok, status, json: async () => body })) as never;

const run = (body: unknown = SERPAPI_RESPONSE, depth = 10) =>
  fetchCanonicalSerp(
    { query: 'northwind crm', geography: null, depth, operation: 'search' },
    parse,
    { transport: transportReturning(body) },
  );

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears calls but NOT implementations, so a test that
  // simulates a missing credential would otherwise poison every test after it.
  (resolveProviderCredential as jest.Mock).mockResolvedValue({ value: 'synthetic-key', reason: null });
  (authorizeProviderCall as jest.Mock).mockReturnValue({ allowed: true, reason: 'allowed' });
  (recordProviderUsage as jest.Mock).mockResolvedValue(undefined);
});

// ── the canonical client ────────────────────────────────────────────────────

describe('DG-001 — one governed client replaces three provider calls', () => {
  it('runs the governance chain in order: budget → governor → credential → call', async () => {
    const order: string[] = [];
    (authorizeProviderCall as jest.Mock).mockImplementation(() => {
      order.push('governor'); return { allowed: true, reason: 'allowed' };
    });
    (resolveProviderCredential as jest.Mock).mockImplementation(async () => {
      order.push('credential'); return { value: 'synthetic-key', reason: null };
    });
    await run();
    // No scan is active in this suite, so the budget layer is a no-op; the two
    // layers that DO act must act in this order.
    expect(order).toEqual(['governor', 'credential']);
  });

  it('records the call in the provider ledger exactly once', async () => {
    await run();
    expect(recordProviderUsage).toHaveBeenCalledTimes(1);
    expect((recordProviderUsage as jest.Mock).mock.calls[0][0]).toMatchObject({
      providerId: 'serpapi', units: 1,
    });
  });

  it('a governor refusal makes NO provider call and records NO usage', async () => {
    (authorizeProviderCall as jest.Mock).mockReturnValue({ allowed: false, reason: 'kill_switch' });
    let transportCalled = 0;
    const out = await fetchCanonicalSerp(
      { query: 'q', depth: 10, operation: 'search' },
      parse,
      { transport: (async () => { transportCalled += 1; return { ok: true, status: 200, json: async () => ({}) }; }) as never },
    );
    expect(transportCalled).toBe(0);
    expect(recordProviderUsage).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'unavailable', refusedBy: 'provider_governor', rows: [] });
    // The credential is never even resolved — the kill switch precedes that I/O.
    expect(resolveProviderCredential).not.toHaveBeenCalled();
  });

  it('a missing credential makes NO provider call and is reported as unavailable', async () => {
    (resolveProviderCredential as jest.Mock).mockResolvedValue({ value: null, reason: 'no credential configured' });
    let transportCalled = 0;
    const out = await fetchCanonicalSerp(
      { query: 'q', depth: 10, operation: 'search' },
      parse,
      { transport: (async () => { transportCalled += 1; return { ok: true, status: 200, json: async () => ({}) }; }) as never },
    );
    expect(transportCalled).toBe(0);
    expect(recordProviderUsage).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'unavailable', refusedBy: 'credential' });
  });

  it('a provider that answers with an error is FAILED, not unavailable', async () => {
    // "We could not ask" and "we asked and it broke" are different findings and
    // the report states them differently.
    const out = await fetchCanonicalSerp(
      { query: 'q', depth: 10, operation: 'search' },
      parse,
      { transport: transportReturning({}, false, 503) },
    );
    expect(out.status).toBe('failed');
    expect(out.refusedBy).toBeNull();
  });

  it('is pinned to SerpAPI and reports the provider it used', async () => {
    const out = await run();
    expect(REPORT_SERP_PROVIDER).toBe('serpapi');
    expect(out.provider).toBe('serpapi');
    expect(resolveProviderCredential).toHaveBeenCalledWith('serpapi');
  });

  it('requests the caller\'s depth verbatim, and never substitutes one', async () => {
    const seen: string[] = [];
    const capture = (async (url: string) => {
      seen.push(url); return { ok: true, status: 200, json: async () => SERPAPI_RESPONSE };
    }) as never;
    for (const depth of [10, 5, 50]) {
      await fetchCanonicalSerp({ query: 'q', depth, operation: 'search' }, parse, { transport: capture });
    }
    expect(seen.map((u) => new URL(u).searchParams.get('num'))).toEqual(['10', '5', '50']);
  });
});

// ── organic vs feature separation ───────────────────────────────────────────

describe('DG-001 — features are observed without touching organic ranking', () => {
  it('parses all ten organic results with their provider ranks intact', async () => {
    const out = await run();
    const organic = out.rows.filter((r) => (r.result_type ?? 'organic') === 'organic');
    expect(organic).toHaveLength(10);
    expect(organic.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(organic[0]).toMatchObject({
      url: 'https://site1.test/page', domain: 'site1.test',
      title: 'Result 1', snippet: 'Snippet for result 1',
    });
  });

  it('observes every feature block the response carried', async () => {
    const out = await run();
    const types = new Set(out.rows.map((r) => r.result_type));
    for (const expected of [
      'organic', 'people_also_ask', 'knowledge_panel', 'sitelink',
      'local', 'video', 'news', 'shopping', 'paid',
    ]) {
      expect(types).toContain(expected);
    }
  });

  it('gives NO feature an organic rank, and invents no link for the unlinked ones', async () => {
    const out = await run();
    for (const row of out.rows.filter((r) => r.result_type === 'people_also_ask' || r.result_type === 'knowledge_panel')) {
      expect(row.position).toBeNull();
      expect(row.url).toBeNull();
      expect(row.domain).toBeNull();
      expect(row.title).toBeTruthy();
    }
  });

  /**
   * REGRESSION — the fabricated feature rank.
   *
   * The test above checked only the two UNRANKED feature types, so it passed
   * while the five RANKED ones (local, video, news, shopping, paid) were each
   * being stamped with an organic-scale position. The cause: this client calls
   * `parse([...organic, ...siblings])`, and the parser fell back to the 1-based
   * ARRAY INDEX whenever an entry declared no rank. For an appended feature
   * entry that index is an offset into a concatenation — with these ten organic
   * results the local pack became "position 14" and the ad "position 18" — and
   * nothing on the page held those ranks. Those numbers are persisted, take
   * part in the persistence conflict key, and drive the top-ten counts and
   * threat scores in externalCompetitiveIntelligenceService.
   *
   * No feature block in this fixture declares a rank, which is the shape the
   * defect needs: absence must read as absence.
   */
  it('gives a RANKED feature no rank either, when the provider declared none', async () => {
    const out = await run();
    const ranked = out.rows.filter((r) =>
      ['local', 'video', 'news', 'shopping', 'paid'].includes(String(r.result_type)));

    // Still observed — withholding a rank must not withhold the observation.
    expect(ranked.map((r) => String(r.result_type)).sort())
      .toEqual(['local', 'news', 'paid', 'shopping', 'video']);

    for (const row of ranked) {
      expect(row.position).toBeNull();
      expect(row.title).toBeTruthy();
    }
    // Nothing outside the ten organic results holds an organic-scale rank.
    const featurePositions = out.rows
      .filter((r) => (r.result_type ?? 'organic') !== 'organic')
      .map((r) => r.position);
    expect(featurePositions).toEqual(featurePositions.map(() => null));
  });

  it('a feature that DOES declare a rank keeps the one it declared', async () => {
    // The fix removes a fabricated rank; it must not discard a real one.
    const out = await run({
      organic_results: SERPAPI_RESPONSE.organic_results,
      top_stories: [{ title: 'Series B', link: 'https://news.test/northwind', position: 3 }],
    });
    expect(out.rows.find((r) => r.result_type === 'news')?.position).toBe(3);
  });

  it('the organic rows are byte-identical whether or not features are present', async () => {
    // THE regression that matters: adding feature capture must not perturb a
    // single organic row, because those rows are what search visibility and
    // competitor discovery both read.
    const withFeatures = await run(SERPAPI_RESPONSE);
    const withoutFeatures = await run({ organic_results: SERPAPI_RESPONSE.organic_results });
    const organicOnly = (rows: typeof withFeatures.rows) =>
      rows.filter((r) => (r.result_type ?? 'organic') === 'organic');
    expect(organicOnly(withFeatures.rows)).toEqual(organicOnly(withoutFeatures.rows));
  });

  it('the top-five domain window competitor discovery reads is unchanged', async () => {
    const out = await run();
    const organic = out.rows.filter((r) => (r.result_type ?? 'organic') === 'organic');
    // Discovery slices the first five organic rows; features must not displace
    // any of them, whatever order the response listed the blocks in.
    const topFive = organic.slice(0, 5).map((r) => r.domain);
    expect(topFive).toEqual(['site1.test', 'site2.test', 'site3.test', 'site4.test', 'site5.test']);
  });
});

// ── the Report 1 surface ────────────────────────────────────────────────────

describe('DG-001 — the Report 1 feature surface', () => {
  const observation = (over: Record<string, unknown> = {}) => ({
    query: 'northwind crm', result_type: 'people_also_ask' as const,
    position: null, url: null, domain: null, title: 'What is Northwind?',
    ownedByCompany: null, ...over,
  });

  it('counts deterministically per type', () => {
    const features = buildSearchFeatures([
      observation(),
      observation({ title: 'How much?' }),
      observation({ result_type: 'knowledge_panel', title: 'Northwind Ltd' }),
    ] as never, 3, 'ok');
    expect(features.state).toBe('measured');
    expect(features.counts).toEqual({ people_also_ask: 2, knowledge_panel: 1 });
  });

  it('distinguishes "we looked and found none" from "we could not look"', () => {
    // A real finding, and not the same as an unavailable acquisition.
    expect(buildSearchFeatures([], 4, 'ok').state).toBe('insufficient_signal');
    expect(buildSearchFeatures([], 0, 'unavailable').state).toBe('unavailable');
    expect(buildSearchFeatures([], 0, 'failed').state).toBe('failed');
  });

  it('keeps ownership three-valued — unknown is never false', () => {
    const features = buildSearchFeatures([
      observation({ ownedByCompany: null }),
      observation({ result_type: 'local', url: 'https://northwind.test/x', domain: 'northwind.test', ownedByCompany: true }),
      observation({ result_type: 'paid', url: 'https://rival.test/ad', domain: 'rival.test', ownedByCompany: false }),
    ] as never, 3, 'ok');
    const owned = features.observed.map((o) => o.ownedByCompany);
    expect(owned).toEqual([null, true, false]);
  });

  it('carries no score, percentage, opportunity or recommendation', () => {
    // DG-001 establishes evidence; DG-007 interprets it. If an interpretation
    // field appears here, that boundary has been crossed.
    const features = buildSearchFeatures([observation()] as never, 1, 'ok');
    const keys = new Set(Object.keys(features));
    expect(keys).toEqual(new Set(['state', 'observed', 'counts']));
    for (const forbidden of ['score', 'readiness', 'coverage', 'opportunity', 'recommendation', 'gap']) {
      expect(JSON.stringify(features).toLowerCase()).not.toContain(forbidden);
    }
  });
});

// ── the renderer ────────────────────────────────────────────────────────────

describe('DG-001 — Report 1 renders the evidence, and older reports still render', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { renderSearchVisibility } = require('../../services/intelligence/exportRendererReport1');

  const searchSurface = (over: Record<string, unknown> = {}) => ({
    state: 'measured', provider: 'serpapi', source: 'serp', provenance: 'PUBLIC_OBSERVED',
    observedAt: '2026-09-08T00:00:00.000Z', queriesRun: 3, queriesRanked: 1, bestPosition: 4,
    observations: [{ query: 'northwind crm', position: 4, url: 'https://northwind.test/', title: 'Northwind', snippet: 'CRM', resultCount: 10 }],
    requestsMade: 3, reason: null, ...over,
  });

  const render = (search: Record<string, unknown>) =>
    renderSearchVisibility({ report1: { search_visibility: search } }, 'Evidence');

  it('renders a report composed BEFORE DG-001, which has no features at all', () => {
    const html = render(searchSurface());                       // no `features` key
    expect(html).toContain('Public Search Visibility');
    expect(html).toContain('Position 4');
    expect(html).not.toContain('Search features observed');
  });

  it('renders the observed features, labelled for a reader', () => {
    const html = render(searchSurface({
      features: {
        state: 'measured',
        counts: { people_also_ask: 2, knowledge_panel: 1 },
        observed: [
          { query: 'northwind crm', result_type: 'people_also_ask', position: null, url: null, domain: null, title: 'What is Northwind?', ownedByCompany: null },
          { query: 'northwind crm', result_type: 'knowledge_panel', position: null, url: null, domain: null, title: 'Northwind Ltd', ownedByCompany: null },
        ],
      },
    }));
    expect(html).toContain('Search features observed');
    expect(html).toContain('People Also Ask');
    expect(html).toContain('Knowledge panel');
    expect(html).toContain('What is Northwind?');
    // The organic presentation is untouched.
    expect(html).toContain('Position 4');
  });

  it('says so plainly when the queries ran and returned no features', () => {
    const html = render(searchSurface({ features: { state: 'insufficient_signal', counts: {}, observed: [] } }));
    expect(html).toContain('returned no answer boxes');
    expect(html).not.toContain('Search features observed');
  });

  it('dumps no raw provider payload into the report', () => {
    const html = render(searchSurface({
      features: {
        state: 'measured', counts: { paid: 1 },
        observed: [{ query: 'q', result_type: 'paid', position: 1, url: 'https://rival.test/ad', title: 'Try RivalCRM', domain: 'rival.test', ownedByCompany: false }],
      },
    }));
    for (const providerShape of ['organic_results', 'related_questions', 'knowledge_graph', 'api_key', 'serpapi.com']) {
      expect(html).not.toContain(providerShape);
    }
  });
});

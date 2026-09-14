/**
 * CPG-006 — public-web discovery: query strategy, filtering, and the
 * discovery→retrieval separation.
 *
 * FIXTURE TESTS. No network. Providers and fetchers are injected. Fixture HTML
 * and fixture search results are hand-written and are never presented as
 * discovered evidence.
 */

import {
  discover, filterCandidates, canonicalizeUrl, isRejectedHost, discoveryUnavailable,
  DISCOVERY_LIMITS, type DiscoveryProvider, type RawSearchResult,
} from '../../services/companyProfile/grounding/discovery/webDiscovery';
import {
  buildQueryPlan, isDiscoverable, NON_DISCOVERABLE_FIELDS,
} from '../../services/companyProfile/grounding/discovery/queryStrategy';
import {
  parseKeylessResults, selectDiscoveryProvider, serpCredentialPresent, KEYLESS_PROVIDER_CAVEAT,
} from '../../services/companyProfile/grounding/discovery/discoveryProviders';
import {
  createDiscoveredWebSource, type DiscoveredRunTrace,
} from '../../services/companyProfile/grounding/acquisition/discoveredSource';
import type { AcquisitionContext, EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const DOMAIN = 'cloudflare.com';
const KNOWN: EntitySignals = {
  companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null,
  location: null, leadership: [], registryId: null,
};

const fixtureProvider = (rows: RawSearchResult[], available = true): DiscoveryProvider => ({
  id: 'keyless_web', isAvailable: () => available, async search() { return rows; },
});

const html = (desc: string) =>
  `<html><head><title>Publisher headline</title><meta name="description" content="${desc}"/></head><body></body></html>`;

const fixtureFetcher = (pages: Record<string, { status?: number; body?: string }>): EvidenceFetcher =>
  async (url) => {
    const p = pages[url];
    if (!p) return { ok: false, status: 404, url, text: '' };
    const status = p.status ?? 200;
    return { ok: status >= 200 && status < 300, status, url, text: p.body ?? '' };
  };

const ctx = (fetcher: EvidenceFetcher): AcquisitionContext => ({
  companyId: 'c1', knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher,
});

describe('CPG-006 (1) field-specific query construction', () => {
  it('builds different queries per field — never just the company name', () => {
    const ceo = buildQueryPlan('Cloudflare', 'ceo').queries;
    const rev = buildQueryPlan('Cloudflare', 'revenue').queries;
    const prod = buildQueryPlan('Cloudflare', 'products_services').queries;
    expect(ceo).toEqual(['Cloudflare CEO', 'Cloudflare leadership team']);
    expect(rev).toEqual(['Cloudflare annual revenue', 'Cloudflare financial results annual report']);
    expect(prod[0]).toContain('products');
    expect(new Set([...ceo, ...rev, ...prod]).size).toBe(6); // all distinct
    for (const q of [...ceo, ...rev, ...prod]) expect(q).not.toBe('Cloudflare');
  });

  it('covers funding and founded_year per §5', () => {
    expect(buildQueryPlan('Stripe', 'funding').queries[0]).toMatch(/funding|raised/i);
    expect(buildQueryPlan('Stripe', 'founded_year').queries[0]).toMatch(/founded/i);
  });

  it('REFUSES discovery for synthesis fields rather than searching for them', () => {
    for (const f of ['ideal_customer_profile', 'brand_voice', 'unique_value', 'competitive_advantages']) {
      const plan = buildQueryPlan('Cloudflare', f);
      expect(plan.queries).toHaveLength(0);
      expect(plan.refusedReason).toMatch(/synthesis/i);
      expect(isDiscoverable(f)).toBe(false);
      expect(NON_DISCOVERABLE_FIELDS.has(f)).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(buildQueryPlan('Cloudflare', 'ceo')).toEqual(buildQueryPlan('Cloudflare', 'ceo'));
  });
});

describe('CPG-006 (2) URL validation and candidate filtering', () => {
  it('rejects malformed, non-http and private addresses', () => {
    for (const bad of ['not a url', 'ftp://x.example/a', 'file:///etc/passwd',
      'http://127.0.0.1/x', 'http://localhost/x', 'http://192.168.1.5/x', 'http://169.254.1.1/x']) {
      expect(canonicalizeUrl(bad)).toBeNull();
    }
  });

  it('rejects search-engine and social hosts', () => {
    for (const h of ['google.com', 'bing.com', 'duckduckgo.com', 'linkedin.com', 'facebook.com', 'reddit.com']) {
      expect(isRejectedHost(h)).toBe(true);
    }
    expect(isRejectedHost('inc42.com')).toBe(false);
  });

  it('canonicalizes away tracking params and trailing slashes', () => {
    const a = canonicalizeUrl('https://www.example.com/a/?utm_source=x&gclid=y')!;
    const b = canonicalizeUrl('https://example.com/a')!;
    expect(a.canonical).toBe(b.canonical);
    expect(a.host).toBe('example.com');
  });

  it('(§10) suppresses duplicate URLs and duplicate hosts', () => {
    const { candidates, rejected } = filterCandidates([
      { url: 'https://inc42.com/a', rank: 1 },
      { url: 'https://inc42.com/a?utm_source=x', rank: 2 },
      { url: 'https://inc42.com/b', rank: 3 },
      { url: 'https://yourstory.com/c', rank: 4 },
    ], { query: 'q', provider: 'keyless_web', retrievedAt: ASOF, companyDomain: DOMAIN, limit: 5 });
    expect(candidates.map((c) => c.host)).toEqual(['inc42.com', 'yourstory.com']);
    expect(rejected.some((r) => /duplicate canonical/.test(r.reason))).toBe(true);
    expect(rejected.some((r) => /duplicate host/.test(r.reason))).toBe(true);
  });

  it('marks first-party vs independent in the discovery reason', () => {
    const { candidates } = filterCandidates([
      { url: `https://${DOMAIN}/about`, rank: 1 }, { url: 'https://inc42.com/x', rank: 2 },
    ], { query: 'q', provider: 'keyless_web', retrievedAt: ASOF, companyDomain: DOMAIN, limit: 5 });
    expect(candidates[0].discoveryReason).toMatch(/first-party/);
    expect(candidates[1].discoveryReason).toMatch(/independent/);
  });
});

describe('CPG-006 (3) provider failure and no-credential behaviour', () => {
  it('an unavailable provider yields DISCOVERY_UNAVAILABLE, not empty success', async () => {
    const r = await discover({
      companyName: 'Cloudflare', companyDomain: DOMAIN, field: 'ceo',
      queries: ['Cloudflare CEO'], provider: fixtureProvider([], false), asOf: ASOF,
    });
    expect(r.status).toBe('DISCOVERY_UNAVAILABLE');
    expect(r.unavailableReason).toMatch(/no credential|not configured/i);
    expect(r.candidates).toHaveLength(0);
  });

  it('a throwing provider is reported, never silently substituted', async () => {
    const boom: DiscoveryProvider = { id: 'serp_api', isAvailable: () => true, async search() { throw new Error('quota exceeded'); } };
    const r = await discover({ companyName: 'X', companyDomain: null, field: 'ceo', queries: ['X CEO'], provider: boom, asOf: ASOF });
    expect(r.status).toBe('DISCOVERY_UNAVAILABLE');
    expect(r.unavailableReason).toMatch(/quota exceeded/);
  });

  it('zero results is no_results, distinct from unavailable', async () => {
    const r = await discover({ companyName: 'X', companyDomain: null, field: 'ceo', queries: ['X CEO'], provider: fixtureProvider([]), asOf: ASOF });
    expect(r.status).toBe('no_results');
    expect(r.unavailableReason).toBeNull();
  });

  it('selection reports no-credential honestly and never fabricates a provider', () => {
    const strict = selectDiscoveryProvider({ allowKeyless: false });
    if (!serpCredentialPresent()) {
      expect(strict.provider).toBeNull();
      expect(strict.reason).toMatch(/implemented_no_credential/);
    }
    const keyless = selectDiscoveryProvider({ allowKeyless: true });
    expect(keyless.provider).not.toBeNull();
    if (!serpCredentialPresent()) expect(keyless.reason).toContain(KEYLESS_PROVIDER_CAVEAT);
  });

  it('discoveryUnavailable carries provider, field, company and timestamp (§15)', () => {
    const u = discoveryUnavailable('Cloudflare', 'revenue', 'serp_api', 'no credential', ASOF);
    expect(u).toMatchObject({ status: 'DISCOVERY_UNAVAILABLE', companyName: 'Cloudflare', field: 'revenue', provider: 'serp_api', queriedAt: ASOF });
  });
});

describe('CPG-006 (4) keyless result parsing is bounded', () => {
  it('extracts, de-duplicates and bounds result links', () => {
    const fixture = ['https://a.example/1', 'https://a.example/1', 'https://b.example/2', 'javascript:alert(1)']
      .map((u) => `<a href="/l/?uddg=${encodeURIComponent(u)}">x</a>`).join('');
    const rows = parseKeylessResults(fixture, 10);
    expect(rows.map((r) => r.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect(parseKeylessResults(fixture, 1)).toHaveLength(1);
  });
});

describe('CPG-006 (5) discovery → retrieval separation — THE core rule', () => {
  const trace: DiscoveredRunTrace[] = [];
  beforeEach(() => { trace.length = 0; });

  it('a snippet NEVER becomes a claim — only a fetched document does', async () => {
    const src = createDiscoveredWebSource({
      provider: fixtureProvider([{ url: 'https://inc42.com/story', rank: 1, title: 'HEADLINE', snippet: 'SNIPPET TEXT' }]),
      fields: ['funding'], trace,
    });
    // The candidate URL is NOT fetchable -> no claims at all.
    const res = await src.acquire(ctx(fixtureFetcher({})));
    expect(res.state).toBe('unavailable');
    expect(JSON.stringify(trace)).not.toContain('claimsProduced":1');
    // and the snippet text appears nowhere as a claim value
    expect(JSON.stringify(res)).not.toContain('SNIPPET TEXT');
  });

  it('a fetched document DOES become evidence, with discovery provenance', async () => {
    const src = createDiscoveredWebSource({
      provider: fixtureProvider([{ url: 'https://inc42.com/story', rank: 1, snippet: 'SNIPPET TEXT' }]),
      fields: ['funding'], trace,
    });
    const res = await src.acquire(ctx(fixtureFetcher({
      'https://inc42.com/story': { body: html('Cloudflare raised a Series E round in 2019.') },
    })));
    expect(res.state).toBe('retrieved');
    if (res.state !== 'retrieved') return;
    expect(res.claims[0].sourceUrl).toBe('https://inc42.com/story');
    expect(res.claims[0].value).toContain('Series E');
    expect(res.claims[0].field).toBe('funding_source_statement');
    // provenance retained
    expect(trace[0].provenance[0]).toMatchObject({ discoveryQuery: expect.any(String), discoveryRank: 1, originalUrl: 'https://inc42.com/story' });
  });

  it('a third-party document never claims the company domain as its entity', async () => {
    const src = createDiscoveredWebSource({
      provider: fixtureProvider([{ url: 'https://inc42.com/story', rank: 1 }]), fields: ['funding'], trace,
    });
    const res = await src.acquire(ctx(fixtureFetcher({ 'https://inc42.com/story': { body: html('Something about funding.') } })));
    if (res.state !== 'retrieved') throw new Error('expected retrieved');
    expect(res.claims[0].entitySignals.domain).toBeNull();
  });
});

describe('CPG-006 (6) search rank NEVER overrides field authority — §9/§12', () => {
  const trace: DiscoveredRunTrace[] = [];
  beforeEach(() => { trace.length = 0; });

  it('the #1-ranked company marketing page is refused for REVENUE', async () => {
    const src = createDiscoveredWebSource({
      provider: fixtureProvider([
        { url: `https://${DOMAIN}/about`, rank: 1 },      // rank #1, but neverFor revenue
        { url: 'https://stockanalysis.com/x', rank: 2 },  // independent, permitted
      ]),
      fields: ['revenue'], trace,
    });
    const fetcher = jest.fn(fixtureFetcher({
      'https://stockanalysis.com/x': { body: html('Cloudflare annual revenue for 2024 was reported at $1.67B.') },
    }));
    const res = await src.acquire(ctx(fetcher));

    const t = trace.find((x) => x.field === 'revenue')!;
    expect(t.skippedBeforeFetch[0].url).toBe(`https://${DOMAIN}/about`);
    expect(t.skippedBeforeFetch[0].reason).toMatch(/neverFor "revenue"/);
    expect(t.skippedBeforeFetch[0].reason).toMatch(/search rank 1 does not override/);
    // the forbidden URL was never even fetched
    expect(fetcher).not.toHaveBeenCalledWith(`https://${DOMAIN}/about`, expect.anything());
    expect(res.state).toBe('retrieved');
  });

  it('the same marketing page IS permitted for products_services', async () => {
    const src = createDiscoveredWebSource({
      provider: fixtureProvider([{ url: `https://${DOMAIN}/about`, rank: 1 }]), fields: ['products_services'], trace,
    });
    await src.acquire(ctx(fixtureFetcher({ [`https://${DOMAIN}/about`]: { body: html('Our products include CDN and Zero Trust.') } })));
    const t = trace.find((x) => x.field === 'products_services')!;
    expect(t.skippedBeforeFetch).toHaveLength(0);
  });

  it('synthesis fields are refused before any query is issued', async () => {
    const provider = fixtureProvider([{ url: 'https://x.example/a', rank: 1 }]);
    const spy = jest.spyOn(provider, 'search');
    const src = createDiscoveredWebSource({ provider, fields: ['ideal_customer_profile'], trace });
    await src.acquire(ctx(fixtureFetcher({})));
    expect(spy).not.toHaveBeenCalled();
    expect(trace[0].refusedReason).toMatch(/synthesis/i);
  });
});

describe('CPG-006 (7) bounded, non-recursive (§16)', () => {
  it('declares conservative limits', () => {
    expect(DISCOVERY_LIMITS.maxQueriesPerField).toBeLessThanOrEqual(2);
    expect(DISCOVERY_LIMITS.maxRetrievalsPerField).toBeLessThanOrEqual(3);
    expect(DISCOVERY_LIMITS.maxCandidatesPerField).toBeLessThanOrEqual(5);
  });

  it('never fetches more than the retrieval bound per field', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `https://site${i}.example/a`, rank: i + 1 }));
    const pages: Record<string, { body: string }> = {};
    for (const m of many) pages[m.url] = { body: html('Some statement about funding.') };
    const fetcher = jest.fn(fixtureFetcher(pages));
    const trace: DiscoveredRunTrace[] = [];
    await createDiscoveredWebSource({ provider: fixtureProvider(many), fields: ['funding'], trace }).acquire(ctx(fetcher));
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(DISCOVERY_LIMITS.maxRetrievalsPerField);
  });
});

// ── CPG-006 regression: subdomain leak of never-fetch hosts ────────────────
describe('CPG-006 regression — never-fetch hosts must match subdomains', () => {
  it('rejects LinkedIn country/regional subdomains (live-found defect)', () => {
    // A live Infosys CEO search surfaced in.linkedin.com and the first version
    // FETCHED it, violating CPG-002 §8.
    for (const h of ['linkedin.com', 'www.linkedin.com', 'in.linkedin.com', 'uk.linkedin.com', 'm.linkedin.com']) {
      expect(isRejectedHost(h)).toBe(true);
    }
  });

  it('rejects subdomains of every other never-fetch host', () => {
    for (const h of ['m.facebook.com', 'business.instagram.com', 'mobile.twitter.com', 'm.youtube.com', 'old.reddit.com']) {
      expect(isRejectedHost(h)).toBe(true);
    }
  });

  it('rejects search engines on any TLD', () => {
    for (const h of ['google.de', 'www.google.co.uk', 'bing.co.uk', 'duckduckgo.com']) {
      expect(isRejectedHost(h)).toBe(true);
    }
  });

  it('still permits legitimate independent publishers', () => {
    for (const h of ['inc42.com', 'stockanalysis.com', 'forbes.com', 'economictimes.indiatimes.com', 'tracxn.com']) {
      expect(isRejectedHost(h)).toBe(false);
    }
  });

  it('a LinkedIn candidate is filtered out before any fetch', () => {
    const { candidates, rejected } = filterCandidates(
      [{ url: 'https://in.linkedin.com/in/salilparekh', rank: 1 }, { url: 'https://forbes.com/x', rank: 2 }],
      { query: 'q', provider: 'keyless_web', retrievedAt: ASOF, companyDomain: DOMAIN, limit: 5 },
    );
    expect(candidates.map((c) => c.host)).toEqual(['forbes.com']);
    expect(rejected[0].reason).toMatch(/disallowed host: in\.linkedin\.com/);
  });
});

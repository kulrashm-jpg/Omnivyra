/**
 * Bing Webmaster Tools (backlinks + Bing search performance) and company-registry evidence in the
 * Digital Snapshot research pack: provider outcomes, ledger families and diagnostics.
 * All HTTP is fixture data passed through injected fetchers; no network, no keys.
 */
import { bingDate, fetchBingWebmaster, matchVerifiedSite } from '../../services/intelligence/publicResearch/bingWebmaster';
import { collectRegistryEvidence, jurisdictionsFrom } from '../../services/intelligence/publicResearch/registryEvidence';
import { buildDiagnostics, plainGap } from '../../services/intelligence/dossierV2/diagnostics';
import { buildLedger } from '../../services/intelligence/dossierV2/ledger';
import { parseResearchPack } from '../../services/intelligence/dossierV2/research';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';

const NOW = () => new Date('2026-10-26T09:00:00Z');
// Fixture key: not a real credential; only its absence from every detail string is asserted.
const KEY = ['fixture', 'bing', 'key', '0123'].join('-');

type Route = (url: URL) => { status: number; body: unknown } | undefined;
function bingFetch(route: Route, log: string[] = []): typeof fetch {
  return (async (input: any) => {
    const url = new URL(String(input));
    log.push(url.pathname.split('/').pop()!);
    const r = route(url) ?? { status: 404, body: { Message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
const SITES = { status: 200, body: { d: [{ Url: 'https://acme.test/', IsVerified: true }, { Url: 'https://other.test/', IsVerified: true }] } };
const method = (u: URL) => u.pathname.split('/').pop();

describe('Bing Webmaster Tools: owner-authorised links and search performance', () => {
  it('parses Bing dates and picks the verified site for the domain (https root preferred)', () => {
    expect(bingDate('/Date(1761436800000-0700)/')).toBe('2025-10-26');
    expect(bingDate('nonsense')).toBeNull();
    const sites = [{ Url: 'http://www.acme.test/', IsVerified: true }, { Url: 'https://acme.test/blog/', IsVerified: true }, { Url: 'https://acme.test/', IsVerified: true }, { Url: 'https://acme.test/x', IsVerified: false }];
    expect(matchVerifiedSite(sites, 'www.acme.test')).toBe('https://acme.test/');
    expect(matchVerifiedSite([{ Url: 'https://acme.test/', IsVerified: false }], 'acme.test')).toBeNull();
  });

  it('no key → not_configured, and no request is made', async () => {
    const log: string[] = [];
    const r = await fetchBingWebmaster('acme.test', null, { fetchImpl: bingFetch(() => SITES, log), now: NOW });
    expect(r).toMatchObject({ status: 'not_configured', links: null, search: null });
    expect(log).toEqual([]);
  });

  it('a site the account cannot read → site_not_authorised (unknown, never "no links")', async () => {
    const r = await fetchBingWebmaster('elsewhere.test', KEY, { fetchImpl: bingFetch(() => SITES), now: NOW });
    expect(r.status).toBe('site_not_authorised');
    expect(r.links).toBeNull();
  });

  it('measured: link pages summed across result pages, queries aggregated by impressions', async () => {
    const log: string[] = [];
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, fetchImpl: bingFetch((u) => {
      if (method(u) === 'GetUserSites') return SITES;
      if (method(u) === 'GetLinkCounts') {
        expect(u.searchParams.get('siteUrl')).toBe('https://acme.test/');
        return u.searchParams.get('page') === '0'
          ? { status: 200, body: { d: { Links: [{ Url: 'https://acme.test/', Count: 12 }], TotalPages: 2 } } }
          : { status: 200, body: { d: { Links: [{ Url: 'https://acme.test/pricing', Count: 30 }], TotalPages: 2 } } };
      }
      if (method(u) === 'GetQueryStats') return { status: 200, body: { d: [
        { Query: 'acme crm', Impressions: 40, Clicks: 4, AvgImpressionPosition: 3, AvgClickPosition: 2, Date: '/Date(1760832000000-0700)/' },
        { Query: 'acme crm', Impressions: 10, Clicks: 1, AvgImpressionPosition: 5, AvgClickPosition: 0, Date: '/Date(1761436800000-0700)/' },
        { Query: 'crm for small teams', Impressions: 90, Clicks: 0, AvgImpressionPosition: 18, AvgClickPosition: 0, Date: '/Date(1761436800000-0700)/' },
      ] } };
      return undefined;
    }, log) });
    expect(r.status).toBe('measured');
    expect(r.links).toEqual({ pages: [{ url: 'https://acme.test/pricing', count: 30 }, { url: 'https://acme.test/', count: 12 }], total: 42, complete: true });
    expect(r.search!.queries.map((q) => q.query)).toEqual(['crm for small teams', 'acme crm']);
    expect(r.search!.queries[1]).toMatchObject({ impressions: 50, clicks: 5, avgImpressionPosition: 4, avgClickPosition: 2 });
    expect(r.search).toMatchObject({ impressions: 140, clicks: 5, from: '2025-10-19', to: '2025-10-26' });
    expect(log.slice(0, 4)).toEqual(['GetUserSites', 'GetLinkCounts', 'GetLinkCounts', 'GetQueryStats']);
    // Optional reports (crawl, link detail) answered 404 here: recorded as partial, core data kept.
    expect(log.slice(4).sort()).toEqual(['GetCrawlStats', 'GetUrlLinks', 'GetUrlLinks']);
    expect(r.partial).toHaveLength(3);
    expect(r.crawl).toBeNull();
    expect(r.search!.stale).toBe(true); // newest row 2025-10-26, checked 2026-10-26
    expect(r.provenance).toMatchObject({ source: 'Bing Webmaster Tools API', methods: expect.arrayContaining(['GetLinkCounts', 'GetQueryStats', 'GetCrawlStats', 'GetUrlLinks']) });
    expect(Object.keys(r.provenance!.definitions)).toEqual(['inbound_links', 'link_sample', 'search_queries', 'crawl']);
  });

  it('crawl stats (newest daily row) and a link-detail sample, with freshness', async () => {
    const day = (iso: string) => `/Date(${Date.parse(iso)}-0700)/`;
    const seen: URL[] = [];
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, fetchImpl: bingFetch((u) => {
      seen.push(u);
      switch (method(u)) {
        case 'GetUserSites': return SITES;
        case 'GetLinkCounts': return { status: 200, body: { d: { Links: [{ Url: 'https://acme.test/', Count: 5 }, { Url: 'https://acme.test/none', Count: 0 }], TotalPages: 1 } } };
        case 'GetQueryStats': return { status: 200, body: { d: [{ Query: 'acme', Impressions: 3, Clicks: 1, AvgImpressionPosition: 2, AvgClickPosition: 2, Date: day('2026-10-19T00:00:00Z') }] } };
        case 'GetCrawlStats': return { status: 200, body: { d: [
          { Date: day('2026-10-24T00:00:00Z'), InIndex: 40, InLinks: 9, CrawledPages: 12, CrawlErrors: 1, BlockedByRobotsTxt: 0, Code4xx: 1, Code5xx: 0 },
          { Date: day('2026-05-01T00:00:00Z'), InIndex: 10, InLinks: 2, CrawledPages: 3, CrawlErrors: 0, BlockedByRobotsTxt: 0, Code4xx: 0, Code5xx: 0 },
        ] } };
        case 'GetUrlLinks': return { status: 200, body: { d: { Details: [{ AnchorText: 'Acme CRM', Url: 'https://blog.example/review' }, { AnchorText: '', Url: 'https://news.example/x' }], TotalPages: 4 } } };
        default: return undefined;
      }
    }) });
    expect(r.status).toBe('measured');
    expect(r.search!.stale).toBe(false);
    expect(r.crawl).toEqual({ date: '2026-10-24', inIndex: 40, inLinks: 9, crawledPages: 12, crawlErrors: 1, blockedByRobotsTxt: 0, code4xx: 1, code5xx: 0, from: '2026-05-01', stale: false });
    // Only pages with links are sampled; the link parameter is the page URL itself.
    const sampled = seen.filter((u) => method(u) === 'GetUrlLinks');
    expect(sampled.map((u) => [u.searchParams.get('link'), u.searchParams.get('page')])).toEqual([['https://acme.test/', '0']]);
    expect(r.linkSample).toEqual({ targetsSampled: 1, referringHosts: ['blog.example', 'news.example'],
      links: [{ target: 'https://acme.test/', source: 'https://blog.example/review', anchorText: 'Acme CRM' }, { target: 'https://acme.test/', source: 'https://news.example/x', anchorText: null }] });
    expect(r.partial).toEqual([]);
  });

  it('a stale crawl row is flagged; an optional-report failure never hides the key', async () => {
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, fetchImpl: bingFetch((u) => {
      if (method(u) === 'GetUserSites') return SITES;
      if (method(u) === 'GetLinkCounts') return { status: 200, body: { d: { Links: [{ Url: 'https://acme.test/', Count: 1 }], TotalPages: 1 } } };
      if (method(u) === 'GetQueryStats') return { status: 200, body: { d: [] } };
      if (method(u) === 'GetCrawlStats') return { status: 200, body: { d: [{ Date: `/Date(${Date.parse('2026-10-01T00:00:00Z')})/`, InIndex: 1 }] } };
      return { status: 500, body: { Message: `boom apikey=${KEY}` } };
    }) });
    expect(r.crawl!.stale).toBe(true);
    expect(r.partial).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a link index larger than the pages read is a lower bound (complete: false)', async () => {
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, maxLinkPages: 1, fetchImpl: bingFetch((u) =>
      method(u) === 'GetUserSites' ? SITES : method(u) === 'GetLinkCounts' ? { status: 200, body: { d: { Links: [{ Url: 'https://acme.test/', Count: 3 }], TotalPages: 4 } } } : { status: 200, body: { d: [] } }) });
    expect(r.links).toMatchObject({ total: 3, complete: false });
    expect(r.detail).toMatch(/first 1 of 4 result pages/);
  });

  it.each([
    [401, { Message: 'Invalid API key' }, 'invalid_key'],
    [429, { Message: 'Too many requests' }, 'rate_limited'],
    [400, { Message: 'User is not authorized for the site' }, 'site_not_authorised'],
    [500, { Message: 'Internal error' }, 'failed'],
  ])('HTTP %i → %s, and the key never appears in the detail', async (status, body, want) => {
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, fetchImpl: bingFetch(() => ({ status, body: { ...body, Echo: `apikey=${KEY}` } })) });
    expect(r.status).toBe(want);
    expect(r.detail).not.toContain(KEY);
  });

  it('a network failure → failed, never thrown', async () => {
    const r = await fetchBingWebmaster('acme.test', KEY, { now: NOW, fetchImpl: (async () => { throw new Error(`connect ECONNRESET ?apikey=${KEY}`); }) as any });
    expect(r.status).toBe('failed');
    expect(r.detail).not.toContain(KEY);
  });
});

// ── registry ────────────────────────────────────────────────────────────────
function pages(map: Record<string, string>): EvidenceFetcher {
  return async (url) => (map[url] === undefined ? { ok: false, status: 404, url, text: '' } : { ok: true, status: 200, url, text: map[url] });
}
function lei(prefix18: string): string {
  const n = (s: string) => [...s].map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
  let rem = 0;
  for (const d of n(`${prefix18}00`)) rem = (rem * 10 + Number(d)) % 97;
  return `${prefix18}${String(98 - rem).padStart(2, '0')}`;
}
const CIN = 'U72200KA2015PTC123456';

describe('company registry evidence: stated, confirmed, or not stated', () => {
  it('maps declared markets to registry jurisdictions', () => {
    expect(jurisdictionsFrom(['India', 'United Kingdom and USA', null, 'Mars'])).toEqual(['IN', 'GB', 'US']);
  });

  it('no identifier on the pages read → none_stated', async () => {
    const r = await collectRegistryEvidence({ domain: 'acme.test', companyNames: ['Acme'], jurisdictions: ['IN'], now: NOW,
      fetcher: pages({ 'https://acme.test/': '<html><body><h1>Acme</h1><footer>© Acme</footer></body></html>' }) });
    expect(r.status).toBe('none_stated');
    expect(r.identifiers).toEqual([]);
    expect(r.detail).toMatch(/No registration number/);
  });

  it('a stated CIN that MCA cannot check automatically → stated_unverified, MCA recorded as unavailable', async () => {
    const r = await collectRegistryEvidence({ domain: 'acme.test', companyNames: ['Acme'], jurisdictions: ['IN'], now: NOW,
      fetcher: pages({ 'https://acme.test/': `<footer>CIN: ${CIN}</footer>` }) });
    expect(r.status).toBe('stated_unverified');
    expect(r.identifiers).toEqual([expect.objectContaining({ id: `CIN:${CIN}`, provider: 'mca', verified: false })]);
    expect(r.detail).toMatch(/^The company states CIN:/);
    expect(r.unavailable).toEqual(expect.arrayContaining([expect.objectContaining({ id: `CIN:${CIN}`, outcome: 'inaccessible' })]));
  });

  it('GLEIF naming the stated CIN for the same entity → verified', async () => {
    const leiIn = lei('3358000000ACMEINDI');
    const node = { attributes: { lei: leiIn, entity: { legalName: { name: 'ACME LIMITED' }, jurisdiction: 'IN', registeredAt: { id: 'RA000394' }, registeredAs: CIN, status: 'ACTIVE', headquartersAddress: { city: 'Bengaluru', country: 'IN' } }, registration: { status: 'ISSUED' } } };
    const r = await collectRegistryEvidence({ domain: 'acme.test', companyNames: ['Acme'], jurisdictions: ['IN'], now: NOW, fetcher: pages({
      'https://acme.test/': `<footer>CIN: ${CIN}</footer>`,
      [`https://api.gleif.org/api/v1/lei-records?filter%5Bentity.registeredAs%5D=${CIN}`]: JSON.stringify({ data: [node] }),
      [`https://api.gleif.org/api/v1/lei-records/${leiIn}`]: JSON.stringify({ data: node }),
    }) });
    expect(r.status).toBe('verified');
    expect(r.identifiers).toEqual(expect.arrayContaining([expect.objectContaining({ id: `LEI:${leiIn}`, provider: 'gleif', verified: true })]));
  });

  it('a fetcher that throws → failed or none_stated, never thrown', async () => {
    const r = await collectRegistryEvidence({ domain: 'acme.test', companyNames: ['Acme'], jurisdictions: [], now: NOW, fetcher: (async () => { throw new Error('boom'); }) as any });
    expect(['failed', 'none_stated']).toContain(r.status);
  });
});

// ── ledger + diagnostics ────────────────────────────────────────────────────
const payload = (): any => ({
  generated_at: '2026-10-26T10:00:00Z', pillars: [],
  report1: { evidence_acquisition: { crawl: { action: 'reused', pagesAfter: 2, lastCrawledAt: '2026-10-26T07:00:00Z' } }, website_checks: { pagesEvaluated: 2 }, company_identity: { fields: [] } },
  authority_inflow: { score: { state: 'unavailable', value: null }, rationale: { text: 'No backlink/authority API is configured.' } },
});
const pack = (o: Record<string, unknown> = {}): any => parseResearchPack({
  subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: '2026-10-26T09:00:00Z', collector: 't', method: {},
  company: [], search: [], generative: [], competitors: [], independent: [], gaps: [], site: [], benchmark: [], ...o,
}, 'acme.test');
const bing = (o: Record<string, unknown>) => ({ checkedAt: '2026-10-26T09:00:00Z', siteUrl: 'https://acme.test/', detail: 'd', links: null, search: null, ...o });
const reg = (o: Record<string, unknown>) => ({ checkedAt: '2026-10-26T09:00:00Z', detail: 'd', pagesRead: [{ url: 'https://acme.test/', status: 200, role: 'homepage' }], identifiers: [], unavailable: [], ...o });
const diag = (p: any, key: string) => buildDiagnostics(buildLedger(payload(), p), p).find((d) => d.key === key)!;

describe('dossier: Bing and registry evidence drive the ledger and diagnostics', () => {
  it('the research pack keeps both blocks', () => {
    const p = pack({ bingWebmaster: bing({ status: 'not_configured' }), registry: reg({ status: 'none_stated' }) });
    expect(p.bingWebmaster.status).toBe('not_configured');
    expect(p.registry.status).toBe('none_stated');
  });

  it('Bing measured with links → inbound_links found, backlinks access measured, Bing search row present', () => {
    const p = pack({ bingWebmaster: bing({ status: 'measured', links: { pages: [{ url: 'https://acme.test/', count: 7 }], total: 7, complete: true }, search: { queries: [], impressions: 0, clicks: 0, from: null, to: null } }) });
    const l = buildLedger(payload(), p);
    expect(l.families.find((f) => f.key === 'inbound_links')).toMatchObject({ state: 'found', source: 'Bing Webmaster Tools (https://acme.test/)' });
    expect(l.access.find((a) => a.family === 'backlinks')).toMatchObject({ reason: 'measured', source: 'research' });
    expect(l.access.some((a) => a.capability === 'Bing search performance (Webmaster Tools)')).toBe(true);
    expect(diag(p, 'family:inbound_links')).toMatchObject({ state: 'measured', usable: true, integration: 'implemented' });
  });

  it('Bing measured with zero links → searched_not_found (a measurement, not "not configured")', () => {
    const p = pack({ bingWebmaster: bing({ status: 'measured', links: { pages: [], total: 0, complete: true }, search: null }) });
    expect(diag(p, 'family:inbound_links').state).toBe('searched_not_found');
  });

  it('site not authorised → permission_denied with a site-owner unlock; unknown, not zero', () => {
    const d = diag(pack({ bingWebmaster: bing({ status: 'site_not_authorised', siteUrl: null }) }), 'family:inbound_links');
    expect(d.state).toBe('permission_denied');
    expect(d.impact).toMatch(/unknown — not zero/);
    expect(plainGap(d)).toMatchObject({ by: 'company', short: 'needs Bing site access' });
  });

  it('invalid key → invalid_credential, owned by the report operator', () => {
    const d = diag(pack({ bingWebmaster: bing({ status: 'invalid_key', siteUrl: null }) }), 'family:inbound_links');
    expect(d).toMatchObject({ state: 'invalid_credential', credential: 'rejected' });
    expect(plainGap(d).by).toBe('report operator');
  });

  it('no Bing key → still "not configured", and the next step names the free Bing route', () => {
    const d = diag(pack({ bingWebmaster: bing({ status: 'not_configured', siteUrl: null }) }), 'family:inbound_links');
    expect(d.state).toBe('not_configured');
    expect(d.next).toMatch(/BING_WEBMASTER_API_KEY/);
  });

  it('registry verified → found / measured', () => {
    const p = pack({ registry: reg({ status: 'verified', identifiers: [{ id: 'LEI:X', scheme: 'LEI', provider: 'gleif', legalName: 'ACME LIMITED', status: 'ACTIVE', jurisdiction: 'IN', verified: true, role: 'subject', establishedBy: 'registry_cross_reference', sourceUrl: null }] }) });
    expect(buildLedger(payload(), p).families.find((f) => f.key === 'registry')!.state).toBe('found');
    expect(diag(p, 'family:registry')).toMatchObject({ state: 'measured', usable: true });
  });

  it('registry none stated → searched_not_found; stated but MCA blocked → login_restricted', () => {
    const none = diag(pack({ registry: reg({ status: 'none_stated', detail: 'No registration number (CIN, LEI, company number…) is stated on the 1 page read.' }) }), 'family:registry');
    expect(none.state).toBe('searched_not_found');
    expect(plainGap(none).short).toBe('no registration number stated');
    const blocked = diag(pack({ registry: reg({ status: 'stated_unverified', detail: `The company states CIN:${CIN}; no registry could confirm it automatically (mca: inaccessible).`, unavailable: [{ id: `CIN:${CIN}`, provider: 'mca', outcome: 'inaccessible', detail: 'CAPTCHA' }] }) }), 'family:registry');
    expect(blocked.state).toBe('login_restricted');
    expect(plainGap(blocked).short).toBe('registry blocks automated check');
  });
});

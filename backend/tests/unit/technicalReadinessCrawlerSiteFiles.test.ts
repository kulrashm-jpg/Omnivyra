/**
 * Technical readiness — crawler integration. The site-file step keeps every legacy boolean, adds
 * exactly two SSRF-safe requests (llms.txt, llms-full.txt), and records the robots.txt outcome
 * that used to collapse into one `null`. No network: safeFetch is mocked and routed by URL.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const upserts: any[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    upsert: (row: any) => {
      upserts.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'page-1' }, error: null }) }) };
    },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }),
  }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/crawl/crawlEventService', () => ({
  emitCrawlEvent: jest.fn(),
  resolveCrawlCorrelationId: async () => 'corr-1',
}));
jest.mock('../../services/ingestionUtils', () => ({
  ...jest.requireActual('../../services/ingestionUtils'),
  ensureCanonicalDomain: async () => ({ id: 'domain-1' }),
  resolveCompanyWebsite: async () => 'https://site.test',
}));

type Route = { status?: number; body?: string; type?: string; throws?: string; headers?: Record<string, string> };
let routes: Record<string, Route> = {};
const safeFetch = jest.fn(async (url: string, _init?: unknown, _opts?: unknown) => {
  const r = routes[url] ?? { status: 404 };
  if (r.throws) throw new Error(r.throws);
  const headers: Record<string, string> = { 'content-type': r.type ?? 'text/plain', ...(r.headers ?? {}) };
  return {
    status: r.status ?? 200,
    url,
    headers: {
      forEach: (fn: (v: string, k: string) => void) => { for (const [k, v] of Object.entries(headers)) fn(v, k); },
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
    __body: r.body ?? '',
  };
});
const readCapped = jest.fn(async (res: unknown) => Buffer.from((res as { __body: string }).__body));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import { crawlCompanyWebsite } from '../../services/crawlerService';

const HOME = `<html><head><title>Site Test</title><link rel="canonical" href="https://site.test/">
<script type="application/ld+json">{"@type":"Organization","name":"Site Test","url":"https://site.test"}</script></head>
<body><h1>Site Test</h1><p>Body copy here.</p></body></html>`;

const crawlRoot = async () => {
  upserts.length = 0;
  await crawlCompanyWebsite({ companyId: 'c1', rootUrl: 'https://site.test', maxPages: 1, timeoutMs: 3000 });
  return upserts.find((u) => u && u.url === 'https://site.test/' && 'http_status' in u);
};

/** The pre-change derivation, re-stated: body of a 200–399 response that was read, else null. */
const legacyRobotsString = (r: Route | undefined): string | null =>
  !r || r.throws || (r.status ?? 200) < 200 || (r.status ?? 200) >= 400 ? null : (r.body ?? '');

beforeEach(() => { safeFetch.mockClear(); readCapped.mockClear(); routes = {}; });

describe('crawler site files — legacy booleans unchanged', () => {
  it.each([
    ['robots 200 text', { status: 200, body: 'User-agent: *\nDisallow: /x\nSitemap: https://site.test/s.xml' }],
    ['robots 404', { status: 404 }],
    ['robots 503', { status: 503 }],
    ['robots 200 HTML soft-404', { status: 200, body: '<html>nope</html>', type: 'text/html' }],
    ['robots 200 empty', { status: 200, body: '   ' }],
    ['robots unreachable', { throws: 'SSRF blocked (dns_resolution_failed) for site.test' }],
  ])('%s: robots_txt / sitemap_xml / sitemap_url_count keep their pre-change values', async (_l, robots: Route) => {
    routes = {
      'https://site.test/': { body: HOME, type: 'text/html' },
      'https://site.test/robots.txt': robots,
      'https://site.test/s.xml': { body: '<urlset><url><loc>https://site.test/</loc></url></urlset>' },
    };
    const row = await crawlRoot();
    const site = row.crawl_metadata.signals.site;
    const legacy = legacyRobotsString(robots);
    expect(site.robots_txt).toBe(legacy != null && legacy.trim().length > 0);
    // /sitemap.xml 404s, so the declared sitemap is used exactly when the legacy string declares one.
    const declared = legacy ? /Sitemap:\s*(\S+)/i.exec(legacy)?.[1] : undefined;
    expect(site.sitemap_xml).toBe(Boolean(declared));
    expect(site.sitemap_url_count).toBe(declared ? 1 : 0);
  });
});

describe('crawler site files — new evidence', () => {
  it('C-1 robots 404 / 503 / timeout / unreachable produce distinct recorded outcomes', async () => {
    const outcomes: Record<string, string> = {};
    for (const [label, r] of Object.entries({ e404: { status: 404 }, e503: { status: 503 }, timeout: { throws: 'UND_ERR_HEADERS_TIMEOUT' }, down: { throws: 'ECONNREFUSED' } } as Record<string, Route>)) {
      routes = { 'https://site.test/': { body: HOME, type: 'text/html' }, 'https://site.test/robots.txt': r };
      outcomes[label] = (await crawlRoot()).crawl_metadata.signals.site.robots.outcome;
    }
    expect(outcomes).toEqual({ e404: 'client_error', e503: 'server_error', timeout: 'timeout', down: 'unreachable' });
  });

  it('robots rules, sitemaps and hash are persisted bounded; llms observations are attached', async () => {
    routes = {
      'https://site.test/': { body: HOME, type: 'text/html' },
      'https://site.test/robots.txt': { body: 'User-agent: GPTBot\nDisallow: /\n' },
      'https://site.test/llms.txt': { body: '# Site Test\n- [Docs](https://site.test/docs)\n' },
    };
    const site = (await crawlRoot()).crawl_metadata.signals.site;
    expect(site.robots).toMatchObject({ outcome: 'ok', status: 200, groups: [{ agents: ['gptbot'], rules: [{ type: 'disallow', path: '/', line: 2 }] }] });
    expect(site.robots.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(site.llms).toMatchObject({ state: 'present_well_formed', status: 200 });
    expect(site.llms_full).toMatchObject({ state: 'absent', status: 404 });
  });

  it('cost: exactly two more requests than before (llms.txt, llms-full.txt), all through safeFetch with the same timeout', async () => {
    routes = { 'https://site.test/': { body: HOME, type: 'text/html' } };
    await crawlRoot();
    const urls = safeFetch.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual([
      'https://site.test/',
      'https://site.test/llms-full.txt',
      'https://site.test/llms.txt',
      'https://site.test/robots.txt',
      'https://site.test/sitemap.xml',
    ]);
    for (const c of safeFetch.mock.calls) expect((c[2] as { timeoutMs: number }).timeoutMs).toBe(3000);
  });

  it('page signals gain jsonld_validation, canonical_href and x_robots_tag; legacy signal values unchanged', async () => {
    routes = { 'https://site.test/': { body: HOME, type: 'text/html', headers: { 'x-robots-tag': 'noindex' } } };
    const signals = (await crawlRoot()).crawl_metadata.signals;
    expect(signals.jsonld_validation).toMatchObject({ state: 'valid_syntax_complete', blocks: 1 });
    expect(signals.canonical_href).toBe('https://site.test/');
    expect(signals.x_robots_tag).toBe('noindex');
    expect(signals).toMatchObject({ canonical: true, jsonld_count: 1, jsonld_types: ['Organization'] });
  });

  it('a 404 robots/llms body is never read', async () => {
    routes = { 'https://site.test/': { body: HOME, type: 'text/html' } };
    await crawlRoot();
    const readUrls = readCapped.mock.calls.map((c) => (c[0] as { url: string }).url);
    expect(readUrls).toEqual(['https://site.test/']);
  });
});

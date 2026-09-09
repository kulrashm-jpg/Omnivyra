/**
 * DG-010 — the crawler recovers the page's DECLARED update date, and nothing else.
 *
 * `extractPageSignals` already recovered `article:published_time` / JSON-LD `datePublished` /
 * `<time datetime>`. It did not recover the page's declared UPDATE date, so a page published in
 * 2019 and declared as updated last month reached the content engine as stale.
 *
 * The decisive negative half of this suite: the HTTP `Last-Modified` response header and the
 * sitemap's `<lastmod>` are BOTH in scope at the call site and must stay unread. Neither is
 * declared by the page — `Last-Modified` is emitted by the server (dynamic and CDN-served pages
 * routinely return the response time) and `<lastmod>` is commonly auto-stamped by the CMS for
 * every URL at build time. Reading either would report "updated today" for sites that changed
 * nothing. That is a fabricated content date, which is exactly what DG-010 exists to prevent.
 *
 * SECRETS: all synthetic. No network, no credential, no real host.
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

/** A safeFetch response carrying the body the matching readCapped call will return. */
interface FakeResponse {
  status: number;
  __body: string;
  headers: { forEach: (fn: (v: string, k: string) => void) => void; get: (k: string) => string | null };
}

const safeFetch = jest.fn();
const readCapped = jest.fn(async (response: unknown) =>
  Buffer.from((response as FakeResponse).__body ?? ''),
);
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import { crawlCompanyWebsite } from '../../services/crawlerService';

/** The server-emitted date the crawler must ignore. Deliberately "today". */
const SERVER_LAST_MODIFIED = 'Mon, 06 Sep 2026 00:00:00 GMT';
/** The sitemap-declared date the crawler must ignore. Also deliberately "today". */
const SITEMAP_LASTMOD = '2026-09-06';

const SITEMAP_XML =
  `<?xml version="1.0"?><urlset><url><loc>https://site.test/</loc><lastmod>${SITEMAP_LASTMOD}</lastmod></url></urlset>`;

const respond = (body: string, extraHeaders: Record<string, string> = {}): FakeResponse => {
  const headers: Record<string, string> = { 'content-type': 'text/html', ...extraHeaders };
  return {
    status: 200,
    __body: body,
    headers: {
      forEach: (fn) => { for (const [k, v] of Object.entries(headers)) fn(v, k); },
      get: (k) => headers[k.toLowerCase()] ?? null,
    },
  };
};

/**
 * Crawl one page whose HTML is `html`. robots.txt and sitemap.xml are served too, so the
 * sitemap `<lastmod>` is genuinely present and genuinely discarded.
 */
const crawlWith = async (html: string, pageHeaders: Record<string, string> = {}) => {
  upserts.length = 0;
  safeFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/robots.txt')) return respond('User-agent: *\nAllow: /');
    if (url.endsWith('/sitemap.xml')) return respond(SITEMAP_XML);
    return respond(html, { 'last-modified': SERVER_LAST_MODIFIED, ...pageHeaders });
  });
  await crawlCompanyWebsite({ companyId: 'c1', rootUrl: 'https://site.test', maxPages: 1 });
  return upserts.find((u) => u && u.crawl_metadata && 'signals' in u.crawl_metadata);
};

const doc = (head: string, body = '<h1>H</h1><p>Body copy here.</p>') =>
  `<html><head><title>T</title>${head}</head><body>${body}</body></html>`;

beforeEach(() => {
  safeFetch.mockReset();
  readCapped.mockClear();
});

// ── 1. What the page declares IS captured ───────────────────────────────────

describe('DG-010 — declared update dates are recovered from the page', () => {
  it('captures article:modified_time', async () => {
    const row = await crawlWith(doc('<meta property="article:modified_time" content="2026-08-01T10:00:00Z" />'));
    expect(row.crawl_metadata.signals.modified_time).toBe('2026-08-01T10:00:00Z');
  });

  it('captures JSON-LD dateModified', async () => {
    const row = await crawlWith(doc(
      '<script type="application/ld+json">{"@type":"Article","dateModified":"2026-07-15T09:00:00Z"}</script>',
    ));
    expect(row.crawl_metadata.signals.modified_time).toBe('2026-07-15T09:00:00Z');
  });

  it('prefers the explicit meta declaration over JSON-LD', async () => {
    const row = await crawlWith(doc(
      '<meta property="article:modified_time" content="2026-08-01T10:00:00Z" />' +
      '<script type="application/ld+json">{"@type":"Article","dateModified":"2020-01-01T00:00:00Z"}</script>',
    ));
    expect(row.crawl_metadata.signals.modified_time).toBe('2026-08-01T10:00:00Z');
  });

  it('captures publication and update independently on the same page', async () => {
    const row = await crawlWith(doc(
      '<meta property="article:published_time" content="2019-03-02T00:00:00Z" />' +
      '<meta property="article:modified_time" content="2026-08-01T10:00:00Z" />',
    ));
    expect(row.crawl_metadata.signals.published_time).toBe('2019-03-02T00:00:00Z');
    expect(row.crawl_metadata.signals.modified_time).toBe('2026-08-01T10:00:00Z');
  });
});

// ── 2. What the page does NOT declare stays null ────────────────────────────

describe('DG-010 — an undeclared update date is null, never inferred', () => {
  it('is null when the page declares nothing', async () => {
    const row = await crawlWith(doc(''));
    expect(row.crawl_metadata.signals.modified_time).toBeNull();
  });

  it('is null when the page declares only a publication date', async () => {
    const row = await crawlWith(doc('<meta property="article:published_time" content="2026-01-01T00:00:00Z" />'));
    expect(row.crawl_metadata.signals.published_time).toBe('2026-01-01T00:00:00Z');
    expect(row.crawl_metadata.signals.modified_time).toBeNull();
  });

  it('does not read <time datetime> as an update date', async () => {
    // `<time datetime>` carries the PUBLICATION date on virtually every template. Reusing it here
    // would silently duplicate published_time into a field that claims to mean something else.
    const row = await crawlWith(doc('', '<h1>H</h1><time datetime="2026-05-05T00:00:00Z">May</time><p>Body copy here.</p>'));
    expect(row.crawl_metadata.signals.published_time).toBe('2026-05-05T00:00:00Z');
    expect(row.crawl_metadata.signals.modified_time).toBeNull();
  });
});

// ── 3. Server- and build-emitted dates are NOT content dates ────────────────

describe('DG-010 — server- and build-emitted dates are never adopted as content evidence', () => {
  it('ignores the HTTP Last-Modified header even though it is in scope', async () => {
    const row = await crawlWith(doc(''));
    // The header WAS delivered on this response…
    expect(SERVER_LAST_MODIFIED).toBeTruthy();
    // …and nothing in the persisted signals carries it.
    expect(row.crawl_metadata.signals.modified_time).toBeNull();
    expect(JSON.stringify(row.crawl_metadata.signals)).not.toContain(SERVER_LAST_MODIFIED);
    expect(JSON.stringify(row.crawl_metadata.signals).toLowerCase()).not.toContain('last-modified');
  });

  it('does not let Last-Modified override a genuinely older declaration', async () => {
    const row = await crawlWith(doc('<meta property="article:modified_time" content="2020-02-02T00:00:00Z" />'));
    expect(row.crawl_metadata.signals.modified_time).toBe('2020-02-02T00:00:00Z');
  });

  it('ignores the sitemap <lastmod> even though the sitemap was fetched and parsed', async () => {
    const row = await crawlWith(doc(''));
    // The sitemap WAS read — its <loc> count proves the body reached the parser…
    expect(row.crawl_metadata.signals.site).toEqual(
      expect.objectContaining({ sitemap_xml: true, sitemap_url_count: 1 }),
    );
    // …and its <lastmod> is nowhere in the persisted signals.
    expect(JSON.stringify(row.crawl_metadata.signals)).not.toContain(SITEMAP_LASTMOD);
  });
});

// ── 4. The existing signal surface is unchanged ─────────────────────────────

describe('DG-010 — the rest of the signals bag is untouched', () => {
  it('leaves every other captured signal identical to a run without the update date', async () => {
    const withModified = await crawlWith(doc('<meta property="article:modified_time" content="2026-08-01T10:00:00Z" />'));
    const withoutModified = await crawlWith(doc(''));
    const strip = (s: Record<string, unknown>) => {
      const { modified_time: _ignored, ...rest } = s;
      return rest;
    };
    expect(strip(withModified.crawl_metadata.signals)).toEqual(strip(withoutModified.crawl_metadata.signals));
  });

  it('adds exactly one key to the signals bag', async () => {
    const row = await crawlWith(doc(''));
    const keys = Object.keys(row.crawl_metadata.signals);
    expect(keys).toContain('modified_time');
    expect(keys).toContain('published_time');
    expect(keys.filter((k) => /modif/i.test(k))).toEqual(['modified_time']);
  });
});

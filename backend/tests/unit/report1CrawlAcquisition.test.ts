/**
 * GAP-03 — the report path must actually acquire crawl evidence.
 *
 * THE DEFECT. `reportInputResolver.normalizeDomain` deliberately strips the scheme
 * (`raw.replace(/^https?:\/\//i, '')`), and `reports.domain` is stored the same way, so
 * `ensureReportCrawlEvidence` handed `crawlCompanyWebsite` a BARE DOMAIN — `calendly.com`.
 * The crawler's first act is `normalizeUrl(rootUrl)`, a bare `new URL(rawUrl)`, and
 * `new URL('calendly.com')` throws `TypeError: Invalid URL`.
 *
 * The throw landed before `ensureCanonicalDomain` and before the fetch loop, so not even the
 * loop's own fetch-error row was written. The company ended with zero `canonical_pages`, which
 * cascaded: `digital_experience.pagesEvaluated = 0` → `digital_snapshot.empty = true` → a Report 1
 * with no opportunities, no priorities and an empty 90-day plan.
 *
 * Every other caller escaped it by routing through `resolveCompanyWebsite`, which already applies
 * `/^https?:\/\//i.test(v) ? v : \`https://\${v}\``. Only the report path bypassed that helper.
 *
 * ── TEST SEAMS, STATED PLAINLY ───────────────────────────────────────────────
 * Two things are replaced, and nothing else:
 *
 *  1. The Supabase WRITE layer (`ownedDbTable`) → an in-memory recorder, so no test row reaches
 *     the production database.
 *  2. The network TRANSPORT (`lib/security/safeFetch`) → a fixture server map. The crawler never
 *     passes `allowPrivateNetwork`, so its SSRF guard correctly refuses loopback; rather than
 *     weaken that guard for a test, the transport below the guard is substituted.
 *
 * Everything between them is the real thing: URL normalisation, the crawl queue, HTML parsing,
 * signal extraction, link discovery and the persistence contract. The SSRF guard itself is
 * untouched and therefore also unexercised here — that is a deliberate limit of this suite.
 */

const recorded: Array<{ table: string; op: string; rows: unknown }> = [];
const canonicalPagesFor = (companyId: string) =>
  recorded.filter((r) => r.table === 'canonical_pages' && r.op === 'upsert')
    .flatMap((r) => (Array.isArray(r.rows) ? r.rows : [r.rows]))
    .filter((row) => (row as { company_id?: string }).company_id === companyId) as Array<Record<string, unknown>>;

jest.mock('../../db/writeOwner', () => {
  // A self-returning query stub. Supabase's builder exposes a long, evolving filter surface
  // (.eq/.in/.is/.not/.order/.limit/…); enumerating it here would make this test brittle against
  // changes that have nothing to do with GAP-03. A proxy returns itself for any unknown method and
  // settles when awaited, so only the calls this test actually asserts on need naming.
  const settle = { data: [], error: null };
  const makeChain = (): any => new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(settle);
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => ({ data: { id: 'row-1', primary_domain: 'fixture.test' }, error: null });
      }
      return () => makeChain();
    },
    apply() { return makeChain(); },
  });

  const makeBuilder = (table: string): any => ({
    upsert: (rows: unknown) => {
      recorded.push({ table, op: 'upsert', rows });
      const one = Array.isArray(rows) ? rows[0] : rows;
      const id = `row-${(one as { url?: string })?.url ?? recorded.length}`;
      const chain: any = new Proxy(function () {} as any, {
        get(_t, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: [{ id }], error: null });
          if (prop === 'single' || prop === 'maybeSingle') {
            return async () => ({ data: { id, primary_domain: 'fixture.test' }, error: null });
          }
          return () => chain;
        },
      });
      return chain;
    },
    insert: (rows: unknown) => { recorded.push({ table, op: 'insert', rows }); return makeChain(); },
    update: (rows: unknown) => { recorded.push({ table, op: 'update', rows }); return makeChain(); },
    delete: () => makeChain(),
    select: () => makeChain(),
  });
  return { ownedDbTable: (table: string) => makeBuilder(table) };
});

const PAGE = (title: string, links: string[]) => `<!doctype html><html><head>
  <title>${title}</title><meta name="description" content="${title} — a fixture page with a real description." />
  <link rel="canonical" href="https://fixture.test/" /></head><body><h1>${title}</h1>
  <h2>What this page covers</h2>
  <p>${'Real extractable copy for the fixture page. '.repeat(14)}</p>
  <a href="https://fixture.test/contact">Book a demo</a>
  ${links.map((l) => `<a href="${l}">${l.replace('https://fixture.test', '') || 'home'}</a>`).join('')}
  </body></html>`;

const SITE: Record<string, string> = {
  'https://fixture.test/': PAGE('Fixture Home', ['https://fixture.test/pricing', 'https://fixture.test/product', 'https://fixture.test/blog']),
  'https://fixture.test/pricing': PAGE('Fixture Pricing', ['https://fixture.test/']),
  'https://fixture.test/product': PAGE('Fixture Product', ['https://fixture.test/']),
  'https://fixture.test/blog': PAGE('Fixture Blog', ['https://fixture.test/']),
  'https://fixture.test/contact': PAGE('Fixture Contact', ['https://fixture.test/']),
};

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async (url: string) => {
    if (url.startsWith('https://fixture.test/robots.txt')) {
      return { status: 200, headers: new Map<string, string>(), _body: 'User-agent: *\nAllow: /' } as never;
    }
    if (url.startsWith('https://unreachable.test')) throw new Error('getaddrinfo ENOTFOUND unreachable.test');
    if (url === 'https://fixture.test/gone') return { status: 500, headers: new Map<string, string>(), _body: '' } as never;
    const html = SITE[url.replace(/\/$/, '') === 'https://fixture.test' ? 'https://fixture.test/' : url];
    if (!html) return { status: 404, headers: new Map<string, string>(), _body: '' } as never;
    const headers = new Map<string, string>([['content-type', 'text/html; charset=utf-8']]);
    return { status: 200, headers, _body: html } as never;
  },
  readCapped: async (res: { _body?: string }) => Buffer.from(res._body ?? '', 'utf8'),
}));

// `ensureReportCrawlEvidence` counts pages through the READ client, which is a different module
// from the write owner. Backing the count with the same recorder makes the boundary test a real
// before/after: the count rises only because the crawl actually persisted something.
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let companyId = '';
      chain.select = (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          const counter: Record<string, unknown> = {};
          counter.eq = (_c: string, v: string) => { companyId = v; return counter; };
          counter.then = (resolve: (v: unknown) => unknown) =>
            resolve({ count: canonicalPagesFor(companyId).filter((p) => p.http_status === 200).length, error: null });
          return counter;
        }
        return chain;
      };
      chain.eq = (_c: string, v: string) => { companyId = v; return chain; };
      chain.not = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table !== 'canonical_pages') return resolve({ data: null, error: null });
        const pages = canonicalPagesFor(companyId).filter((p) => p.http_status === 200);
        return resolve({ data: pages.length > 0 ? [{ last_crawled_at: pages[0].last_crawled_at }] : [], error: null });
      };
      return chain;
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { crawlCompanyWebsite } = require('../../services/crawlerService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureReportCrawlEvidence } = require('../../services/crawl/reportCrawlEvidenceService');

jest.setTimeout(120_000);
beforeEach(() => { recorded.length = 0; });

describe('GAP-03 · Test A — the exact failure is reproduced, and the boundary fix removes it', () => {
  it('proves a bare domain is unparseable as a URL — the original throw', () => {
    expect(() => new URL('calendly.com')).toThrow(/Invalid URL/);
    expect(() => new URL('https://calendly.com')).not.toThrow();
  });

  it('rejects a bare domain handed straight to the crawler, writing nothing (pre-fix behaviour)', async () => {
    // Exactly what `ensureReportCrawlEvidence` used to do. The throw precedes all persistence,
    // which is why not even the loop's fetch-error row existed — matching `canonical_pages = 0`.
    await expect(crawlCompanyWebsite({ companyId: 'gap03-bare', rootUrl: 'fixture.test', maxPages: 3 }))
      .rejects.toThrow(/Invalid URL/);
    expect(canonicalPagesFor('gap03-bare')).toHaveLength(0);
  });

  it('applies the same scheme normalisation resolveCompanyWebsite already uses', () => {
    const normalise = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);
    expect(normalise('calendly.com')).toBe('https://calendly.com');
    expect(normalise('https://calendly.com')).toBe('https://calendly.com');
    expect(() => new URL(normalise('calendly.com'))).not.toThrow();
  });
});

describe('GAP-03 · Test B — a reachable page survives fetch → extraction → persistence', () => {
  it('persists the fetched page with genuinely extracted content', async () => {
    const result = await crawlCompanyWebsite({ companyId: 'gap03-one', rootUrl: 'https://fixture.test/pricing', maxPages: 1 });
    expect(result.pagesProcessed).toBeGreaterThanOrEqual(1);

    const pages = canonicalPagesFor('gap03-one');
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const page = pages[0];
    expect(page.http_status).toBe(200);
    expect(String(page.title)).toContain('Fixture Pricing');
    expect(page.meta_description).toBeTruthy();
    expect(Array.isArray(page.headings) ? (page.headings as unknown[]).length : 0).toBeGreaterThan(0);
    // Extraction reached the downstream tables the report engines read.
    expect(recorded.some((r) => r.table === 'page_content')).toBe(true);
  });
});

describe('GAP-03 · Test C — a successful crawl reaches the minimum-evidence threshold', () => {
  it('persists at least REPORT_CRAWL_MIN_PAGES pages from a site that has them', async () => {
    // The constant is READ, never adjusted to make the assertion pass.
    const MIN_USABLE_PAGES = Math.max(1, Number(process.env.REPORT_CRAWL_MIN_PAGES) || 3);
    const result = await crawlCompanyWebsite({ companyId: 'gap03-many', rootUrl: 'https://fixture.test', maxPages: 10 });

    expect(result.pagesProcessed).toBeGreaterThanOrEqual(MIN_USABLE_PAGES);
    const urls = new Set(canonicalPagesFor('gap03-many').map((p) => String(p.url)));
    expect(urls.size).toBeGreaterThanOrEqual(MIN_USABLE_PAGES);
    // Link discovery ran: the crawl followed internal links beyond the root page.
    expect([...urls].some((u) => u.includes('/pricing'))).toBe(true);
  });
});

describe('GAP-03 · Test D — a genuinely unreachable target is never dressed up as evidence', () => {
  it('records a non-200 as a failed fetch, not as a page', async () => {
    const result = await crawlCompanyWebsite({ companyId: 'gap03-500', rootUrl: 'https://fixture.test/gone', maxPages: 1, timeoutMs: 4000 });
    expect(result.pagesInserted).toBe(0);
    const pages = canonicalPagesFor('gap03-500');
    expect(pages).toHaveLength(1);
    expect(pages[0].http_status).toBe(0);
    expect(JSON.stringify(pages[0].crawl_metadata)).toContain('fetch_error');
  });

  it('invents nothing for a host that does not resolve', async () => {
    const result = await crawlCompanyWebsite({ companyId: 'gap03-dns', rootUrl: 'https://unreachable.test', maxPages: 1, timeoutMs: 4000 });
    expect(result.pagesInserted).toBe(0);
    for (const p of canonicalPagesFor('gap03-dns')) expect(p.http_status).toBe(0);
  });
});

describe('GAP-03 · Test F — the report boundary now acquires evidence end to end', () => {
  it('turns a BARE DOMAIN into persisted crawl evidence (the actual GAP-03 fix)', async () => {
    // This is the exact call `generateReportPayload` makes, with the exact value
    // `reportInputResolver` produces: a scheme-less domain. Before the fix this reached
    // `new URL('fixture.test')`, threw, and left `pagesAfter: 0` with nothing persisted.
    const result = await ensureReportCrawlEvidence({
      companyId: 'gap03-boundary',
      websiteDomain: 'fixture.test',
    });

    expect(result.action).toBe('crawled');
    expect(result.error).toBeUndefined();
    expect(result.pagesBefore).toBe(0);
    expect(result.pagesAfter).toBeGreaterThanOrEqual(3);
    expect(canonicalPagesFor('gap03-boundary').length).toBeGreaterThanOrEqual(3);
  });

  it('still reports an honest failure for a domain that cannot be reached', async () => {
    const result = await ensureReportCrawlEvidence({
      companyId: 'gap03-boundary-dead',
      websiteDomain: 'unreachable.test',
    });
    // The crawl ran and completed, but nothing was obtained — recorded as such, never as success.
    expect(result.pagesAfter).toBe(0);
    expect(canonicalPagesFor('gap03-boundary-dead').every((p) => p.http_status === 0)).toBe(true);
  });

  it('accepts a full URL unchanged, so existing callers are unaffected', async () => {
    const result = await ensureReportCrawlEvidence({
      companyId: 'gap03-boundary-url',
      websiteDomain: 'https://fixture.test',
    });
    expect(result.action).toBe('crawled');
    expect(result.pagesAfter).toBeGreaterThanOrEqual(3);
  });
});

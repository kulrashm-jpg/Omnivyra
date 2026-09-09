/**
 * DG-010 — DECLARED content staleness.
 *
 * The crawler already recovered the page's declared PUBLICATION date. It did not recover the page's
 * declared UPDATE date, so a page published in 2019 and declared as updated last month was reported
 * as stale. `article:modified_time` and JSON-LD `dateModified` are the page's own claim about itself,
 * available from the SAME static parse the crawler already runs.
 *
 * Three lines these tests hold:
 *
 *   1. STALENESS is not DECAY. Decay means traffic or ranking falling over time. Measuring it needs
 *      per-page history, and none exists: `canonical_pages` is upserted on (company_id, url) and
 *      `page_content` / `page_links` are deleted and reinserted on every re-crawl, so a page's prior
 *      state is destroyed the moment it is crawled again. No output here may claim decay, a trend,
 *      a direction, or a comparison with a previous crawl.
 *
 *   2. No date is ever invented. A page that declares nothing has nothing. The check abstains below
 *      the evidence floor rather than substituting the crawl timestamp, the HTTP `Last-Modified`
 *      header, or a sitemap `<lastmod>` — the latter two are emitted by servers and build tools, not
 *      declared by the page, and would report "updated today" for every dynamically served site.
 *
 *   3. The existing publication-date behaviour is unchanged where no update date is declared.
 */
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';

const NOW = Date.parse('2026-09-06T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

type Page = Parameters<typeof scoreContentIntelligence>[0][number];

function page(
  id: string,
  signals: { published_time?: string | null; modified_time?: string | null },
): Page {
  return {
    id,
    url: `https://acme.io/${id}`,
    title: `Page ${id}`,
    meta_title: `Page ${id}`,
    meta_description: 'description',
    page_type: 'page',
    headings: [{ level: 1, text: 'Heading' }],
    ctas: [{ text: 'Get started' }],
    internal_link_count: 5,
    http_status: 200,
    // Crawled seconds ago — the check must never read this.
    last_crawled_at: new Date(NOW).toISOString(),
    crawl_metadata: { signals: { published_time: null, ...signals } },
  } as unknown as Page;
}

const freshness = (pages: Page[]) =>
  scoreContentIntelligence(pages, [], NOW).checks.find((c) => c.key === 'content_freshness')!;

describe('DG-010 — declared update dates are content evidence', () => {
  // ── 1. The update date is read at all ─────────────────────────────────────
  describe('1. a declared update date counts as a content date', () => {
    it('evaluates pages that declare only an update date', () => {
      const check = freshness([
        page('a', { modified_time: daysAgo(10) }),
        page('b', { modified_time: daysAgo(20) }),
        page('c', { modified_time: daysAgo(30) }),
      ]);
      expect(check.status).toBe('pass');
      expect(check.score).toBe(100);
      expect(check.detail).toBe('3/3 dated pages declare publication or update within the last 12 months');
    });

    it('abstains — not evaluates — when only two pages declare an update date', () => {
      const check = freshness([
        page('a', { modified_time: daysAgo(10) }),
        page('b', { modified_time: daysAgo(20) }),
        page('c', {}),
      ]);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
      expect(check.detail).toBe('Only 2 of 3 pages declare a publication or update date');
    });

    it('lets an update date lift a page over the evidence floor', () => {
      // Two published dates alone would abstain; the third page's update date makes three.
      const check = freshness([
        page('a', { published_time: daysAgo(10) }),
        page('b', { published_time: daysAgo(20) }),
        page('c', { modified_time: daysAgo(30) }),
      ]);
      expect(check.status).toBe('pass');
      expect(check.detail).toBe('3/3 dated pages declare publication or update within the last 12 months');
    });
  });

  // ── 2. The LATER declaration wins ─────────────────────────────────────────
  describe('2. the page date is the later of the two declarations', () => {
    it('an old publication with a recent update is recent', () => {
      const check = freshness([
        page('a', { published_time: daysAgo(2000), modified_time: daysAgo(30) }),
        page('b', { published_time: daysAgo(2000), modified_time: daysAgo(30) }),
        page('c', { published_time: daysAgo(2000), modified_time: daysAgo(30) }),
      ]);
      expect(check.score).toBe(100);
    });

    it('a recent publication with an older update stays recent', () => {
      // max(), not last-wins: a stale `dateModified` must not pull a fresh page backwards.
      const check = freshness([
        page('a', { published_time: daysAgo(30), modified_time: daysAgo(2000) }),
        page('b', { published_time: daysAgo(30), modified_time: daysAgo(2000) }),
        page('c', { published_time: daysAgo(30), modified_time: daysAgo(2000) }),
      ]);
      expect(check.score).toBe(100);
    });

    it('both declarations old still scores zero — an honest low, not an abstention', () => {
      const check = freshness([
        page('a', { published_time: daysAgo(2000), modified_time: daysAgo(900) }),
        page('b', { published_time: daysAgo(2000), modified_time: daysAgo(900) }),
        page('c', { published_time: daysAgo(2000), modified_time: daysAgo(900) }),
      ]);
      expect(check.status).toBe('pass');
      expect(check.score).toBe(0);
    });

    it('counts each page once however many dates it declares', () => {
      const check = freshness([
        page('a', { published_time: daysAgo(10), modified_time: daysAgo(5) }),
        page('b', { published_time: daysAgo(10), modified_time: daysAgo(5) }),
        page('c', { published_time: daysAgo(10), modified_time: daysAgo(5) }),
      ]);
      // 3 pages, 6 declarations — the denominator is pages.
      expect(check.detail).toBe('3/3 dated pages declare publication or update within the last 12 months');
    });
  });

  // ── 3. A malformed update declaration is not evidence ─────────────────────
  describe('3. only parseable, non-future update dates count', () => {
    it('ignores an unparseable update date', () => {
      const check = freshness([
        page('a', { modified_time: 'not a date' }),
        page('b', { modified_time: daysAgo(10) }),
        page('c', { modified_time: daysAgo(10) }),
      ]);
      expect(check.status).toBe('not_evaluable');
      expect(check.detail).toBe('Only 2 of 3 pages declare a publication or update date');
    });

    it('ignores a future update date', () => {
      const future = new Date(NOW + 90 * 24 * 60 * 60 * 1000).toISOString();
      const check = freshness([
        page('a', { modified_time: future }),
        page('b', { modified_time: daysAgo(10) }),
        page('c', { modified_time: daysAgo(10) }),
      ]);
      expect(check.status).toBe('not_evaluable');
    });

    it('falls back to the publication date when the update date is malformed', () => {
      const check = freshness([
        page('a', { published_time: daysAgo(10), modified_time: 'garbage' }),
        page('b', { published_time: daysAgo(10), modified_time: 'garbage' }),
        page('c', { published_time: daysAgo(10), modified_time: 'garbage' }),
      ]);
      expect(check.status).toBe('pass');
      expect(check.score).toBe(100);
    });

    it('ignores an empty-string update date', () => {
      const check = freshness([page('a', { modified_time: '   ' }), page('b', {}), page('c', {})]);
      expect(check.detail).toBe('No page declares a publication or update date');
    });

    it('a future publication date does not resurrect a page through the update field', () => {
      const future = new Date(NOW + 90 * 24 * 60 * 60 * 1000).toISOString();
      const check = freshness([
        page('a', { published_time: future, modified_time: future }),
        page('b', { published_time: future, modified_time: future }),
        page('c', { published_time: future, modified_time: future }),
      ]);
      expect(check.status).toBe('not_evaluable');
      expect(check.detail).toBe('No page declares a publication or update date');
    });
  });

  // ── 4. Nothing is invented when the page declares nothing ─────────────────
  describe('4. an undeclared date stays unavailable', () => {
    it('abstains for freshly crawled pages that declare neither date', () => {
      const pages = Array.from({ length: 12 }, (_, i) => page(`p${i}`, {}));
      const check = freshness(pages);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
      expect(check.detail).toBe('No page declares a publication or update date');
    });

    it('does not read the crawl timestamp as an update date', () => {
      const check = freshness([
        page('a', {}), page('b', {}), page('c', {}), page('d', {}), page('e', {}),
      ]);
      expect(check.status).toBe('not_evaluable');
      expect(check.detail).not.toMatch(/crawl|scan|last seen|checked|last-modified/i);
    });

    it('ignores a signals bag that carries no dates at all', () => {
      const pages = [
        { ...page('a', {}), crawl_metadata: { signals: { author: 'A' } } },
        { ...page('b', {}), crawl_metadata: { signals: { author: 'B' } } },
        { ...page('c', {}), crawl_metadata: { signals: { author: 'C' } } },
      ] as unknown as Page[];
      const check = freshness(pages);
      expect(check.status).toBe('not_evaluable');
    });
  });

  // ── 5. Staleness is never dressed as decay ────────────────────────────────
  describe('5. the output claims staleness, never decay', () => {
    it('never uses decay / trend / decline vocabulary', () => {
      const check = freshness([
        page('a', { modified_time: daysAgo(900) }),
        page('b', { modified_time: daysAgo(900) }),
        page('c', { modified_time: daysAgo(900) }),
      ]);
      expect(`${check.label} ${check.detail}`).not.toMatch(
        /decay|declin|traffic|ranking|trend|since the last|previous crawl|dropping|falling/i,
      );
    });

    it('reports the same result for identical input regardless of call order — no history is consulted', () => {
      const build = () => [
        page('a', { modified_time: daysAgo(30) }),
        page('b', { modified_time: daysAgo(400) }),
        page('c', { modified_time: daysAgo(30) }),
      ];
      const first = freshness(build());
      const second = freshness(build());
      expect(second).toEqual(first);
      expect(first.score).toBe(67);
    });
  });

  // ── 6. It must not disturb the rest of the engine ─────────────────────────
  describe('6. the delta is confined to this one check', () => {
    it('still emits exactly one content_freshness check', () => {
      const keys = scoreContentIntelligence([page('a', { modified_time: daysAgo(1) })], [], NOW)
        .checks.map((c) => c.key);
      expect(keys.filter((k) => k === 'content_freshness')).toHaveLength(1);
    });

    it('adds no new check key to the content engine', () => {
      const withDates = scoreContentIntelligence(
        [page('a', { modified_time: daysAgo(1) }), page('b', { modified_time: daysAgo(2) }), page('c', { modified_time: daysAgo(3) })],
        [], NOW,
      ).checks.map((c) => c.key).sort();
      const withoutDates = scoreContentIntelligence(
        [page('a', {}), page('b', {}), page('c', {})], [], NOW,
      ).checks.map((c) => c.key).sort();
      expect(withDates).toEqual(withoutDates);
    });

    it('leaves every other check identical whether or not an update date is declared', () => {
      const others = (pages: Page[]) =>
        scoreContentIntelligence(pages, [], NOW).checks.filter((c) => c.key !== 'content_freshness');
      const dated = others([
        page('a', { modified_time: daysAgo(1) }), page('b', { modified_time: daysAgo(2) }), page('c', { modified_time: daysAgo(3) }),
      ]);
      const undated = others([page('a', {}), page('b', {}), page('c', {})]);
      expect(dated).toEqual(undated);
    });
  });
});

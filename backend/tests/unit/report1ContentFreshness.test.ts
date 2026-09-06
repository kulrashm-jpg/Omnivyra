/**
 * CONTENT FRESHNESS — the check must measure the PAGE's publication claim, never our crawl date.
 *
 * The crawler already recovers `article:published_time` / JSON-LD `datePublished` / `<time datetime>`
 * into `crawl_metadata.signals.published_time`. That is genuine page-level publication evidence and
 * nothing in Report 1 delivered it. `last_crawled_at`, by contrast, records when WE looked; reporting
 * it as "content freshness" would hand the customer our own scan schedule back as their publishing
 * cadence. These tests hold that line, and hold the abstention floor: in production only 3 of 147
 * crawled pages declare a date, so the honest answer for almost every site today is "not evaluable".
 */
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';

const NOW = Date.parse('2026-09-06T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

type Page = Parameters<typeof scoreContentIntelligence>[0][number];

function page(id: string, publishedTime: string | null, extra: Partial<Page> = {}): Page {
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
    // Crawled long after publication — the check must not read this.
    last_crawled_at: new Date(NOW).toISOString(),
    crawl_metadata: { signals: { published_time: publishedTime } },
    ...extra,
  } as unknown as Page;
}

const freshness = (pages: Page[]) =>
  scoreContentIntelligence(pages, [], NOW).checks.find((c) => c.key === 'content_freshness')!;

describe('content freshness — declared publication dates only', () => {
  // ── 1. Measured when enough pages declare a date ───────────────────────────
  describe('1. it measures once at least three pages declare a date', () => {
    it('reports the share published in the last 12 months', () => {
      const check = freshness([
        page('a', daysAgo(30)), page('b', daysAgo(60)), page('c', daysAgo(900)), page('d', daysAgo(1200)),
      ]);
      expect(check.status).toBe('pass');
      expect(check.score).toBe(50);
      expect(check.detail).toBe('2/4 dated pages published in the last 12 months');
    });

    it('reports 100 when every dated page is recent', () => {
      const check = freshness([page('a', daysAgo(1)), page('b', daysAgo(10)), page('c', daysAgo(200))]);
      expect(check.score).toBe(100);
    });

    it('reports 0 when every dated page is stale — an honest low, not an abstention', () => {
      const check = freshness([page('a', daysAgo(400)), page('b', daysAgo(800)), page('c', daysAgo(1500))]);
      expect(check.status).toBe('pass');
      expect(check.score).toBe(0);
    });

    it('counts only dated pages in the denominator', () => {
      const check = freshness([
        page('a', daysAgo(30)), page('b', daysAgo(30)), page('c', daysAgo(30)),
        page('d', null), page('e', null),
      ]);
      expect(check.detail).toBe('3/3 dated pages published in the last 12 months');
    });
  });

  // ── 2. Abstention below the evidence floor ────────────────────────────────
  describe('2. below three declared dates it abstains and says so', () => {
    it('abstains when no page declares a date', () => {
      const check = freshness([page('a', null), page('b', null)]);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
      expect(check.detail).toBe('No page declares a publication date');
    });

    it('abstains on the production case — one dated page out of many', () => {
      const pages = [page('a', daysAgo(20)), ...Array.from({ length: 26 }, (_, i) => page(`p${i}`, null))];
      const check = freshness(pages);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
      expect(check.detail).toBe('Only 1 of 27 pages declare a publication date');
    });

    it('abstains at two dated pages', () => {
      const check = freshness([page('a', daysAgo(20)), page('b', daysAgo(40)), page('c', null)]);
      expect(check.status).toBe('not_evaluable');
    });
  });

  // ── 3. It must never read the crawl timestamp ─────────────────────────────
  describe('3. crawl age is never relabelled as content freshness', () => {
    it('abstains for freshly crawled pages that declare no publication date', () => {
      // Every page was crawled seconds ago. If the check read `last_crawled_at` this would score 100.
      const pages = Array.from({ length: 10 }, (_, i) => page(`p${i}`, null));
      const check = freshness(pages);
      expect(check.status).toBe('not_evaluable');
      expect(check.score).toBeNull();
    });

    it('reports stale content even though the crawl is current', () => {
      const check = freshness([page('a', daysAgo(900)), page('b', daysAgo(900)), page('c', daysAgo(900))]);
      expect(check.score).toBe(0);
    });

    it('says nothing about when the site was scanned', () => {
      const check = freshness([page('a', daysAgo(30)), page('b', daysAgo(30)), page('c', daysAgo(30))]);
      expect(check.detail).not.toMatch(/crawl|scan|last seen|checked/i);
    });
  });

  // ── 4. Malformed declarations are not evidence ────────────────────────────
  describe('4. only parseable, non-future dates count', () => {
    it('ignores an unparseable declaration', () => {
      const check = freshness([page('a', 'not a date'), page('b', daysAgo(10)), page('c', daysAgo(10))]);
      expect(check.status).toBe('not_evaluable');
    });

    it('ignores a future publication date', () => {
      const future = new Date(NOW + 90 * 24 * 60 * 60 * 1000).toISOString();
      const check = freshness([page('a', future), page('b', daysAgo(10)), page('c', daysAgo(10))]);
      expect(check.status).toBe('not_evaluable');
      expect(check.detail).toBe('Only 2 of 3 pages declare a publication date');
    });

    it('ignores an empty string', () => {
      const check = freshness([page('a', '   '), page('b', null), page('c', null)]);
      expect(check.detail).toBe('No page declares a publication date');
    });
  });

  // ── 5. It must not disturb the existing content score ─────────────────────
  describe('5. abstention leaves the content score untouched', () => {
    it('produces the same content score with and without an abstaining freshness check', () => {
      const pages = Array.from({ length: 5 }, (_, i) => page(`p${i}`, null));
      const result = scoreContentIntelligence(pages, [], NOW);
      const check = result.checks.find((c) => c.key === 'content_freshness')!;
      expect(check.status).toBe('not_evaluable');
      // `aggregate()` excludes not_evaluable checks, so the score is that of the evaluable checks alone.
      const evaluable = result.checks.filter((c) => c.status !== 'not_evaluable' && typeof c.score === 'number');
      const expected = Math.round(evaluable.reduce((sum, c) => sum + (c.score as number), 0) / evaluable.length);
      expect(Math.abs((result.contentScore ?? 0) - expected)).toBeLessThanOrEqual(1);
    });

    it('adds exactly one check and leaves the others alone', () => {
      const pages = [page('a', null)];
      const keys = scoreContentIntelligence(pages, [], NOW).checks.map((c) => c.key);
      expect(keys.filter((k) => k === 'content_freshness')).toHaveLength(1);
      expect(keys).toEqual(expect.arrayContaining(['authorship', 'forms_present', 'tables_present']));
    });
  });
});

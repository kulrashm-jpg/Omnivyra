/**
 * GAP-11A — the pages behind the count.
 *
 * GAP-10 delivered 66 checks with observed counts, and not one carried a URL: a reader told
 * "3 pages returned 4xx/5xx" could not act without knowing WHICH pages. FOUR checks already hold
 * the affected page rows inside their own computation AND count the population a reader is asking
 * about, so those rows can be shown without restructuring anything or acquiring anything new.
 *
 * `crawlability` is deliberately NOT among them: it counts pages that DID return 200, so no example
 * set both matches its aggregate and helps the reader. Its complement is already carried by
 * `redirect_chains` (3xx) and `broken_links` (4xx/5xx), each matched to its own aggregate.
 *
 * WHAT IS ASSERTED
 * The real engine, the real grouping producer, the real mapper and the real renderer. The rule
 * throughout is that a URL shown was a page actually fetched and counted — never derived from a
 * domain, path, title or count, and never attached to a check that observed nothing or could not
 * be evaluated.
 *
 * NOT IN SCOPE — content freshness. See the report: the crawl records only when Omnivyra
 * evaluated the site, so no honest content-freshness check can be built from it.
 */
import { scoreTechnicalIntelligence } from '../../services/websiteIntelligence/technicalIntelligenceEngine';
import { buildWebsiteChecks } from '../../services/snapshotReport/websiteCheckGrouping';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import { renderWebsiteChecks } from '../../services/intelligence/exportRendererReport1';
import type { SnapshotWebsiteChecks } from '../../services/snapshotReportTypes';

const NOW = Date.parse('2026-09-06T00:00:00.000Z');

type Page = Parameters<typeof scoreTechnicalIntelligence>[0][number];

const page = (over: Partial<Page> & { url: string }): Page => ({
  id: over.url, url: over.url, title: 'T', meta_description: 'D',
  headings: [{ level: 1, text: 'H' }], internal_link_count: 10,
  http_status: 200, crawl_depth: 1, last_crawled_at: '2026-09-05T00:00:00.000Z',
  crawl_metadata: { meta_tags: { robots: 'index,follow' } },
  ...over,
} as Page);

/** A corpus exercising every affected population at once. */
const CORPUS: Page[] = [
  page({ url: 'https://x.test/ok-b' }),
  page({ url: 'https://x.test/ok-a' }),
  page({ url: 'https://x.test/gone-2', http_status: 404 }),
  page({ url: 'https://x.test/gone-1', http_status: 500 }),
  page({ url: 'https://x.test/moved-2', http_status: 301 }),
  page({ url: 'https://x.test/moved-1', http_status: 302 }),
  page({ url: 'https://x.test/deep-2', crawl_depth: 7 }),
  page({ url: 'https://x.test/deep-1', crawl_depth: 4 }),
  page({ url: 'https://x.test/hidden-2', crawl_metadata: { meta_tags: { robots: 'noindex' } } }),
  page({ url: 'https://x.test/hidden-1', crawl_metadata: { meta_tags: { robots: 'NOINDEX,follow' } } }),
];

const checksOf = (pages: Page[]) => scoreTechnicalIntelligence(pages, NOW).checks;
const find = (pages: Page[], key: string) => checksOf(pages).find((c) => c.key === key)!;
const urls = (pages: Page[], key: string) => (find(pages, key).examples ?? []).map((e) => e.url);

function grouped(pages: Page[]): SnapshotWebsiteChecks | null {
  return buildWebsiteChecks({
    technical: { checks: checksOf(pages) },
    content: { checks: [] },
    accessibility: { checks: [] },
    pagesEvaluated: pages.length,
  });
}

function throughPersistence(wc: SnapshotWebsiteChecks | null) {
  const composed = JSON.parse(JSON.stringify({
    score: { value: 40, state: 'measured', label: 'x', available: true, dimensions: [] },
    summary: 's',
    sections: [{ section_name: 'Website Evidence', insights: [], actions: [] }],
    website_checks: wc,
  }));
  const payload = mapComposedReport(
    composed, 'snapshot', 'r', 'c', 'x.test', '2026-09-06', '2026-09-06T00:00:00.000Z', false, 'v',
  );
  return { composed, payload };
}

const render = (wc: SnapshotWebsiteChecks | null) =>
  renderWebsiteChecks({ report1: { website_checks: wc } } as never, 'Public Evidence');

describe('GAP-11A — example pages for the four page-scoped checks that count them', () => {
  // ── 1-5. Each check shows its own affected population ─────────────────────
  describe('1-5. each check exposes the pages IT counted', () => {
    it('broken_links shows the 4xx/5xx pages', () => {
      expect(find(CORPUS, 'broken_links').detail).toBe('2 pages returned 4xx/5xx');
      expect(urls(CORPUS, 'broken_links')).toEqual(['https://x.test/gone-1', 'https://x.test/gone-2']);
    });

    it('redirect_chains shows the 3xx pages', () => {
      expect(urls(CORPUS, 'redirect_chains')).toEqual(['https://x.test/moved-1', 'https://x.test/moved-2']);
    });

    it('crawlability stays AGGREGATE-ONLY — examples must never contradict the aggregate', () => {
      // This check counts pages that DID return 200. Examples matching that population would list
      // pages that worked (useless); examples of the complement would put "Pages returning 200"
      // above a list of 3xx/4xx/5xx URLs (false). So it carries none — and the non-200 population
      // is already covered, correctly matched to its own aggregate, by the two checks below.
      const c = find(CORPUS, 'crawlability');
      expect(c.detail).toBe('Pages returning 200');
      expect(c.examples).toBeUndefined();
      expect(c).not.toHaveProperty('examples');
    });

    it('the non-200 pages are still reachable, under the checks that actually count them', () => {
      const covered = [...urls(CORPUS, 'broken_links'), ...urls(CORPUS, 'redirect_chains')].sort();
      const nonOk = CORPUS.filter((p) => (p.http_status ?? 200) !== 200).map((p) => p.url).sort();
      expect(covered).toEqual(nonOk); // no information lost by dropping crawlability examples
    });

    it('page_depth shows the pages deeper than 3 clicks', () => {
      expect(urls(CORPUS, 'page_depth')).toEqual(['https://x.test/deep-1', 'https://x.test/deep-2']);
    });

    it('indexability shows the noindex pages', () => {
      expect(urls(CORPUS, 'indexability')).toEqual(['https://x.test/hidden-1', 'https://x.test/hidden-2']);
    });

    it('every example URL came from a real page row in the corpus', () => {
      const corpusUrls = new Set(CORPUS.map((p) => p.url));
      for (const key of ['broken_links', 'redirect_chains', 'page_depth', 'indexability']) {
        urls(CORPUS, key).forEach((u) => expect(corpusUrls.has(u)).toBe(true));
      }
    });
  });

  // ── 6-8. Determinism, dedupe, bounding ────────────────────────────────────
  describe('6-8. deterministic, deduplicated and bounded', () => {
    it('orders by URL, not by crawl order', () => {
      const reversed = [...CORPUS].reverse();
      expect(urls(reversed, 'broken_links')).toEqual(urls(CORPUS, 'broken_links'));
      expect(urls(reversed, 'indexability')).toEqual(urls(CORPUS, 'indexability'));
      // Ascending URL order, independent of the order pages were crawled in.
      expect(urls(CORPUS, 'redirect_chains')).toEqual([...urls(CORPUS, 'redirect_chains')].sort());
    });

    it('suppresses duplicate URLs', () => {
      const dupes = [
        page({ url: 'https://x.test/dupe', http_status: 404 }),
        page({ url: 'https://x.test/dupe', http_status: 404 }),
        page({ url: 'https://x.test/other', http_status: 404 }),
      ];
      expect(urls(dupes, 'broken_links')).toEqual(['https://x.test/dupe', 'https://x.test/other']);
    });

    it('caps the list at 5 and does not present it as exhaustive', () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        page({ url: `https://x.test/broken-${String(i).padStart(2, '0')}`, http_status: 503 }));
      expect(find(many, 'broken_links').detail).toBe('12 pages returned 4xx/5xx');
      expect(urls(many, 'broken_links')).toHaveLength(5);
      // The count still tells the truth about the full population.
      expect(urls(many, 'broken_links')[0]).toBe('https://x.test/broken-00');
    });
  });

  // ── 9-11. Nothing is invented ─────────────────────────────────────────────
  describe('9-11. an observed zero and an unevaluated check stay bare', () => {
    const CLEAN = [page({ url: 'https://x.test/a' }), page({ url: 'https://x.test/b' })];

    it('a check with zero affected pages carries no examples', () => {
      const c = find(CLEAN, 'broken_links');
      expect(c.detail).toBe('0 pages returned 4xx/5xx');
      expect(c.examples).toBeUndefined();
    });

    it('a not_evaluable check carries no examples', () => {
      const noMeta = [page({ url: 'https://x.test/a', crawl_metadata: {} })];
      const c = find(noMeta, 'indexability');
      expect(c.status).toBe('not_evaluable');
      expect(c.examples).toBeUndefined();
    });

    it('aggregate-only checks gain nothing', () => {
      for (const key of ['https', 'crawlability', 'meta_tags', 'duplicate_titles', 'heading_structure', 'internal_linking']) {
        expect(find(CORPUS, key).examples).toBeUndefined();
      }
    });
  });

  // ── 12. Persistence ───────────────────────────────────────────────────────
  describe('12. examples survive the persistence chain', () => {
    it('reaches the view payload byte-identical through the JSONB round trip', () => {
      const built = grouped(CORPUS);
      const { composed, payload } = throughPersistence(built);
      expect(composed.website_checks).toEqual(built);
      expect(payload!.websiteChecks).toEqual(built);
      const persisted = (composed.website_checks as SnapshotWebsiteChecks)
        .groups.flatMap((g) => g.checks).find((c) => c.key === 'broken_links');
      expect(persisted!.examples).toEqual([
        { url: 'https://x.test/gone-1' }, { url: 'https://x.test/gone-2' },
      ]);
    });

    it('the grouping producer drops examples from a not_evaluable check', () => {
      const noMeta = [page({ url: 'https://x.test/a', crawl_metadata: {} })];
      const built = grouped(noMeta)!;
      built.groups.flatMap((g) => g.checks)
        .filter((c) => c.status === 'not_evaluable')
        .forEach((c) => expect(c.examples).toBeUndefined());
    });
  });

  // ── 13-14. Rendering ──────────────────────────────────────────────────────
  describe('13-14. the renderer shows examples only when they exist', () => {
    it('renders the URLs under the check that produced them', () => {
      const html = render(grouped(CORPUS));
      expect(html).toContain('Example pages');
      expect(html).toContain('https://x.test/gone-1');
      expect(html).toContain('https://x.test/hidden-2');
      // Rendered inline with the check, not as a detached list.
      const i = html.indexOf('Broken pages');
      expect(html.slice(i, i + 900)).toContain('https://x.test/gone-1');
    });

    it('invents nothing when no check has examples', () => {
      const html = render(grouped([page({ url: 'https://x.test/a' }), page({ url: 'https://x.test/b' })]));
      expect(html).not.toContain('Example pages');
      expect(html).not.toMatch(/https?:\/\/x\.test/);
    });

    it('never claims the list is complete', () => {
      const html = render(grouped(CORPUS));
      expect(html).not.toMatch(/all (affected|pages)|complete list|every page/i);
    });
  });

  // ── 15-18. GAP-10 behaviour is untouched ──────────────────────────────────
  describe('15-18. GAP-10 semantics preserved', () => {
    it('keeps PUBLIC_OBSERVED provenance', () => {
      expect(grouped(CORPUS)!.provenance).toBe('PUBLIC_OBSERVED');
    });

    it('introduces no scoring field on the examples surface', () => {
      const raw = JSON.stringify(grouped(CORPUS));
      expect(raw).not.toMatch(/"(score|band|value|health|rating|severity|weight|percent|pct|confidence)"\s*:/i);
      grouped(CORPUS)!.groups.flatMap((g) => g.checks).forEach((c) => {
        (c.examples ?? []).forEach((e) => expect(Object.keys(e)).toEqual(['url']));
      });
    });

    it('leaves the engine counts and statuses unchanged', () => {
      // Same predicates as before: the rows are named, not recomputed.
      expect(find(CORPUS, 'broken_links').score).toBe(80);   // 100 - 2/10*100
      expect(find(CORPUS, 'page_depth').detail).toBe('2 pages deeper than 3 clicks');
      expect(find(CORPUS, 'indexability').detail).toBe('2 pages marked noindex');
    });

    it('keeps the zero-page abstention intact', () => {
      expect(grouped([])).toBeNull();
      expect(render(grouped([]))).toBe('');
    });

    it('still counts evaluated vs not_evaluable as before', () => {
      const c = grouped(CORPUS)!;
      const all = c.groups.flatMap((g) => g.checks);
      expect(c.evaluated + c.notEvaluable).toBe(c.total);
      expect(c.total).toBe(all.length);
    });
  });
});

/**
 * REPORT-1-INTEGRITY-REMEDIATION-001 — a presence check must never claim an observation
 * it did not make.
 *
 * THE DEFECT
 * The seven content presence checks in `contentIntelligenceEngine` passed the LITERAL status
 * 'pass' whatever the crawl found, with a detail that asserted presence in both directions
 * (`<label> page detected on the site`). Absence survived only in the numeric score — and
 * `websiteCheckGrouping.adopt()` deliberately drops the score. By the time
 * `exportRendererReport1` mapped pass -> Observed, the single carrier of absence was gone.
 *
 * A site with no testimonials, no case studies, no pricing page and no legal pages therefore
 * rendered four customer-facing rows reading:
 *     "Testimonials · Observed · Testimonials page detected on the site"
 *
 * That is a fabricated PUBLIC observation of a trust asset, on a public-domain report.
 *
 * WHAT IS ASSERTED
 * These tests run the REAL engine, the REAL grouping producer and the REAL renderer. Nothing
 * is stubbed: the fixtures are crawl-row shaped, so the false positive is chased all the way
 * to the rendered HTML rather than being caught at the source where a downstream layer could
 * reintroduce it.
 */
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import { buildWebsiteChecks } from '../../services/snapshotReport/websiteCheckGrouping';
import { renderWebsiteChecks } from '../../services/intelligence/exportRendererReport1';
import type { SnapshotWebsiteChecks } from '../../services/snapshotReportTypes';

/** The seven checks this slice governs. */
const SEVEN = [
  'contact_info', 'pricing_visibility', 'company_information',
  'legal_pages', 'testimonials', 'social_proof', 'case_studies',
] as const;

/** The four nearby checks whose existing not_evaluable behaviour must NOT move. */
const LEGITIMATE_ABSTAINERS = ['forms_present', 'tables_present', 'authorship', 'content_freshness'] as const;

type Page = Parameters<typeof scoreContentIntelligence>[0][number];

const page = (id: string, url: string, title: string): Page => ({
  id, url, title,
  meta_title: title, meta_description: 'x', page_type: null,
  headings: [{ level: 1, text: title }], ctas: [{ text: 'Contact us' }],
  internal_link_count: 5, http_status: 200, last_crawled_at: '2026-09-01T00:00:00.000Z',
  crawl_metadata: undefined,
} as Page);

/** A site that genuinely publishes all seven assets. */
const SITE_WITH_EVERYTHING: Page[] = [
  page('1', 'https://x.test/', 'Home'),
  page('2', 'https://x.test/contact', 'Contact'),
  page('3', 'https://x.test/pricing', 'Pricing'),
  page('4', 'https://x.test/about', 'About us'),
  page('5', 'https://x.test/privacy', 'Privacy policy'),
  page('6', 'https://x.test/testimonials', 'Testimonials'),
  page('7', 'https://x.test/customers', 'Our customers'),
  page('8', 'https://x.test/case-studies', 'Case study library'),
];

/** A real crawl that read real pages and found none of the seven. */
const SITE_WITH_NONE: Page[] = [
  page('1', 'https://y.test/', 'Home'),
  page('2', 'https://y.test/product', 'Product'),
  page('3', 'https://y.test/blog/post-one', 'Post one'),
];

const run = (pages: Page[]) => scoreContentIntelligence(pages, [], Date.parse('2026-09-28T00:00:00.000Z'));
const checkFor = (pages: Page[], key: string) => run(pages).checks.find((c) => c.key === key);

function group(pages: Page[]): SnapshotWebsiteChecks | null {
  return buildWebsiteChecks({
    technical: { checks: [] },
    content: { checks: run(pages).checks },
    accessibility: { checks: [] },
    pagesEvaluated: pages.length,
  } as never);
}

const render = (pages: Page[]): string =>
  renderWebsiteChecks({ report1: { website_checks: group(pages) } } as never, 'Public Evidence');

const decode = (html: string) =>
  html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * The rendered fragment for exactly ONE check row, so an "Observed" belonging to the NEXT
 * row can never be attributed to this one. A row is `<dt>label + status pill</dt><dd>detail</dd>`,
 * so the slice runs from the label to the first `</dd>` after it and stops there.
 */
function rowFor(html: string, label: string): string {
  const decoded = decode(html);
  const at = decoded.indexOf(label);
  expect(at).toBeGreaterThan(-1);
  const end = decoded.indexOf('</dd>', at);
  expect(end).toBeGreaterThan(at);
  return decoded.slice(at, end);
}

describe('REPORT-1 INTEGRITY — content presence checks', () => {
  describe('a site that publishes none of the seven', () => {
    it.each(SEVEN)('%s is not reported as a pass', (key) => {
      const c = checkFor(SITE_WITH_NONE, key);
      expect(c).toBeDefined();
      expect(c!.status).not.toBe('pass');
      expect(c!.score).toBe(0);
    });

    it.each(SEVEN)('%s states the absence, never a detection', (key) => {
      const detail = checkFor(SITE_WITH_NONE, key)!.detail ?? '';
      expect(detail).toMatch(/^No .+ found among the 3 pages read$/);
      expect(detail).not.toMatch(/detected on the site/);
    });

    it.each([
      'Contact information', 'Pricing visibility', 'Company information',
      'Legal pages', 'Testimonials', 'Social proof', 'Case studies',
    ])('%s does not render as Observed', (label) => {
      expect(rowFor(render(SITE_WITH_NONE), label)).not.toContain('Observed');
    });

    it('the fabricated detail string is gone from the whole rendered document', () => {
      expect(decode(render(SITE_WITH_NONE))).not.toContain('page detected on the site');
    });
  });

  describe('a site that publishes all seven', () => {
    it.each(SEVEN)('%s remains a pass with a full score', (key) => {
      const c = checkFor(SITE_WITH_EVERYTHING, key);
      expect(c!.status).toBe('pass');
      expect(c!.score).toBe(100);
      expect(c!.detail).toMatch(/found among the 8 pages read$/);
    });

    it.each([
      'Contact information', 'Pricing visibility', 'Company information',
      'Legal pages', 'Testimonials', 'Social proof', 'Case studies',
    ])('%s renders as Observed when it genuinely was', (label) => {
      expect(rowFor(render(SITE_WITH_EVERYTHING), label)).toContain('Observed');
    });
  });

  describe('a crawl with no pages', () => {
    it('emits the not_evaluable crawl check and none of the seven', () => {
      const checks = run([]).checks;
      expect(checks.find((c) => c.key === 'crawl')!.status).toBe('not_evaluable');
      for (const key of SEVEN) expect(checks.find((c) => c.key === key)).toBeUndefined();
    });

    it('renders no Observed presence claim at all', () => {
      const html = decode(render([]));
      expect(html).not.toContain('page detected on the site');
      for (const label of ['Testimonials', 'Case studies', 'Pricing visibility']) {
        expect(html).not.toContain(label);
      }
    });
  });

  describe('nearby checks that already abstained correctly', () => {
    it.each(LEGITIMATE_ABSTAINERS)('%s still abstains rather than passing', (key) => {
      const c = checkFor(SITE_WITH_NONE, key);
      expect(c).toBeDefined();
      expect(c!.status).toBe('not_evaluable');
      expect(c!.score).toBeNull();
    });
  });

  it('leaves contentScore unchanged — the correction is to what is CLAIMED, not scored', () => {
    const absent = run(SITE_WITH_NONE);
    for (const key of SEVEN) {
      const c = absent.checks.find((x) => x.key === key)!;
      expect(c.score).toBe(0);
      expect(c.status).not.toBe('not_evaluable');
    }
  });
});

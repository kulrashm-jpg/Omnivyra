/**
 * GAP-10 — the website checks the engines already compute must reach the customer.
 *
 * THE DEFECT
 * The technical, content and accessibility engines evaluate 60+ checks on every snapshot run.
 * `composeSnapshotReport` fetched all three into `engineEvidenceDigest` and used them for
 * NARRATIVE ONLY — `enrichRationale` compressed them into one "weakest X; strongest Y" sentence,
 * and the checks themselves were dropped before persistence. A production report therefore stated
 * `pagesEvaluated: 27, signalsEvaluated: 9/10` while `robots_txt`, `sitemap_xml`, `structured_data`,
 * `hreflang`, `duplicate_titles`, `not_evaluable` and `checksEvaluated` had ZERO occurrences in the
 * persisted `composed_report`. The site was measured and the customer was never told what was found.
 *
 * WHAT IS ASSERTED
 * These tests run the REAL grouping producer, the REAL mapper and the REAL renderer. Only the two
 * repository reads that would require a live crawl corpus are stubbed, and they are stubbed with
 * the engines' own `CheckResult` shape — never with pre-grouped output, so the grouping under test
 * is genuinely exercised.
 *
 * The rules that carry this gap:
 *   • `not_evaluable` is never converted into a zero and never into a pass.
 *   • An evaluated check that observed nothing stays distinct from one that was never evaluated.
 *   • Zero evaluable checks ⇒ the section abstains (GAP-02's rule applied here).
 *   • No score, band, percentage or aggregate is introduced anywhere.
 */
import { buildWebsiteChecks } from '../../services/snapshotReport/websiteCheckGrouping';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import { renderWebsiteChecks } from '../../services/intelligence/exportRendererReport1';
import { provenanceForSource } from '../../services/evidenceProvenance';
import type { CheckResult } from '../../services/platformIntelligence/confidence';
import type { SnapshotWebsiteChecks } from '../../services/snapshotReportTypes';

const check = (
  key: string,
  label: string,
  status: CheckResult['status'],
  score: number | null,
  detail?: string,
): CheckResult => ({ key, label, status, score, detail });

/** A crawl that produced real results, mixing every status the engines can emit. */
const TECHNICAL: CheckResult[] = [
  check('crawlability', 'Crawlability', 'pass', 100, 'Pages returning 200'),
  // An EVALUATED check that observed nothing — a genuine finding, not an absence of looking.
  check('broken_links', 'Broken pages (4xx/5xx)', 'pass', 100, '0 pages returned 4xx/5xx'),
  check('robots_txt', 'robots.txt', 'pass', 100, 'robots.txt present'),
  check('sitemap_xml', 'sitemap.xml', 'pass', 100, '42 sitemap URLs'),
  check('structured_data', 'Structured data / schema.org', 'pass', 60, 'Pages with JSON-LD structured data (types: Organization, FAQPage)'),
  check('duplicate_titles', 'Unique titles', 'warn', 70, '3 duplicate titles'),
  check('meta_tags', 'Meta title + description', 'fail', 20, '9 pages missing a meta description'),
  check('internal_linking', 'Internal linking', 'pass', 80, 'Average 12 internal links per page'),
  // NOT evaluated — no data existed. Must never read as zero or as a pass.
  check('hreflang', 'International targeting (hreflang)', 'not_evaluable', null, 'No hreflang detected (not applicable to single-language sites)'),
  check('javascript_errors', 'JavaScript errors', 'not_evaluable', null, 'Not observable from a static crawl'),
];
const CONTENT: CheckResult[] = [
  check('headline_clarity', 'Headline clarity (H1)', 'pass', 90, '18/20 pages have an H1'),
  check('faq', 'FAQ', 'not_evaluable', null, 'No FAQ content found'),
];
const ACCESSIBILITY: CheckResult[] = [
  check('alt_text', 'Image alt text', 'warn', 55, '12/30 images have alt text'),
  check('contrast', 'Colour contrast', 'not_evaluable', null, 'Requires rendered DOM / CSS'),
];

function build(overrides?: {
  technical?: CheckResult[];
  content?: CheckResult[];
  accessibility?: CheckResult[];
  pagesEvaluated?: number;
}): SnapshotWebsiteChecks | null {
  return buildWebsiteChecks({
    technical: { checks: overrides?.technical ?? TECHNICAL },
    content: { checks: overrides?.content ?? CONTENT },
    accessibility: { checks: overrides?.accessibility ?? ACCESSIBILITY },
    pagesEvaluated: overrides?.pagesEvaluated ?? 20,
  });
}

const allChecks = (c: SnapshotWebsiteChecks) => c.groups.flatMap((g) => g.checks);
const find = (c: SnapshotWebsiteChecks, key: string) => allChecks(c).find((x) => x.key === key);

/** Persist exactly as production does: through a JSONB round trip, then the real mapper. */
function throughPersistence(websiteChecks: SnapshotWebsiteChecks | null) {
  const composed = JSON.parse(JSON.stringify({
    score: { value: 40, state: 'measured', label: 'Developing', available: true, dimensions: [] },
    summary: 'x',
    // The mapper abstains on a report with no sections; one minimal section keeps this fixture on
    // the real production read path rather than short-circuiting it.
    sections: [{ section_name: 'Website Evidence', insights: [], actions: [] }],
    website_checks: websiteChecks,
  }));
  const payload = mapComposedReport(
    composed, 'snapshot', 'r-1', 'c-1', 'example.com',
    '2026-09-05', '2026-09-05T00:00:00.000Z', false, 'test',
  );
  return { composed, payload };
}

function render(websiteChecks: SnapshotWebsiteChecks | null): string {
  return renderWebsiteChecks(
    { report1: { website_checks: websiteChecks } } as never,
    'Public Evidence',
  );
}

const decode = (html: string) =>
  html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

describe('GAP-10 — website checks reach the customer', () => {
  // ── A. Populated crawl ────────────────────────────────────────────────────
  describe('A. a populated crawl delivers the checks', () => {
    it('carries every engine check across, with its own key, label, status and detail', () => {
      const built = build();
      expect(built).not.toBeNull();
      const c = built as SnapshotWebsiteChecks;
      expect(allChecks(c)).toHaveLength(TECHNICAL.length + CONTENT.length + ACCESSIBILITY.length);

      const sitemap = find(c, 'sitemap_xml');
      expect(sitemap).toMatchObject({
        key: 'sitemap_xml', label: 'sitemap.xml', status: 'pass',
        detail: '42 sitemap URLs', engine: 'technical',
      });
    });

    it('renders the identifiers that had ZERO occurrences in the persisted production report', () => {
      // The exact identifiers the production baseline proved absent.
      const html = decode(render(build()));
      for (const label of ['robots.txt', 'sitemap.xml', 'Structured data / schema.org', 'Unique titles', 'International targeting (hreflang)']) {
        expect(html).toContain(label);
      }
      // ...and their observed counts, not just their names.
      expect(html).toContain('42 sitemap URLs');
      expect(html).toContain('3 duplicate titles');
      expect(html).toContain('types: Organization, FAQPage');
    });

    it('groups checks under the five named groups plus the honest extras', () => {
      const c = build() as SnapshotWebsiteChecks;
      const byId = Object.fromEntries(c.groups.map((g) => [g.id, g.checks.map((x) => x.key)]));
      expect(byId.reachability).toEqual(expect.arrayContaining(['crawlability', 'broken_links']));
      expect(byId.indexability).toEqual(expect.arrayContaining(['robots_txt', 'sitemap_xml', 'hreflang', 'duplicate_titles']));
      expect(byId.metadata).toEqual(expect.arrayContaining(['meta_tags']));
      expect(byId.structured_data).toEqual(expect.arrayContaining(['structured_data']));
      expect(byId.linking).toEqual(expect.arrayContaining(['internal_linking']));
      // Content and accessibility keep their own groups rather than being mis-filed.
      expect(byId.content_structure).toEqual(expect.arrayContaining(['headline_clarity', 'faq']));
      expect(byId.accessibility).toEqual(expect.arrayContaining(['alt_text', 'contrast']));
      expect(byId.rendering).toEqual(expect.arrayContaining(['javascript_errors']));
    });

    it('never carries the engines\' per-check numeric score into the contract', () => {
      const c = build() as SnapshotWebsiteChecks;
      for (const one of allChecks(c)) {
        expect(one).not.toHaveProperty('score');
      }
    });
  });

  // ── B. not_evaluable is not zero and not a pass ───────────────────────────
  describe('B. not_evaluable stays not_evaluable', () => {
    it('keeps the status and refuses to invent a value for it', () => {
      const c = build() as SnapshotWebsiteChecks;
      const hreflang = find(c, 'hreflang');
      expect(hreflang?.status).toBe('not_evaluable');
      expect(hreflang).not.toHaveProperty('score');
      expect(hreflang?.detail).toContain('No hreflang detected');
    });

    it('renders it as "Not evaluated" — never as 0 and never as a pass', () => {
      const html = decode(render(build()));
      const start = html.indexOf('International targeting (hreflang)');
      expect(start).toBeGreaterThan(-1);
      // The slice covering this check's own row.
      const row = html.slice(start, start + 400);
      expect(row).toContain('Not evaluated');
      expect(row).not.toMatch(/\bObserved\b/);
      expect(row).not.toMatch(/\b0\s*%/);
      expect(row).not.toMatch(/>\s*0\s*</);
    });
  });

  // ── C. Zero evidence ──────────────────────────────────────────────────────
  describe('C. zero evidence abstains', () => {
    // Exactly what all three engines emit for a company with no crawled pages.
    const ZERO = [check('crawl', 'Crawl coverage', 'not_evaluable', null, 'No crawled pages — run the website scan')];

    it('produces no section at all when nothing was evaluable', () => {
      const built = build({ technical: ZERO, content: ZERO, accessibility: ZERO, pagesEvaluated: 0 });
      expect(built).toBeNull();
    });

    it('renders nothing, so no check can appear as passing', () => {
      const html = render(build({ technical: ZERO, content: ZERO, accessibility: ZERO, pagesEvaluated: 0 }));
      expect(html).toBe('');
    });

    it('manufactures no numeric aggregate for the zero-evidence case', () => {
      const { composed } = throughPersistence(build({ technical: ZERO, content: ZERO, accessibility: ZERO, pagesEvaluated: 0 }));
      expect(composed.website_checks).toBeNull();
      expect(JSON.stringify(composed.website_checks)).not.toMatch(/\d/);
    });
  });

  // ── D. Observed zero ≠ not evaluated ──────────────────────────────────────
  describe('D. an observed zero is not an unevaluated check', () => {
    it('distinguishes the two in the contract', () => {
      const c = build() as SnapshotWebsiteChecks;
      const observedZero = find(c, 'broken_links');   // evaluated, found none
      const notEvaluated = find(c, 'hreflang');       // never evaluated

      expect(observedZero?.status).toBe('pass');
      expect(observedZero?.detail).toBe('0 pages returned 4xx/5xx');
      expect(notEvaluated?.status).toBe('not_evaluable');
      expect(observedZero?.status).not.toBe(notEvaluated?.status);
    });

    it('distinguishes the two in the rendered output', () => {
      const html = decode(render(build()));
      const zeroStart = html.indexOf('Broken pages (4xx/5xx)');
      const zeroRow = html.slice(zeroStart, zeroStart + 400);
      // The observed zero keeps its real finding and is NOT labelled "Not evaluated".
      expect(zeroRow).toContain('0 pages returned 4xx/5xx');
      expect(zeroRow).not.toContain('Not evaluated');
    });

    it('counts an observed zero as evaluated', () => {
      const c = build() as SnapshotWebsiteChecks;
      const notEvaluable = allChecks(c).filter((x) => x.status === 'not_evaluable').length;
      expect(c.evaluated).toBe(c.total - notEvaluable);
      expect(c.notEvaluable).toBe(notEvaluable);
      expect(c.evaluated + c.notEvaluable).toBe(c.total);
    });
  });

  // ── E. Provenance ─────────────────────────────────────────────────────────
  describe('E. provenance comes from the canonical policy', () => {
    it('classifies the surface through evidenceProvenance, not a local literal', () => {
      const c = build() as SnapshotWebsiteChecks;
      expect(c.provenance).toBe(provenanceForSource('public_audit'));
      expect(c.provenance).toBe('PUBLIC_OBSERVED');
    });

    it('surfaces no connected/private source through this evidence', () => {
      const { composed } = throughPersistence(build());
      const raw = JSON.stringify(composed.website_checks);
      expect(raw).not.toContain('gsc');
      expect(raw).not.toContain('search_console');
      expect(raw).not.toContain('COMPANY_CONFIRMED');
      expect(raw).not.toContain('CONNECTED_SOURCE');
    });
  });

  // ── F. JSONB round trip ───────────────────────────────────────────────────
  describe('F. the evidence survives persistence', () => {
    it('is byte-identical through the JSONB round trip and reaches the view payload', () => {
      const built = build();
      const { composed, payload } = throughPersistence(built);
      expect(composed.website_checks).toEqual(built);
      expect(payload).not.toBeNull();
      expect(payload!.websiteChecks).toEqual(built);
    });

    it('renders from the MAPPED payload, completing composer → JSONB → mapper → renderer', () => {
      const { payload } = throughPersistence(build());
      const html = decode(renderWebsiteChecks(
        { report1: { website_checks: payload!.websiteChecks } } as never,
        'Public Evidence',
      ));
      expect(html).toContain('robots.txt');
      expect(html).toContain('42 sitemap URLs');
      expect(html).toContain('Not evaluated');
    });

    it('keeps detail as null rather than dropping the key when the engine wrote none', () => {
      const built = build({ technical: [check('https', 'HTTPS', 'pass', 100)] }) as SnapshotWebsiteChecks;
      const https = find(built, 'https');
      expect(https).toHaveProperty('detail', null);
      const { composed } = throughPersistence(built);
      const roundTripped = (composed.website_checks as SnapshotWebsiteChecks)
        .groups.flatMap((g) => g.checks).find((x) => x.key === 'https');
      expect(roundTripped).toHaveProperty('detail', null);
    });
  });

  // ── G. No scoring introduced ──────────────────────────────────────────────
  describe('G. GAP-10 introduces no scoring surface', () => {
    it('emits no score, band, value, rating or percentage anywhere in the evidence', () => {
      const { composed } = throughPersistence(build());
      const forbidden = /"(score|band|value|health|rating|severity|weight|percent|pct|confidence)"\s*:/i;
      expect(JSON.stringify(composed.website_checks)).not.toMatch(forbidden);
    });

    it('exposes only check COUNTS, and never a ratio derived from them', () => {
      const c = build() as SnapshotWebsiteChecks;
      // Counts are integers and are disclosure, in the GAP-09 "9 of 10 signals" idiom.
      for (const n of [c.evaluated, c.notEvaluable, c.total, c.pagesEvaluated]) {
        expect(Number.isInteger(n)).toBe(true);
      }
      // No key on the object is a computed proportion.
      const keys = Object.keys(c);
      expect(keys.sort()).toEqual(
        ['evaluated', 'groups', 'notEvaluable', 'pagesEvaluated', 'provenance', 'total'].sort(),
      );
    });

    it('renders no percentage and no score for the section', () => {
      const html = decode(render(build()));
      // The engines' per-check scores (100, 60, 70, 20, 90, 55) must not appear as readings.
      expect(html).not.toMatch(/\b\d{1,3}\s*%/);
      // No numeric reading of any kind: no "72/100", no "Score: 72", no band word applied to it.
      expect(html).not.toMatch(/\d+\s*\/\s*100/);
      // A score VALUE, not the word — the framing sentence below legitimately says "not a score:".
      expect(html).not.toMatch(/score\s*[:=]\s*\d/i);
      expect(html).not.toMatch(/\b(foundational|developing|established|leading)\b/i);
      // The only occurrence of the word "score" is the sentence denying there is one.
      expect(html.match(/score/gi)).toHaveLength(1);
      expect(html).toContain('These are observations, not a score');
    });
  });
});

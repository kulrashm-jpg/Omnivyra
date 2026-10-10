/**
 * R1-C — CRAWL EVIDENCE READER INTEGRITY (consumer side).
 *
 * WHY THIS SUITE EXISTS. Four readers of the crawl evidence turned a MISSING
 * measurement into a negative finding about the customer's company:
 *
 *   4. CTA DENOMINATOR. `assessDigitalExperience` measures CTA coverage over every
 *      row that produced an HTTP response — which includes the 4xx/5xx rows, whose
 *      body `fetchHtml` deliberately never reads. A broken URL therefore counted a
 *      second time, as a page that "offers no next step", and dragged coverage under
 *      the 50% threshold so the finding fired for sites that are above it.
 *   5. REUSE COUNT. `ensureReportCrawlEvidence` decided "we already have usable
 *      evidence" from the TOTAL row count for the domain. `ga4IngestionService`
 *      writes a row per analytics path with no `http_status` at all, and the crawler
 *      writes one per 404 and per transport failure, so two real pages plus three
 *      GA4 rows cleared the three-page threshold and the report was composed from
 *      two pages while reporting five.
 *   6. HOMEPAGE SELECTION. "Homepage positioning" was judged from `pageTitles[0]`,
 *      and the page query is ordered `last_crawled_at DESC` — so the copy assessed
 *      as the home page's was the copy of whichever page was crawled LAST.
 *   7. LEGAL-PAGE REGEX. `/terms|tos/i` was tested as a bare substring of the whole
 *      URL, so `tos` inside `photos` made `/photos` the site's Terms page: a legal
 *      declaration the site never made.
 *
 *   1 (consumer half). H1 absence was asserted for rows nobody fetched, and "no H1
 *      element" was collapsed into "no H1 with text".
 *
 * NEGATIVE CONTROLS pair every assertion with the pre-fix rule re-run on the same
 * fixture. NON-VACUITY CONTROLS prove the fixes are not blanket suppression: a real
 * CTA gap, a genuinely missing H1, a real legal page and a genuinely stale corpus
 * must all still be reported.
 *
 * SECRETS: all synthetic. No network, no credential, no real host.
 */
export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};

const numCmp = (left: unknown, right: unknown): number => {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? 0 : a < b ? -1 : 1;
  const sa = String(left);
  const sb = String(right);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
};

/** A PostgREST-shaped fake applying each filter the way the real one does. */
jest.mock('../../db/supabaseClient', () => {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let head = false;
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const run = (): Row[] => {
      let rows = [...(TABLES[table] ?? [])];
      for (const f of filters) rows = rows.filter(f);
      if (order) {
        const { column, ascending } = order;
        rows.sort((a, b) => (String(a[column] ?? '') < String(b[column] ?? '') ? -1 : 1) * (ascending ? 1 : -1));
      }
      return rows.slice(0, limit);
    };
    const q: Record<string, unknown> = {
      select: (_c: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      not: (c: string, _op: string, _v: unknown) => { filters.push((r) => r[c] != null); return q; },
      gte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && numCmp(r[c], v) >= 0); return q; },
      lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && numCmp(r[c], v) < 0); return q; },
      order: (c: string, opts?: { ascending?: boolean }) => { order = { column: c, ascending: opts?.ascending !== false }; return q; },
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const rows = run();
        return Promise.resolve(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null })
          .then(resolve, reject);
      },
    };
    return q;
  };
  return { supabase: { from: (table: string) => query(table) } };
});

const crawlCalls: Array<{ companyId: string }> = [];
jest.mock('../../services/crawlerService', () => ({
  crawlCompanyWebsite: async (input: { companyId: string; rootUrl?: string }) => {
    crawlCalls.push(input);
    return { pagesInserted: 0, pagesProcessed: 0, rootUrl: input.rootUrl ?? '' };
  },
}));

import { assessDigitalExperience, type ExperiencePage } from '../../services/digitalExperience';
import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';
import { ensureReportCrawlEvidence } from '../../services/crawl/reportCrawlEvidenceService';

const HOUR = 3_600_000;
const freshStamp = () => new Date(Date.now() - HOUR).toISOString();

beforeEach(() => {
  for (const key of Object.keys(TABLES)) delete TABLES[key];
  crawlCalls.length = 0;
});

// ── Defect 4 — the CTA denominator ───────────────────────────────────────────

/** A readable page with a CTA; `n` of them. */
const okPage = (i: number, withCta: boolean): ExperiencePage => ({
  url: `https://site.test/p${i}`,
  page_type: 'other',
  title: `Page ${i}`,
  meta_description: `Page ${i} description that is long enough to be a real description.`,
  headings: [{ level: 1, text: `Page ${i}` }],
  ctas: withCta ? [{ text: 'Book a demo', href: '/demo', source: 'anchor' }] : [],
  internal_link_count: 4,
  http_status: 200,
  crawl_depth: 1,
  wordCount: 400,
  crawl_metadata: { reachability: { outcome: 'success', status: 200, reason: null } },
});

/** A page that ANSWERED 404 — so its body was never read and it has no ctas. */
const brokenPage = (i: number): ExperiencePage => ({
  url: `https://site.test/gone-${i}`,
  page_type: 'other',
  title: null,
  meta_description: null,
  headings: null,
  ctas: [],
  internal_link_count: null,
  http_status: 404,
  crawl_depth: 2,
  wordCount: 0,
  crawl_metadata: { reachability: { outcome: 'client_error', status: 404, reason: 'HTTP 404' } },
});

const ctaFinding = (pages: readonly ExperiencePage[]) =>
  assessDigitalExperience({ pages }).findings.find((f) => f.problem === 'Most pages offer no clear next step');

describe('R1-C defect 4 — CTA coverage is measured over the pages whose body was read', () => {
  /** 3 readable pages, all with a CTA (100% coverage), plus 4 genuine 404s. */
  const MIXED: ExperiencePage[] = [
    okPage(1, true), okPage(2, true), okPage(3, true),
    brokenPage(1), brokenPage(2), brokenPage(3), brokenPage(4),
  ];

  it('a site with full CTA coverage and some broken URLs gets NO missing-CTA finding', () => {
    expect(ctaFinding(MIXED)).toBeUndefined();
  });

  it('NEGATIVE CONTROL — the pre-fix denominator reports 3 of 7 and fires the finding', () => {
    const responded = MIXED; // every one of these produced an HTTP response
    const withCta = responded.filter((p) => (p.ctas ?? []).length > 0);
    expect(withCta.length).toBe(3);
    expect(responded.length).toBe(7);
    expect(withCta.length / responded.length).toBeLessThan(0.5); // → the finding fired
  });

  it('the broken URLs are still reported — once, as broken pages', () => {
    const result = assessDigitalExperience({ pages: MIXED });
    const broken = result.findings.find((f) => f.problem === 'Pages return errors');
    expect(broken).toBeDefined();
    expect(broken?.evidence).toMatch(/4 of 7 crawled pages returned 4xx\/5xx/);
  });

  it('NON-VACUITY — a real CTA gap on readable pages is still reported, with the right denominator', () => {
    const pages = [okPage(1, true), okPage(2, false), okPage(3, false), okPage(4, false), brokenPage(1)];
    const finding = ctaFinding(pages);
    expect(finding).toBeDefined();
    expect(finding?.evidence).toMatch(/Only 1 of 4 readable pages expose a call to action/);
    expect(finding?.evidence).toMatch(/1 further page answered with an error/);
  });

  it('NON-VACUITY — when every page answered with an error, conversion readiness abstains', () => {
    const result = assessDigitalExperience({ pages: [brokenPage(1), brokenPage(2), brokenPage(3)] });
    expect(ctaFinding(result.pillars.length ? [brokenPage(1), brokenPage(2), brokenPage(3)] : [])).toBeUndefined();
    const pillar = result.pillars.find((p) => p.pillar === 'conversion_readiness');
    // Two of the three conversion signals could not be evaluated, so coverage says so
    // instead of the pillar reading back as "ready".
    expect(pillar?.coverage.evaluated).toBeLessThan(3);
  });
});

// ── Defect 1 (consumer half) — the home page's H1 statement ──────────────────

const homePage = (overrides: Partial<ExperiencePage>): ExperiencePage => ({
  url: 'https://site.test/',
  page_type: 'home',
  title: 'Acme',
  meta_description: 'Acme description that is long enough to count as a real description.',
  headings: [],
  ctas: [{ text: 'Book a demo', href: '/demo' }],
  internal_link_count: 9,
  http_status: 200,
  crawl_depth: 0,
  wordCount: 400,
  crawl_metadata: { reachability: { outcome: 'success', status: 200, reason: null } },
  ...overrides,
});

const homeFinding = (pages: readonly ExperiencePage[]) =>
  assessDigitalExperience({ pages }).findings
    .find((f) => f.problem === 'The home page does not clearly state what the company does');

describe('R1-C defect 1 (consumer) — three H1 states, not two', () => {
  it('an image-only H1 WITH alt text is a real headline and raises no finding', () => {
    const pages = [homePage({ headings: [{ level: 1, text: 'Acme Analytics', textSource: 'image_alt' }] }), okPage(2, true), okPage(3, true)];
    expect(homeFinding(pages)).toBeUndefined();
  });

  it('an H1 element with no readable text is reported as exactly that', () => {
    const pages = [homePage({ headings: [{ level: 1, text: '', textSource: 'none' }] }), okPage(2, true), okPage(3, true)];
    const finding = homeFinding(pages);
    expect(finding?.evidence).toMatch(/has an H1 element that carries no readable text/);
  });

  it('NON-VACUITY — a server-rendered home page with NO H1 element is still critical', () => {
    const pages = [homePage({ headings: [{ level: 2, text: 'Secondary' }] }), okPage(2, true), okPage(3, true)];
    const finding = homeFinding(pages);
    expect(finding?.evidence).toMatch(/exposes NO H1 heading in the HTML served to the crawler/);
    expect(finding?.severity).toBe('critical');
  });

  it('where client-side rendering is suspected, H1 absence is stated as a detection limit', () => {
    // Three 200 pages with almost no text and at most one heading → the CSR detector fires.
    const shell = (i: number): ExperiencePage => ({
      ...okPage(i, false), wordCount: 5, headings: [], meta_description: 'x'.repeat(80),
    });
    const pages = [homePage({ headings: [], wordCount: 5 }), shell(2), shell(3), shell(4)];
    const result = assessDigitalExperience({ pages });
    expect(result.limitations.some((l) => l.kind === 'client_side_rendering')).toBe(true);
    const finding = result.findings
      .find((f) => f.problem === 'The home page does not clearly state what the company does');
    expect(finding?.evidence).toMatch(/detection is static-HTML only/);
    expect(finding?.severity).toBe('moderate');
  });
});

// ── Defect 6 — home-page identification ──────────────────────────────────────

const auditPageRow = (over: Row): Row => ({
  id: String(over.id),
  company_id: 'co-1',
  domain_id: 'd-1',
  url: 'https://site.test/x',
  page_type: 'other',
  title: null,
  meta_title: null,
  meta_description: null,
  headings: [{ level: 1, text: 'Heading' }],
  ctas: [],
  internal_link_count: 3,
  http_status: 200,
  crawl_depth: 1,
  crawl_metadata: {},
  last_crawled_at: freshStamp(),
  ...over,
});

const seedAudit = (pages: Row[], content: Row[] = []) => {
  TABLES.canonical_domains = [{ id: 'd-1', company_id: 'co-1', primary_domain: 'site.test' }];
  TABLES.canonical_pages = pages;
  TABLES.page_content = content;
  TABLES.page_links = [];
};

describe('R1-C defect 6 — "homepage positioning" is read off the home page', () => {
  /**
   * The home page says who it is for and what it does; a blog post crawled LATER
   * says neither. `last_crawled_at DESC` puts the blog post first.
   */
  const HOME = auditPageRow({
    id: 'home', url: 'https://site.test/', page_type: 'home',
    title: 'Acme helps marketing teams grow faster',
    meta_title: 'Acme helps marketing teams grow faster',
    meta_description: 'Acme helps marketing teams improve and grow faster with clear measurement.',
    last_crawled_at: new Date(Date.now() - 5 * HOUR).toISOString(),
  });
  const BLOG = auditPageRow({
    id: 'blog', url: 'https://site.test/blog/post-1', page_type: 'blog',
    title: 'Notes from a conference',
    meta_title: 'Notes from a conference',
    meta_description: 'A short recap of a conference we attended last month in the city.',
    headings: [{ level: 1, text: 'Notes from a conference' }],
    last_crawled_at: new Date(Date.now() - 1 * HOUR).toISOString(),
  });

  it('reports the real home page URL, and judges its copy', async () => {
    seedAudit([BLOG, HOME]);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    expect(audit.site_structure.homepage).toBe('https://site.test/');
    expect(audit.decisions.some((d) => d.issue_type === 'intent_gap')).toBe(false);
  });

  it('NEGATIVE CONTROL — pageTitles[0] on the same corpus is the blog post, not the home page', async () => {
    seedAudit([BLOG, HOME]);
    // The reader orders by last_crawled_at DESC, so index 0 is the most recent crawl.
    const ordered = [BLOG, HOME].sort((a, b) => String(b.last_crawled_at) < String(a.last_crawled_at) ? -1 : 1);
    const pageTitles = ordered.map((p) => `${p.title ?? ''} ${p.meta_title ?? ''} ${p.meta_description ?? ''}`.trim());
    expect(pageTitles[0]).toMatch(/Notes from a conference/);
    expect(pageTitles[0]).not.toMatch(/Acme helps marketing teams/);
  });

  it('no identifiable home page means no homepage claim at all', async () => {
    seedAudit([BLOG]);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    expect(audit.site_structure.homepage).toBeNull();
    expect(audit.decisions.some((d) => d.issue_type === 'intent_gap')).toBe(false);
  });

  it('NON-VACUITY — a home page that really says neither still raises the positioning gap', async () => {
    const vagueHome = auditPageRow({
      id: 'home', url: 'https://site.test/', page_type: 'home',
      title: 'Welcome', meta_title: 'Welcome', meta_description: 'Welcome to our website.',
      headings: [{ level: 1, text: 'Welcome' }],
    });
    seedAudit([vagueHome]);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    expect(audit.site_structure.homepage).toBe('https://site.test/');
    expect(audit.decisions.some((d) => d.issue_type === 'intent_gap')).toBe(true);
  });
});

// ── Defect 7 — legal-page classification ─────────────────────────────────────

describe('R1-C defect 7 — a legal page must occupy a path segment, not a substring', () => {
  const photoPages = [
    auditPageRow({ id: 'p1', url: 'https://site.test/', page_type: 'home', title: 'Acme helps teams grow faster' }),
    auditPageRow({ id: 'p2', url: 'https://site.test/photos' }),
    auditPageRow({ id: 'p3', url: 'https://site.test/blog/best-photos-of-2026' }),
  ];

  it('/photos is not the site\'s Terms page', async () => {
    seedAudit(photoPages);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    expect(audit.site_structure.legal_pages).toEqual([]);
    const terms = audit.declared_evidence?.legal_transparency.items.find((i) => i.key === 'terms');
    expect(terms?.present).toBe(false);
    expect(audit.declared_evidence?.legal_transparency.present_count).toBe(0);
  });

  it('NEGATIVE CONTROL — the pre-fix regex declares both photo URLs as Terms', () => {
    const legacy = /terms|tos/i;
    expect(legacy.test('https://site.test/photos')).toBe(true);
    expect(legacy.test('https://site.test/blog/best-photos-of-2026')).toBe(true);
  });

  it('NON-VACUITY — real legal pages are still detected, in every common spelling', async () => {
    seedAudit([
      auditPageRow({ id: 'p1', url: 'https://site.test/', page_type: 'home', title: 'Acme helps teams grow faster' }),
      auditPageRow({ id: 'p2', url: 'https://site.test/terms' }),
      auditPageRow({ id: 'p3', url: 'https://site.test/privacy-policy' }),
      auditPageRow({ id: 'p4', url: 'https://site.test/legal/tos' }),
      auditPageRow({ id: 'p5', url: 'https://site.test/cookie-policy' }),
      auditPageRow({ id: 'p6', url: 'https://site.test/impressum' }),
    ]);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    expect(audit.site_structure.legal_pages).toHaveLength(5);
    const present = (audit.declared_evidence?.legal_transparency.items ?? [])
      .filter((i) => i.present).map((i) => i.key).sort();
    expect(present).toEqual(['cookie', 'imprint', 'legal_notice', 'privacy', 'terms']);
  });
});

// ── Defect 1 (consumer half, audit) — H1 absence needs a page that was read ───

describe('R1-C defect 1 (audit) — H1 absence is only claimed for pages that were read', () => {
  const HOME = auditPageRow({
    id: 'home', url: 'https://site.test/', page_type: 'home',
    title: 'Acme helps marketing teams grow faster', meta_title: 'Acme helps marketing teams grow faster',
    meta_description: 'Acme helps marketing teams improve and grow faster with clear measurement.',
    headings: [{ level: 1, text: 'Acme Analytics' }],
  });
  /** A GA4-created row: never fetched, so no status and no headings. */
  const GA4_ROW = auditPageRow({
    id: 'ga4', url: 'https://site.test/campaign-landing', page_type: 'landing',
    headings: null, http_status: null, internal_link_count: 0, last_crawled_at: null,
  });
  /** A crawled page whose H1 is an unlabelled image. */
  const TEXTLESS = auditPageRow({
    id: 'textless', url: 'https://site.test/product', page_type: 'product',
    headings: [{ level: 1, text: '', textSource: 'none' }, { level: 2, text: 'Features' }],
  });

  const h1Evidence = async (pages: Row[]) => {
    seedAudit(pages);
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', domainScope: { domainId: 'd-1' } });
    // Two decisions share `issue_type: 'weak_content_depth'`; the H1/thin-content one
    // is identified by its own evidence key, not by the shared issue type.
    const decision = audit.decisions.find((d) =>
      d.issue_type === 'weak_content_depth'
      && Object.prototype.hasOwnProperty.call(d.evidence ?? {}, 'pages_without_h1_count'));
    return decision?.evidence as Record<string, unknown> | undefined;
  };

  it('a never-fetched GA4 row is not reported as a page without an H1', async () => {
    const evidence = await h1Evidence([HOME, GA4_ROW]);
    expect(evidence).toBeUndefined(); // nothing to report: the only read page has an H1
  });

  it('NEGATIVE CONTROL — the pre-fix predicate counts the GA4 row as having no H1', () => {
    const legacyWithoutH1 = [HOME, GA4_ROW].filter((page) => {
      const headings = page.headings as Array<{ level?: number; text?: string }> | null;
      if (!Array.isArray(headings) || headings.length === 0) return true;
      return !headings.some((h) => Number(h?.level ?? 0) === 1 && String(h?.text ?? '').trim().length > 0);
    });
    expect(legacyWithoutH1.map((p) => p.id)).toEqual(['ga4']);
  });

  it('separates "no H1 element" from "an H1 with no readable text", and names the detector limit', async () => {
    const noH1 = auditPageRow({ id: 'nohead', url: 'https://site.test/pricing', page_type: 'pricing', headings: [{ level: 2, text: 'Plans' }] });
    const evidence = await h1Evidence([HOME, TEXTLESS, noH1, GA4_ROW]);
    expect(evidence?.pages_without_h1_count).toBe(2);
    expect(evidence?.pages_with_textless_h1_count).toBe(1);
    expect(evidence?.pages_with_no_h1_element_count).toBe(1);
    expect(evidence?.h1_detection).toBe('static_html_only');
    expect(String(evidence?.h1_detection_limitation)).toMatch(/inserted by JavaScript/);
    // The GA4 row is excluded from the examined population, not silently counted.
    expect(evidence?.h1_pages_examined).toBe(3);
  });
});

// ── Defect 5 — what counts as usable stored evidence ─────────────────────────

const storedPage = (id: string, status: number | null): Row => ({
  id, company_id: 'co-1', domain_id: 'd-1', url: `https://site.test/${id}`,
  page_type: 'other', http_status: status,
  last_crawled_at: status === null ? null : freshStamp(),
});

const seedEvidence = (pages: Row[]) => {
  TABLES.canonical_domains = [{ id: 'd-1', company_id: 'co-1', primary_domain: 'site.test' }];
  TABLES.canonical_pages = pages;
};

describe('R1-C defect 5 — "usable evidence" means pages whose body was read', () => {
  /** Two real pages + three GA4 rows: five rows, two pages of evidence. */
  const TWO_REAL_THREE_GA4 = [
    storedPage('a', 200), storedPage('b', 200),
    storedPage('ga1', null), storedPage('ga2', null), storedPage('ga3', null),
  ];

  it('two readable pages padded by three analytics-only rows does NOT count as usable', async () => {
    seedEvidence(TWO_REAL_THREE_GA4);
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'site.test' });
    expect(result.action).toBe('refreshed');
    expect(result.reason).toMatch(/only 2 readable page\(s\)/);
    expect(result.reason).toMatch(/plus 3 stored row\(s\) with no readable body/);
    expect(crawlCalls).toHaveLength(1);
  });

  it('NEGATIVE CONTROL — the pre-fix total-row count clears the threshold and reuses', () => {
    const MIN_USABLE_PAGES = 3;
    expect(TWO_REAL_THREE_GA4.length).toBe(5);
    expect(TWO_REAL_THREE_GA4.length >= MIN_USABLE_PAGES).toBe(true); // → 'reused', on two pages
  });

  it('fresh error rows are not usable evidence either', async () => {
    seedEvidence([storedPage('g1', 404), storedPage('g2', 404), storedPage('g3', 500), storedPage('g4', 404)]);
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'site.test' });
    expect(result.action).toBe('refreshed');
    expect(result.reason).toMatch(/only 0 readable page\(s\)/);
    expect(crawlCalls).toHaveLength(1);
  });

  it('NON-VACUITY — three genuinely readable fresh pages are still reused, with no crawl', async () => {
    seedEvidence([storedPage('a', 200), storedPage('b', 200), storedPage('c', 204)]);
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'site.test' });
    expect(result.action).toBe('reused');
    expect(result.reason).toMatch(/3 readable page\(s\)/);
    expect(crawlCalls).toEqual([]);
  });

  it('NON-VACUITY — freshness is read off the readable rows, so a stale corpus is re-crawled', async () => {
    const stale = new Date(Date.now() - 400 * HOUR).toISOString();
    seedEvidence([
      { ...storedPage('a', 200), last_crawled_at: stale },
      { ...storedPage('b', 200), last_crawled_at: stale },
      { ...storedPage('c', 200), last_crawled_at: stale },
      // A fresh row that was never readable must not make the corpus look fresh.
      { ...storedPage('err', 404), last_crawled_at: freshStamp() },
    ]);
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'site.test' });
    expect(result.action).toBe('refreshed');
    expect(result.reason).toMatch(/past the/);
    expect(crawlCalls).toHaveLength(1);
  });
});

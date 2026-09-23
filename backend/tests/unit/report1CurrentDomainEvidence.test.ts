/**
 * R1-OPEN-01 — Report 1 website evidence must belong to the report's CURRENT domain.
 *
 * `canonical_pages` keeps every site a company was ever crawled on (unique per company + url),
 * each row stamped with its `domain_id`. Reads scoped by `company_id` alone let the previous
 * site's pages stand in for the current one. Production, 2026-09-14: a test tenant's stored
 * www.python.org pages seeded "learn python" SERP queries for a calendly.com report.
 *
 * The store below applies every filter the way PostgREST does, so these tests observe exactly
 * which rows each Report 1 reader RECEIVES. The same fixture read UNSCOPED still returns the
 * python.org pages — proof the fixture is not vacuous and that the scope is what excludes them.
 */
export {};

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in' | 'notNull' | 'gte'; column: string; value?: unknown };

const HOUR = 3_600_000;
const fresh = () => new Date(Date.now() - HOUR).toISOString();

const TABLES: Record<string, Row[]> = {};
const readLog: Array<{ table: string; filters: Filter[]; rows: Row[] }> = [];

function seed(): void {
  const pages: Row[] = [];
  const content: Row[] = [];
  const links: Row[] = [];
  const addPage = (id: string, company: string, domain: string, url: string, title: string, heading: string, body: string) => {
    pages.push({
      id, company_id: company, domain_id: domain, url, page_type: /\/$/.test(url) ? 'home' : 'other',
      title, meta_title: title, meta_description: `${title} description`, headings: [{ level: 1, text: heading }],
      ctas: [], internal_link_count: 3, http_status: 200, crawl_depth: 1, crawl_metadata: {}, last_crawled_at: fresh(),
    });
    content.push({ page_id: id, company_id: company, block_type: 'paragraph', content_text: body, heading_level: null });
    links.push({ from_page_id: id, company_id: company, to_page_id: null, to_url: url, anchor_text: heading, is_internal: true });
  };
  // The previous site — 12 fresh pages, more than enough to pass the reuse threshold on their own.
  for (let i = 0; i < 12; i += 1) {
    addPage(`old-${i}`, 'co-1', 'd-old', `https://www.python.org/${i === 0 ? '' : `tutorial-${i}`}`,
      'Learn Python Programming', 'Python tutorial for beginners', 'Learn python programming with the python tutorial.');
  }
  // The current site.
  for (let i = 0; i < 4; i += 1) {
    addPage(`cur-${i}`, 'co-1', 'd-cur', `https://calendly.com/${i === 0 ? '' : `feature-${i}`}`,
      'Calendly Scheduling Software', 'Scheduling meetings made easy', 'Schedule meetings with calendly scheduling links.');
  }
  // Another tenant on the SAME host — tenant isolation must still hold.
  for (let i = 0; i < 3; i += 1) {
    addPage(`oth-${i}`, 'co-2', 'd-other', `https://calendly.com/private-${i}`,
      'Other Tenant Confidential', 'Confidential other tenant heading', 'Confidential other tenant body copy.');
  }
  // Only the stale site — the exact 09-14 state: no row for the current domain yet.
  for (let i = 0; i < 12; i += 1) {
    addPage(`stale-${i}`, 'co-3', 'd-stale', `https://www.python.org/stale-${i}`,
      'Learn Python Programming', 'Python tutorial', 'Learn python programming.');
  }
  TABLES.canonical_domains = [
    { id: 'd-old', company_id: 'co-1', primary_domain: 'www.python.org' },
    { id: 'd-cur', company_id: 'co-1', primary_domain: 'calendly.com' },
    { id: 'd-other', company_id: 'co-2', primary_domain: 'calendly.com' },
    { id: 'd-stale', company_id: 'co-3', primary_domain: 'www.python.org' },
  ];
  TABLES.canonical_pages = pages;
  TABLES.page_content = content;
  TABLES.page_links = links;
}

let failDomainLookup = false;

jest.mock('../../db/supabaseClient', () => {
  const query = (table: string) => {
    const filters: Filter[] = [];
    let head = false;
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const run = (): Row[] => {
      let rows = [...(TABLES[table] ?? [])];
      for (const f of filters) {
        if (f.op === 'eq') rows = rows.filter((r) => r[f.column] === f.value);
        if (f.op === 'in') rows = rows.filter((r) => (f.value as unknown[]).includes(r[f.column]));
        if (f.op === 'notNull') rows = rows.filter((r) => r[f.column] != null);
        if (f.op === 'gte') rows = rows.filter((r) => String(r[f.column]) >= String(f.value));
      }
      if (order) {
        const { column, ascending } = order;
        rows.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, limit);
      readLog.push({ table, filters: [...filters], rows });
      return rows;
    };
    const q: Record<string, unknown> = {
      select: (_c: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return q; },
      eq: (column: string, value: unknown) => { filters.push({ op: 'eq', column, value }); return q; },
      in: (column: string, value: unknown[]) => { filters.push({ op: 'in', column, value }); return q; },
      not: (column: string, _op: string, _v: unknown) => { filters.push({ op: 'notNull', column }); return q; },
      gte: (column: string, value: unknown) => { filters.push({ op: 'gte', column, value }); return q; },
      order: (column: string, opts?: { ascending?: boolean }) => { order = { column, ascending: opts?.ascending !== false }; return q; },
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: async () => {
        if (table === 'canonical_domains' && failDomainLookup) return { data: null, error: { message: 'boom' } };
        return { data: run()[0] ?? null, error: null };
      },
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const rows = run();
        return Promise.resolve(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { supabase: { from: (table: string) => query(table) } };
});

const crawlCalls: Array<{ companyId: string; rootUrl?: string }> = [];
jest.mock('../../services/crawlerService', () => ({
  crawlCompanyWebsite: async (input: { companyId: string; rootUrl?: string }) => {
    crawlCalls.push(input);
    return { pagesInserted: 0, pagesProcessed: 0, rootUrl: input.rootUrl ?? '' };
  },
}));

const { resolveReportDomainScope } = require('../../services/crawl/reportDomainScope');
const { ensureReportCrawlEvidence } = require('../../services/crawl/reportCrawlEvidenceService');
const { buildPublicDomainAuditDecisions } = require('../../services/publicDomainAuditService');
const { loadExperiencePages } = require('../../services/digitalExperienceRepository');
const { extractTopKeywords } = require('../../services/reportCompetitorIntelligenceServiceModel');
const {
  getWebsiteTechnicalIntelligence, getWebsiteContentIntelligence,
  getWebsiteAccessibilityIntelligence, getWebsiteBrandIntelligence,
} = require('../../services/websiteIntelligence/websiteIntelligenceRepository');

const CURRENT = { domainId: 'd-cur' };
const UNRESOLVED = { domainId: null };

const pageReads = () => readLog.filter((r) => r.table === 'canonical_pages' && r.rows.length > 0);
const receivedPageIds = () => pageReads().flatMap((r) => r.rows.map((row) => String(row.id)));
const derivedReads = (table: 'page_content' | 'page_links') => readLog.filter((r) => r.table === table);

beforeEach(() => {
  seed();
  readLog.length = 0;
  crawlCalls.length = 0;
  failDomainLookup = false;
});

describe('R1-OPEN-01 — resolving the current report domain', () => {
  it('resolves the current domain for this company, for a bare domain and a full URL alike', async () => {
    expect(await resolveReportDomainScope('co-1', 'calendly.com')).toEqual({ domainId: 'd-cur' });
    expect(await resolveReportDomainScope('co-1', 'https://calendly.com/')).toEqual({ domainId: 'd-cur' });
  });

  it("never resolves to ANOTHER company's row for the same host", async () => {
    expect(await resolveReportDomainScope('co-2', 'calendly.com')).toEqual({ domainId: 'd-other' });
    expect(await resolveReportDomainScope('co-3', 'calendly.com')).toEqual({ domainId: null });
  });

  it('an unknown or missing domain resolves to nothing — never to the company\'s other site', async () => {
    expect(await resolveReportDomainScope('co-1', 'example.org')).toEqual({ domainId: null });
    expect(await resolveReportDomainScope('co-1', null)).toEqual({ domainId: null });
    expect(await resolveReportDomainScope('co-1', '   ')).toEqual({ domainId: null });
  });

  it('a lookup ERROR is surfaced, not mistaken for "no such domain"', async () => {
    failDomainLookup = true;
    await expect(resolveReportDomainScope('co-1', 'calendly.com')).rejects.toThrow(/could not resolve report domain scope/);
  });
});

describe('R1-OPEN-01 — the 09-14 contamination pattern', () => {
  it('stale pages from the previous site no longer satisfy the reuse check: the current site is crawled', async () => {
    const result = await ensureReportCrawlEvidence({ companyId: 'co-3', websiteDomain: 'calendly.com' });
    expect(result.action).toBe('crawled');
    expect(result.pagesBefore).toBe(0);
    expect(crawlCalls).toEqual([expect.objectContaining({ companyId: 'co-3', rootUrl: 'https://calendly.com' })]);
    expect(result.targetUrl).toBe('https://calendly.com');
  });

  it("current-domain pages still count — and ONLY they count", async () => {
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'calendly.com' });
    expect(result.action).toBe('reused');
    expect(result.pagesBefore).toBe(4); // not 16: the 12 python.org pages are excluded
    expect(crawlCalls).toEqual([]);
  });

  it('the public audit sees only the current site', async () => {
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', reportTier: 'snapshot', domainScope: CURRENT });
    expect(receivedPageIds().length).toBe(4);
    expect(receivedPageIds().every((id) => id.startsWith('cur-'))).toBe(true);
    expect(audit.site_structure.homepage).toBe('https://calendly.com/');
    // Content and links follow the scoped page ids.
    for (const read of [...derivedReads('page_content'), ...derivedReads('page_links')]) {
      expect(read.rows.every((row) => String(row.page_id ?? row.from_page_id).startsWith('cur-'))).toBe(true);
    }
  });

  it('SERP keyword generation is no longer seeded by the previous site', async () => {
    const scoped: string[] = await extractTopKeywords({ companyId: 'co-1', domain: 'calendly.com', businessType: null, domainScope: CURRENT });
    expect(scoped.join(' ').toLowerCase()).not.toContain('python');
    // Anchors and copy carry no domain; they are restricted to the current domain's page ids.
    for (const table of ['page_content', 'page_links'] as const) {
      const reads = derivedReads(table);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(read.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'in' })]));
      expect(reads.flatMap((r) => r.rows).every((row) => String(row.page_id ?? row.from_page_id).startsWith('cur-'))).toBe(true);
    }
    // The same fixture read unscoped still produces the contamination — the scope is what removes it.
    const legacy: string[] = await extractTopKeywords({ companyId: 'co-1', domain: 'calendly.com', businessType: null });
    expect(legacy.join(' ').toLowerCase()).toContain('python');
  });

  it('the experience assessment reads only the current site', async () => {
    const pages: Array<{ url: string }> = await loadExperiencePages('co-1', CURRENT);
    expect(pages.length).toBe(4);
    expect(pages.every((p) => p.url.startsWith('https://calendly.com/'))).toBe(true);
    expect(derivedReads('page_content').flatMap((r) => r.rows).every((row) => String(row.page_id).startsWith('cur-'))).toBe(true);
  });

  it.each([
    ['technical', getWebsiteTechnicalIntelligence],
    ['content', getWebsiteContentIntelligence],
    ['accessibility', getWebsiteAccessibilityIntelligence],
    ['brand', getWebsiteBrandIntelligence],
  ])('the %s website-intelligence engine reads only the current site', async (_name, fn) => {
    await fn('co-1', CURRENT);
    expect(receivedPageIds().length).toBe(4);
    expect(receivedPageIds().every((id) => id.startsWith('cur-'))).toBe(true);
  });
});

describe('R1-OPEN-01 — no current domain means no stored evidence, never a fallback', () => {
  it('every reader abstains instead of reading the company\'s other pages', async () => {
    const audit = await buildPublicDomainAuditDecisions({ companyId: 'co-1', reportTier: 'snapshot', domainScope: UNRESOLVED });
    expect(audit.site_structure.homepage).toBeNull();
    expect(await loadExperiencePages('co-1', UNRESOLVED)).toEqual([]);
    const keywords: string[] = await extractTopKeywords({ companyId: 'co-1', domain: 'calendly.com', businessType: null, domainScope: UNRESOLVED });
    expect(keywords.join(' ').toLowerCase()).not.toContain('python');
    for (const fn of [getWebsiteTechnicalIntelligence, getWebsiteContentIntelligence, getWebsiteAccessibilityIntelligence, getWebsiteBrandIntelligence]) {
      await fn('co-1', UNRESOLVED);
    }
    expect(readLog.filter((r) => ['canonical_pages', 'page_content', 'page_links'].includes(r.table))).toEqual([]);
  });

  it('a report with no resolvable website is skipped honestly, counting no pages', async () => {
    TABLES.companies = [{ id: 'co-1', website: null }];
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: null });
    expect(result.action).toBe('skipped_no_domain');
    expect(result.pagesBefore).toBe(0);
    expect(crawlCalls).toEqual([]);
  });

  it('a scope-lookup error still refuses to crawl blindly', async () => {
    failDomainLookup = true;
    const result = await ensureReportCrawlEvidence({ companyId: 'co-1', websiteDomain: 'calendly.com' });
    expect(result.action).toBe('failed');
    expect(crawlCalls).toEqual([]);
  });
});

describe('R1-OPEN-01 — tenant isolation and non-Report-1 callers', () => {
  it("another tenant's pages on the same host never enter this company's evidence", async () => {
    await buildPublicDomainAuditDecisions({ companyId: 'co-1', reportTier: 'snapshot', domainScope: CURRENT });
    expect(receivedPageIds().some((id) => id.startsWith('oth-'))).toBe(false);
    for (const read of readLog) {
      if (read.table === 'canonical_pages') expect(read.filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'company_id', value: 'co-1' }]));
    }
  });

  it('an UNSCOPED caller (not Report 1) keeps its existing company-wide read', async () => {
    const pages: Array<{ url: string }> = await loadExperiencePages('co-1');
    expect(pages.some((p) => p.url.includes('python.org'))).toBe(true);
    expect(readLog.find((r) => r.table === 'canonical_pages')?.filters.some((f) => f.column === 'domain_id')).toBe(false);
  });
});

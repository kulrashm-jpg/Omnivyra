/**
 * R1-OPEN-01 (3AH-182) — the content-authority PRODUCER derives conclusions from the company's
 * CURRENT website only, stamps each with the domain it came from, and retires its previous set.
 *
 * 3AH-179 found the daily producer re-deriving growth-tier content decisions from every site the
 * company had ever been crawled on. Those persisted rows then reached Report 1. Here the producer
 * runs for real against a store that applies every filter; `archiveDecisionSourceEntityType` runs
 * for real too. Only the INSERT is recorded in memory, because the real one also writes event and
 * prioritisation tables this suite has no business touching.
 */
export {};

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in'; column: string; value: unknown };

const TABLES: Record<string, Row[]> = {};
const readLog: Array<{ table: string; filters: Filter[] }> = [];
let failDomainLookup = false;

const matches = (row: Row, filters: Filter[]) => filters.every((f) => (
  f.op === 'eq' ? row[f.column] === f.value : (f.value as unknown[]).includes(row[f.column])
));

function builder(table: string, logReads: boolean): Record<string, unknown> {
  const filters: Filter[] = [];
  let patch: Row | null = null;
  let limit = Infinity;
  const rows = () => (TABLES[table] ?? []).filter((r) => matches(r, filters)).slice(0, limit);
  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Row) => { patch = p; return q; },
    eq: (column: string, value: unknown) => { filters.push({ op: 'eq', column, value }); return q; },
    in: (column: string, value: unknown[]) => { filters.push({ op: 'in', column, value }); return q; },
    order: () => q,
    limit: (n: number) => { limit = n; return q; },
    maybeSingle: async () => {
      if (table === 'canonical_domains' && failDomainLookup) return { data: null, error: { message: 'boom' } };
      return { data: rows()[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (patch) {
        for (const r of (TABLES[table] ?? []).filter((row) => matches(row, filters))) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      const out = rows();
      if (logReads) readLog.push({ table, filters: [...filters] });
      return Promise.resolve({ data: out, error: null }).then(resolve, reject);
    },
  };
  return q;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t, true) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t, false) }));

const inserted: Row[] = [];
jest.mock('../../services/decisionObjectService', () => {
  const actual = jest.requireActual('../../services/decisionObjectService');
  return {
    ...actual,
    createDecisionObjects: async (inputs: Row[]) => {
      const rows = inputs.map((input, i): Row => ({ ...input, id: `new-${inserted.length + i}`, status: 'open' }));
      inserted.push(...rows);
      TABLES.decision_objects.push(...rows);
      return rows;
    },
  };
});

const { generateContentAuthorityDecisions } = require('../../services/contentAuthorityService');
const { runInBackgroundJobContext } = require('../../services/intelligenceExecutionContext');

const run = (companyId: string) =>
  runInBackgroundJobContext('test:content_authority', () => generateContentAuthorityDecisions(companyId));

const page = (id: string, company: string, domain: string, url: string, title: string): Row => ({
  id, company_id: company, domain_id: domain, url, page_type: 'other', title,
  headings: [{ level: 1, text: title }], ctas: [], internal_link_count: 0,
});
const block = (pageId: string, company: string, text: string): Row => ({
  page_id: pageId, company_id: company, block_type: 'paragraph', content_text: text, heading_level: null,
});
const decision = (id: string, over: Row): Row => ({
  id, company_id: 'co-1', report_tier: 'growth', source_service: 'contentAuthorityService',
  entity_type: 'content_cluster', status: 'open', evidence: {}, ...over,
});

function seed(website: string | null): void {
  inserted.length = 0;
  readLog.length = 0;
  failDomainLookup = false;
  TABLES.companies = [{ id: 'co-1', website, website_domain: null }, { id: 'co-2', website: 'https://new.test', website_domain: null }];
  TABLES.canonical_domains = [
    { id: 'd-old', company_id: 'co-1', primary_domain: 'old.test' },
    { id: 'd-older', company_id: 'co-1', primary_domain: 'older.test' },
    { id: 'd-new', company_id: 'co-1', primary_domain: 'new.test' },
    { id: 'd-empty', company_id: 'co-1', primary_domain: 'empty.test' },
    { id: 'd-oth', company_id: 'co-2', primary_domain: 'new.test' },
  ];
  TABLES.canonical_pages = [
    page('p-old', 'co-1', 'd-old', 'https://old.test/tutorial', 'Old Tutorial'),
    page('p-older', 'co-1', 'd-older', 'https://older.test/legacyguide', 'Older Legacy Guide'),
    page('p-new', 'co-1', 'd-new', 'https://new.test/scheduling', 'Scheduling Overview'),
    page('p-oth', 'co-2', 'd-oth', 'https://new.test/confidential', 'Other Tenant Confidential'),
  ];
  TABLES.page_content = [
    block('p-old', 'co-1', 'short old copy'), block('p-older', 'co-1', 'short older copy'),
    block('p-new', 'co-1', 'short current copy'), block('p-oth', 'co-2', 'short other copy'),
  ];
  TABLES.page_links = [];
  TABLES.canonical_keywords = [];
  TABLES.decision_objects = [
    decision('stale-d1', { evidence: { content_cluster: 'tutorial', domain_id: 'd-old' } }),
    decision('legacy', { evidence: { content_cluster: 'tutorial' } }),
    decision('funnel', { report_tier: 'deep', source_service: 'funnelIntelligenceService', entity_type: 'page' }),
    decision('traffic', { source_service: 'trafficIntelligenceService', entity_type: 'session' }),
    decision('sibling', { source_service: 'contentClusterService' }),
    decision('other-tenant', { company_id: 'co-2', evidence: { domain_id: 'd-oth' } }),
  ];
}

const status = (id: string) => TABLES.decision_objects.find((d) => d.id === id)?.status;
const pageReads = () => readLog.filter((r) => r.table === 'canonical_pages');
const clusters = () => inserted.map((d) => String((d.evidence as Row).content_cluster ?? ''));

describe('3AH-182 — content-authority producer is confined to the current domain', () => {
  it('A. after moving D1 → D2: D2 conclusions are generated and stamped, D1 ones retired, D1 pages kept', async () => {
    seed('https://new.test');
    await run('co-1');
    expect(inserted.length).toBeGreaterThan(0);
    expect(clusters()).toEqual(expect.arrayContaining(['scheduling']));
    expect(clusters().some((c) => /tutorial|legacyguide/.test(c))).toBe(false);
    expect(inserted.every((d) => (d.evidence as Row).domain_id === 'd-new')).toBe(true);
    expect(status('stale-d1')).toBe('resolved');
    expect(status('legacy')).toBe('resolved');
    expect(TABLES.canonical_pages.map((p) => p.id)).toEqual(expect.arrayContaining(['p-old', 'p-older'])); // history kept
  });

  it('E. with several old domains, only the current one is read', async () => {
    seed('https://new.test');
    await run('co-1');
    expect(pageReads().length).toBe(1);
    expect(pageReads()[0].filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'company_id', value: 'co-1' },
      { op: 'eq', column: 'domain_id', value: 'd-new' },
    ]));
    // content/links follow the scoped page ids only
    for (const r of readLog.filter((x) => x.table === 'page_content' || x.table === 'page_links')) {
      expect(r.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'in', value: ['p-new'] })]));
    }
  });

  it('B. no current website: nothing is read or generated, and the previous set is still retired', async () => {
    seed(null);
    await run('co-1');
    expect(pageReads()).toEqual([]);
    expect(inserted).toEqual([]);
    expect(status('stale-d1')).toBe('resolved');
  });

  it('C. a domain-lookup error fails closed: no generation and no blind archive', async () => {
    seed('https://new.test');
    failDomainLookup = true;
    await expect(run('co-1')).rejects.toThrow(/could not resolve report domain scope/);
    expect(pageReads()).toEqual([]);
    expect(inserted).toEqual([]);
    expect(status('stale-d1')).toBe('open'); // untouched: a failed run changes nothing
  });

  it('D. current domain with zero pages: no fallback to the old sites', async () => {
    seed('https://empty.test');
    await run('co-1');
    expect(pageReads().length).toBe(1);
    expect(pageReads()[0].filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'domain_id', value: 'd-empty' }]));
    expect(inserted).toEqual([]);
    expect(status('stale-d1')).toBe('resolved');
  });

  it('F. another tenant on the same host is never read or touched', async () => {
    seed('https://new.test');
    await run('co-1');
    expect(clusters().some((c) => c.includes('confidential'))).toBe(false);
    expect(status('other-tenant')).toBe('open');
  });

  it('F. a host whose only domain row belongs to ANOTHER tenant never resolves for this company', async () => {
    seed('https://new.test');
    TABLES.companies.push({ id: 'co-3', website: 'https://shared.test', website_domain: null });
    TABLES.canonical_domains.push({ id: 'd-shared-co2', company_id: 'co-2', primary_domain: 'shared.test' });
    await run('co-3');
    expect(pageReads()).toEqual([]); // unresolved for co-3 — never borrows co-2's domain row
    expect(inserted).toEqual([]);
  });

  it('J. retirement touches ONLY this source, tier and entity type', async () => {
    seed('https://new.test');
    await run('co-1');
    expect(status('funnel')).toBe('open');
    expect(status('traffic')).toBe('open');
    expect(status('sibling')).toBe('open');
  });
});

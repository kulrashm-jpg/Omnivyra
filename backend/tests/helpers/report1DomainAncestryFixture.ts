/**
 * Fixture for report1DomainAncestrySimulation.test.ts — one company that changed websites, plus
 * another tenant on the SAME host as that company's current site.
 *
 * Every row carries a unique marker so leakage is unambiguous in any serialisation:
 *   CURRENTPAGE-MARKER   the current site (sim-co, domain d-cur, current-sim.test)
 *   OLDPAGE-MARKER       the previous site (sim-co, domain d-old, old-sim.test)
 *   OTHERTENANT-MARKER   another tenant (other-co, domain d-oth, ALSO current-sim.test)
 *
 * The in-memory store applies eq / in / not-null / gte / lte / order / limit the way PostgREST does
 * (the same model as report1CurrentDomainEvidence.test.ts), so the test observes exactly which rows
 * each Report 1 reader RECEIVES. Unknown tables answer with zero rows; writes are accepted and
 * discarded. It is a `jest.mock` factory body: `supabaseModule()` is required from inside the
 * factory, and the test requires this same module to reach `TABLES` / `readLog`.
 *
 * SECRETS: all synthetic. No network, no database.
 */
import type { PersistedDecisionObject } from '../../services/decisionObjectService';

export type Row = Record<string, unknown>;
export type Filter = { op: 'eq' | 'in' | 'notNull' | 'gte' | 'lte' | 'neq'; column: string; value?: unknown };

export const COMPANY = 'sim-co';
export const OTHER_COMPANY = 'other-co';
export const CURRENT_HOST = 'current-sim.test';
export const OLD_HOST = 'old-sim.test';

export const TABLES: Record<string, Row[]> = {};
export type ReadEntry = { table: string; filters: Filter[]; rows: Row[] };
export const readLog: ReadEntry[] = [];

/** One broken page per site, so the crawl's page-level evidence names a concrete URL. */
const BROKEN_PAGES = new Set(['cur-3', 'old-4']);

const fresh = (): string => new Date(Date.now() - 3_600_000).toISOString();

export function seedFixture(): void {
  const pages: Row[] = [];
  const content: Row[] = [];
  const links: Row[] = [];
  const addPage = (id: string, company: string, domain: string, url: string, marker: string, i: number): void => {
    const title = `${marker} ${i} Page Title`;
    pages.push({
      id, company_id: company, domain_id: domain, url, page_type: /\/$/.test(url) ? 'home' : 'other',
      title, meta_title: title, meta_description: `${marker} ${i} meta description`,
      headings: [{ level: 1, text: `${marker} heading ${i}` }],
      ctas: [], internal_link_count: 3, http_status: BROKEN_PAGES.has(id) ? 404 : 200, crawl_depth: 1, crawl_metadata: {}, last_crawled_at: fresh(),
    });
    content.push({
      page_id: id, company_id: company, block_type: 'paragraph', heading_level: null,
      content_text: `${marker} body copy ${i} describing ${marker} services in detail.`,
    });
    links.push({ from_page_id: id, company_id: company, to_page_id: null, to_url: url, anchor_text: `${marker} link ${i}`, is_internal: true });
  };
  // The previous site: MORE pages than the current one, so an unscoped read would favour it.
  for (let i = 0; i < 10; i += 1) {
    addPage(`old-${i}`, COMPANY, 'd-old', `https://${OLD_HOST}/${i === 0 ? '' : `oldpage-marker-${i}`}`, 'OLDPAGE-MARKER', i);
  }
  for (let i = 0; i < 4; i += 1) {
    addPage(`cur-${i}`, COMPANY, 'd-cur', `https://${CURRENT_HOST}/${i === 0 ? '' : `currentpage-marker-${i}`}`, 'CURRENTPAGE-MARKER', i);
  }
  for (let i = 0; i < 3; i += 1) {
    addPage(`oth-${i}`, OTHER_COMPANY, 'd-oth', `https://${CURRENT_HOST}/othertenant-marker-${i}`, 'OTHERTENANT-MARKER', i);
  }
  for (const key of Object.keys(TABLES)) delete TABLES[key];
  TABLES.canonical_domains = [
    { id: 'd-old', company_id: COMPANY, primary_domain: OLD_HOST },
    { id: 'd-cur', company_id: COMPANY, primary_domain: CURRENT_HOST },
    { id: 'd-oth', company_id: OTHER_COMPANY, primary_domain: CURRENT_HOST },
  ];
  TABLES.canonical_pages = pages;
  TABLES.page_content = content;
  TABLES.page_links = links;
  readLog.length = 0;
}

function query(table: string): Record<string, unknown> {
  const filters: Filter[] = [];
  let head = false;
  let order: { column: string; ascending: boolean } | null = null;
  let limit = Infinity;
  const run = (): Row[] => {
    let rows = [...(TABLES[table] ?? [])];
    for (const f of filters) {
      if (f.op === 'eq') rows = rows.filter((r) => r[f.column] === f.value);
      if (f.op === 'neq') rows = rows.filter((r) => r[f.column] !== f.value);
      if (f.op === 'in') rows = rows.filter((r) => (f.value as unknown[]).includes(r[f.column]));
      if (f.op === 'notNull') rows = rows.filter((r) => r[f.column] != null);
      if (f.op === 'gte') rows = rows.filter((r) => String(r[f.column]) >= String(f.value));
      if (f.op === 'lte') rows = rows.filter((r) => String(r[f.column]) <= String(f.value));
    }
    if (order) {
      const { column, ascending } = order;
      rows.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    rows = rows.slice(0, limit);
    readLog.push({ table, filters: [...filters], rows });
    return rows;
  };
  const q: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return q; };
  q.select = chain((_c: unknown, opts: unknown) => { head = Boolean((opts as { head?: boolean } | undefined)?.head); });
  q.eq = chain((column, value) => { filters.push({ op: 'eq', column: String(column), value }); });
  q.neq = chain((column, value) => { filters.push({ op: 'neq', column: String(column), value }); });
  q.in = chain((column, value) => { filters.push({ op: 'in', column: String(column), value }); });
  q.not = chain((column) => { filters.push({ op: 'notNull', column: String(column) }); });
  q.gte = chain((column, value) => { filters.push({ op: 'gte', column: String(column), value }); });
  q.lte = chain((column, value) => { filters.push({ op: 'lte', column: String(column), value }); });
  q.order = chain((column, opts) => { order = { column: String(column), ascending: (opts as { ascending?: boolean } | undefined)?.ascending !== false }; });
  q.limit = chain((n) => { limit = Number(n); });
  for (const m of ['is', 'or', 'ilike', 'like', 'range', 'contains', 'filter', 'match', 'gt', 'lt', 'returns']) q[m] = chain(() => undefined);
  // Writes are accepted and discarded: nothing a report run writes may feed back into this fixture.
  for (const m of ['insert', 'upsert', 'update', 'delete']) q[m] = chain(() => { limit = 0; });
  q.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
  q.single = async () => ({ data: run()[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const rows = run();
    return Promise.resolve(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }).then(resolve, reject);
  };
  return q;
}

export function supabaseModule(): Record<string, unknown> {
  const client = {
    from: (table: string) => query(table),
    rpc: async () => ({ data: null, error: null }),
  };
  return { __esModule: true, supabase: client, default: client };
}

const NOW = new Date('2026-09-20T00:00:00.000Z').toISOString();

/** A persisted decision in the shape `listDecisionObjects` returns. */
export function simDecision(params: {
  id: string;
  service: string;
  tier: 'snapshot' | 'growth';
  entityType: string;
  issueType: string;
  marker: string;
  evidence: Record<string, unknown>;
  impact: number;
  actionType?: string;
}): PersistedDecisionObject {
  return {
    id: params.id,
    company_id: COMPANY,
    report_tier: params.tier,
    source_service: params.service,
    entity_type: params.entityType,
    entity_id: null,
    issue_type: params.issueType,
    title: `${params.marker} title`,
    description: `${params.marker} description`,
    evidence: params.evidence,
    impact_traffic: params.impact,
    impact_conversion: 30,
    impact_revenue: 26,
    priority_score: params.impact,
    effort_score: 24,
    execution_score: 60,
    confidence_score: 0.8,
    recommendation: `${params.marker} recommendation`,
    action_type: params.actionType ?? 'improve_content',
    action_payload: { content_cluster: params.marker, optimization_focus: params.issueType },
    status: 'open',
    last_changed_by: 'system',
    created_at: NOW,
    updated_at: NOW,
    resolved_at: null,
    ignored_at: null,
  } as unknown as PersistedDecisionObject;
}

const contentCluster = (id: string, marker: string, domainId: string | undefined, impact: number): PersistedDecisionObject =>
  simDecision({
    id, service: 'contentAuthorityService', tier: 'growth', entityType: 'content_cluster', issueType: 'topic_gap', marker, impact,
    evidence: {
      content_cluster: marker, cluster_id: `${id}-cluster`, page_count: 1, avg_word_count: 120, avg_heading_count: 1,
      ...(domainId === undefined ? {} : { domain_id: domainId }),
    },
  });

/** contentAuthorityService decisions: current domain, previous domain, and a legacy row with no domain. */
export const currentDecision = (): PersistedDecisionObject => contentCluster('ca-current', 'CURRENTDECISION-MARKER', 'd-cur', 97);
export const staleDecision = (): PersistedDecisionObject => contentCluster('ca-stale', 'STALEDECISION-MARKER', 'd-old', 99);
export const legacyDecision = (): PersistedDecisionObject => contentCluster('ca-legacy', 'LEGACYDECISION-MARKER', undefined, 98);

/** An unrelated public source in the snapshot tier — the domain filter must not touch it. */
export const unrelatedDecision = (): PersistedDecisionObject =>
  simDecision({
    id: 'pub-unrelated', service: 'publicDomainAuditService', tier: 'snapshot', entityType: 'global',
    issueType: 'credibility_gap', marker: 'UNRELATED-MARKER', impact: 70, actionType: 'fix_cta',
    evidence: { avg_relevance: 0.62 },
  });

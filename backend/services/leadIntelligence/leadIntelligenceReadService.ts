/**
 * Unified Lead Intelligence read service — the single read surface for consumers.
 *
 * Reads the durable canonical store (Phase 4) UNION the legacy sources (bridged via
 * adapters) so the same data appears unified whether or not the durable table is
 * applied/backfilled — backward compatible by construction. All composition,
 * filtering, search, sort, pagination and export live HERE (and the pure query/
 * export libs); consumers never touch fragmented sources or filter source-specifically.
 *
 * Anti-N+1: each source is read ONCE in bulk per query (3 reads, parallel), never
 * per-lead; provenance for canonical prospects is ONE more read per page (per
 * chunk of ≤100 lead ids — see contributionReader). Tenant isolation: every
 * reader is company-scoped + the query re-filters by company_id. Fail-open: any
 * source error degrades to [] (never throws) and is REPORTED once.
 *
 * Sources: `lead_intelligence` (durable), `leads` (website/form capture),
 * `canonical_leads` (PI canonical prospects, CRM) + `prospect_source_contributions`
 * (their complete provenance, attached as `sources[]` / `evidence[]`). The legacy
 * `active_leads` reader was REMOVED: production `active_leads` is the legacy shape
 * with no `organization_id`, so the read failed with 42703 on every call and
 * contributed nothing (PI-STATE-OF-PROGRAMME DEFECT-009). Community signals reach
 * this view through `lead_intelligence` (adoptLead('community')) and, as canonical
 * prospects, through their provenance contributions.
 *
 * Caps are VISIBLE: each bulk read has a deterministic order and reads cap+1 rows;
 * hitting a cap sets `truncated` / `truncatedSources` on the result and logs once.
 *
 * SIGNAL MERGE (owner decision 4): a durable view keyed by a signal row
 * (`opportunity_feed_items`, `lead_signals`, `engagement_messages`) and a canonical
 * prospect whose contribution references that SAME signal are ONE lead. After the
 * bulk reads, ONE more read per (signal column, ≤100 ids) fetches the contributions
 * referencing the signals present, and `mergeSignalLinkedViews` folds each such
 * view into its prospect (`linkedRecords`, `aliasKeys`). Nothing is deleted or
 * re-keyed: the durable row's persisted key resolves to the merged lead as an
 * alias (`getLeadProfile`, audiences). Unreadable store ⇒ no merge, reported.
 *
 * ACCOUNT-ONLY PROSPECTS: a canonical prospect without a person shows the account
 * of its originating contribution's source record (accountReader; ≤2 reads per
 * page, tenant-filtered, fail-open + observable).
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  projectExistingRow,
  applyLeadQuery,
  filterLeads,
  sortLeads,
  dedupeViews,
  mergeSignalLinkedViews,
  canonicalProspectIdOf,
  signalRefOf,
  viewHasLeadKey,
  type SignalLink,
  type SignalMergeStatus,
  type LeadAccount,
  displayLabelFor,
  type LeadEvidenceRef,
  type LeadOrigin,
  toExportRow,
  toCsv,
  toExcelXml,
  DISCLOSE_NOTHING,
  type ExportDisclosure,
  computeLeadStats,
  activeLeadsCompatibilityFilter,
  leadKeyFor,
  identityProjection,
  campaignProjection,
  journeyProjection,
  contentProjection,
  activityProjection,
  opportunityProjection,
  marketPulseProjection,
  crmProjection,
  engagementProjection,
  analyticsProjection,
  recommendNextAction,
  summarizeLead,
  buildTimeline,
  type CanonicalLeadView,
  type LeadQuery,
  type LeadQueryResult,
  type LeadStats,
  visitorJourneyProjection,
  campaignAttributionProjection,
  contentReferenceProjection,
  websiteBehaviourProjection,
  sourceDetailProjection,
  buildBuyingIntentProfile,
  ensureMaterializedScores,
  buildLeadActionPlan,
  buildCompanyIntelligence,
  resolveCompanyKey,
  resolveCompanyName,
  summarizeCompanyIntelligence,
  type TimelineEvent,
  type LeadProfile,
  type EnrichedLeadProfile,
  type BuyingIntentProfile,
  type LeadActionPlan,
  type CompanyIntelligenceProfile,
} from '../../../lib/leadIntelligence';
import { listCanonicalLeads } from './leadIntelligenceRepository';
import {
  readContributionsForLeads,
  readOriginatingContributions,
  readContributionsBySignalRefs,
  type ContributionReadResult,
  type SignalRefQuery,
} from '../prospectProvenance/contributionReader';
import { readAccountsForSourceRecords, type AccountReadResult } from '../prospectProvenance/accountReader';
import type { ProvenanceContribution } from '../../../lib/prospectProvenance/contract';
// W0-B — the canonical contact-governance evaluator and a tenant-scoped read of
// its records. `mayContact` is pure; the read is the only I/O this adds.
import { mayContact } from '../prospectIdentity/contactGovernance';
import { loadTenantGovernanceRecords, normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';

type Row = Record<string, unknown>;
/** A bulk read's rows; `truncated` is set when the read hit its cap. */
export type SourceRows<T = Row> = T[] & { truncated?: boolean };

export interface LeadSourceReaders {
  durable(companyId: string): Promise<SourceRows<CanonicalLeadView>>;
  leads(companyId: string): Promise<SourceRows>;
  canonicalLeads(companyId: string): Promise<SourceRows>;
  /** Provenance of canonical prospects (tenant-filtered). Defaults to the contribution reader. */
  contributions?(companyId: string, canonicalLeadIds: string[]): Promise<ContributionReadResult>;
  /** Originating contribution of every canonical prospect of the tenant (stats). */
  originatingContributions?(companyId: string): Promise<ContributionReadResult>;
  /** Contributions referencing the given signal ids (signal merge). Defaults to the contribution reader. */
  signalLinks?(companyId: string, refs: SignalRefQuery): Promise<ContributionReadResult>;
  /** Accounts of the given source records (account-only prospects). Defaults to the account reader. */
  accounts?(companyId: string, sourceRecordIds: string[]): Promise<AccountReadResult>;
}

const BULK_CAP = 2000;
const DURABLE_CAP = 1000; // listCanonicalLeads clamps to 1000 (newest first)
const CANONICAL_TABLE = 'canonical_leads';

/**
 * A failed source read stays fail-open — the source contributes no rows and the
 * unified view is still served — but it is never SILENT. Reported once per
 * table + error code per process, so a hot read path cannot flood the log.
 */
const reportedReadFailures = new Set<string>();

function reportReadFailure(table: string, tenantCol: string, code: string, message: string): void {
  const key = `${table}|${code}`;
  if (reportedReadFailures.has(key)) return;
  reportedReadFailures.add(key);
  console.warn(
    `[leadIntelligenceReadService] ${table} read failed (filter ${tenantCol}) — this source contributes no rows:`,
    code,
    message,
  );
}

/** A capped read: reported once per table + tenant per process. */
function reportTruncation(table: string, companyId: string, cap: number): void {
  const key = `truncated|${table}|${companyId}`;
  if (reportedReadFailures.has(key)) return;
  reportedReadFailures.add(key);
  console.warn(
    `[leadIntelligenceReadService] ${table} read hit its cap of ${cap} rows for tenant ${companyId} — results are truncated (newest kept)`,
  );
}

/** Test seam: forget which failures were already reported. */
export function resetReadFailureReportsForTests(): void {
  reportedReadFailures.clear();
}

function capped<T>(rows: T[], cap: number, table: string, companyId: string): SourceRows<T> {
  const out = (rows.length > cap ? rows.slice(0, cap) : rows) as SourceRows<T>;
  if (rows.length > cap) {
    out.truncated = true;
    reportTruncation(table, companyId, cap);
  }
  return out;
}

/** Deterministic, capped bulk read: newest first, id as the tie-break; reads cap+1 to detect truncation. */
async function readTable(table: string, tenantCol: string, companyId: string): Promise<SourceRows> {
  try {
    const { data, error } = await ownedDbTable(table)
      .select('*')
      .eq(tenantCol, companyId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(BULK_CAP + 1);
    if (error) {
      const e = error as { code?: unknown; message?: unknown };
      reportReadFailure(table, tenantCol, String(e.code ?? 'unknown'), String(e.message ?? error));
      return [];
    }
    return capped(Array.isArray(data) ? (data as Row[]) : [], BULK_CAP, table, companyId);
  } catch (err) {
    reportReadFailure(table, tenantCol, 'exception', err instanceof Error ? err.message : String(err));
    return [];
  }
}

export const defaultLeadSourceReaders: LeadSourceReaders = {
  durable: async (companyId) => {
    const rows: SourceRows<CanonicalLeadView> = await listCanonicalLeads({ companyId, limit: DURABLE_CAP })
      .catch(() => [] as CanonicalLeadView[]);
    // The repository clamps at 1000 and cannot read cap+1: a FULL page is
    // reported as (possibly) truncated rather than assumed complete.
    if (rows.length >= DURABLE_CAP) {
      rows.truncated = true;
      reportTruncation('lead_intelligence', companyId, DURABLE_CAP);
    }
    return rows;
  },
  leads: (companyId) => readTable('leads', 'company_id', companyId),
  canonicalLeads: (companyId) => readTable(CANONICAL_TABLE, 'company_id', companyId),
  contributions: (companyId, ids) => readContributionsForLeads(companyId, ids),
  originatingContributions: (companyId) => readOriginatingContributions(companyId),
  signalLinks: (companyId, refs) => readContributionsBySignalRefs(companyId, refs),
  accounts: (companyId, ids) => readAccountsForSourceRecords(companyId, ids),
};

interface Collected { views: CanonicalLeadView[]; truncatedSources: string[]; signalMerge: SignalMergeStatus }

const NO_MERGE: SignalMergeStatus = { status: 'not_requested', merged: 0, ambiguous: 0 };

/** Flatten a tenant's contribution read into typed signal links (feed item / lead signal / engagement message). */
export function signalLinksOf(companyId: string, read: ContributionReadResult): SignalLink[] {
  const links: SignalLink[] = [];
  for (const [canonicalLeadId, list] of read.byLead) {
    for (const c of list) {
      const r = c.signalRefs;
      if (r.opportunityFeedItemId) links.push({ organizationId: companyId, canonicalLeadId, kind: 'opportunity_feed_item', ref: r.opportunityFeedItemId });
      if (r.leadSignalId) links.push({ organizationId: companyId, canonicalLeadId, kind: 'lead_signal', ref: r.leadSignalId });
      if (r.engagementMessageId) links.push({ organizationId: companyId, canonicalLeadId, kind: 'engagement_message', ref: r.engagementMessageId });
    }
  }
  return links;
}

/**
 * Signal merge for one collect. Reads ONLY when there is something to merge (a
 * canonical prospect AND a signal-keyed view of this tenant), and only the
 * contributions referencing those signals. Never throws.
 */
async function mergeSignals(
  companyId: string,
  views: CanonicalLeadView[],
  readers: LeadSourceReaders,
): Promise<{ views: CanonicalLeadView[]; signalMerge: SignalMergeStatus; truncated: boolean }> {
  const own = views.filter((v) => v.organizationId === companyId);
  if (!own.some((v) => canonicalProspectIdOf(v) !== null)) return { views, signalMerge: NO_MERGE, truncated: false };
  const refs: Required<SignalRefQuery> = { opportunityFeedItemIds: [], leadSignalIds: [], engagementMessageIds: [] };
  for (const v of own) {
    if (canonicalProspectIdOf(v)) continue;
    const sig = signalRefOf(v);
    const id = v.sourceRef?.id;
    if (!sig || !id) continue;
    if (sig.kind === 'opportunity_feed_item') refs.opportunityFeedItemIds.push(id);
    else if (sig.kind === 'lead_signal') refs.leadSignalIds.push(id);
    else refs.engagementMessageIds.push(id);
  }
  if (refs.opportunityFeedItemIds.length + refs.leadSignalIds.length + refs.engagementMessageIds.length === 0) {
    return { views, signalMerge: NO_MERGE, truncated: false };
  }
  const read = readers.signalLinks ?? defaultLeadSourceReaders.signalLinks!;
  const result = await safeRead(() => read(companyId, refs));
  if (result.status !== 'ok') {
    return { views, signalMerge: { status: 'unavailable', merged: 0, ambiguous: 0 }, truncated: false };
  }
  const merged = mergeSignalLinkedViews(views, signalLinksOf(companyId, result));
  if (merged.ambiguous > 0) reportAmbiguousSignals(companyId, merged.ambiguous);
  return {
    views: merged.views,
    signalMerge: { status: 'ok', merged: merged.merged, ambiguous: merged.ambiguous },
    truncated: result.truncated,
  };
}

/** A signal referenced by more than one prospect is never merged — and never silently. */
function reportAmbiguousSignals(companyId: string, count: number): void {
  const key = `ambiguous_signal|${companyId}`;
  if (reportedReadFailures.has(key)) return;
  reportedReadFailures.add(key);
  console.warn(
    `[leadIntelligenceReadService] ${count} signal view(s) of tenant ${companyId} are referenced by more than one canonical prospect — left unmerged`,
  );
}

/** Bulk-read every source once, bridge to unified views, dedupe (durable wins), merge signals. */
async function collectViews(companyId: string, readers: LeadSourceReaders): Promise<Collected> {
  const [durable, legacyLeads, canonical] = await Promise.all([
    readers.durable(companyId),
    readers.leads(companyId),
    readers.canonicalLeads(companyId),
  ]);
  const truncatedSources = [
    durable.truncated ? 'lead_intelligence' : null,
    legacyLeads.truncated ? 'leads' : null,
    canonical.truncated ? CANONICAL_TABLE : null,
  ].filter((x): x is string => x !== null);
  const views: CanonicalLeadView[] = [
    ...durable, // durable first → wins on dedupe
    ...legacyLeads.map((r) => projectExistingRow('website', r, { readFrom: 'leads' })),
    ...canonical.map((r) => projectExistingRow('crm', r, { readFrom: CANONICAL_TABLE })),
  ];
  // Signal merge BEFORE scoring/filtering/paging, so every count, page, export and
  // audience sees a merged lead exactly once.
  const merged = await mergeSignals(companyId, dedupeViews(views), readers);
  if (merged.truncated) truncatedSources.push('prospect_source_contributions');
  // G3 (LC-102): guarantee every view carries a canonical score from the ONE scorer.
  // Durable rows are already materialized at write; legacy/unbackfilled rows are
  // materialized here so List, Detail, Filters and Sorting all agree. No-op for
  // source-scored leads and when the kill-switch is off.
  return { views: merged.views.map(ensureMaterializedScores), truncatedSources, signalMerge: merged.signalMerge };
}

/* ── Provenance attachment ─────────────────────────────────────────────────── */

const NO_PROVENANCE: ContributionReadResult = { status: 'error', byLead: new Map(), truncated: false, reads: 0 };

/** The canonical prospect id a view represents, or null (not a canonical prospect). */
export function canonicalLeadIdOf(v: CanonicalLeadView): string | null {
  return canonicalProspectIdOf(v);
}

/** Flatten a contribution's typed references into evidence refs (deterministic order). */
export function evidenceOf(c: ProvenanceContribution): LeadEvidenceRef[] {
  const base = { contributionId: c.id, role: c.role, sourceCategory: c.sourceCategory, platform: c.platform, observedAt: c.observedAt };
  const refs: Array<[LeadEvidenceRef['kind'], string | null | undefined]> = [
    ['source_url', c.sourceUrl],
    ['source_record', c.sourceRecordId],
    ['lead_signal', c.signalRefs.leadSignalId],
    ['opportunity_feed_item', c.signalRefs.opportunityFeedItemId],
    ['engagement_message', c.signalRefs.engagementMessageId],
    ['contact', c.signalRefs.contactId],
  ];
  return refs.filter(([, ref]) => !!ref).map(([kind, ref]) => ({ ...base, kind, ref: String(ref) }));
}

function originFrom(c: ProvenanceContribution | undefined, fallback: LeadOrigin | null | undefined): LeadOrigin | null {
  if (c) return { category: c.sourceCategory, platform: c.platform, observedAt: c.observedAt };
  return fallback ?? null;
}

function withProvenance(v: CanonicalLeadView, read: ContributionReadResult | null): CanonicalLeadView {
  const id = canonicalLeadIdOf(v);
  if (!id || !read) {
    return { ...v, sources: [], evidence: [], provenanceStatus: 'not_applicable', origin: v.origin ?? null };
  }
  if (read.status !== 'ok') {
    return { ...v, sources: [], evidence: [], provenanceStatus: 'unavailable', origin: v.origin ?? null };
  }
  const sources = read.byLead.get(id) ?? [];
  const origin = originFrom(sources.find((c) => c.role === 'originating'), v.origin);
  return {
    ...v,
    sources,
    evidence: sources.flatMap(evidenceOf),
    provenanceStatus: 'loaded',
    origin,
    sourceLabel: displayLabelFor(v.source, origin),
  };
}

async function safeRead(fn: () => Promise<ContributionReadResult>): Promise<ContributionReadResult> {
  try {
    return await fn();
  } catch (err) {
    // An injected reader that throws is treated exactly like an unreadable store.
    reportReadFailure('prospect_source_contributions', 'organization_id', 'exception', err instanceof Error ? err.message : String(err));
    return NO_PROVENANCE;
  }
}

/**
 * Attach provenance to a set of views (normally ONE page): one read per chunk of
 * canonical prospect ids, tenant-filtered. Never throws.
 */
async function attachProvenance(
  companyId: string,
  views: CanonicalLeadView[],
  readers: LeadSourceReaders,
): Promise<{ views: CanonicalLeadView[]; status: 'ok' | 'unavailable' | 'not_requested'; truncated: boolean }> {
  const ids = views.map(canonicalLeadIdOf).filter((x): x is string => x !== null);
  if (ids.length === 0) return { views: views.map((v) => withAccount(withProvenance(v, null), null)), status: 'not_requested', truncated: false };
  const read = readers.contributions ?? defaultLeadSourceReaders.contributions!;
  const result = await safeRead(() => read(companyId, ids));
  const withSources = views.map((v) => withProvenance(v, result));
  return {
    views: await attachAccounts(companyId, withSources, readers),
    status: result.status === 'ok' ? 'ok' : 'unavailable',
    truncated: result.truncated,
  };
}

/* ── Account-only prospects (read side) ───────────────────────────────────── */

const hasPerson = (v: CanonicalLeadView): boolean => !!(v.unifiedPersonId ?? v.identity?.unifiedPersonId);

/** The originating contribution's source record of an account-only canonical prospect, or null. */
function accountSourceRecordOf(v: CanonicalLeadView): string | null {
  if (!canonicalLeadIdOf(v) || hasPerson(v) || v.provenanceStatus !== 'loaded') return null;
  return (v.sources ?? []).find((c) => c.role === 'originating')?.sourceRecordId ?? null;
}

function withAccount(v: CanonicalLeadView, read: AccountReadResult | null): CanonicalLeadView {
  if (!canonicalLeadIdOf(v) || hasPerson(v)) return { ...v, account: null, accountStatus: 'not_applicable' };
  // Account-only prospect whose provenance could not be read: the account is unknown, not absent.
  if (v.provenanceStatus === 'unavailable') return { ...v, account: null, accountStatus: 'unavailable' };
  const sr = accountSourceRecordOf(v);
  if (!sr || !read) return { ...v, account: null, accountStatus: 'not_applicable' };
  if (read.status !== 'ok') return { ...v, account: null, accountStatus: 'unavailable' };
  const account: LeadAccount | undefined = read.bySourceRecord.get(sr);
  return account ? { ...v, account, accountStatus: 'loaded' } : { ...v, account: null, accountStatus: 'not_found' };
}

/** Resolve accounts for every account-only prospect in `views` (≤2 batched reads per ≤100 ids). Never throws. */
async function attachAccounts(companyId: string, views: CanonicalLeadView[], readers: LeadSourceReaders): Promise<CanonicalLeadView[]> {
  const ids = views.map(accountSourceRecordOf).filter((x): x is string => x !== null);
  if (ids.length === 0) return views.map((v) => withAccount(v, null));
  const read = readers.accounts ?? defaultLeadSourceReaders.accounts!;
  let result: AccountReadResult;
  try {
    result = await read(companyId, ids);
  } catch (err) {
    reportReadFailure('prospect_accounts', 'organization_id', 'exception', err instanceof Error ? err.message : String(err));
    result = { status: 'error', bySourceRecord: new Map(), reads: 0 };
  }
  return views.map((v) => withAccount(v, result));
}

/** Paginated query + provenance for exactly the returned page. */
async function pageWithProvenance(
  companyId: string,
  collected: Collected,
  query: LeadQuery,
  readers: LeadSourceReaders,
): Promise<LeadQueryResult> {
  const page = applyLeadQuery(collected.views, query);
  const attached = await attachProvenance(companyId, page.rows, readers);
  const truncatedSources = attached.truncated
    ? [...collected.truncatedSources, 'prospect_source_contributions']
    : collected.truncatedSources;
  return {
    ...page,
    rows: attached.views,
    truncated: truncatedSources.length > 0,
    truncatedSources,
    provenance: attached.status,
    signalMerge: collected.signalMerge,
  };
}

/** The unified, paginated, filtered, searched lead read. */
export async function searchLeads(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadQueryResult> {
  const limit = Math.max(1, Math.min(query.page?.limit ?? 50, 500));
  const offset = Math.max(0, query.page?.offset ?? 0);
  if (!query.companyId) return { rows: [], total: 0, limit, offset };
  const collected = await collectViews(query.companyId, readers);
  return pageWithProvenance(query.companyId, collected, query, readers);
}

export interface AllLeadsResult {
  rows: CanonicalLeadView[];
  total: number;
  truncated: boolean;
  truncatedSources: string[];
  provenance: 'ok' | 'unavailable' | 'not_requested';
  signalMerge?: SignalMergeStatus;
}

/**
 * The WHOLE filtered, sorted set — for consumers that must see every lead
 * (audience evaluation). `searchLeads` clamps a page at 500, so a caller asking it
 * for 5000 silently got 500. Provenance is opt-in here (chunked, ≤100 ids/read);
 * without it the provenance fields are left unset because nothing was read.
 */
export async function listAllLeads(
  query: LeadQuery,
  opts: { withProvenance?: boolean } = {},
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<AllLeadsResult> {
  if (!query.companyId) return { rows: [], total: 0, truncated: false, truncatedSources: [], provenance: 'not_requested' };
  const collected = await collectViews(query.companyId, readers);
  const rows = sortLeads(filterLeads(collected.views, query), query.sort);
  if (!opts.withProvenance) {
    // Provenance fields are left UNSET (not "not_applicable"): nothing was read.
    return {
      rows, total: rows.length,
      truncated: collected.truncatedSources.length > 0, truncatedSources: collected.truncatedSources, provenance: 'not_requested',
      signalMerge: collected.signalMerge,
    };
  }
  const attached = await attachProvenance(query.companyId, rows, readers);
  const truncatedSources = attached.truncated ? [...collected.truncatedSources, 'prospect_source_contributions'] : collected.truncatedSources;
  return {
    rows: attached.views, total: rows.length, truncated: truncatedSources.length > 0, truncatedSources, provenance: attached.status,
    signalMerge: collected.signalMerge,
  };
}

/**
 * Repository-owned aggregation — counts/statistics/status-summary/source-breakdown.
 * Consumers (dashboard widgets/counters, analytics) receive ready-to-render data;
 * no consumer-side aggregation. Reuses the single bulk collect (anti-N+1).
 */
export async function getLeadStats(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadStats> {
  if (!query.companyId) {
    return { total: 0, bySource: {}, byStatus: {}, intentBands: { high: 0, medium: 0, low: 0 }, withIdentity: 0, withCampaign: 0, byOriginCategory: {}, bySourceLabel: {} };
  }
  const collected = await collectViews(query.companyId, readers);
  const filtered = filterLeads(collected.views, query);
  const truncatedSources = [...collected.truncatedSources];
  // Per-origin breakdown: ONE tenant-wide read of originating contributions,
  // only when the filtered set contains canonical prospects.
  let provenance: LeadStats['provenance'] = 'not_requested';
  let views = filtered;
  if (filtered.some((v) => canonicalLeadIdOf(v) !== null)) {
    const read = readers.originatingContributions ?? defaultLeadSourceReaders.originatingContributions!;
    const result = await safeRead(() => read(query.companyId));
    provenance = result.status === 'ok' ? 'ok' : 'unavailable';
    if (result.truncated) truncatedSources.push('prospect_source_contributions');
    if (result.status === 'ok') {
      views = filtered.map((v) => {
        const id = canonicalLeadIdOf(v);
        if (!id) return v;
        const origin = originFrom(result.byLead.get(id)?.find((c) => c.role === 'originating'), v.origin);
        return { ...v, origin, sourceLabel: displayLabelFor(v.source, origin) };
      });
    }
  }
  return {
    ...computeLeadStats(views),
    truncated: truncatedSources.length > 0,
    truncatedSources: [...new Set(truncatedSources)],
    provenance,
    signalMerge: collected.signalMerge,
  };
}

/**
 * Active Leads as a repository-backed filtered view (community scope = today's
 * behaviour). Active Leads owns NO query logic — it renders this result.
 */
export async function getActiveLeadsView(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadQueryResult> {
  const limit = Math.max(1, Math.min(query.page?.limit ?? 50, 500));
  const offset = Math.max(0, query.page?.offset ?? 0);
  if (!query.companyId) return { rows: [], total: 0, limit, offset };
  const collected = await collectViews(query.companyId, readers);
  return pageWithProvenance(query.companyId, { ...collected, views: activeLeadsCompatibilityFilter(collected.views) }, query, readers);
}

/**
 * Resolve one unified lead by its stable key and hydrate its full profile (every
 * section the workspace renders) via the EXISTING pure projection/recommendation/
 * timeline builders. No new business logic, no per-lead source queries (anti-N+1):
 * the view already carries identity / scores / attribution / campaign / content;
 * auxiliary source arrays (touchpoints/events/threads) default to [] so projections
 * degrade to their real zero-state rather than fabricating data. Repository-only.
 */
export async function getLeadProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadProfile | null> {
  if (!companyId || !leadKey) return null;
  const { views } = await collectViews(companyId, readers);
  // A merged lead is found by its own key OR by the persisted key of any record
  // folded into it (alias) — deep links / memberships keyed by the durable row resolve.
  const found = views.find((v) => v.organizationId === companyId && leadKeyFor(v) === leadKey)
    ?? views.find((v) => v.organizationId === companyId && viewHasLeadKey(v, leadKey))
    ?? null;
  if (!found) return null;
  const view = (await attachProvenance(companyId, [found], readers)).views[0];

  // Every provenance contribution is its own timeline event (when each source
  // observed the prospect): the originating source and every later contributor.
  const contributionEvents: TimelineEvent[] = (view.sources ?? []).map((c) => ({
    origin: 'prospect_source_contributions',
    source: view.source,
    entityId: c.id,
    eventType: c.role === 'originating' ? 'source_originated' : 'source_contributed',
    occurredAt: c.observedAt,
    metadata: { sourceCategory: c.sourceCategory, platform: c.platform, externalRef: c.externalRef, sourceUrl: c.sourceUrl },
  }));

  const leadEvent: TimelineEvent = {
    origin: view.sourceRef?.table ?? view.source,
    source: view.source,
    entityId: view.sourceRef?.id ?? null,
    eventType: 'lead_captured',
    occurredAt: view.occurredAt,
    metadata: {
      sourceLabel: view.sourceLabel,
      campaign: view.campaign,
      content: view.content,
      status: view.status,
      referrer: view.referrer,
    },
  };

  // Every record folded into this lead (signal merge) keeps its own capture event.
  const linkedEvents: TimelineEvent[] = (view.linkedRecords ?? []).map((r) => ({
    origin: r.sourceRef?.table ?? r.source,
    source: r.source,
    entityId: r.sourceRef?.id ?? null,
    eventType: 'lead_captured',
    occurredAt: r.occurredAt,
    metadata: {
      sourceLabel: r.sourceLabel,
      campaign: r.campaign,
      content: r.content,
      status: r.status,
      linkedLeadKey: r.leadKey,
      matchedOn: r.matchedOn.kind,
    },
  }));

  return {
    // The representative's own (stable) key, also when resolved through an alias.
    leadKey: leadKeyFor(view),
    view,
    identity: identityProjection(view),
    campaign: campaignProjection(view),
    journey: journeyProjection(view),
    content: contentProjection(view, {}),
    activity: activityProjection(view, []),
    opportunity: opportunityProjection(view),
    marketPulse: marketPulseProjection(view),
    crm: crmProjection(view),
    engagement: engagementProjection(view),
    analytics: analyticsProjection(view),
    timeline: buildTimeline([leadEvent, ...linkedEvents, ...contributionEvents]),
    summary: summarizeLead(view),
    recommendedNextAction: recommendNextAction(view),
  };
}

const aux = async (table: string, col: string, val: string, tenant: string, limit: number): Promise<Array<Record<string, unknown>>> => {
  if (!val) return [];
  try {
    const { data, error } = await ownedDbTable(table).select('*').eq('company_id', tenant).eq(col, val).limit(limit);
    return !error && Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } catch { return []; }
};

/**
 * Enriched lead profile (Phase 9) — the base profile PLUS first-class enrichment
 * sections (visitor journey, campaign attribution, content references, website
 * behaviour, source detail) projected from the canonical view's captured attribution.
 * Reuses getLeadProfile (no duplication) and hydrates the EXISTING tracking
 * (visitor_sessions / tracking_events / campaign_touchpoints) for this one lead —
 * bounded single-lead reads (not N+1), tenant-scoped, fail-open. Additive: the base
 * LeadProfile contract is unchanged. Repository owns every projection.
 */
export async function getEnrichedLeadProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<EnrichedLeadProfile | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const view = base.view;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, view);
  const websiteBehaviour = websiteBehaviourProjection({ events, touchpoints, sessionCount: sessions.length });
  const buyingIntent = buildBuyingIntentProfile({ view, events, touchpoints, sessions, timeline: base.timeline });

  // Account-level summary when the lead belongs to a known company (reuses the
  // company-intelligence builder; no duplicated logic, no extra per-contact reads).
  const companyKey = resolveCompanyKey(view);
  let company: EnrichedLeadProfile['company'] = null;
  if (companyKey) {
    const ci = await getCompanyIntelligence(companyId, companyKey, readers);
    company = ci ? summarizeCompanyIntelligence(ci) : null;
  }

  return {
    ...base,
    visitorJourney: visitorJourneyProjection(view, sessions),
    campaignAttribution: campaignAttributionProjection(view),
    contentReferences: contentReferenceProjection(view),
    websiteBehaviour,
    sourceDetail: sourceDetailProjection(view),
    buyingIntent,
    actionPlan: buildLeadActionPlan({ view, buyingIntent, behaviour: websiteBehaviour }),
    company,
  };
}

/** Hydrate the EXISTING tracking for one lead (bounded, tenant-scoped, fail-open). Shared. */
async function hydrateLeadTracking(companyId: string, view: CanonicalLeadView): Promise<{ events: Array<Record<string, unknown>>; touchpoints: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>> }> {
  const sm = (view.attribution.sourceMetadata ?? {}) as Record<string, unknown>;
  const sessionId = (sm.visitor_session_id as string) || (view.identity.anonymousId ?? '') || '';
  const leadId = view.sourceRef?.id ?? '';
  const personId = view.unifiedPersonId ?? '';
  const [events, touchpoints, sessions] = await Promise.all([
    aux('tracking_events', 'visitor_session_id', sessionId, companyId, 1000),
    leadId ? aux('campaign_touchpoints', 'lead_id', leadId, companyId, 1000) : aux('campaign_touchpoints', 'visitor_session_id', sessionId, companyId, 1000),
    personId ? aux('visitor_sessions', 'unified_person_id', personId, companyId, 200) : (sessionId ? aux('visitor_sessions', 'id', sessionId, companyId, 1) : Promise.resolve([])),
  ]);
  return { events, touchpoints, sessions };
}

/**
 * Standalone Buying Intent Intelligence (Phase 10) — the deterministic decision-support
 * object, reusable by the workspace, future email/calling, CRM and automations. Resolves
 * the lead, hydrates the EXISTING tracking, and runs the pure engine. Repository owns it.
 */
export async function getBuyingIntentProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<BuyingIntentProfile | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, base.view);
  return buildBuyingIntentProfile({ view: base.view, events, touchpoints, sessions, timeline: base.timeline });
}

/**
 * Standalone Lead Action Plan (Phase 11) — the deterministic action layer (actions,
 * readiness, CRM package, qualification, follow-up). Reusable by the workspace, CRM,
 * and future email/calling/automation modules. Composes the buying-intent engine +
 * existing behaviour; no execution, repository-owned.
 */
export async function getLeadActionPlan(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadActionPlan | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, base.view);
  const websiteBehaviour = websiteBehaviourProjection({ events, touchpoints, sessionCount: sessions.length });
  const buyingIntent = buildBuyingIntentProfile({ view: base.view, events, touchpoints, sessions, timeline: base.timeline });
  return buildLeadActionPlan({ view: base.view, buyingIntent, behaviour: websiteBehaviour });
}

/**
 * Company Intelligence (Phase 12) — account-centric aggregation across every known
 * contact that shares a prospect company (grouped by a deterministic company key).
 * One bulk collect (anti-N+1); per-contact intent is built from the view alone (no
 * per-contact tracking reads). Tenant-scoped, fail-open, repository-owned. Reusable
 * by the workspace, CRM, and future channels. No execution / no CRM sync.
 */
export async function getCompanyIntelligence(
  companyId: string,
  companyKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<CompanyIntelligenceProfile | null> {
  if (!companyId || !companyKey) return null;
  const key = companyKey.toLowerCase();
  const { views } = await collectViews(companyId, readers);
  const matched = views.filter((v) => v.organizationId === companyId && resolveCompanyKey(v) === key);
  if (matched.length === 0) return null;
  const contacts = matched.map((view) => ({ view, buyingIntent: buildBuyingIntentProfile({ view }) }));
  const companyName = resolveCompanyName(matched[0]);
  return buildCompanyIntelligence({ companyKey: key, companyName, contacts });
}

export interface LeadExportResult { contentType: string; filename: string; body: string }

/** Repository-backed export (CSV / Excel) over the unified set — never the raw sources. */
export async function exportLeads(
  query: LeadQuery,
  format: 'csv' | 'excel',
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadExportResult> {
  // The WHOLE filtered set, sorted deterministically. (This used `searchLeads`
  // with limit 5000, but the page limit clamps at 500, so every export larger
  // than 500 rows was silently cut to 500.) Provenance is attached in chunks of
  // ≤100 canonical prospect ids.
  const collected: Collected = query.companyId
    ? await collectViews(query.companyId, readers)
    : { views: [], truncatedSources: [], signalMerge: NO_MERGE };
  const attached = await attachProvenance(query.companyId, sortLeads(filterLeads(collected.views, query), query.sort), readers);
  const all = { rows: attached.views };
  const truncatedSources = attached.truncated ? [...collected.truncatedSources, 'prospect_source_contributions'] : collected.truncatedSources;
  if (truncatedSources.length > 0) {
    console.warn(`[leadIntelligenceReadService] export for tenant ${query.companyId} is truncated — capped sources: ${truncatedSources.join(', ')}`);
  }

  // ── W0-B. GOVERNED EGRESS ────────────────────────────────────────────────
  // An export is a send in every respect that matters to the person in it: it
  // hands their email, their phone and an instruction to act to whoever
  // downloaded the file. The dispatch gate never sees this path, so the same
  // canonical rules are applied here.
  //
  // ONE tenant-scoped read, then the PURE `mayContact` per row — anchoring the
  // existing loader per row would be two queries per lead, up to 10,000.
  //
  // FAIL CLOSED, twice over: an unreadable governance store redacts every
  // sensitive field in every row, and a row that cannot be anchored to a person
  // or a target is redacted too, because an unanchorable subject is one no
  // restriction could ever have matched.
  const governance = await loadTenantGovernanceRecords(query.companyId, ['email', 'phone']);
  const now = new Date().toISOString();

  const discloseFor = (view: CanonicalLeadView): ExportDisclosure => {
    if (!governance.ok) return DISCLOSE_NOTHING;
    const personId = view.identity.unifiedPersonId ?? view.unifiedPersonId ?? null;
    const permits = (channel: 'email' | 'phone', target: string | null | undefined): boolean => {
      // R1 — NORMALISE AT THE COMPARISON BOUNDARY, per channel: email through
      // the email rule, phone through the phone rule, never one with the other.
      //
      // THE DEFECT THIS CLOSES (M2). This seam compared the view's raw endpoint
      // against `record.targetNormalized`, which the canonical writer had
      // normalised. It happened to agree only because `resolveUnifiedPerson`
      // normalises before writing the person spine — an upstream coincidence,
      // not a guarantee: `unified_persons` carries no normalisation constraint
      // (and none at all on `primary_phone`), so any other writer, backfill or
      // import could land a value that silently bypassed a real restriction.
      const targetNormalized = normalizeGovernanceTarget(channel, target ?? null);
      // Unanchorable → deny, now judged on the value that can actually match.
      // A raw endpoint that normalises to nothing could never match a record, and
      // disclosing on that basis would be exactly the fail-open this guard exists
      // to prevent.
      if (!targetNormalized && !personId) return false;
      return mayContact({
        organizationId: query.companyId,
        personId,
        targetNormalized,
        channel,
        now,
        records: governance.records,
      }).decision === 'allowed';
    };
    const email = view.identity.email ? permits('email', view.identity.email) : false;
    const phone = view.identity.phone ? permits('phone', view.identity.phone) : false;
    // The provenance evidence URL points at the person's own post / profile.
    // Granted only when every PRESENT endpoint is permitted AND no all-channel
    // (`*`) restriction applies to the person. The probe channel below names no
    // real channel, so only `*` records can match it ("every channel, including
    // channels that do not exist yet").
    const everyEndpointPermitted = (!view.identity.email || email) && (!view.identity.phone || phone);
    const blockedEverywhere = !!personId && mayContact({
      organizationId: query.companyId,
      personId,
      targetNormalized: null,
      channel: 'provenance_export',
      now,
      records: governance.records,
    }).decision !== 'allowed';
    // An actionable recommendation is an instruction to contact. It is withheld
    // unless at least one channel actually permits contact.
    return { email, phone, action: email || phone, sourceUrl: everyEndpointPermitted && !blockedEverywhere };
  };

  const rows = all.rows.map((v) => toExportRow(v, undefined, discloseFor(v)));
  if (format === 'excel') {
    return { contentType: 'application/vnd.ms-excel; charset=utf-8', filename: 'lead-intelligence.xls', body: toExcelXml(rows) };
  }
  return { contentType: 'text/csv; charset=utf-8', filename: 'lead-intelligence.csv', body: `﻿${toCsv(rows)}` };
}

/**
 * Tenant-filtered READ path for `prospect_source_contributions`.
 *
 * The writer (`contributionWriter.ts`) is the only write path; this is the only
 * read path the unified lead reader uses. It maps rows to the contract's
 * `ProvenanceContribution` and never throws.
 *
 * Tenant isolation: every read is `.eq('organization_id', <companies.id>)`, and
 * each returned row is re-checked in memory (organization + requested lead id).
 * A row that fails the re-check is dropped AND reported — it would mean the
 * filter is broken, never a reason to show another tenant's evidence.
 *
 * Fail-open, observably: until the migration is applied in production the table
 * does not exist (42P01 from Postgres, PGRST205 from PostgREST's schema cache).
 * The read then yields NO contributions with `status: 'table_missing'` and one
 * warning per (table, code) per process — never a throw, never silence. Any other
 * error is `status: 'error'`, reported the same way. Callers surface the status so
 * "no sources" is never confused with "sources unavailable".
 *
 * Bounded: lead ids are read in chunks (one read per chunk, ≤ CHUNK ids, so a
 * default page of 50 leads is ONE read), each read capped at READ_CAP rows with a
 * deterministic order; hitting the cap sets `truncated`.
 *
 * `source_metadata` is deliberately NOT selected: it is free-form provider
 * payload with no redaction contract, and the read model does not expose it.
 */
import { ownedDbTable } from '../../db/writeOwner';
import {
  PROVENANCE_DB,
  isSourceCategory,
  type ContributionRole,
  type ProvenanceContribution,
} from '../../../lib/prospectProvenance/contract';

export type ContributionReadStatus = 'ok' | 'table_missing' | 'error';

export interface ContributionReadResult {
  status: ContributionReadStatus;
  /** canonical_lead_id → contributions, originating first then by observedAt, id. */
  byLead: Map<string, ProvenanceContribution[]>;
  /** At least one read hit READ_CAP; some contributions may be missing. */
  truncated: boolean;
  /** Number of database reads issued (observability/tests). */
  reads: number;
}

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Injectable query seam (tests). Default: PostgREST via the owned table seam. */
export interface ContributionQueryPort {
  byLeads(organizationId: string, leadIds: string[], limit: number): Promise<QueryResult>;
  originating(organizationId: string, limit: number): Promise<QueryResult>;
}

export const CONTRIBUTION_COLUMNS = [
  'id', 'organization_id', 'canonical_lead_id', 'contribution_role', 'source_category', 'external_ref',
  'source_record_id', 'platform', 'source_url', 'contact_id', 'lead_signal_id', 'opportunity_feed_item_id',
  'engagement_message_id', 'observed_at', 'evidence',
].join(',');

export const CHUNK = 100;
export const READ_CAP = 2000;
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

const defaultPort: ContributionQueryPort = {
  async byLeads(organizationId, leadIds, limit) {
    const { data, error } = await ownedDbTable(PROVENANCE_DB.table)
      .select(CONTRIBUTION_COLUMNS)
      .eq('organization_id', organizationId)
      .in('canonical_lead_id', leadIds)
      .order('canonical_lead_id', { ascending: true })
      .order('observed_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    return { data, error };
  },
  async originating(organizationId, limit) {
    const { data, error } = await ownedDbTable(PROVENANCE_DB.table)
      .select(CONTRIBUTION_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('contribution_role', 'originating')
      .order('observed_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(limit);
    return { data, error };
  },
};

const reported = new Set<string>();
function reportOnce(key: string, ...args: unknown[]): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[contributionReader] ${PROVENANCE_DB.table}`, ...args);
}

/** Test seam: forget which conditions were already reported. */
export function resetContributionReadReportsForTests(): void {
  reported.clear();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const jsonObj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Map one row to the contract shape; null when the row violates the contract. */
export function mapContributionRow(row: Row): ProvenanceContribution | null {
  const id = str(row.id);
  const role = row.contribution_role;
  const category = row.source_category;
  const externalRef = str(row.external_ref);
  const observedAt = str(row.observed_at);
  if (!id || (role !== 'originating' && role !== 'contributing') || !isSourceCategory(category) || !externalRef || !observedAt) {
    return null;
  }
  return {
    id,
    role: role as ContributionRole,
    sourceCategory: category,
    externalRef,
    platform: str(row.platform),
    sourceUrl: str(row.source_url),
    sourceRecordId: str(row.source_record_id),
    observedAt,
    signalRefs: {
      leadSignalId: str(row.lead_signal_id),
      opportunityFeedItemId: str(row.opportunity_feed_item_id),
      engagementMessageId: str(row.engagement_message_id),
      contactId: str(row.contact_id),
    },
    evidence: jsonObj(row.evidence),
  };
}

/** Originating first, then observedAt ascending, then id — total and deterministic. */
export function compareContributions(a: ProvenanceContribution, b: ProvenanceContribution): number {
  if (a.role !== b.role) return a.role === 'originating' ? -1 : 1;
  if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function classify(error: { code?: string; message?: string }): ContributionReadStatus {
  return MISSING_TABLE_CODES.has(String(error.code ?? '')) ? 'table_missing' : 'error';
}

/** Fold one read's rows into `byLead`, enforcing the tenant + lead-id re-check. */
function absorb(
  organizationId: string,
  rows: Row[],
  wanted: Set<string> | null,
  byLead: Map<string, ProvenanceContribution[]>,
): void {
  for (const row of rows) {
    const leadId = str(row.canonical_lead_id);
    if (row.organization_id !== organizationId || !leadId || (wanted && !wanted.has(leadId))) {
      reportOnce('foreign_row', 'returned a row outside the requested tenant/leads — dropped');
      continue;
    }
    const c = mapContributionRow(row);
    if (!c) {
      reportOnce('invalid_row', 'row violates the provenance contract — skipped:', str(row.id));
      continue;
    }
    const list = byLead.get(leadId);
    if (list) list.push(c); else byLead.set(leadId, [c]);
  }
}

function finish(result: ContributionReadResult): ContributionReadResult {
  for (const list of result.byLead.values()) list.sort(compareContributions);
  return result;
}

async function run(
  label: string,
  query: () => Promise<QueryResult>,
): Promise<{ rows: Row[]; status: ContributionReadStatus; truncated: boolean }> {
  try {
    const { data, error } = await query();
    if (error) {
      const status = classify(error);
      reportOnce(`${label}|${String(error.code ?? 'unknown')}`,
        status === 'table_missing' ? 'is not readable (table missing) — provenance unavailable:' : 'read failed — provenance unavailable:',
        String(error.code ?? 'unknown'), String(error.message ?? ''));
      return { rows: [], status, truncated: false };
    }
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const truncated = rows.length > READ_CAP;
    if (truncated) reportOnce(`${label}|truncated`, `read hit its cap of ${READ_CAP} rows — contributions truncated`);
    return { rows: truncated ? rows.slice(0, READ_CAP) : rows, status: 'ok', truncated };
  } catch (err) {
    reportOnce(`${label}|exception`, 'read threw — provenance unavailable:', err instanceof Error ? err.message : String(err));
    return { rows: [], status: 'error', truncated: false };
  }
}

/**
 * Complete contribution history for the given canonical leads of ONE tenant.
 * One read per chunk of ≤ CHUNK lead ids. Never throws.
 */
export async function readContributionsForLeads(
  organizationId: string,
  leadIds: string[],
  deps: { port?: ContributionQueryPort } = {},
): Promise<ContributionReadResult> {
  const port = deps.port ?? defaultPort;
  const result: ContributionReadResult = { status: 'ok', byLead: new Map(), truncated: false, reads: 0 };
  const ids = [...new Set(leadIds.filter((x) => typeof x === 'string' && x.length > 0))].sort();
  if (!organizationId || ids.length === 0) return result;
  const wanted = new Set(ids);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    result.reads += 1;
    const r = await run('byLeads', () => port.byLeads(organizationId, chunk, READ_CAP + 1));
    if (r.status !== 'ok') {
      // The store is unreadable: report it for the whole request, not a partial history.
      return { status: r.status, byLead: new Map(), truncated: false, reads: result.reads };
    }
    result.truncated = result.truncated || r.truncated;
    absorb(organizationId, r.rows, wanted, result.byLead);
  }
  return finish(result);
}

/**
 * The originating contribution of every canonical lead of one tenant (one read),
 * for aggregate breakdowns (stats). Never throws.
 */
export async function readOriginatingContributions(
  organizationId: string,
  deps: { port?: ContributionQueryPort } = {},
): Promise<ContributionReadResult> {
  const port = deps.port ?? defaultPort;
  const result: ContributionReadResult = { status: 'ok', byLead: new Map(), truncated: false, reads: 0 };
  if (!organizationId) return result;
  result.reads = 1;
  const r = await run('originating', () => port.originating(organizationId, READ_CAP + 1));
  if (r.status !== 'ok') return { ...result, status: r.status };
  result.truncated = r.truncated;
  absorb(organizationId, r.rows.filter((row) => row.contribution_role === 'originating'), null, result.byLead);
  return finish(result);
}

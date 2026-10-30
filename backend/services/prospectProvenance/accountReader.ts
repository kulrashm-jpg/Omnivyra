/**
 * Tenant-filtered READ path for the account of an account-only canonical prospect.
 *
 * A canonical prospect created without a person (unverified identity) is still a
 * prospect of an ACCOUNT. The account is reached through provenance, never
 * guessed:
 *
 *   originating contribution.source_record_id
 *     → source_records.account_id          (tenant: organization_id)
 *     → prospect_accounts.name / domain    (tenant: organization_id)
 *
 * The write side (setting `source_records.account_id`) is Workstream C's; this is
 * only the read side.
 *
 * Batched: at most one read per chunk of ≤ CHUNK ids per table, so a page of 50
 * prospects is two reads. Tenant isolation: every read is `.eq('organization_id',
 * X)` and every returned row is re-checked in memory (tenant + requested id); a
 * row that fails is dropped and reported. Fail-open, observably: a missing table
 * (42P01 / PGRST205) or column (42703 / PGRST204) yields `status:
 * 'table_missing'`, any other error `status: 'error'` — one warning per condition
 * per process, never a throw, and callers surface the status so "no account" is
 * never confused with "account unreadable".
 *
 * Only the account's `name` and normalized `domain` are selected — company data,
 * not personal data.
 */
import { ownedDbTable } from '../../db/writeOwner';
import type { LeadAccount } from '../../../lib/leadIntelligence/types';

export type AccountReadStatus = 'ok' | 'table_missing' | 'error';

export interface AccountReadResult {
  status: AccountReadStatus;
  /** source_record_id → account (only source records that carry a readable account). */
  bySourceRecord: Map<string, LeadAccount>;
  /** Number of database reads issued (observability/tests). */
  reads: number;
}

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Injectable query seam (tests). Default: PostgREST via the owned table seam. */
export interface AccountQueryPort {
  sourceRecords(organizationId: string, ids: string[], limit: number): Promise<QueryResult>;
  accounts(organizationId: string, ids: string[], limit: number): Promise<QueryResult>;
}

export const ACCOUNT_CHUNK = 100;
const MISSING_CODES = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);

const defaultPort: AccountQueryPort = {
  async sourceRecords(organizationId, ids, limit) {
    const { data, error } = await ownedDbTable('source_records')
      .select('id,organization_id,account_id')
      .eq('organization_id', organizationId)
      .in('id', ids)
      .limit(limit);
    return { data, error };
  },
  async accounts(organizationId, ids, limit) {
    const { data, error } = await ownedDbTable('prospect_accounts')
      .select('id,organization_id,name,domain_normalized')
      .eq('organization_id', organizationId)
      .in('id', ids)
      .limit(limit);
    return { data, error };
  },
};

const reported = new Set<string>();
function reportOnce(key: string, ...args: unknown[]): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn('[accountReader]', ...args);
}

/** Test seam: forget which conditions were already reported. */
export function resetAccountReadReportsForTests(): void {
  reported.clear();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function run(
  table: string,
  query: () => Promise<QueryResult>,
): Promise<{ rows: Row[]; status: AccountReadStatus }> {
  try {
    const { data, error } = await query();
    if (error) {
      const code = String(error.code ?? 'unknown');
      const status: AccountReadStatus = MISSING_CODES.has(code) ? 'table_missing' : 'error';
      reportOnce(`${table}|${code}`, `${table} is not readable — account unavailable:`, code, String(error.message ?? ''));
      return { rows: [], status };
    }
    return { rows: Array.isArray(data) ? (data as Row[]) : [], status: 'ok' };
  } catch (err) {
    reportOnce(`${table}|exception`, `${table} read threw — account unavailable:`, err instanceof Error ? err.message : String(err));
    return { rows: [], status: 'error' };
  }
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += ACCOUNT_CHUNK) out.push(ids.slice(i, i + ACCOUNT_CHUNK));
  return out;
}

/**
 * Accounts for the given source records of ONE tenant. Never throws.
 * Source records without an account are simply absent from `bySourceRecord`.
 */
export async function readAccountsForSourceRecords(
  organizationId: string,
  sourceRecordIds: string[],
  deps: { port?: AccountQueryPort } = {},
): Promise<AccountReadResult> {
  const port = deps.port ?? defaultPort;
  const result: AccountReadResult = { status: 'ok', bySourceRecord: new Map(), reads: 0 };
  const ids = [...new Set(sourceRecordIds.filter((x) => typeof x === 'string' && x.length > 0))].sort();
  if (!organizationId || ids.length === 0) return result;

  // 1. source record → account id (tenant re-checked).
  const wantedRecords = new Set(ids);
  const accountOf = new Map<string, string>();
  for (const chunk of chunks(ids)) {
    result.reads += 1;
    const r = await run('source_records', () => port.sourceRecords(organizationId, chunk, chunk.length));
    if (r.status !== 'ok') return { status: r.status, bySourceRecord: new Map(), reads: result.reads };
    for (const row of r.rows) {
      const id = str(row.id);
      if (row.organization_id !== organizationId || !id || !wantedRecords.has(id)) {
        reportOnce('foreign_source_record', 'source_records returned a row outside the requested tenant/ids — dropped');
        continue;
      }
      const accountId = str(row.account_id);
      if (accountId) accountOf.set(id, accountId);
    }
  }
  const accountIds = [...new Set(accountOf.values())].sort();
  if (accountIds.length === 0) return result;

  // 2. account id → name / domain (tenant re-checked).
  const wantedAccounts = new Set(accountIds);
  const accounts = new Map<string, LeadAccount>();
  for (const chunk of chunks(accountIds)) {
    result.reads += 1;
    const r = await run('prospect_accounts', () => port.accounts(organizationId, chunk, chunk.length));
    if (r.status !== 'ok') return { status: r.status, bySourceRecord: new Map(), reads: result.reads };
    for (const row of r.rows) {
      const id = str(row.id);
      if (row.organization_id !== organizationId || !id || !wantedAccounts.has(id)) {
        reportOnce('foreign_account', 'prospect_accounts returned a row outside the requested tenant/ids — dropped');
        continue;
      }
      accounts.set(id, { id, name: str(row.name), domain: str(row.domain_normalized), via: 'originating_source_record' });
    }
  }
  for (const [recordId, accountId] of accountOf) {
    const a = accounts.get(accountId);
    if (a) result.bySourceRecord.set(recordId, a);
  }
  return result;
}

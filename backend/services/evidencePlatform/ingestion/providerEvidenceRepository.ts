/**
 * Canonical provider_evidence Repository  (BETA-RELEASE-001, Phase 2/4/7)
 *
 * The ONE canonical DB persistence for provider Evidence — over the `provider_evidence` table (migration
 * 20260902000000). No provider-specific storage, no fork. It maps the in-memory `EvidenceRecord` ↔ a
 * `provider_evidence` row (pure, deterministic mappers) and provides guarded async upsert/load. The runtime
 * store stays the fast in-memory `EvidenceStore`; this repository DURABLY persists + hydrates it across runs
 * once the migration is applied. Every DB call is guarded — it NEVER throws (a missing table / connection
 * error returns `{ ok:false }`, so the decision run is never broken and failures are visible, not silent).
 */
import { supabase } from '../../../db/supabaseClient';
import { classifyFreshness } from './evidenceFreshness';
import type { EvidenceRecord } from './evidenceStore';
import type { EvidenceGovernance } from '../validation/evidenceGovernance';
import type { Evidence } from '../evidenceModel';

/** A `provider_evidence` row (subset the repository reads/writes). */
export interface ProviderEvidenceRow {
  company_id: string;
  provider_id: string;
  subject_id: string;
  evidence: Evidence[];
  fetched_at: string;
  status: EvidenceRecord['status'];
  failure_reason: string | null;
  governance: EvidenceGovernance | null;
  freshness_state: string | null;
  measured: boolean;
  updated_at?: string;
}

const isMeasured = (evidence: Evidence[]): boolean => evidence.some((e) => e.maturity !== 'UNAVAILABLE' && e.value != null);

/** Pure: EvidenceRecord → row (freshness derived deterministically on write). Testable without a DB. */
export function recordToRow(companyId: string, record: EvidenceRecord, nowIso: string, maxAgeHours: number): ProviderEvidenceRow {
  return {
    company_id: companyId,
    provider_id: record.providerId,
    subject_id: record.subjectId,
    evidence: record.evidence,
    fetched_at: record.fetchedAt,
    status: record.status,
    failure_reason: record.failureReason,
    governance: record.governance ?? null,
    freshness_state: classifyFreshness(record.fetchedAt, nowIso, maxAgeHours, record.status),
    measured: isMeasured(record.evidence),
  };
}

/** Pure: row → EvidenceRecord (round-trips `recordToRow`). */
export function rowToRecord(row: ProviderEvidenceRow): EvidenceRecord {
  return {
    providerId: row.provider_id,
    subjectId: row.subject_id,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    fetchedAt: row.fetched_at,
    status: row.status,
    failureReason: row.failure_reason,
    governance: row.governance ?? null,
  };
}

export interface RepoResult {
  ok: boolean;
  error: string | null;
}

/**
 * Durably upsert one record to the canonical store. Guarded — never throws; a missing table / DB error is
 * returned as `{ ok:false, error }` (visible failure, no silent degradation). Upserts on the canonical
 * `(company_id, provider_id, subject_id)` unique key — one record per provider/subject (no duplicate rows).
 */
export async function persistProviderEvidence(companyId: string, record: EvidenceRecord, nowIso: string, maxAgeHours: number): Promise<RepoResult> {
  try {
    const row = recordToRow(companyId, record, nowIso, maxAgeHours);
    const { error } = await supabase
      .from('provider_evidence')
      .upsert({ ...row, updated_at: nowIso }, { onConflict: 'company_id,provider_id,subject_id' });
    return { ok: !error, error: error?.message ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown persistence error' };
  }
}

/** Load all persisted records for a company (to hydrate the in-memory store). Guarded — never throws. */
export async function loadProviderEvidence(companyId: string): Promise<{ records: EvidenceRecord[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('provider_evidence')
      .select('provider_id, subject_id, evidence, fetched_at, status, failure_reason, governance')
      .eq('company_id', companyId);
    if (error) return { records: [], error: error.message };
    return { records: ((data ?? []) as ProviderEvidenceRow[]).map(rowToRecord), error: null };
  } catch (err) {
    return { records: [], error: err instanceof Error ? err.message : 'unknown load error' };
  }
}

/** Health check: whether the canonical table is reachable (guarded, read-only). */
export async function providerEvidenceTableHealthy(): Promise<{ healthy: boolean; error: string | null }> {
  try {
    const { error } = await supabase.from('provider_evidence').select('id', { count: 'exact', head: true }).limit(1);
    return { healthy: !error, error: error?.message ?? null };
  } catch (err) {
    return { healthy: false, error: err instanceof Error ? err.message : 'unknown health error' };
  }
}

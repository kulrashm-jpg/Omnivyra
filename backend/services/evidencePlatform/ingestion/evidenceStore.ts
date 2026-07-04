/**
 * Canonical Evidence Store  (BETA-ENGINE-007, Phase 4)
 *
 * A single, provider-agnostic persistence abstraction for canonical provider Evidence. One store, many
 * providers, many consumers — no provider-specific storage. Each record holds the canonical `Evidence[]`
 * (which already carries provider, measurement, timestamp, freshness, confidence, maturity, source,
 * validationStatus and calculation provenance — Phase 4's required fields), plus ingestion metadata
 * (fetchedAt, status, failure reason) keyed by `(providerId, subjectId)`.
 *
 * The default implementation is in-memory (deterministic, dependency-free, used by the orchestrator + tests).
 * A DB-backed implementation persists the same records to the `provider_evidence` table (migration
 * shipped, unapplied in this environment per the migration-ledger governance) — swapped in via
 * `setEvidenceStore()` without touching any caller.
 */
import type { Evidence } from '../evidenceModel';
import type { EvidenceGovernance } from '../validation/evidenceGovernance';

export type EvidenceRecordStatus = 'ready' | 'refresh_in_progress' | 'refresh_failed';

export interface EvidenceRecord {
  providerId: string;
  subjectId: string;
  /** Canonical Evidence rows that PASSED validation (rejected rows removed — never enter a decision). */
  evidence: Evidence[];
  /** ISO timestamp the Evidence was fetched (passed in; deterministic). */
  fetchedAt: string;
  status: EvidenceRecordStatus;
  /** Present when status is refresh_failed. */
  failureReason: string | null;
  /** BETA-ENGINE-008: validation + quality + conflict governance for this record (traceability). */
  governance?: EvidenceGovernance | null;
}

export interface EvidenceStore {
  put(record: EvidenceRecord): void;
  get(providerId: string, subjectId: string): EvidenceRecord | null;
  list(subjectId: string): EvidenceRecord[];
  markRefreshing(providerId: string, subjectId: string): void;
  clear(): void;
}

const key = (providerId: string, subjectId: string): string => `${providerId}::${subjectId}`;

/** Deterministic, dependency-free in-memory store (default). */
export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly records = new Map<string, EvidenceRecord>();

  put(record: EvidenceRecord): void {
    this.records.set(key(record.providerId, record.subjectId), record);
  }

  get(providerId: string, subjectId: string): EvidenceRecord | null {
    return this.records.get(key(providerId, subjectId)) ?? null;
  }

  list(subjectId: string): EvidenceRecord[] {
    return [...this.records.values()].filter((r) => r.subjectId === subjectId);
  }

  markRefreshing(providerId: string, subjectId: string): void {
    const existing = this.get(providerId, subjectId);
    this.records.set(key(providerId, subjectId), {
      providerId, subjectId,
      evidence: existing?.evidence ?? [],
      fetchedAt: existing?.fetchedAt ?? '',
      status: 'refresh_in_progress',
      failureReason: null,
    });
  }

  clear(): void {
    this.records.clear();
  }
}

let _store: EvidenceStore = new InMemoryEvidenceStore();

/** The active canonical Evidence store (in-memory by default; DB-backed when configured). */
export function getEvidenceStore(): EvidenceStore {
  return _store;
}

/** Swap the active store (e.g. to a DB-backed implementation). */
export function setEvidenceStore(store: EvidenceStore): void {
  _store = store;
}

/** Convenience helper: the persisted Evidence rows for a provider+subject, or [] when absent. */
export function readPersistedEvidence(providerId: string, subjectId: string, store: EvidenceStore = _store): Evidence[] {
  return store.get(providerId, subjectId)?.evidence ?? [];
}

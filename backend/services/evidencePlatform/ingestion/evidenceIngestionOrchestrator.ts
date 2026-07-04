/**
 * Canonical Evidence Ingestion Orchestrator  (BETA-ENGINE-007, Phase 2/3/7)
 *
 * ONE reusable orchestration layer for all providers — no provider-specific orchestration. Responsibilities:
 * provider discovery (via registered specs), authentication check, fetch, validation, normalization (the
 * adapters already emit canonical Evidence), persistence (canonical Evidence store), freshness, failure
 * handling, and a deterministic retry policy. Decision engines never call providers directly and never
 * duplicate a fetch — the orchestrator fetches ONCE per (provider, subject) and every consumer reads the
 * persisted Evidence.
 *
 * Deterministic: timestamps are passed in (no clock); no randomness. Every failure becomes canonical
 * Evidence (persisted), never a silent skip.
 */
import type { Evidence } from '../evidenceModel';
import { PROVIDER_FAILURE, failureToEvidence } from '../providers/providerFailure';
import { getEvidenceStore, type EvidenceStore, type EvidenceRecord } from './evidenceStore';
import { classifyFreshness, needsRefresh, type FreshnessState } from './evidenceFreshness';
// BETA-ENGINE-008: every fetched Evidence set is validated + quality-scored + conflict-governed BEFORE
// persistence; only validated Evidence is persisted (invalid rows never reach a decision engine).
import { governEvidence } from '../validation/evidenceGovernance';

/** Normalised ingestion subject — the union of inputs the provider fetch functions need. */
export interface IngestionSubject {
  subjectId: string;
  brandName?: string | null;
  domain?: string | null;
  siteUrl?: string | null;
  category?: string | null;
  /** Optional raw inputs the fetch spec may consume (review sources, bing rows, …). */
  extra?: Record<string, unknown>;
}

/** A provider's normalised ingestion contract. `fetch` returns canonical Evidence (never throws by contract;
 *  the orchestrator still guards + retries in case an adapter throws unexpectedly). */
export interface IngestionSpec {
  providerId: string;
  isConfigured: () => boolean;
  maxAgeHours: number;
  /** Provider reliability (0..1) from the descriptor — feeds quality + conflict resolution. */
  providerReliability?: number | null;
  fetch: (subject: IngestionSubject, nowIso: string) => Promise<Evidence[]> | Evidence[];
}

const specs = new Map<string, IngestionSpec>();

export function registerIngestionSpec(spec: IngestionSpec): void {
  specs.set(spec.providerId, spec);
}

export function listIngestionSpecs(): IngestionSpec[] {
  return [...specs.values()];
}

/** Test helper — clear the registered specs. */
export function __clearIngestionSpecs(): void {
  specs.clear();
}

export type IngestionOutcome =
  | 'persisted' // measured or failure Evidence fetched + persisted
  | 'reused_fresh' // an existing fresh record was reused (no fetch)
  | 'skipped_unconfigured'; // provider has no credentials → not fetched (engines fall back)

export interface IngestionResult {
  providerId: string;
  outcome: IngestionOutcome;
  /** Count of VALIDATED evidence rows persisted (rejected rows excluded). */
  evidenceCount: number;
  freshness: FreshnessState | null;
  measured: boolean;
  failureReason: string | null;
  /** BETA-ENGINE-008 governance summary. */
  governanceStatus?: 'validated' | 'flagged' | 'rejected' | null;
  qualityScore?: number | null;
  rejectedCount?: number;
  conflictCount?: number;
}

export interface IngestionOptions {
  store?: EvidenceStore;
  /** Max fetch attempts on unexpected throw (default 2). Deterministic — no backoff timing. */
  retries?: number;
  /** Force a refetch even when a fresh record exists. */
  force?: boolean;
}

async function fetchWithRetry(spec: IngestionSpec, subject: IngestionSubject, nowIso: string, attempts: number): Promise<{ evidence: Evidence[]; failed: boolean; reason: string | null }> {
  let lastReason: string | null = null;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      const evidence = await spec.fetch(subject, nowIso);
      return { evidence, failed: false, reason: null };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'unknown fetch error';
    }
  }
  // Retry exhausted → synthesize a canonical UNAVAILABLE failure Evidence (no silent degradation).
  const failure = failureToEvidence({
    providerId: spec.providerId,
    state: PROVIDER_FAILURE.UNAVAILABLE,
    reason: `Ingestion fetch failed after ${Math.max(1, attempts)} attempt(s): ${lastReason ?? 'unknown'}`,
    evidenceKey: 'ingestion',
    observedAt: nowIso,
  });
  return { evidence: [failure], failed: true, reason: lastReason };
}

const hasMeasured = (evidence: Evidence[]): boolean =>
  evidence.some((e) => e.maturity !== 'UNAVAILABLE' && e.value != null);

/** Ingest one provider for one subject: discover → auth-check → (freshness) → fetch → validate → persist. */
export async function ingestProvider(
  spec: IngestionSpec,
  subject: IngestionSubject,
  nowIso: string,
  opts: IngestionOptions = {},
): Promise<IngestionResult> {
  const store = opts.store ?? getEvidenceStore();

  // Auth check — unconfigured providers are not fetched (engines fall back; not a failure).
  if (!spec.isConfigured()) {
    return { providerId: spec.providerId, outcome: 'skipped_unconfigured', evidenceCount: 0, freshness: null, measured: false, failureReason: null };
  }

  // Freshness — reuse a fresh persisted record instead of re-fetching (one fetch, many consumers).
  const existing = store.get(spec.providerId, subject.subjectId);
  if (!opts.force && existing) {
    const state = classifyFreshness(existing.fetchedAt, nowIso, spec.maxAgeHours, existing.status);
    if (!needsRefresh(state) && state !== 'refresh_in_progress') {
      return {
        providerId: spec.providerId, outcome: 'reused_fresh', evidenceCount: existing.evidence.length,
        freshness: state, measured: hasMeasured(existing.evidence), failureReason: null,
        governanceStatus: existing.governance?.validation.status ?? null,
        qualityScore: existing.governance?.quality.qualityScore ?? null,
        rejectedCount: existing.governance?.validation.rejectedCount ?? 0,
        conflictCount: existing.governance?.conflictCount ?? 0,
      };
    }
  }

  store.markRefreshing(spec.providerId, subject.subjectId);
  const { evidence: fetched, failed, reason } = await fetchWithRetry(spec, subject, nowIso, opts.retries ?? 2);

  // BETA-ENGINE-008: validate + quality-score + conflict-govern BEFORE persistence. Only validated rows
  // are persisted (rejected rows can never reach a decision engine); governance is retained for traceability.
  const governed = governEvidence(fetched, {
    nowIso, maxAgeHours: spec.maxAgeHours, providerId: spec.providerId, providerReliability: spec.providerReliability ?? null,
  });

  const record: EvidenceRecord = {
    providerId: spec.providerId,
    subjectId: subject.subjectId,
    evidence: governed.valid, // validated subset only
    fetchedAt: nowIso,
    status: failed ? 'refresh_failed' : 'ready',
    failureReason: failed ? reason : null,
    governance: governed.governance,
  };
  store.put(record);
  const freshness = classifyFreshness(record.fetchedAt, nowIso, spec.maxAgeHours, record.status);
  return {
    providerId: spec.providerId, outcome: 'persisted', evidenceCount: governed.valid.length,
    freshness, measured: hasMeasured(governed.valid), failureReason: record.failureReason,
    governanceStatus: governed.governance.validation.status,
    qualityScore: governed.governance.quality.qualityScore,
    rejectedCount: governed.governance.validation.rejectedCount,
    conflictCount: governed.governance.conflictCount,
  };
}

/** Ingest ALL registered providers for one subject. Deterministic order (registration order). */
export async function ingestProviderEvidence(
  subject: IngestionSubject,
  nowIso: string,
  opts: IngestionOptions = {},
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  for (const spec of listIngestionSpecs()) {
    results.push(await ingestProvider(spec, subject, nowIso, opts));
  }
  return results;
}

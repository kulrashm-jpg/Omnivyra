// Snapshot comparability identity.
//
// Change intelligence, forecast and authority trajectory all work by
// SUBTRACTING one stored snapshot from another. That subtraction is only a
// statement about the company when both snapshots measured THE SAME SUBJECT
// WITH THE SAME INSTRUMENT. Until this module existed every history read was
// keyed on `company_id` alone (`HistoryRange.company_id`), so three different
// kinds of non-event were published as movement:
//
//   1. The company changed website. `buildCanonicalReport` is handed
//      `options.domain` from `companyContext.domain`; the same `company_id`
//      can outlive a domain change, and every score in the report is measured
//      against the live site.
//   2. The run used a different scan profile. `executionPolicies.ts` gives
//      `lightweight` one query class with `runStructuredDataExtraction: false`
//      and `runBenchmark: false`, while `deep` gets four classes with both on.
//      A `lightweight` → `deep` pair moves because the MEASUREMENT widened.
//   3. The scoring engine changed. `source_metadata.engine_version` is already
//      persisted for exactly this reason; a scoring change moves the number
//      with the world held constant.
//
// The identity below is the minimum set that separates "the company moved"
// from "we measured something else". It deliberately does NOT include
// `providers_used` / `providers_unavailable`: provider availability flaps on
// essentially every run (that is why `ProviderHistoryRecord.outcome` has
// `rate_limited` / `timeout` / `quota_exceeded`), so folding it into the
// identity would make no two snapshots ever comparable and history would never
// accumulate. Per-provider availability drift is a COVERAGE question, handled
// where coverage is handled, not a subject-identity question.
//
// FAIL CLOSED. An unknown comparability fact is never "comparable". A snapshot
// whose identity cannot be fully reconstructed — in particular every row
// written before `subject_domain` was recorded — yields `comparable: false`
// with a reason, never a silent pass and never a number.

import { normalizeDomain } from '../../../lib/shared/domain/companyDomain';
import type { ReportSnapshotRecord } from './historicalPersistence';

export type ComparabilityIdentity = {
  company_id: string;
  /** Normalized bare host of the site that was actually measured. */
  subject_domain: string;
  scan_profile: ReportSnapshotRecord['scan_profile'];
  engine_version: string;
};

/**
 * `reason` is non-null exactly when `comparable` is false.
 *
 * Deliberately NOT a discriminated union: this project compiles with
 * `strict: false`, under which TypeScript does not reliably narrow a union on
 * a boolean literal discriminant, so a `{ comparable: true } | { comparable:
 * false; reason: string }` shape forces casts at every read. The flat shape
 * matches the `reason_unavailable: string | null` idiom used by every other
 * abstaining result in this directory.
 */
export type ComparabilityVerdict = {
  comparable: boolean;
  reason: string | null;
};

/** Named so the writer, the reader and the tests all quote the same sentence. */
export const INCOMPLETE_CURRENT_IDENTITY_REASON =
  'This run has no complete comparability identity (company, measured domain, scan profile and engine version must all be known), so it cannot be compared with anything.';

export const BASELINE_HAS_NO_IDENTITY_REASON =
  'The stored snapshot carries no comparability identity — it predates comparability recording, so the site it measured is unknown and it cannot serve as a baseline.';

/**
 * `https://www.Acme.com/pricing` → `acme.com`.
 *
 * Reuses `lib/shared/domain/companyDomain.normalizeDomain`, the repo's declared
 * single source of truth for host normalization, so a snapshot's subject key
 * cannot drift from the company-identity key used elsewhere. Returns `null`
 * (not `''`) when no host can be extracted, because an absent subject must be
 * distinguishable from a present one and must never compare equal to anything.
 */
export function resolveComparabilitySubjectDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const host = normalizeDomain(raw);
  // A host with no dot is not a site (it is a brand word, a slug, or a stray
  // label); treating it as a subject key would let two unrelated runs match.
  if (!host || !host.includes('.')) return null;
  return host;
}

/**
 * Build the identity for a run that is ABOUT TO BE recorded. Returns `null`
 * when any component is missing — the caller must then treat the run as
 * non-comparable rather than substituting a default.
 */
export function buildComparabilityIdentity(params: {
  companyId: string | null | undefined;
  domain: string | null | undefined;
  scanProfile: ReportSnapshotRecord['scan_profile'];
  engineVersion: string | null | undefined;
}): ComparabilityIdentity | null {
  const companyId = typeof params.companyId === 'string' ? params.companyId.trim() : '';
  const subjectDomain = resolveComparabilitySubjectDomain(params.domain);
  const engineVersion = typeof params.engineVersion === 'string' ? params.engineVersion.trim() : '';
  if (!companyId || !subjectDomain || !engineVersion || !params.scanProfile) return null;
  return {
    company_id: companyId,
    subject_domain: subjectDomain,
    scan_profile: params.scanProfile,
    engine_version: engineVersion,
  };
}

/**
 * Reconstruct the identity of a STORED snapshot.
 *
 * `scan_profile` and `source_metadata.engine_version` are already persisted
 * (columns `scan_profile text NOT NULL` and `source_metadata jsonb NOT NULL`
 * in `report_score_history`). `subject_domain` is the one fact that was never
 * recorded, so it is carried as an additive key inside the existing
 * `source_metadata` JSON — no new column, no migration.
 *
 * Returns `null` for any row that predates that key. Those rows are REAL
 * history and are never deleted or rewritten; they simply cannot be used as a
 * comparison baseline, because the site they measured is unknowable after the
 * fact and a domain change is precisely the hazard this guard exists for.
 */
export function readComparabilityIdentity(
  record: Pick<ReportSnapshotRecord, 'company_id' | 'scan_profile' | 'source_metadata'>,
): ComparabilityIdentity | null {
  return buildComparabilityIdentity({
    companyId: record.company_id,
    domain: record.source_metadata?.subject_domain ?? null,
    scanProfile: record.scan_profile,
    engineVersion: record.source_metadata?.engine_version ?? null,
  });
}

/** Human-readable reason naming EVERY component that differs. */
function describeMismatch(a: ComparabilityIdentity, b: ComparabilityIdentity): string[] {
  const mismatched: string[] = [];
  if (a.company_id !== b.company_id) mismatched.push(`company (${b.company_id} → ${a.company_id})`);
  if (a.subject_domain !== b.subject_domain) {
    mismatched.push(`domain (${b.subject_domain} → ${a.subject_domain})`);
  }
  if (a.scan_profile !== b.scan_profile) {
    mismatched.push(`scan profile (${b.scan_profile} → ${a.scan_profile})`);
  }
  if (a.engine_version !== b.engine_version) {
    mismatched.push(`engine version (${b.engine_version} → ${a.engine_version})`);
  }
  return mismatched;
}

/**
 * The whole contract in one function: two snapshots are comparable only when
 * BOTH identities are fully known AND every component matches.
 */
export function compareComparability(
  current: ComparabilityIdentity | null,
  candidate: ComparabilityIdentity | null,
): ComparabilityVerdict {
  if (!current) {
    return { comparable: false, reason: INCOMPLETE_CURRENT_IDENTITY_REASON };
  }
  if (!candidate) {
    return { comparable: false, reason: BASELINE_HAS_NO_IDENTITY_REASON };
  }
  const mismatched = describeMismatch(current, candidate);
  if (mismatched.length > 0) {
    return {
      comparable: false,
      reason: `The stored snapshot is not comparable with this run: ${mismatched.join('; ')}.`,
    };
  }
  return { comparable: true, reason: null };
}

export function isComparableWith(
  current: ComparabilityIdentity | null,
  record: Pick<ReportSnapshotRecord, 'company_id' | 'scan_profile' | 'source_metadata'>,
): boolean {
  return compareComparability(current, readComparabilityIdentity(record)).comparable;
}

/**
 * Restrict a history window to the snapshots that may legitimately be placed on
 * one axis with `current`. Order is preserved; nothing is reordered or merged.
 */
export function filterComparableSnapshots<
  T extends Pick<ReportSnapshotRecord, 'company_id' | 'scan_profile' | 'source_metadata'>,
>(current: ComparabilityIdentity | null, snapshots: readonly T[]): T[] {
  if (!current) return [];
  return snapshots.filter((snapshot) => isComparableWith(current, snapshot));
}

export type BaselineSelection =
  | { state: 'comparable'; baseline: ReportSnapshotRecord }
  | { state: 'no_history'; reason: string }
  | { state: 'not_comparable'; reason: string; rejected: number };

/**
 * Pick the most recent PRIOR snapshot that is comparable with this run.
 *
 * An older comparable snapshot is preferred over a newer incomparable one —
 * e.g. one ad-hoc `deep` scan between two `standard` scans does not destroy the
 * standard-to-standard comparison; it is simply not the baseline.
 *
 * The three outcomes are deliberately distinct, because they are three
 * different things to tell a reader:
 *   - `no_history`     — nothing to compare against yet (this is baseline #1)
 *   - `not_comparable` — prior runs exist but none measured the same subject
 *                        with the same instrument
 *   - `comparable`     — a legitimate baseline
 */
export function selectComparableBaseline(params: {
  current: ComparabilityIdentity | null;
  /** Prior snapshots, any order; the caller has already excluded the current run. */
  priorSnapshots: readonly ReportSnapshotRecord[];
}): BaselineSelection {
  const prior = [...params.priorSnapshots].sort((a, b) =>
    a.observed_at < b.observed_at ? 1 : a.observed_at > b.observed_at ? -1 : 0,
  );

  if (prior.length === 0) {
    return {
      state: 'no_history',
      reason:
        'No prior snapshot stored — change intelligence activates on the second comparable report run.',
    };
  }

  if (!params.current) {
    return {
      state: 'not_comparable',
      reason: INCOMPLETE_CURRENT_IDENTITY_REASON,
      rejected: prior.length,
    };
  }

  for (const candidate of prior) {
    if (isComparableWith(params.current, candidate)) {
      return { state: 'comparable', baseline: candidate };
    }
  }

  // Every prior snapshot was rejected. Name WHY the most recent one failed —
  // that is the one a reader would otherwise expect to see a delta against.
  const verdict = compareComparability(params.current, readComparabilityIdentity(prior[0]));
  const checked = `${prior.length} prior snapshot${prior.length === 1 ? ' was' : 's were'} checked and none is comparable, so no movement can be reported.`;
  return {
    state: 'not_comparable',
    reason: verdict.reason ? `${verdict.reason} ${checked}` : checked,
    rejected: prior.length,
  };
}

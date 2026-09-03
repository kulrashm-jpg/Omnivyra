/**
 * PI-P1-W06 — observability for the two PI safety mechanisms.
 *
 * Governance and deduplication both work by REFUSING things, and a refusal
 * leaves no artefact. `leadOutreachExecution/telemetry.ts` already instruments
 * the outreach side of governance; the ingestion and Path B side emitted
 * nothing at all, so the same decisions were observable or invisible depending
 * only on which caller reached the evaluator. This closes that asymmetry, and
 * deliberately nothing more.
 *
 * ─── THE DISTINCTION THIS EXISTS TO PRESERVE ──────────────────────────────
 * `recordGovernanceFailure` in the outreach module states it exactly: "blocked
 * means the rules said no, failure means we could not ask. Conflating them
 * would let a broken governance layer look like a quiet one."
 *
 * That conflation was live here. `isSuppressed` answers `{ suppressed: true }`
 * both when a person asked never to be contacted and when the governance table
 * could not be read — the fail-closed posture is correct and unchanged, but from
 * outside the two were indistinguishable and neither was recorded anywhere. A
 * governance outage would have looked like a well-behaved, quiet system.
 *
 * LI-5E made the same argument for the shadow counter: "'zero disagreements'
 * and 'zero observations' look identical in a log."
 *
 * ─── IT PLUGS INTO THE EXISTING REGISTRY ──────────────────────────────────
 * `backend/observability/metrics` — the HARDEN-001 store the snapshot and the
 * Prometheus exporter already enumerate generically. No new transport, no new
 * table, no new observability domain, no dashboard of its own.
 *
 * ─── BOUNDED CARDINALITY, NO TENANT LABEL ─────────────────────────────────
 * Every label comes from a closed set declared in this file: 18 series in total,
 * forever, regardless of traffic or tenant count. Organization, person, account
 * and record ids are NEVER labels — they are unbounded, and the registry is a
 * platform aggregate that tenant-facing code can read. Per-event tenant detail
 * belongs in the tenant-scoped structured log lines at the call sites, which is
 * where `external_identity_shadow` already puts it.
 *
 * ─── NO SENSITIVE DATA ────────────────────────────────────────────────────
 * No email, phone, handle, domain or suppression value is recorded here. A
 * suppression VALUE is precisely the personal data the suppression exists to
 * protect; it belongs in the database row, not in a metric an exporter
 * publishes.
 *
 * ─── FAIL-SAFE: OBSERVATION NEVER GATES A DECISION ────────────────────────
 * Every recorder swallows its own failure. A counter must never break the path
 * it observes, and must never become a precondition for a safety decision —
 * W06 is observability only, and the fail-closed semantics of the paths below
 * are untouched by it.
 */

import { recordRawCounter } from '../../observability/metrics';

/** `<domain>.<subject>.<unit>`, matching the HARDEN-001 convention. */
export const IDENTITY_METRICS = {
  governance: {
    decisions: 'identity.governance.decisions',
    failClosed: 'identity.governance.failclosed',
  },
  dedup: {
    detection: 'identity.dedup.detection',
  },
  account: {
    resolution: 'identity.account.resolution',
  },
} as const;

const counter = (name: string, labels: Record<string, string>): void => {
  try {
    recordRawCounter(name, 1, labels);
  } catch {
    /* observation must never break the path it observes */
  }
};

// ── Governance ──────────────────────────────────────────────────────────────

/** Path B's boolean seam collapses `blocked` and `deferred` into one answer. */
export type GovernanceGateDecision = 'allowed' | 'suppressed';

/** Which store answered. `none` means neither did — an allow by absence. */
export type GovernanceStore = 'canonical' | 'legacy' | 'none';

/**
 * The four fail-closed paths, kept DISTINCT.
 *
 * They are different faults with different owners: a caller that lost the
 * tenant, an unreadable canonical table, an erroring legacy query, and an
 * exception escaping the legacy read. A single `error` label would tell an
 * operator that governance is broken without telling them where, which is the
 * question they actually need answered at 3am.
 */
export const GOVERNANCE_FAILCLOSED_STAGES = [
  'no_tenant',
  'canonical_read',
  'legacy_read',
  'legacy_exception',
] as const;
export type GovernanceFailClosedStage = typeof GOVERNANCE_FAILCLOSED_STAGES[number];

/** One governance gate verdict. 2 decisions x 3 stores = 6 series. */
export function recordGovernanceGateDecision(
  decision: GovernanceGateDecision,
  store: GovernanceStore,
): void {
  counter(IDENTITY_METRICS.governance.decisions, { decision, store });
}

/**
 * A suppression that happened because we could not ask, not because the rules
 * said no. Recorded IN ADDITION to the decision above, never instead of it: the
 * refusal is real and must still count as a refusal.
 *
 * 4 series. A non-zero rate here is an outage signal, not a compliance signal.
 */
export function recordGovernanceFailClosed(stage: GovernanceFailClosedStage): void {
  counter(IDENTITY_METRICS.governance.failClosed, { stage });
}

// ── Deduplication ───────────────────────────────────────────────────────────

/**
 * `none` is the reason this counter exists. A duplicate that was parked leaves
 * a durable row in `person_duplicate_candidates`; a detection that found
 * nothing leaves no trace at all, so "dedup ran and the data is clean" and
 * "dedup never ran" were the same observation. Only this separates them.
 */
export const DEDUP_OUTCOMES = ['none', 'parked', 'already_open'] as const;
export type DedupOutcome = typeof DEDUP_OUTCOMES[number];

/** One duplicate-detection pass. 3 series. */
export function recordDedupOutcome(outcome: DedupOutcome): void {
  counter(IDENTITY_METRICS.dedup.detection, { outcome });
}

// ── Account identity ────────────────────────────────────────────────────────

/**
 * The account resolver's own outcome vocabulary, reused rather than
 * re-spelled — `AccountOutcome` in `accountResolution.ts` is the authority and
 * this counter must not drift from it.
 *
 * `ambiguous` is the one that matters most: it is a REFUSED MERGE — the
 * resolver saw evidence pointing at two accounts and declined to pick — and the
 * orchestrator then maps it to `null`, the same value it uses for "the source
 * said nothing about an employer". Without this counter a refused merge and an
 * absent employer are the same non-event.
 */
export function recordAccountResolutionOutcome(outcome: string): void {
  counter(IDENTITY_METRICS.account.resolution, { outcome });
}

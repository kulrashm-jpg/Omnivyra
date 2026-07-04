/**
 * Executive Root Cause Model  (BETA-ENGINE-010, Phase 4)
 *
 * Canonical types for deterministic root-cause analysis. A `RootCause` turns correlated evidence into a
 * diagnosis — the "why" behind a recommendation — so executive decisions target CAUSES, not symptoms.
 * NO AI, NO probability: every field is derived deterministically from validated + correlated Evidence.
 */

/** The deterministic role a diagnosed cause plays. */
export type RootCauseType =
  | 'primary_cause' // the dominant driver of the observed problem
  | 'contributing_cause' // a secondary driver that worsens it
  | 'blocking_cause' // a cause that must be resolved before others can improve (a dependency)
  | 'dependent_cause' // a symptom that depends on a blocking cause (fixing it alone won't help)
  | 'missing_cause' // a diagnosis cannot be made — the required evidence/correlation is absent
  | 'conflicting_cause' // the supporting correlations conflict — the cause cannot be asserted cleanly
  | 'resolved_cause'; // a positive finding — this area is a strength, not a gap (don't recommend fixing it)

export type SeverityBand = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** A canonical Root Cause artifact (Phase 4). */
export interface RootCause {
  causeId: string;
  causeType: RootCauseType;
  severity: number; // 0..100 deterministic severity
  severityBand: SeverityBand;
  confidence: number; // 0..1 — mean of the supporting correlations' confidence
  supportingEvidence: string[]; // canonical evidence keys behind the cause
  supportingCorrelations: string[]; // correlation ruleIds / reason codes
  missingEvidence: string[];
  conflictingEvidence: string[];
  blockingDependencies: string[];
  explanation: string;
  reasonCodes: string[];
  validationStatus: 'validated';
  freshnessAt: string | null;
  decisionConsumers: string[];
  /** Human title (e.g. "Authority Deficit") for report + recommendation targeting. */
  title: string;
}

/**
 * Cross-Evidence Correlation Model  (BETA-ENGINE-009, Phase 4)
 *
 * Canonical types for deterministic cross-evidence intelligence. A `CorrelatedEvidence` result is itself a
 * first-class, explainable artifact — it names the participating measurements, the relationship, and the
 * exact reason. NO AI, NO probability — every field is derived deterministically from measured canonical
 * Evidence.
 */

/** The deterministic relationship a correlation rule can assert between evidence measurements. */
export type RelationshipType =
  | 'agreement' // measurements point the same way (both strong or both weak)
  | 'contradiction' // measurements disagree (one strong, one weak) in a way that signals a problem
  | 'dependency' // one measurement gates another (X cannot improve without Y)
  | 'reinforcement' // measurements mutually strengthen a conclusion
  | 'weak_support' // supported, but by a thin evidence base
  | 'strong_support' // supported by a robust evidence base
  | 'missing_supporting_evidence' // a required corroborating measurement is absent
  | 'conflicting_supporting_evidence'; // corroborating measurements conflict

/** How a correlation should influence the consuming decision's confidence (deterministic, bounded). */
export type ConfidenceEffect = 'reinforce' | 'contradict' | 'support' | 'neutral';

/** A single participating measurement in a correlation. */
export interface CorrelationMeasurement {
  measurement: string; // logical measurement name
  key: string | null; // the physical canonical evidence key that supplied it (null when missing)
  value: number | null;
}

/** A canonical Correlated Evidence result (Phase 4). */
export interface CorrelatedEvidence {
  ruleId: string;
  relationshipType: RelationshipType;
  /** 0..1 deterministic strength of the relationship. */
  strength: number;
  /** 0..1 fraction of the rule's required measurements that were present. */
  coverage: number;
  /** 0..1 correlation confidence (coverage × strength for asserted relationships; 0 when missing). */
  confidence: number;
  explanation: string;
  reasonCode: string;
  participatingEvidence: CorrelationMeasurement[];
  supportingMeasurements: string[];
  missingMeasurements: string[];
  contradictions: string[];
  dependencies: string[];
  confidenceEffect: ConfidenceEffect;
  decisionConsumers: string[];
  /** ISO of the most recent participating observation, when known. */
  freshnessAt: string | null;
  validationStatus: 'validated'; // only measured, validated evidence participates
}

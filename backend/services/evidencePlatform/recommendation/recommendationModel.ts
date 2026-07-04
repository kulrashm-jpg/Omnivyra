/**
 * Recommendation & Execution Plan Model  (BETA-ENGINE-011, Phase 4)
 *
 * Canonical types for deterministic, evidence-backed execution plans. A recommendation is no longer a
 * static template string — it is an `ExecutionPlan` generated from a validated `RootCause`, carrying the
 * steps, dependencies, success criteria, and provenance needed to execute AND measure it. NO AI, NO
 * probability, NO generic templates — every field is derived deterministically from the root cause + its
 * supporting evidence/correlations.
 */

/** The kind of action a recommendation represents. */
export type ActionType =
  | 'corrective' // fix a diagnosed problem
  | 'preventive' // prevent a weakness from worsening
  | 'optimization' // improve an already-working area
  | 'monitoring' // watch a strength / signal to sustain it
  | 'dependency' // resolve a blocking cause that gates other work
  | 'validation'; // re-validate conflicting / uncertain signals

export type PriorityBand = 'p0' | 'p1' | 'p2' | 'p3';

/** A single canonical execution plan (Phase 4). */
export interface ExecutionPlan {
  recommendationId: string;
  ruleId: string;
  title: string;
  actionType: ActionType;
  /** 0..100 deterministic priority (Phase 5). */
  priority: number;
  priorityBand: PriorityBand;
  businessImpact: number; // 0..100
  technicalImpact: number; // 0..100
  expectedBusinessOutcome: string;
  expectedTechnicalOutcome: string;
  requiredEffort: number; // 0..100 (higher = more effort)
  dependencies: string[]; // other recommendationIds / causeIds this depends on
  prerequisites: string[];
  executionSteps: string[];
  validationSteps: string[];
  successCriteria: string[];
  supportingEvidence: string[];
  supportingRootCauses: string[]; // causeIds
  supportingCorrelations: string[]; // correlation ruleIds
  confidence: number; // 0..1 (inherited from the root cause)
  reasonCodes: string[];
  /** The legacy template recommendation this plan replaces (for audit/traceability). */
  replaces: string;
  validationStatus: 'validated';
  freshnessAt: string | null;
  decisionConsumers: string[];
}

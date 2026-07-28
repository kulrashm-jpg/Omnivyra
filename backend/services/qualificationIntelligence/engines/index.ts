/**
 * Qualification Intelligence engines (Program 8 / Phase C) — deterministic evidence CONTRIBUTORS only.
 * The assembly is the sole owner of Qualification Understanding; engines ANALYZE the Phase-B evaluation
 * (never re-derive it) and emit contributions/facets/reasoning, abstaining when evidence is insufficient.
 * Descriptive only — no prediction, no recommendation, no workflow, no decisioning. Policy is immutable.
 */
export * from './engineTypes';
export { runCriteria } from './criteria';
export { runEvidence } from './evidence';
export { runConfidence } from './confidence';
export { runPolicy } from './policy';
export { runContext } from './context';
export { runEvaluation } from './evaluation';
export { qualificationHealthSummary, type QualificationHealthSummary } from './healthSummary';
export { assembleQualificationIntelligence, type QualificationAssemblyResult } from './assembly';

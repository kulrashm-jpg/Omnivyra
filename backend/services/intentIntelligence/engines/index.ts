/**
 * Intent Intelligence engines (Program 7 / Phase C) — deterministic evidence CONTRIBUTORS only. The
 * assembly is the sole owner of Intent Understanding; engines ANALYZE the Phase-B interpretation (never
 * re-derive it) and emit contributions/facets/reasoning, abstaining when evidence is insufficient.
 * Descriptive only — no prediction, no recommendation, no decisioning.
 */
export * from './engineTypes';
export { runObjective } from './objective';
export { runEvidence } from './evidence';
export { runConfidence } from './confidence';
export { runConflict } from './conflict';
export { runContext } from './context';
export { runInterpretation } from './interpretation';
export { intentHealthSummary, type IntentHealthSummary } from './healthSummary';
export { assembleIntentIntelligence, type IntentAssemblyResult } from './assembly';

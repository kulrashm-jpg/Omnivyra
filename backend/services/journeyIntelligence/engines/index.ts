/**
 * Journey Intelligence engines (Program 6 / Phase C) — deterministic evidence CONTRIBUTORS only. The
 * assembly is the sole owner of Journey Understanding; engines emit evidence/contributions/facets/
 * reasoning and abstain when evidence is insufficient. Descriptive only — no prediction, no intent, no
 * optimization, no recommendation. Chronology derives from evidence (`observedAt`).
 */
export * from './engineTypes';
export { runProgression } from './progression';
export { runMomentum } from './momentum';
export { runContinuity } from './continuity';
export { runCompletion } from './completion';
export { runMilestone } from './milestone';
export { runTransition } from './transition';
export { journeyHealthSummary, type JourneyHealthSummary } from './healthSummary';
export { assembleJourneyIntelligence, type JourneyAssemblyResult } from './assembly';

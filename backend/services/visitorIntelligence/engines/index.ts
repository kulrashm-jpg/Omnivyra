/**
 * Visitor Intelligence engines (Program 5 / Phase B) — deterministic evidence CONTRIBUTORS only. The
 * assembly is the sole owner of Visitor Understanding; engines emit evidence/contributions/facets/
 * reasoning and abstain when evidence is insufficient. Descriptive only — no prediction, no intent, no
 * journeys, no attribution.
 */
export * from './engineTypes';
export { runBehavioral } from './behavioral';
export { runEngagement } from './engagement';
export { runSession } from './session';
export { runActivityPattern } from './activityPattern';
export { runAcquisition } from './acquisition';
export { visitorConfidence, type VisitorConfidence } from './confidence';
export { visitorHealthSummary, type VisitorHealthSummary, type VisitorHealthStatus } from './healthSummary';
export { assembleVisitorIntelligence, type VisitorAssemblyResult } from './assembly';
// Phase C — validation / readiness (pure, report/assessment only; no enablement).
export { validateVisitorCrossUnderstanding, type VisitorCrossUnderstandingReport } from './crossUnderstanding';
export { validateVisitorShadowBatch, type VisitorShadowReport, type VisitorShadowValidation } from './shadowValidation';
export { assessVisitorAuthoritativeReadiness, type VisitorAuthoritativeReadiness } from './authoritativeReadiness';
export { assessVisitorConsumerReadiness, VISITOR_DOWNSTREAM_CONSUMERS, type VisitorConsumerReadiness, type VisitorDownstreamConsumer } from './consumerReadiness';

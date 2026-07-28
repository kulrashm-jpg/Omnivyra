/**
 * Journey Intelligence (JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase B).
 *
 * The 5th canonical Understanding entity — OWNS ONLY temporal PROGRESSION semantics (ordered
 * touchpoints / stages / milestones / transitions / continuity / completion+abandonment state /
 * summaries) on the SHARED spine. Ordering derives DETERMINISTICALLY from EVIDENCE CHRONOLOGY, never
 * from the graph. It REUSES Facet/EvidenceRef/ReasoningTrace/scoring/explain (no new primitive),
 * PUBLISHES references-only edges into the Program-4 graph (journey is its only owned node; the graph
 * stays relationship infrastructure), and is consumable by the Program-4 cross-entity + platform APIs
 * unchanged. Descriptive only: no prediction, no intent. Flag-dark, shadow-only, additive — Programs
 * 1–5 unchanged (one additive union widening for journey/touchpoint/stage/milestone + ordered edges).
 */
export * from './types';
export { buildJourneyUnderstanding, JOURNEY_MODEL_VERSION, type BuildJourneyInput } from './builder';
export { journeyFromRaw, resolveJourneyId, type JourneyRawInput, type JourneyRawTouchpoint, type AdoptedJourney } from './fromRaw';
export { assembleJourneyUnderstanding, type AssembledJourney } from './assembly';
export { projectJourney } from './projection';
export { journeyEdge, buildJourneyGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyJourneyFields } from './persistence';
export { computeJourneyUnderstandingShadow, compareToRaw, type JourneyShadowBundle, type JourneyShadowComparison } from './shadowRuntime';
export { explainJourney, explainJourneyAll, type Explanation } from './explainability';
export { isJourneyUnderstandingEnabled, isJourneyProjectionAuthoritative } from './flags';
// Phase C — enrichment engines (deterministic contributors; assembly is sole owner).
export {
  assembleJourneyIntelligence, type JourneyAssemblyResult, type JourneyIntelligenceContext, type JourneyEngineOutput,
  runProgression, runMomentum, runContinuity, runCompletion, runMilestone, runTransition,
  journeyHealthSummary, type JourneyHealthSummary,
} from './engines';
// Phase D — frozen canonical contract + governance + migration prohibitions.
export {
  JOURNEY_CANONICAL_CONTRACT, JOURNEY_CONTRACT_VERSION, JOURNEY_PUBLISHED_EDGE_TYPES,
  JOURNEY_GOVERNANCE_RULES, JOURNEY_MIGRATION_PROHIBITIONS,
  validateJourneyContract, type JourneyContractConformance,
} from './contract';

/**
 * Visitor Intelligence (VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase A).
 *
 * The 4th canonical Understanding entity — OWNS ONLY visitor semantics (identity / device / geo /
 * referral / acquisition / session / behavioral / engagement / lifecycle) on the SHARED spine. It
 * REUSES Facet/EvidenceRef/ReasoningTrace/scoring/explainability primitives (no new primitive),
 * PUBLISHES references-only edges into the Program-4 graph (visitor is its only owned node), and is
 * consumable by the Program-4 cross-entity + platform APIs unchanged. Descriptive only: no identity
 * resolution, no attribution modelling, no intent inference. Flag-dark, shadow-only, additive —
 * Programs 1–4 unchanged (one additive union widening for the `visitor` node + reference edges).
 */
export * from './types';
export { buildVisitorUnderstanding, VISITOR_MODEL_VERSION, type BuildVisitorInput } from './builder';
export { visitorFromRaw, resolveVisitorId, type VisitorRawInput, type AdoptedVisitor } from './fromRaw';
export { assembleVisitorUnderstanding, type AssembledVisitor } from './assembly';
export { projectVisitor } from './projection';
export { visitorEdge, buildVisitorGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyVisitorFields } from './persistence';
export { computeVisitorUnderstandingShadow, compareToRaw, type VisitorShadowBundle, type VisitorShadowComparison } from './shadowRuntime';
export { explainVisitor, explainVisitorAll, type Explanation } from './explainability';
export { isVisitorUnderstandingEnabled, isVisitorProjectionAuthoritative } from './flags';
// Phase B — enrichment engines (deterministic contributors; assembly is sole owner).
export {
  assembleVisitorIntelligence, type VisitorAssemblyResult, type VisitorIntelligenceContext, type VisitorEngineOutput,
  runBehavioral, runEngagement, runSession, runActivityPattern, runAcquisition,
  visitorConfidence, type VisitorConfidence, visitorHealthSummary, type VisitorHealthSummary, type VisitorHealthStatus,
} from './engines';
// Phase C — validation / readiness (pure, report/assessment only).
export {
  validateVisitorCrossUnderstanding, type VisitorCrossUnderstandingReport,
  validateVisitorShadowBatch, type VisitorShadowReport,
  assessVisitorAuthoritativeReadiness, type VisitorAuthoritativeReadiness,
  assessVisitorConsumerReadiness, VISITOR_DOWNSTREAM_CONSUMERS, type VisitorConsumerReadiness,
} from './engines';
export { summarizeVisitorRun, type VisitorRunSummary } from './metrics';
// Phase D — frozen canonical contract + governance + migration prohibitions.
export {
  VISITOR_CANONICAL_CONTRACT, VISITOR_CONTRACT_VERSION, VISITOR_PUBLISHED_EDGE_TYPES,
  VISITOR_GOVERNANCE_RULES, VISITOR_MIGRATION_PROHIBITIONS,
  validateVisitorContract, type VisitorContractConformance,
} from './contract';

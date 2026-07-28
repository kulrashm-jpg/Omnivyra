/**
 * Intent Intelligence (INTENT-INTELLIGENCE-PROGRAM-007 / Phase B).
 *
 * The 6th canonical Understanding entity — OWNS ONLY the canonical INTERPRETATION of observed evidence
 * (inferred objective / competing intents / confidence / uncertainty / abstention / evidence summary)
 * on the SHARED spine. It is DESCRIPTIVE interpretation of OBSERVED evidence — never a prediction. It
 * REUSES Facet/EvidenceRef/ReasoningTrace/validateReasoning/fuseEvidence/detectEvidenceContradictions/
 * scoring/explain (no new primitive or inference framework), derives chronology from evidence
 * (`observedAt`), PUBLISHES references-only edges into the Program-4 graph (intent is its only owned
 * node; NO reasoning edges), and is consumable by the Program-4 cross-entity + platform APIs unchanged.
 * Abstains when evidence is insufficient. Flag-dark, shadow-only, additive — Programs 1–6 unchanged
 * (one additive union widening for the `intent` node + `intent_of`/`intent_toward` edges).
 */
export * from './types';
export { buildIntentUnderstanding, INTENT_MODEL_VERSION, type BuildIntentInput } from './builder';
export { intentFromEvidence, resolveIntentId, type IntentEvidenceInput, type IntentSignal, type AdoptedIntent } from './fromEvidence';
export { assembleIntentUnderstanding, type AssembledIntent } from './assembly';
export { projectIntent } from './projection';
export { intentEdge, buildIntentGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyIntentFields } from './persistence';
export { computeIntentUnderstandingShadow, compareToInput, type IntentShadowBundle, type IntentShadowComparison } from './shadowRuntime';
export { explainIntent, explainIntentAll, type Explanation } from './explainability';
export { isIntentUnderstandingEnabled, isIntentProjectionAuthoritative } from './flags';
// Phase C — enrichment engines (deterministic contributors; assembly is sole owner).
export {
  assembleIntentIntelligence, type IntentAssemblyResult, type IntentIntelligenceContext, type IntentEngineOutput,
  runObjective, runEvidence, runConfidence, runConflict, runContext, runInterpretation,
  intentHealthSummary, type IntentHealthSummary,
} from './engines';

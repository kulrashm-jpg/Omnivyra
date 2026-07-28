/**
 * Qualification Intelligence (QUALIFICATION-INTELLIGENCE-PROGRAM-008 / Phase B).
 *
 * The 7th canonical Understanding entity — OWNS ONLY the canonical EVALUATION of qualification policy
 * (qualification state / rationale / per-criterion evaluation / confidence / uncertainty / abstention /
 * policy provenance) on the SHARED spine. A POLICY is a versioned, typed, IMMUTABLE INPUT (declarative
 * criteria) — the builder evaluates it; the policy owns nothing and is not infrastructure. It is
 * DESCRIPTIVE evaluation of current facts — never prescription. It REUSES Facet/EvidenceRef/
 * ReasoningTrace/validateReasoning/scoring/explain (no new primitive, no policy engine), derives
 * chronology from evidence (`observedAt`), PUBLISHES references-only edges into the Program-4 graph
 * (qualification is its only owned node; NO reasoning/policy edges), and is consumable by the Program-4
 * cross-entity + platform APIs unchanged. Abstains when criteria are unevaluable. Flag-dark, shadow-
 * only, additive — Programs 1–7 unchanged (one additive union widening for the `qualification` node +
 * `qualifies`/`qualified_for` edges).
 */
export * from './types';
export { buildQualificationUnderstanding, QUALIFICATION_MODEL_VERSION, type BuildQualificationInput } from './builder';
export { qualificationFromPolicy, resolveQualificationId, type QualificationEvaluationInput, type CriterionObservation, type CriterionOutcome, type AdoptedQualification } from './fromPolicy';
export { assembleQualificationUnderstanding, type AssembledQualification } from './assembly';
export { projectQualification } from './projection';
export { qualificationEdge, buildQualificationGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyQualificationFields } from './persistence';
export { computeQualificationUnderstandingShadow, compareToInput, type QualificationShadowBundle, type QualificationShadowComparison } from './shadowRuntime';
export { explainQualification, explainQualificationAll, type Explanation } from './explainability';
export { isQualificationUnderstandingEnabled, isQualificationProjectionAuthoritative } from './flags';

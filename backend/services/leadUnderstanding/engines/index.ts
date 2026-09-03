/**
 * Phase C — Advanced Lead Intelligence engines. Every engine is a deterministic evidence contributor
 * into the Phase B canonical contracts; the assembly pipeline is the sole owner of Lead Understanding.
 */
export * from './engineTypes';
export { runPersonaIcp } from './personaIcp';
export { runProspectIcpFit, toIcpSubjectFacts } from './prospectIcpFit';
export { runBuyingSignal } from './buyingSignal';
export { runIntent } from './intent';
export { runRelationship } from './relationship';
export { runQualification } from './qualification';
export { runPrioritization } from './prioritization';
export { runRecommendation } from './recommendation';
export { runCrossEngine } from './crossEngine';
export { assembleLeadUnderstanding, type AssemblyResult } from './assembly';
export { assessQuality, type QualityScorecard } from './quality';
export { validateShadowBatch, type ShadowValidationReport, type LeadShadowValidation } from './shadowValidation';
// Phase D
export { runEnrichment } from './enrichment';
export { runBehavioral } from './behavioral';
export { runStrategic } from './strategic';
export { predict, type LeadPredictions, type Prediction, type PredictionName } from './predictive';
export { explain, explainAll, type Explanation } from './explainability';
export { fuseEvidence, DEFAULT_SOURCE_WEIGHTS, type FusionResult } from './fusion';
export { toLegacyView, validateConvergence, type LegacyLeadView, type ConvergenceResult } from './convergence';
export { assessAuthoritativeReadiness, type AuthoritativeReadiness } from './authoritativeReadiness';

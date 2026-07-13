/**
 * decisionIntelligence — the canonical Decision Intelligence layer (PMF-007R).
 *
 * The Recommendation Engine now also produces canonical Decision Objects — the
 * reusable, machine-readable representation every future platform capability consumes
 * instead of parsing recommendation text. Additive over PMF-007: recommendations,
 * prompts, quality, and the API are unchanged.
 */

export {
  DECISION_SCHEMA_VERSION, buildDecisionObject, decisionId, impactFor, urgencyFor,
} from './decisionObjectModel';
export type {
  DecisionObject, DecisionType, DecisionSource, ImpactBand, EffortBand, UrgencyBand, RiskBand, BuildDecisionInput,
} from './decisionObjectModel';

export {
  DECISION_STATES, canDecisionTransition, assertDecisionTransition, isDecisionTerminal,
  nextDecisionStates, replayDecisionLifecycle,
} from './decisionLifecycle';
export type { DecisionStatus } from './decisionLifecycle';

export {
  mapNodeToDecision, mapRecommendationItemToDecision, mapRecommendationsToDecisions, mapGraphToDecisions,
} from './decisionMapping';
export type { DecisionMappingContext } from './decisionMapping';

export { explainDecision, withDecisionExplanation } from './decisionExplainability';
export type { DecisionExplanation } from './decisionExplainability';

export { deriveDecisionRelationships } from './decisionRelationships';
export type { DecisionRelationship, RelationshipType } from './decisionRelationships';

export {
  exportDecisions, recommendationResultToDecisions, decisionsToRecommendationText, exportFromRecommendationResult,
} from './decisionExport';
export type { DecisionExport, ExportOptions } from './decisionExport';

export { emitDecisionEvent, metricForDecisionEvent, resolveDecisionCorrelationId, DECISION_EVENT_CAPABILITY_PREFIX } from './decisionEvents';
export type { DecisionEventName } from './decisionEvents';

export { buildDecisionSnapshot, recordDecisionTelemetry, recordDecisionConsumption } from './decisionObservability';
export type { DecisionSnapshot } from './decisionObservability';

export { produceDecisionsFromRecommendation } from './decisionIntelligenceService';
export type { ProduceDecisionsContext, ProducedDecisions } from './decisionIntelligenceService';

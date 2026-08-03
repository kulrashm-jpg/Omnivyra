/**
 * INT-001 Phase 2 — Lead Intelligence Engine (public surface).
 *
 * A standalone, additive, post-capture intelligence layer. Everything here is
 * pure and deterministic: callers assemble a snapshot from already-stored rows
 * (assembleLeadCaptureSnapshot) and run the engines / the consolidated
 * summary. This module deliberately has ZERO imports from the capture,
 * tracking, attribution or Phase 1 code paths and performs no I/O.
 */

export * from './types';
export {
  defaultEngineConfig,
  resolveEngineConfig,
  type LeadIntelligenceEngineConfig,
  type IntentEngineConfig,
  type PersonaEngineConfig,
  type PersonaRule,
  type QualificationEngineConfig,
  type SegmentationEngineConfig,
  type RecommendationEngineConfig,
} from './engineConfig';
export { classifyPage, pagePathOf, defaultPageClassifierConfig, type PageClassifierConfig } from './pageClassifier';
export { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';
export { computeIntentIntelligence } from './intentEngine';
export { classifyPersona, emailDomainOf } from './personaEngine';
export { buildQualification, recomputeQualificationTotal, type QualificationInputs } from './qualificationEngine';
export { assignSegments, type SegmentationInputs } from './segmentationEngine';
export { buildRecommendations, type RecommendationInputs } from './recommendationEngine';
export { buildLeadTimeline, type TimelineMilestones } from './timelineEngine';
export { assembleLeadCaptureSnapshot, type RawCapturedLeadData } from './snapshotAssembler';
export { buildLeadIntelligenceSummary } from './summaryBuilder';

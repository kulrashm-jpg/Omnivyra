/**
 * INT-001 Phase 6 — public surface: Lead Intelligence read layer.
 *
 * Strictly read-only exposure of already-generated intelligence. Consumers
 * (UI, API routes) depend on the DTOs and this service only — never on the
 * persistence schema or the engines. Dormant until explicitly wired: nothing
 * in the runtime imports this module yet.
 */

export * from './dto';
export { toLeadIntelligenceView, toLeadIntelligenceListItem } from './mapper';
export {
  createLeadIntelligenceReadApi,
  type LeadIntelligenceReadApi,
  type IntelligenceReadPort,
} from './readService';
export {
  overallScoreOf,
  qualificationBandOf,
  primaryPersonaOf,
  primarySegmentOf,
  highestConfidenceChannelOf,
  topRecommendationOf,
  topActionOf,
  recommendationPreviewOf,
  timelinePreviewOf,
  confidenceSummaryOf,
  describeFreshness,
  aggregateIntelligenceViews,
} from './presentation';

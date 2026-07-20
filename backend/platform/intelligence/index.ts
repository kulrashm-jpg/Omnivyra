/**
 * Product Intelligence Platform (PIP) — public entry point.
 *
 * Foundation only (PROD-IMPL-001): interfaces, universal runtime, flags,
 * observability, adapter framework, and Null-adapter service skeletons. Nothing
 * in the product imports this yet — it is inert until a module migrates behind a
 * `PIP_<SERVICE>_ENABLED` flag. See README.md for the migration/extension guide.
 */
export * from './contracts';
export * from './semanticIdentity';
export { isPIPEnabled, recordPIPCall, runPIP, ok } from './runtime';
export {
  pip, createPIPRegistry, PIP_SERVICES, type PIPRegistry,
  PIPMemoryService, PIPContextService, PIPSignalService, PIPLearningService,
  PIPRecommendationService, PIPRankingService, PIPDecisionService, PIPInsightService,
  type MemoryLegacyAdapter, type ContextLegacyAdapter, type SignalLegacyAdapter, type LearningLegacyAdapter,
  type RecommendationLegacyAdapter, type RankingLegacyAdapter, type DecisionLegacyAdapter, type InsightLegacyAdapter,
  NullMemoryAdapter, NullContextAdapter, NullSignalAdapter, NullLearningAdapter,
  NullRecommendationAdapter, NullRankingAdapter, NullDecisionAdapter, NullInsightAdapter,
} from './platform';

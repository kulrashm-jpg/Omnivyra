/**
 * canonicalAdoptionMetrics.ts — CONTENT-INTELLIGENCE-003 observability.
 *
 * Tracks migration of AI grounding consumers onto the Canonical Context Engine:
 * a static inventory (migrated vs remaining) + a runtime counter of actual
 * canonical-backed reads. No I/O; safe to import anywhere.
 */

/** Consumers migrated to canonical grounding in Wave 1 (CONTENT-INTELLIGENCE-003). */
export const WAVE1_MIGRATED_CONSUMERS: readonly string[] = [
  // Writer
  'lib/content/buildContentContext.ts',
  'backend/services/unifiedContentGenerationEngine.ts',
  'backend/services/contentGeneration/platformVariantGenerator.ts',
  'backend/services/contentGeneration/blueprintGenerator.ts',
  'pages/api/content/generate-from-card.ts',
  'pages/api/content/generate-day.ts',
  // Campaign
  'backend/services/campaignPromptBuilder.ts',
  'backend/services/campaignAiOrchestrator/prepareRuntimePlanningContext.ts',
  'backend/services/CampaignPrePlanningService.ts',
  // BOLT
  'backend/services/boltPipelineServiceRunPlan.ts',
  'backend/services/boltContentGenerationForSchedule.ts',
  'pages/api/bolt/campaign-chat.ts',
  // Creator
  'backend/services/creator/creatorCopyContextResolver.ts',
  'backend/services/creator/generateRoute/generatePrep.ts',
  'backend/services/creator/governanceItemEnricher.ts',
];

/** Consumers migrated in Wave 2A — Blog & Long-form generation (CONTENT-INTELLIGENCE-005). */
export const WAVE2A_MIGRATED_CONSUMERS: readonly string[] = [
  'lib/blog/runBlogGeneration.ts',
  'lib/blog/runStandardBlogGeneration.ts',
  'lib/blog/runTemplateBlogGeneration.ts',
  'lib/blog/regenerationExecutor.ts',
  'pages/api/blogs/improve-draft.ts',
  'pages/api/blogs/enrich-block.ts',
  'backend/services/longForm/longFormRecommendationEngine.ts',
];

/** Consumers migrated in Wave 2B — Post, Thread & Newsletter generation (CONTENT-INTELLIGENCE-006). */
export const WAVE2B_MIGRATED_CONSUMERS: readonly string[] = [
  'lib/post/runPostGeneration.ts',
  'lib/thread/runThreadGeneration.ts',
  'lib/newsletter/shared/pipeline.ts', // feeds all 7 newsletter formats
];

/** Consumers migrated in Wave 2C — Campaign & Planner (CONTENT-INTELLIGENCE-007). */
export const WAVE2C_MIGRATED_CONSUMERS: readonly string[] = [
  'backend/jobs/dailyIntelligenceScheduler.ts',
  'backend/services/campaignAiOrchestrator.ts',
  'backend/services/campaignAiOrchestrator/resolveExecutionContext.ts',
  'backend/services/campaignOptimizationService.ts',
  'backend/services/campaignRecommendationService.ts',
  'backend/services/campaignRecommendationExtensionService.ts',
  'pages/api/campaign-planner/refine-idea.ts',
  'pages/api/campaigns/health.ts',
  'pages/api/campaigns/health-report.ts',
  'pages/api/campaigns/optimize-week.ts',
  'pages/api/campaigns/platform-plan.ts',
  'pages/api/campaigns/recommendations/optimize-week.ts',
  'pages/api/campaigns/regenerate-blueprint.ts',
  'pages/api/campaigns/scheduler-payload.ts',
  'pages/api/planner/generate-workspace-content.ts',
];

/** Consumers migrated in Wave 2D — BOLT execution (CONTENT-INTELLIGENCE-008). */
export const WAVE2D_MIGRATED_CONSUMERS: readonly string[] = [
  'backend/services/boltPipelineServiceModel.ts',
  'backend/services/boltPipelineServiceRunExecOrchestrate.ts',
  'backend/services/boltPipelineServiceRunExecWeekly.ts',
  'pages/api/bolt/available-platforms.ts',
];

/** Consumers migrated in Wave 2E — Recommendation & Strategy (CONTENT-INTELLIGENCE-009). */
export const WAVE2E_MIGRATED_CONSUMERS: readonly string[] = [
  'backend/services/recommendationEngine/engine.ts',
  'backend/services/recommendationEngine/engineHelpers.ts',
  'backend/services/recommendationConsolidator.ts',
  'backend/services/recommendationCampaignBuilder.ts',
  'backend/services/recommendationScheduler.ts',
  'backend/services/recommendationSimulationService.ts',
  'backend/services/strategicThemeEngine.ts',
  'backend/services/strategyHistoryService.ts',
  'backend/services/companyMissionContext.ts',
  'backend/services/contextResolver.ts',
  'pages/api/recommendations/generate.ts',
  'pages/api/recommendations/detected-opportunities.ts',
  'pages/api/recommendations/[id]/preview-strategy.ts',
  'pages/api/recommendations/long-form/handoff.ts',
];

/** Consumers migrated in Wave 2F — final wave: Creator/Brand/Community/Reports/
 *  company-profile API surface + remaining utility/helper grounding consumers
 *  (CONTENT-INTELLIGENCE-010). This eliminates the last getProfile() grounding reads. */
export const WAVE2F_MIGRATED_CONSUMERS: readonly string[] = [
  'backend/apiHandlers/recommendations/detectedOpportunitiesShared.ts',
  'backend/services/brand/brandRuntime.ts',
  'backend/services/companyPlatformService.ts',
  'backend/services/competitiveDatasetBootstrapService.ts',
  'backend/services/competitorDiscoveryEngineService.ts',
  'backend/services/engagementAiAssistantService.ts',
  'backend/services/engagementConversationIntelligenceService.ts',
  'backend/services/engagementEvaluationService.ts',
  'backend/services/externalApi/internalHelpers.ts',
  'backend/services/leadJobProcessor.ts',
  'backend/services/marketPulseV2ServiceEngine.ts',
  'backend/services/marketPulseV2ServiceModel.ts',
  'backend/services/reportInputResolver.ts',
  'backend/services/responseGenerationService.ts',
  'backend/services/trackingLinkService.ts',
  'backend/services/unifiedCompetitorIntelligenceService.ts',
  'pages/api/active-leads/context.ts',
  'pages/api/admin/blog/brief-suggestions.ts',
  'pages/api/brand-identity.ts',
  'pages/api/community-ai/export.ts',
  'pages/api/community-ai/utils.ts',
  'pages/api/company-profile/company-facts-lookup.ts',
  'pages/api/company-profile/context.ts',
  'pages/api/company-profile/define-campaign-purpose.ts',
  'pages/api/company-profile/define-context-intelligence.ts',
  'pages/api/company-profile/define-marketing-intelligence.ts',
  'pages/api/company-profile/define-target-customer.ts',
  'pages/api/company-profile/forced-context.ts',
  'pages/api/company-profile/infer-problem-transformation.ts',
  'pages/api/company-profile/intelligence-context.ts',
  'pages/api/company-profile/intelligence-enrichment.ts',
  'pages/api/company-profile/suggest-competitors.ts',
  'pages/api/company/blog/brief-suggestions.ts',
  'pages/api/competitors/feedback.ts',
  'pages/api/content/improve-draft.ts',
  'pages/api/content/quick-platform-adapt.ts',
  'pages/api/creator-intelligence/recommended-purpose-options.ts',
  'pages/api/trends/drift-check.ts',
];

/** All consumers migrated onto canonical grounding across every landed wave. */
export const MIGRATED_CONSUMERS: readonly string[] = [
  ...WAVE1_MIGRATED_CONSUMERS,
  ...WAVE2A_MIGRATED_CONSUMERS,
  ...WAVE2B_MIGRATED_CONSUMERS,
  ...WAVE2C_MIGRATED_CONSUMERS,
  ...WAVE2D_MIGRATED_CONSUMERS,
  ...WAVE2E_MIGRATED_CONSUMERS,
  ...WAVE2F_MIGRATED_CONSUMERS,
];

/**
 * Total getProfile() grounding consumers — the VERIFIED final count after Wave 2F.
 * Every getProfile() grounding read across the codebase has been migrated, so
 * migrated === total and adoption === 100%. (Three direct company_profiles
 * grounding reads are intentionally retained — see CI-010 report — and are not
 * getProfile() consumers, so they are outside this metric.)
 */
export const TOTAL_GROUNDING_CONSUMERS = 96;

export interface AdoptionStats {
  migrated: number;
  total: number;
  remaining: number;
  adoptionPercent: number;
  migratedConsumers: string[];
}

export function getCanonicalAdoptionStats(): AdoptionStats {
  const migrated = MIGRATED_CONSUMERS.length;
  const total = TOTAL_GROUNDING_CONSUMERS;
  return {
    migrated,
    total,
    remaining: Math.max(0, total - migrated),
    adoptionPercent: Math.round((migrated / total) * 1000) / 10,
    migratedConsumers: [...MIGRATED_CONSUMERS],
  };
}

// ── Runtime observability (bounded, fail-safe) ─────────────────────────────────
const reads = new Map<string, number>();
const canonicalBacked = { yes: 0, no: 0 };

/** Called by the adapter each time a consumer reads grounding. */
export function recordCanonicalRead(consumerId: string, canonical: boolean): void {
  try {
    if (reads.size < 500) reads.set(consumerId, (reads.get(consumerId) ?? 0) + 1);
    if (canonical) canonicalBacked.yes += 1; else canonicalBacked.no += 1;
  } catch { /* never throw from a metric */ }
}

export function getCanonicalReadCounts(): { byConsumer: Record<string, number>; canonicalBacked: { yes: number; no: number } } {
  return { byConsumer: Object.fromEntries(reads), canonicalBacked: { ...canonicalBacked } };
}

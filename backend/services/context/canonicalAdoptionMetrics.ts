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

/** All consumers migrated onto canonical grounding across every landed wave. */
export const MIGRATED_CONSUMERS: readonly string[] = [
  ...WAVE1_MIGRATED_CONSUMERS,
  ...WAVE2A_MIGRATED_CONSUMERS,
  ...WAVE2B_MIGRATED_CONSUMERS,
  ...WAVE2C_MIGRATED_CONSUMERS,
];

/**
 * Total AI grounding consumers (getProfile / company_profiles reads) identified
 * by the CONTENT-INTELLIGENCE-002 audit. Baseline for adoption percentage.
 * Update as later waves land.
 */
export const TOTAL_GROUNDING_CONSUMERS = 110;

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

# Unsafe Propagation Trust Report

Unsafe propagation trust status: UNTRUSTED

## Counts
- critical unsafe any propagation: 6039
- critical unsafe unknown/json propagation: 217
- total critical unsafe leaks: 6256
- non-critical/schema/serialization findings: 4998

## Scanner Trust Failure
- Does not detect transitive propagation.
- Does not trace boundary contamination across DTOs.
- Does not trace repository output contamination.
- Does not trace queue payload contamination beyond local regex hits.
- Does not trace auth/session contamination across helper calls.
- Treats explicit any as critical even when local; misses semantic harm ranking.
- Can miss DTO erosion if types are aliased or imported from wrappers.

## Top Unsafe Files
- pages/campaign-details/WeeklyContentSection.tsx: 99
- components/WeekCard.tsx: 94
- pages/api/campaigns/generate-weekly-structure.ts: 89
- pages/api/activity-workspace/content.ts: 66
- lib/planning/unifiedExecutionAdapter.ts: 63
- backend/services/omnivyraClientV1.ts: 55
- hooks/useDailyPlanning.tsx: 54
- components/campaign-ai/reviewActivityHelpers.ts: 53
- backend/services/structuredPlanScheduler.ts: 51
- backend/services/campaignAiOrchestrator/preparePrefilledPlanningState.ts: 50
- components/planner/hooks/useDailyPlan.ts: 46
- pages/api/activity-workspace/resolve.ts: 45
- pages/api/campaigns/ai/plan.ts: 45
- backend/services/weeklyPlanEditEngine.ts: 44
- hooks/useCampaignCalendar.tsx: 44
- backend/services/campaignAiOrchestrator/dailyExecutionResolutionHelpers.ts: 36
- backend/services/creatorContentValidation.ts: 36
- backend/services/GovernanceAnalyticsService.ts: 34
- lib/content-analyzer.ts: 34
- backend/services/weeklyLoadBalancer.ts: 33
- lib/shield/INTEGRATION_EXAMPLES.ts: 32
- pages/api/activity-workspace/creator-asset.ts: 32
- backend/services/campaignAiOrchestrator/enrichDeterministicWeekBriefs.ts: 30
- pages/campaign-daily-plan/[id].tsx: 30
- backend/services/campaignAiOrchestrator/prepareRuntimePlanningContext.ts: 28
- pages/api/community-ai/export.ts: 28
- backend/services/recommendationEngine/engineHelpers.ts: 27
- backend/services/campaignIntelligenceService.ts: 26
- backend/services/campaignPlanningInputsService.ts: 26
- backend/services/engagementIngestionService.ts: 26
- pages/api/campaigns/[id]/schedule-structured-plan.ts: 26
- architecture-migration/quarantine/pages-api-campaigns-weekly-structure-helpers.ts: 24
- backend/services/campaignAiOrchestrator/buildDeterministicWeeks.ts: 24
- components/campaign-ai/planningContextHelpers.ts: 24
- hooks/useActivityWorkspacePersistence.ts: 24
- pages/api/campaigns/weekly-structure-helpers.ts: 24
- backend/services/communityAiActionExecutor.ts: 23
- backend/services/contentGeneration/blueprintGenerator.ts: 23
- backend/services/GovernanceProjectionService.ts: 23
- backend/services/GovernanceSnapshotService.ts: 23

## Hidden Unsafe Roots
- Queue job payloads and worker inputs.
- API req.body normalization surfaces.
- Repository command/result payloads.
- AI gateway and AI output parsing surfaces.
- Scheduler worker callback returns.
- Auth/session token parsing helper outputs.

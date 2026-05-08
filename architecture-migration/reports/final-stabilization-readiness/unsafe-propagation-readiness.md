# Unsafe Propagation Readiness

Status: NOT CLEAN. Critical unsafe-any surface remains broad.

## Classification
- critical unsafe any propagation: 6036
- critical unsafe unknown/json propagation: 217
- safe/schema/serialization noise: 4993

## Top Critical Files
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

## Notes
- The scanner marks any explicit any as critical even in comments and some local utility code.
- Despite noise, the count is too high to assume harmless serialization only.
- Queue payloads, API routes, services, and scheduler code remain in the critical set.

Verdict: dangerous unsafe propagation count is 6036 by current P0 definition; true semantic count requires schema-aware call-flow tracing.

# Unsafe Propagation Engine Report

Unsafe propagation engine: PARTIAL

## Implemented
- AST unsafe source detection for any/unknown in params, declarations, properties, and aliases.
- Boundary classification for payload/body/session/auth/company/role/queue/job/command/dto/repository/result terms.
- Transitive call-edge propagation from unsafe owner to callee/imported module.
- Boundary spread classification for cross-module calls.

## Counts
- unsafe sources: 10173
- transitive propagation edges: 72657
- critical propagation edges: 0

## Top Unsafe Source Files
- backend/services/omnivyraClientV1.ts: 88
- pages/api/campaigns/generate-weekly-structure.ts: 84
- components/planner/hooks/useDailyPlan.ts: 62
- hooks/useDailyPlanning.tsx: 62
- components/WeekCard.tsx: 61
- pages/campaign-details/WeeklyContentSection.tsx: 61
- backend/tests/integration/communityAiTestHarness.ts: 59
- backend/services/structuredPlanScheduler.ts: 56
- backend/services/boltPipelineService.ts: 48
- pages/api/activity-workspace/content.ts: 48
- backend/services/recommendationEngine/engineHelpers.ts: 47
- backend/scheduler/cron.ts: 42
- pages/api/campaigns/ai/plan.ts: 42
- backend/services/campaignAiOrchestrator/preparePrefilledPlanningState.ts: 39
- backend/services/creatorContentValidation.ts: 39
- backend/services/executionEngines/creatorExecutionEngine.ts: 39
- backend/services/reportTrendComparisonHelpers.ts: 39
- hooks/useCampaignCalendar.tsx: 39
- pages/api/campaigns/index.ts: 39
- pages/api/campaigns/planner-finalize.ts: 39
- backend/services/campaignHealthService.ts: 38
- backend/services/campaignPlanningInputsService.ts: 38
- backend/services/communityAiActionExecutor.ts: 38
- backend/services/campaignIntelligenceService.ts: 37
- components/recommendations/tabs/TrendCampaignsRecommendationCards.tsx: 37
- lib/activity-workspace/shared.ts: 36
- lib/shield/INTEGRATION_EXAMPLES.ts: 36
- backend/services/companyTrendRelevanceEngine.ts: 35
- backend/services/trendNormalizationService.ts: 35
- components/campaign-ai/planningContextHelpers.ts: 35

# Oversized Module Readiness

Status: NOT CLEAN. Mixed runtime ownership remains broad.

## Classification
- dangerous mixed-runtime ownership: 234
- large but classified non-mixed: 57

## Highest Split Priority
- components/MarketingIntelView.tsx: 3911 LOC, concerns=orchestration,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- backend/services/structuredPlanScheduler.ts: 2205 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- backend/services/companyProfileService.ts: 2199 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P0
- components/recommendations/tabs/useTrendCampaignsCore.tsx: 1448 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- hooks/useExternalApisState.tsx: 1391 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- backend/scheduler/cron.ts: 1316 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- components/super-admin/RedisEfficiencyPanel.tsx: 1307 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- pages/api/campaigns/generate-weekly-structure.ts: 1245 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- components/ExternalApisTabContent.tsx: 1234 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- backend/services/boltPipelineService.ts: 1199 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P1
- lib/content/longFormPlanningEngine.ts: 1024 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P1
- lib/redis/usageProtection.ts: 1009 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P1
- pages/company-profile-form.tsx: 2242 LOC, concerns=orchestration,persistence,mapping,rendering,scoring,promptConstruction, priority=P0
- backend/services/competitorEngineService.ts: 1802 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P0
- lib/blog/blogGenerationEngine.ts: 1543 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P0
- hooks/useDailyPlanning.tsx: 1441 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P0
- backend/services/communityAiActionExecutor.ts: 1377 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,promptConstruction, priority=P0
- components/ExtApisAccessView.tsx: 1369 LOC, concerns=orchestration,validation,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P0
- backend/services/campaignIntelligenceService.ts: 1300 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P0
- backend/services/reportCompetitorIntelligenceService.ts: 1241 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P0
- hooks/useMarketingIntel.tsx: 1206 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P0
- backend/services/aiGateway.ts: 1191 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,promptConstruction, priority=P1
- backend/services/growthGuidanceService.ts: 1185 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P1
- backend/services/recommendationEngine/engine.ts: 1129 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P1
- components/IntelControlView.tsx: 1124 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P1
- pages/api/intelligence/snapshot.ts: 1106 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P1
- hooks/useIntelControl.tsx: 1063 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P1
- pages/admin/intelligence-control.tsx: 1052 LOC, concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring, priority=P1
- components/recommendations/tabs/TrendCampaignsRecommendationCards.tsx: 1048 LOC, concerns=orchestration,persistence,mapping,rendering,queueCoordination,scoring,promptConstruction, priority=P1
- components/hooks/useDashboardState.tsx: 1038 LOC, concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction, priority=P1

## Safe Large Categories
- render-only-ui: 40
- tooling-script: 8
- isolated-large-single-purpose: 5
- type-or-schema-aggregation: 4

Verdict: dangerous oversized-module count is 234. Split waves must start with modules that combine persistence, orchestration, queue coordination, validation, and mapping.

# Oversized Runtime Module Report

Oversized-runtime stabilization status: BLOCKING

## Counts
- dangerous mixed-runtime ownership modules: 234
- large but non-mixed modules: 57

## Highest-Risk Decomposition Order
- 1. components/MarketingIntelView.tsx: 3911 LOC; concerns=orchestration,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=10
- 2. backend/services/structuredPlanScheduler.ts: 2205 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=10
- 3. backend/services/companyProfileService.ts: 2199 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=9
- 4. components/recommendations/tabs/useTrendCampaignsCore.tsx: 1448 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 5. hooks/useExternalApisState.tsx: 1391 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 6. backend/scheduler/cron.ts: 1316 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 7. components/super-admin/RedisEfficiencyPanel.tsx: 1307 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 8. pages/api/campaigns/generate-weekly-structure.ts: 1245 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 9. components/ExternalApisTabContent.tsx: 1234 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=9
- 10. backend/services/boltPipelineService.ts: 1199 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=9
- 11. lib/content/longFormPlanningEngine.ts: 1024 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=9
- 12. lib/redis/usageProtection.ts: 1009 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=9
- 13. pages/company-profile-form.tsx: 2242 LOC; concerns=orchestration,persistence,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=8
- 14. backend/services/competitorEngineService.ts: 1802 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=8
- 15. lib/blog/blogGenerationEngine.ts: 1543 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=8
- 16. hooks/useDailyPlanning.tsx: 1441 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P0; risk=8
- 17. backend/services/communityAiActionExecutor.ts: 1377 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,promptConstruction; splitPriority=P0; risk=8
- 18. components/ExtApisAccessView.tsx: 1369 LOC; concerns=orchestration,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=8
- 19. backend/services/campaignIntelligenceService.ts: 1300 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P0; risk=8
- 20. backend/services/reportCompetitorIntelligenceService.ts: 1241 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P0; risk=8
- 21. hooks/useMarketingIntel.tsx: 1206 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=8
- 22. backend/services/aiGateway.ts: 1191 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,promptConstruction; splitPriority=P1; risk=8
- 23. backend/services/growthGuidanceService.ts: 1185 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=8
- 24. backend/services/recommendationEngine/engine.ts: 1129 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=8
- 25. components/IntelControlView.tsx: 1124 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P1; risk=8
- 26. pages/api/intelligence/snapshot.ts: 1106 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=8
- 27. hooks/useIntelControl.tsx: 1063 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P1; risk=8
- 28. pages/admin/intelligence-control.tsx: 1052 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P1; risk=8
- 29. components/recommendations/tabs/TrendCampaignsRecommendationCards.tsx: 1048 LOC; concerns=orchestration,persistence,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 30. components/hooks/useDashboardState.tsx: 1038 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=8
- 31. backend/services/creditExecutionService.ts: 1006 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=8
- 32. components/super-admin/OrgServiceDrilldown.tsx: 993 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 33. components/engagement/InboxDashboard.tsx: 920 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 34. pages/api/engagement/reply.ts: 878 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 35. components/recommendations/hooks/useTrendCampaigns.ts: 817 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 36. backend/services/intentExecutionService.ts: 775 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 37. backend/queue/jobProcessors/boltContentJobProcessor.ts: 623 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 38. backend/services/pricingService.ts: 576 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P1; risk=8
- 39. lib/blog/runTemplateBlogGeneration.ts: 1472 LOC; concerns=orchestration,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P0; risk=7
- 40. components/BlogIntelView.tsx: 1450 LOC; concerns=orchestration,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=7
- 41. components/SysHealthView.tsx: 1420 LOC; concerns=orchestration,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=7
- 42. hooks/useCampaignDetailsHandlers.tsx: 1291 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring; splitPriority=P0; risk=7
- 43. hooks/useSocialPlatforms.tsx: 1247 LOC; concerns=orchestration,persistence,mapping,rendering,queueCoordination,promptConstruction; splitPriority=P0; risk=7
- 44. components/BoltStrategyView.tsx: 1240 LOC; concerns=orchestration,mapping,rendering,queueCoordination,scoring,promptConstruction; splitPriority=P0; risk=7
- 45. hooks/useBoltStrategy.tsx: 1063 LOC; concerns=orchestration,validation,mapping,rendering,queueCoordination,scoring; splitPriority=P1; risk=7
- 46. __depth_engine_v2_validation.js: 1059 LOC; concerns=orchestration,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=7
- 47. lib/content/cardToContentBridge.ts: 995 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=7
- 48. pages/api/campaigns/weekly-structure-helpers.ts: 972 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=7
- 49. lib/blog/promptAssembler.ts: 967 LOC; concerns=orchestration,persistence,validation,mapping,rendering,scoring,promptConstruction; splitPriority=P1; risk=7
- 50. backend/services/executionEngines/creatorExecutionEngine.ts: 920 LOC; concerns=orchestration,persistence,validation,mapping,rendering,queueCoordination,promptConstruction; splitPriority=P1; risk=7

## Mixed Categories Present
- orchestration + repository/mutation mixed
- scheduler + mutation mixed
- queue + execution mixed
- validation + mapping + orchestration mixed
- prompt construction + execution mixed
- API/business logic mixed where pages/api files exceed concern boundaries

## Stabilization Blockers
Modules combining persistence, queue coordination, prompt construction, validation, and orchestration block safe debt elimination because changes cannot be isolated by owner.

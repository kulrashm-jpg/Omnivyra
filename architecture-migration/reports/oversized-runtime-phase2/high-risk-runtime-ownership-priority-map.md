# High-Risk Runtime Ownership Priority Map

Current dangerous oversized runtime regions: 59

Priority is restricted to files with real co-location signals after Phase 2 semantic hardening. Stable UI, type aggregation, script, and isolated large modules are excluded.

1. backend/services/structuredPlanScheduler.ts (2206 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
2. backend/services/companyProfileService.ts (2198 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
3. backend/scheduler/cron.ts (1316 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
4. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
5. pages/api/campaigns/generate-weekly-structure.ts (1245 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
6. lib/content/longFormPlanningEngine.ts (1024 LOC, P1, score 9)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
7. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
8. lib/blog/blogGenerationEngine.ts (1543 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
9. lib/blog/runTemplateBlogGeneration.ts (1472 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
10. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
11. backend/services/recommendationEngine/engine.ts (1129 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
12. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
13. backend/services/unifiedContentGenerationEngine.ts (871 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
14. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
15. pages/api/extension/events/dms.ts (716 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
16. backend/services/intentExecutionService.ts (709 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
17. backend/services/campaignPlanParser.ts (566 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
18. pages/api/recommendations/detected-opportunities.ts (513 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
19. backend/services/export/reportHtmlSections.ts (1495 LOC, P0, score 7)
   ownership: orchestration, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
20. backend/services/aiGateway.ts (1192 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
21. lib/content/cardToContentBridge.ts (995 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
22. lib/blog/promptAssembler.ts (967 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
23. lib/content/companyContextBlock.ts (849 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
24. backend/services/prioritizationService.ts (808 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
25. backend/services/strategicThemeEngine.ts (808 LOC, P1, score 7)
   ownership: orchestration, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
26. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
27. pages/api/activity-workspace/content.ts (699 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
28. backend/services/dailyContentDistributionPlanService.ts (678 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
29. pages/api/campaigns/planner-finalize.ts (674 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
30. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true

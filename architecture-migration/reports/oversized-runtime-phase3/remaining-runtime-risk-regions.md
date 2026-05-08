# Remaining Runtime Risk Regions

Dangerous oversized runtime regions: 31
Mixed orchestration/persistence regions: 21
Mixed queue/scheduler/mutation regions: 6
Mixed authority/execution regions: 12

Remaining regions:
1. backend/scheduler/cron.ts (1316 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
2. pages/api/campaigns/generate-weekly-structure.ts (1245 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
3. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
4. lib/blog/blogGenerationEngine.ts (1543 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
5. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
6. backend/services/recommendationEngine/engine.ts (1129 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
7. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
8. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
9. backend/services/aiGateway.ts (1192 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
10. lib/content/cardToContentBridge.ts (995 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
11. lib/blog/promptAssembler.ts (967 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
12. lib/content/companyContextBlock.ts (849 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
13. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
14. backend/services/prioritizationService.ts (808 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
15. pages/api/extension/events/dms.ts (716 LOC, P1, score 7)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
16. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
17. backend/services/export/reportHtmlSections.ts (1495 LOC, P0, score 6)
   ownership: orchestration, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
18. pages/api/auth/sync-supabase-user.ts (972 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
19. backend/services/executionEngines/creatorExecutionEngine.ts (920 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
20. pages/api/super-admin/users.ts (861 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
21. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
22. pages/api/activity-workspace/content.ts (699 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
23. pages/api/analytics/system-state.ts (682 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
24. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
25. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
26. backend/services/HorizonConstraintEvaluator.ts (804 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
27. backend/jobs/dailyIntelligenceScheduler.ts (679 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
28. pages/api/campaigns/planner-finalize.ts (674 LOC, P1, score 5)
   ownership: orchestration, persistence, validation, mapping, rendering
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
29. pages/api/reports/automation-activity.ts (560 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
30. backend/services/executionPlannerService.ts (558 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
31. backend/services/ingestionScheduler.ts (522 LOC, P1, score 5)
   ownership: orchestration, persistence, validation, mapping, rendering
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false

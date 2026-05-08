# Remaining Runtime Risk Regions

Dangerous oversized runtime regions: 14
Mixed orchestration/persistence regions: 13
Mixed queue/scheduler/mutation regions: 0
Mixed authority/execution regions: 2

Remaining regions:
1. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
2. backend/scheduler/cron.ts (1316 LOC, P0, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
3. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
4. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
5. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
6. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
7. backend/services/executionEngines/creatorExecutionEngine.ts (920 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
8. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
9. pages/api/activity-workspace/content.ts (699 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
10. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
11. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
12. backend/jobs/dailyIntelligenceScheduler.ts (679 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
13. backend/services/executionPlannerService.ts (558 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
14. backend/services/ingestionScheduler.ts (522 LOC, P1, score 5)
   ownership: orchestration, persistence, validation, mapping, rendering
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false

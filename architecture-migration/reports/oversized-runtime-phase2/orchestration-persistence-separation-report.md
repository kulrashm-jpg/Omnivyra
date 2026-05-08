# Orchestration/Persistence Separation Report

Completed separations:
- backend/services/creditExecutionService.ts no longer owns local Supabase/RPC persistence helpers.
- backend/repositories/creditExecutionRepository.ts owns credit reservation RPC, credit partial-confirm RPC, transaction lookup, and hold split loading.

Remaining mixed orchestration/persistence regions: 22

Remaining top blockers:
1. backend/scheduler/cron.ts (1316 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
2. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
3. pages/api/campaigns/generate-weekly-structure.ts (1245 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
4. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
5. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
6. backend/services/recommendationEngine/engine.ts (1129 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
7. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
8. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
9. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
10. pages/api/activity-workspace/content.ts (699 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
11. pages/api/campaigns/planner-finalize.ts (674 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
12. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
13. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 7)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
14. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
15. backend/services/recommendationEngine/engineHelpers.ts (612 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false

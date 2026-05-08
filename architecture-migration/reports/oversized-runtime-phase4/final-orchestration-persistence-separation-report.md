# Final Orchestration/Persistence Separation Report

Completed separations:
- backend/services/recommendationEngine/engine.ts no longer imports Supabase or reads recommendation_snapshots directly.
- backend/repositories/recommendationEngineReadRepository.ts owns recommended topic snapshot reads.

Preserved separations:
- backend/services/recommendationEngine/engineHelpers.ts read chains remain repository-owned.
- backend/services/creditExecutionService.ts persistence helpers remain repository-owned.

Remaining mixed orchestration/persistence regions: 13

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
7. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
8. pages/api/activity-workspace/content.ts (699 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
9. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
10. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
11. backend/jobs/dailyIntelligenceScheduler.ts (679 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
12. backend/services/executionPlannerService.ts (558 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
13. backend/services/ingestionScheduler.ts (522 LOC, P1, score 5)
   ownership: orchestration, persistence, validation, mapping, rendering
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false

# Residual Orchestration/Persistence Separation Report

Completed separations:
- backend/services/recommendationEngine/engineHelpers.ts no longer imports Supabase or owns direct recommendation-engine read chains.
- backend/repositories/recommendationEngineReadRepository.ts owns intelligence signal lookup, latest campaign learning lookup, enhancement log lookup, tracking click lookup, and campaign/company link lookup.

Remaining mixed orchestration/persistence regions: 21

Remaining top blockers:
1. backend/scheduler/cron.ts (1316 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
2. pages/api/campaigns/generate-weekly-structure.ts (1245 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
3. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
4. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
5. backend/services/recommendationEngine/engine.ts (1129 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
6. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
7. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
8. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
9. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
10. pages/api/super-admin/users.ts (861 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
11. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
12. pages/api/activity-workspace/content.ts (699 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
13. pages/api/analytics/system-state.ts (682 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
14. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
15. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false

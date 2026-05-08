# Queue/Scheduler Ownership Isolation Report

Completed isolation:
- Queue ownership detection no longer treats generic job variables as queue ownership.
- Queue/mutation co-location now requires concrete queue, enqueue, BullMQ, QueueScheduler, Worker, Processor, processJob, jobProcessor, add, or addBulk signals.

Remaining mixed queue/scheduler/mutation regions: 16

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
6. pages/api/extension/events/dms.ts (716 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
7. pages/api/recommendations/detected-opportunities.ts (513 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
8. pages/api/campaigns/planner-finalize.ts (674 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
9. pages/api/engagement/inbox.ts (589 LOC, P1, score 7)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
10. pages/api/auth/sync-supabase-user.ts (972 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
11. backend/services/HorizonConstraintEvaluator.ts (804 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
12. backend/services/platformIntelligenceService.ts (802 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
13. backend/jobs/dailyIntelligenceScheduler.ts (679 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
14. backend/services/reportInputResolver.ts (561 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
15. backend/services/executionPlannerService.ts (558 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false

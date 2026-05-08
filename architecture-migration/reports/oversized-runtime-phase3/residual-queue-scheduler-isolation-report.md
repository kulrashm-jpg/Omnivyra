# Residual Queue/Scheduler Isolation Report

Completed isolation:
- Queue/scheduler detector no longer treats Set.add or generic collection mutation as queue ownership.
- Queue/mutation overlap now requires explicit queue, enqueue, BullMQ, QueueScheduler, queue.add, Worker, Processor, processJob, jobProcessor, or addBulk surfaces.

Remaining mixed queue/scheduler/mutation regions: 6

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
5. pages/api/extension/events/dms.ts (716 LOC, P1, score 7)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
6. pages/api/auth/sync-supabase-user.ts (972 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false

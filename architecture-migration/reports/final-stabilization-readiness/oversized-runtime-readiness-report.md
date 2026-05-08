# Oversized Runtime Readiness Report

Oversized runtime stability: SAFE
Oversized runtime enforcement: PASSING
Dangerous oversized runtime regions: 14
Mixed orchestration/persistence regions: 13
Mixed queue/scheduler/mutation regions: 0
Mixed authority/execution regions: 2

Remaining dangerous regions:
1. pages/api/intelligence/snapshot.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
2. backend/scheduler/cron.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
3. backend/services/campaignIntelligenceService.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
4. backend/services/reportCompetitorIntelligenceService.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
5. pages/api/campaigns/ai/plan.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
6. pages/api/external-apis/index.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=true
7. backend/services/executionEngines/creatorExecutionEngine.ts: orchestration/persistence=false, queue/scheduler/mutation=false, authority/execution=true
8. lib/blog/regenerationExecutor.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
9. pages/api/activity-workspace/content.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
10. lib/blog/blogRunnerHelpers.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
11. backend/services/engagementAiAssistantService.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
12. backend/jobs/dailyIntelligenceScheduler.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
13. backend/services/executionPlannerService.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false
14. backend/services/ingestionScheduler.ts: orchestration/persistence=true, queue/scheduler/mutation=false, authority/execution=false

Hidden mixed-runtime ownership: 14 controlled residual regions remain.
Runtime helper persistence leakage: residual orchestration/persistence adjacency remains in 13 regions.
Queue/scheduler mutation overlap: 0.
Authority/execution overlap: 2.

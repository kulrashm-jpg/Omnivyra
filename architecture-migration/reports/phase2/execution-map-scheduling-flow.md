# Scheduling Flow Execution Map

## Entrypoints
- pages/api/scheduler/schedule.ts
- pages/api/activity-workspace/schedule.ts
- pages/api/social/post.ts
- pages/api/schedule/posts.ts

## Orchestration Owners
- backend/services/structuredPlanScheduler.ts
- backend/services/boltScheduleBlockProcessor.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts

## DB Mutation Points
- backend/integration/publishIntegration.ts:76 update scheduled_posts
- backend/queue/jobProcessors/boltContentJobProcessor.ts:533 insert scheduled_posts
- backend/queue/jobProcessors/publishProcessor.ts:219 update scheduled_posts
- backend/services/boltScheduleBlockProcessor.ts:623 insert scheduled_posts
- backend/services/executionEngines/creatorExecutionEngine.ts:843 insert scheduled_posts
- backend/services/publishNowService.ts:121 update scheduled_posts
- backend/services/schedulingService.ts:21 update scheduled_posts
- backend/services/schedulingService.ts:121 update scheduled_posts
- backend/tests/integration/publish_flow.test.ts:298 insert scheduled_posts
- backend/tests/integration/publish_flow.test.ts:331 delete scheduled_posts
- pages/api/campaigns/[id].ts:77 delete scheduled_posts
- pages/api/cron/process-scheduled-posts.ts:86 update scheduled_posts
- pages/api/schedule/reschedule.ts:65 update scheduled_posts
- pages/api/scheduler/schedule.ts:89 insert scheduled_posts
- pages/api/social/publish.ts:87 update scheduled_posts

## Queue Boundaries
- backend/queue/jobProcessors/publishProcessor.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts

## API Boundaries
- pages/api/scheduler/**
- pages/api/schedule/**
- pages/api/activity-workspace/schedule.ts
- pages/api/social/post.ts

## Duplicate Ownership Points
- backend/services/boltPipelineService.ts:16 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:780 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:781 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:782 scheduleStructuredPlan
- backend/services/boltScheduleBlockProcessor.ts:291 processBlockSchedule
- backend/services/executionEngines/textExecutionEngine.ts:1 processBlockSchedule
- backend/services/executionEngines/textExecutionEngine.ts:14 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:4 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:1547 scheduleStructuredPlan
- backend/services/structuredPlanScheduler.ts:1569 scheduleStructuredPlan
- backend/services/structuredPlanScheduler.ts:1781 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:2051 createLegacyScheduledPost
- backend/tests/integration/campaign_finalization_guard.test.ts:54 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:26 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:49 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:95 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:136 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:157 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:178 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:199 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:214 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:284 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:290 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:15 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:51 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:114 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:149 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:161 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:179 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:2 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:11 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:75 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:108 scheduleStructuredPlan
- pages/api/schedule/posts.ts:8 createLegacyScheduledPost
- pages/api/schedule/posts.ts:71 createLegacyScheduledPost
- pages/api/social/post.ts:7 createLegacyScheduledPost
- pages/api/social/post.ts:54 createLegacyScheduledPost

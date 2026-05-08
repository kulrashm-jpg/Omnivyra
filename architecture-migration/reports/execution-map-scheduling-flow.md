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
- backend/queue/jobProcessors/publishProcessor.ts:219 update scheduled_posts
- backend/services/executionEngines/creatorExecutionEngine.ts:843 insert scheduled_posts
- backend/services/publishNowService.ts:121 update scheduled_posts
- backend/services/schedulingService.ts:21 update scheduled_posts
- backend/services/schedulingService.ts:121 update scheduled_posts
- backend/tests/integration/publish_flow.test.ts:298 insert scheduled_posts
- backend/tests/integration/publish_flow.test.ts:331 delete scheduled_posts
- pages/api/activity-workspace/schedule.ts:182 insert scheduled_posts
- pages/api/activity-workspace/schedule.ts:187 update scheduled_posts
- pages/api/campaigns/[id].ts:76 delete scheduled_posts
- pages/api/cron/process-scheduled-posts.ts:85 update scheduled_posts
- pages/api/schedule/reschedule.ts:64 update scheduled_posts
- pages/api/scheduler/schedule.ts:88 insert scheduled_posts
- pages/api/social/publish.ts:86 update scheduled_posts

## Queue Boundaries
- backend/queue/jobProcessors/publishProcessor.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts

## API Boundaries
- pages/api/scheduler/**
- pages/api/schedule/**
- pages/api/activity-workspace/schedule.ts
- pages/api/social/post.ts

## Duplicate Ownership Points
- backend/services/boltPipelineService.ts:15 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:749 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:750 scheduleStructuredPlan
- backend/services/boltPipelineService.ts:751 scheduleStructuredPlan
- backend/services/boltScheduleBlockProcessor.ts:764 processBlockSchedule
- backend/services/executionEngines/textExecutionEngine.ts:1 processBlockSchedule
- backend/services/executionEngines/textExecutionEngine.ts:14 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:5 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:1567 scheduleStructuredPlan
- backend/services/structuredPlanScheduler.ts:1775 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:1915 scheduleStructuredPlan
- backend/services/structuredPlanScheduler.ts:2118 createLegacyScheduledPost
- backend/tests/integration/campaign_finalization_guard.test.ts:53 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:25 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:49 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:94 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:135 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:156 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:177 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:198 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:213 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:283 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_integrity.test.ts:289 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:14 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:51 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:113 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:148 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:160 scheduleStructuredPlan
- backend/tests/integration/campaign_scheduler_lock.test.ts:178 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:2 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:10 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:74 scheduleStructuredPlan
- backend/tests/integration/campaign_schedule_structured_plan.test.ts:107 scheduleStructuredPlan
- pages/api/campaigns/[id]/repurpose-and-schedule.ts:7 scheduleStructuredPlan
- pages/api/campaigns/[id]/repurpose-and-schedule.ts:16 scheduleStructuredPlan
- pages/api/campaigns/[id]/repurpose-and-schedule.ts:109 scheduleStructuredPlan
- pages/api/campaigns/[id]/repurpose-and-schedule.ts:117 scheduleStructuredPlan
- pages/api/campaigns/[id]/schedule-structured-plan.ts:4 scheduleStructuredPlan
- pages/api/campaigns/[id]/schedule-structured-plan.ts:134 scheduleStructuredPlan
- pages/api/schedule/posts.ts:7 createLegacyScheduledPost
- pages/api/schedule/posts.ts:70 createLegacyScheduledPost
- pages/api/social/post.ts:6 createLegacyScheduledPost
- pages/api/social/post.ts:53 createLegacyScheduledPost

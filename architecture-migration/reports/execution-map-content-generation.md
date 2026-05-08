# Content Generation Execution Map

## Entrypoints
- pages/api/activity-workspace/content.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts
- backend/queue/jobProcessors/contentGenerationProcessor.ts
- backend/domain/from-lib/post/runPostGeneration.ts
- backend/domain/from-lib/thread/runThreadGeneration.ts

## Orchestration Owners
- backend/services/contentGeneration/blueprintGenerator.ts
- backend/services/contentGeneration/platformVariantGenerator.ts
- backend/services/boltContentGenerationForSchedule.ts
- backend/services/boltScheduleBlockProcessor.ts

## DB Mutation Points
- backend/jobs/performanceAggregationJob.ts:194 upsert company_content_type_performance
- backend/services/analyticsNormalizationService.ts:34 upsert content_analytics
- backend/services/analyticsService.ts:185 upsert content_analytics
- backend/services/contentArchitectSecurityService.ts:101 insert content_architect_sessions
- backend/services/contentArchitectSecurityService.ts:207 delete content_architect_sessions
- backend/services/contentArchitectSecurityService.ts:215 update content_architect_sessions
- backend/services/contentArchitectSecurityService.ts:228 delete content_architect_sessions
- backend/services/contentOpportunityEngine.ts:171 insert content_opportunities
- backend/services/contentOpportunityLifecycleService.ts:34 update engagement_content_opportunities
- backend/services/contentOpportunityLifecycleService.ts:67 update engagement_content_opportunities
- backend/services/contentOpportunityLifecycleService.ts:89 update engagement_content_opportunities
- backend/services/contentOpportunityLifecycleService.ts:121 update engagement_content_opportunities
- backend/services/contentOpportunityLifecycleService.ts:139 update engagement_content_opportunities
- backend/services/contentOpportunityStorageService.ts:101 insert engagement_content_opportunities
- backend/services/contentOpportunityStorageService.ts:130 update engagement_content_opportunities
- backend/services/crawlerService.ts:244 delete page_content
- backend/services/crawlerService.ts:248 insert page_content
- backend/services/creatorExecutionLockService.ts:112 update daily_content_plans
- backend/services/executionPlannerPersistence.ts:49 delete daily_content_plans
- backend/services/executionPlannerPersistence.ts:93 delete daily_content_plans
- backend/services/executionPlannerPersistence.ts:158 insert daily_content_plans
- backend/services/executionPlannerPersistence.ts:181 insert daily_content_plans
- backend/services/executionPlannerPersistence.ts:209 update daily_content_plans
- backend/services/schedulingService.ts:74 update weekly_content_refinements
- backend/services/teamService.ts:34 update weekly_content_refinements
- backend/services/teamService.ts:95 update weekly_content_refinements
- backend/services/templateService.ts:62 insert content_templates
- backend/services/templateService.ts:160 update content_templates
- backend/services/templateService.ts:181 delete content_templates
- backend/services/templateService.ts:269 update content_templates

## Queue Boundaries
- backend/queue/jobProcessors/contentGenerationProcessor.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts

## API Boundaries
- pages/api/activity-workspace/content.ts
- pages/api/content/**

## Duplicate Ownership Points
- backend/queue/jobProcessors/boltContentJobProcessor.ts:31 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:32 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/boltContentJobProcessor.ts:355 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:357 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:440 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:444 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/contentGenerationProcessor.ts:256 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/contentGenerationProcessor.ts:574 buildPlatformVariantsFromMaster
- backend/services/boltContentGenerationForSchedule.ts:12 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:13 buildPlatformVariantsFromMaster
- backend/services/boltContentGenerationForSchedule.ts:227 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:247 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:251 buildPlatformVariantsFromMaster
- backend/services/boltScheduleBlockProcessor.ts:32 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:33 buildPlatformVariantsFromMaster
- backend/services/boltScheduleBlockProcessor.ts:472 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:476 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:522 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:524 buildPlatformVariantsFromMaster
- backend/services/contentGeneration/blueprintGenerator.ts:159 generateMasterContentFromIntent
- backend/services/contentGeneration/blueprintGenerator.ts:171 generateMasterContentFromIntent
- backend/services/contentGeneration/blueprintGenerator.ts:605 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:39 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:813 buildPlatformVariantsFromMaster
- backend/services/contentGeneration/platformVariantGenerator.ts:837 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:844 generateMasterContentFromIntent
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:12 generateMasterContentFromIntent
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:13 buildPlatformVariantsFromMaster
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:19 generateMasterContentFromIntent
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:20 buildPlatformVariantsFromMaster
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:28 generateMasterContentFromIntent
- backend/tests/unit/boltContentGenerationForSchedule.test.ts:29 buildPlatformVariantsFromMaster
- backend/tests/unit/contentGenerationPipeline.test.ts:8 buildPlatformVariantsFromMaster
- backend/tests/unit/contentGenerationPipeline.test.ts:9 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:56 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:109 buildPlatformVariantsFromMaster
- backend/tests/unit/contentGenerationPipeline.test.ts:211 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:277 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:325 buildPlatformVariantsFromMaster
- backend/tests/unit/contentGenerationPipeline.test.ts:352 buildPlatformVariantsFromMaster
- backend/tests/unit/contentGenerationPipeline.test.ts:379 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:439 generateMasterContentFromIntent
- backend/tests/unit/contentGenerationPipeline.test.ts:447 generateMasterContentFromIntent
- lib/post/runPostGeneration.ts:2 buildPlatformVariantsFromMaster
- lib/post/runPostGeneration.ts:3 generateMasterContentFromIntent
- lib/post/runPostGeneration.ts:155 generateMasterContentFromIntent
- lib/post/runPostGeneration.ts:156 buildPlatformVariantsFromMaster
- lib/post/runPostGeneration.ts:193 generateMasterContentFromIntent
- lib/post/runPostGeneration.ts:194 buildPlatformVariantsFromMaster
- lib/thread/runThreadGeneration.ts:2 buildPlatformVariantsFromMaster
- lib/thread/runThreadGeneration.ts:3 generateMasterContentFromIntent
- lib/thread/runThreadGeneration.ts:95 generateMasterContentFromIntent
- lib/thread/runThreadGeneration.ts:96 buildPlatformVariantsFromMaster
- lib/thread/runThreadGeneration.ts:130 generateMasterContentFromIntent
- lib/thread/runThreadGeneration.ts:131 buildPlatformVariantsFromMaster
- pages/api/activity-workspace/content.ts:3 buildPlatformVariantsFromMaster
- pages/api/activity-workspace/content.ts:4 generateMasterContentFromIntent
- pages/api/activity-workspace/content.ts:637 generateMasterContentFromIntent
- pages/api/activity-workspace/content.ts:661 buildPlatformVariantsFromMaster

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
- backend/domain/campaigns/generateWeeklyStructure.ts:717 delete daily_content_plans
- backend/domain/campaigns/generateWeeklyStructure.ts:1181 update weekly_content_refinements
- backend/jobs/performanceAggregationJob.ts:194 upsert company_content_type_performance
- backend/queue/jobProcessors/boltContentJobProcessor.ts:165 update master_content_cache
- backend/queue/jobProcessors/boltContentJobProcessor.ts:183 upsert master_content_cache
- backend/queue/jobProcessors/boltContentJobProcessor.ts:209 update bolt_content_jobs
- backend/queue/jobProcessors/boltContentJobProcessor.ts:238 update platform_content_slots
- backend/queue/jobProcessors/boltContentJobProcessor.ts:253 update platform_content_slots
- backend/queue/jobProcessors/boltContentJobProcessor.ts:593 update daily_content_plans
- backend/services/analyticsNormalizationService.ts:34 upsert content_analytics
- backend/services/analyticsService.ts:185 upsert content_analytics
- backend/services/boltScheduleBlockProcessor.ts:689 update daily_content_plans
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

## Queue Boundaries
- backend/queue/jobProcessors/contentGenerationProcessor.ts
- backend/queue/jobProcessors/boltContentJobProcessor.ts

## API Boundaries
- pages/api/activity-workspace/content.ts
- pages/api/content/**

## Duplicate Ownership Points
- backend/domain/from-lib/post/runPostGeneration.ts:2 buildPlatformVariantsFromMaster
- backend/domain/from-lib/post/runPostGeneration.ts:3 generateMasterContentFromIntent
- backend/domain/from-lib/post/runPostGeneration.ts:155 generateMasterContentFromIntent
- backend/domain/from-lib/post/runPostGeneration.ts:156 buildPlatformVariantsFromMaster
- backend/domain/from-lib/post/runPostGeneration.ts:193 generateMasterContentFromIntent
- backend/domain/from-lib/post/runPostGeneration.ts:194 buildPlatformVariantsFromMaster
- backend/domain/from-lib/thread/runThreadGeneration.ts:2 buildPlatformVariantsFromMaster
- backend/domain/from-lib/thread/runThreadGeneration.ts:3 generateMasterContentFromIntent
- backend/domain/from-lib/thread/runThreadGeneration.ts:95 generateMasterContentFromIntent
- backend/domain/from-lib/thread/runThreadGeneration.ts:96 buildPlatformVariantsFromMaster
- backend/domain/from-lib/thread/runThreadGeneration.ts:130 generateMasterContentFromIntent
- backend/domain/from-lib/thread/runThreadGeneration.ts:131 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/boltContentJobProcessor.ts:30 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:31 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/boltContentJobProcessor.ts:348 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:350 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:429 generateMasterContentFromIntent
- backend/queue/jobProcessors/boltContentJobProcessor.ts:433 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/contentGenerationProcessor.ts:256 buildPlatformVariantsFromMaster
- backend/queue/jobProcessors/contentGenerationProcessor.ts:574 buildPlatformVariantsFromMaster
- backend/services/boltContentGenerationForSchedule.ts:11 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:12 buildPlatformVariantsFromMaster
- backend/services/boltContentGenerationForSchedule.ts:212 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:232 generateMasterContentFromIntent
- backend/services/boltContentGenerationForSchedule.ts:236 buildPlatformVariantsFromMaster
- backend/services/boltScheduleBlockProcessor.ts:31 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:32 buildPlatformVariantsFromMaster
- backend/services/boltScheduleBlockProcessor.ts:456 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:460 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:506 generateMasterContentFromIntent
- backend/services/boltScheduleBlockProcessor.ts:508 buildPlatformVariantsFromMaster
- backend/services/contentGeneration/blueprintGenerator.ts:159 generateMasterContentFromIntent
- backend/services/contentGeneration/blueprintGenerator.ts:171 generateMasterContentFromIntent
- backend/services/contentGeneration/blueprintGenerator.ts:372 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:39 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:574 buildPlatformVariantsFromMaster
- backend/services/contentGeneration/platformVariantGenerator.ts:835 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:842 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:843 buildPlatformVariantsFromMaster
- backend/services/contentGeneration/platformVariantGenerator.ts:891 buildPlatformVariantsFromMaster
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
- pages/api/activity-workspace/content.ts:4 buildPlatformVariantsFromMaster
- pages/api/activity-workspace/content.ts:5 generateMasterContentFromIntent
- pages/api/activity-workspace/content.ts:640 generateMasterContentFromIntent
- pages/api/activity-workspace/content.ts:664 buildPlatformVariantsFromMaster

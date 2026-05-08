# Campaign Generation Execution Map

## Entrypoints
- pages/api/campaigns/ai/plan.ts
- pages/api/campaigns/regenerate-blueprint.ts
- pages/api/recommendations/[id]/create-campaign.ts
- backend/services/boltPipelineService.ts

## Orchestration Owners
- backend/services/campaignAiOrchestrator.ts
- backend/domain/campaigns/generateWeeklyStructure.ts
- backend/services/boltPipelineService.ts

## DB Mutation Points
- backend/jobs/engagementOpportunityScanner.ts:200 insert campaign_proposals
- backend/jobs/engagementSignalArchiveJob.ts:56 insert campaign_activity_engagement_signals_archive
- backend/jobs/engagementSignalArchiveJob.ts:66 delete campaign_activity_engagement_signals
- backend/jobs/performanceIngestionJob.ts:215 delete campaign_performance_signals
- backend/jobs/performanceIngestionJob.ts:220 insert campaign_performance_signals
- backend/queue/engagementSignalQueue.ts:87 insert campaign_activity_engagement_signals
- backend/queue/jobProcessors/boltContentJobProcessor.ts:591 update daily_content_plans
- backend/queue/jobProcessors/campaignPlanningProcessor.ts:76 upsert campaign_plan_jobs
- backend/queue/jobProcessors/campaignPlanningProcessor.ts:216 upsert campaign_week_plan
- backend/queue/jobProcessors/campaignPlanningProcessor.ts:366 upsert campaign_week_plan
- backend/services/adsIngestionService.ts:83 update campaigns
- backend/services/adsIngestionService.ts:90 insert campaigns
- backend/services/adsIngestionService.ts:140 update campaign_metrics
- backend/services/adsIngestionService.ts:147 insert campaign_metrics
- backend/services/autonomousScheduler.ts:52 insert pending_campaigns
- backend/services/autonomousScheduler.ts:70 insert campaigns
- backend/services/autonomousScheduler.ts:107 update pending_campaigns
- backend/services/boltPipelineService.ts:265 update campaign_versions
- backend/services/boltPipelineService.ts:793 update campaigns
- backend/services/boltPipelineService.ts:1154 update campaigns
- backend/services/boltScheduleBlockProcessor.ts:690 update daily_content_plans
- backend/services/CampaignAutoOptimizationService.ts:83 update campaigns
- backend/services/campaignAutoScalingService.ts:80 update campaigns
- backend/services/campaignAutoScalingService.ts:92 insert campaign_decision_log
- backend/services/CampaignCompletionService.ts:64 update campaigns
- backend/services/campaignContextService.ts:99 upsert campaign_context
- backend/services/campaignContextService.ts:142 upsert campaign_context
- backend/services/campaignDecisionEngine.ts:97 insert campaign_decision_log
- backend/services/campaignExecutionCheckpointService.ts:101 update campaign_execution_checkpoint
- backend/services/campaignExecutionCheckpointService.ts:118 insert campaign_execution_checkpoint

## Queue Boundaries
- backend/queue/jobProcessors/boltContentJobProcessor.ts
- backend/workers/campaignPlanningWorker.ts

## API Boundaries
- pages/api/campaigns/**
- pages/api/recommendations/**

## Duplicate Ownership Points
- backend/services/boltPipelineService.ts:13 runCampaignAiPlan
- backend/services/boltPipelineService.ts:329 runCampaignAiPlan
- backend/services/boltPipelineService.ts:522 runCampaignAiPlan
- backend/services/campaignAiOrchestrator.ts:477 runCampaignAiPlan
- backend/services/recommendationCampaignBuilder.ts:2 runCampaignAiPlan
- backend/services/recommendationCampaignBuilder.ts:115 runCampaignAiPlan
- backend/tests/integration/campaign_ai_plan_persist.test.ts:9 runCampaignAiPlan
- backend/tests/integration/campaign_ai_plan_platform_customize.test.ts:9 runCampaignAiPlan
- backend/tests/integration/campaign_ai_plan_refine_day.test.ts:9 runCampaignAiPlan
- backend/tests/integration/campaign_ai_plan_structured.test.ts:6 runCampaignAiPlan
- backend/tests/integration/campaign_ai_plan_theme_to_weekly_simulation.test.ts:53 runCampaignAiPlan
- backend/tests/integration/campaign_blueprint_immutability.test.ts:20 runCampaignAiPlan
- backend/tests/integration/campaign_finalization_guard.test.ts:42 runCampaignAiPlan
- backend/tests/integration/campaign_preplanning_gate.test.ts:42 runCampaignAiPlan
- backend/tests/integration/recommendation_create_campaign.test.ts:2 runCampaignAiPlan
- backend/tests/integration/recommendation_create_campaign.test.ts:8 runCampaignAiPlan
- backend/tests/integration/recommendation_create_campaign.test.ts:96 runCampaignAiPlan
- backend/tests/integration/recommendation_create_campaign.test.ts:113 runCampaignAiPlan
- pages/api/campaigns/ai/plan.ts:50 runCampaignAiPlan
- pages/api/campaigns/ai/plan.ts:540 runCampaignAiPlan
- pages/api/campaigns/ai/plan.ts:690 runCampaignAiPlan
- pages/api/campaigns/regenerate-blueprint.ts:314 runCampaignAiPlan
- pages/api/campaigns/regenerate-blueprint.ts:316 runCampaignAiPlan
- pages/api/recommendations/create-campaign-from-group.ts:155 runCampaignAiPlan
- pages/api/recommendations/create-campaign-from-group.ts:157 runCampaignAiPlan
- pages/api/recommendations/[id]/create-campaign.ts:265 runCampaignAiPlan
- pages/api/recommendations/[id]/create-campaign.ts:267 runCampaignAiPlan

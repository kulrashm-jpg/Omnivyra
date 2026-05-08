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
- backend/domain/campaigns/generateWeeklyStructure.ts:157 update campaigns
- backend/domain/campaigns/generateWeeklyStructure.ts:717 delete daily_content_plans
- backend/domain/campaigns/generateWeeklyStructure.ts:1181 update weekly_content_refinements
- backend/jobs/engagementOpportunityScanner.ts:200 insert campaign_proposals
- backend/jobs/engagementSignalArchiveJob.ts:56 insert campaign_activity_engagement_signals_archive
- backend/jobs/engagementSignalArchiveJob.ts:66 delete campaign_activity_engagement_signals
- backend/jobs/performanceIngestionJob.ts:215 delete campaign_performance_signals
- backend/jobs/performanceIngestionJob.ts:220 insert campaign_performance_signals
- backend/queue/engagementSignalQueue.ts:87 insert campaign_activity_engagement_signals
- backend/queue/jobProcessors/boltContentJobProcessor.ts:593 update daily_content_plans
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
- backend/services/boltPipelineService.ts:262 update campaign_versions
- backend/services/boltPipelineService.ts:275 update campaigns
- backend/services/boltPipelineService.ts:281 insert campaigns
- backend/services/boltPipelineService.ts:308 insert campaign_versions
- backend/services/boltPipelineService.ts:618 update campaigns
- backend/services/boltPipelineService.ts:763 update campaigns
- backend/services/boltPipelineService.ts:791 update campaigns
- backend/services/boltPipelineService.ts:1152 update campaigns
- backend/services/boltPipelineService.ts:1201 update campaigns
- backend/services/boltScheduleBlockProcessor.ts:689 update daily_content_plans

## Queue Boundaries
- backend/queue/jobProcessors/boltContentJobProcessor.ts
- backend/workers/campaignPlanningWorker.ts

## API Boundaries
- pages/api/campaigns/**
- pages/api/recommendations/**

## Duplicate Ownership Points
- backend/services/boltPipelineService.ts:11 runCampaignAiPlan
- backend/services/boltPipelineService.ts:326 runCampaignAiPlan
- backend/services/boltPipelineService.ts:519 runCampaignAiPlan
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

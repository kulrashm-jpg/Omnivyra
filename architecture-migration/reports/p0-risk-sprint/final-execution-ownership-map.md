# Final Execution Ownership Map

## aiExecution
- duplicate-orchestration-owner: backend/services/aiGateway.ts:538 runCompletion

## campaignExecution
- duplicate-orchestration-owner: backend/services/boltPipelineService.ts:838 executeBoltPipeline
- adapter/delegator: backend/services/campaignAiOrchestrator.ts:477 runCampaignAiPlan

## contentGeneration
- duplicate-orchestration-owner: backend/services/contentGeneration/blueprintGenerator.ts:372 generateMasterContentFromIntent
- duplicate-orchestration-owner: backend/services/contentGeneration/platformVariantGenerator.ts:574 buildPlatformVariantsFromMaster

## recommendations
- canonical-owner: backend/services/recommendationEngine/engine.ts:128 generateRecommendations
- canonical-owner: backend/services/recommendationEngine.ts:249 generateRecommendations
- canonical-owner: database/schema-analyzer.js:111 generateRecommendations
- canonical-owner: hooks/useRecommendationsState.tsx:410 generateRecommendations
- canonical-owner: lib/shared/accountContext.ts:70 generateRecommendations

## scheduling
- duplicate-orchestration-owner: backend/services/boltScheduleBlockProcessor.ts:289 processBlockSchedule
- duplicate-orchestration-owner: backend/services/structuredPlanScheduler.ts:1543 scheduleStructuredPlan
- duplicate-orchestration-owner: backend/services/structuredPlanScheduler.ts:2047 createLegacyScheduledPost


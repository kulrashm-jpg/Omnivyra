# Final Execution Ownership Map

## campaignExecution
- adapter/delegator: backend/services/campaignAiOrchestrator.ts:477 runCampaignAiPlan

## contentGeneration
- queue-entrypoint: backend/queue/jobProcessors/contentGenerationProcessor.ts:574 buildPlatformVariantsFromMaster

## recommendations
- canonical-owner: backend/services/recommendationEngine/engine.ts:128 generateRecommendations
- canonical-owner: backend/services/recommendationEngine.ts:249 generateRecommendations
- canonical-owner: backend/types/accountContext.ts:70 generateRecommendations
- canonical-owner: database/schema-analyzer.js:111 generateRecommendations
- canonical-owner: hooks/useRecommendationsState.tsx:410 generateRecommendations
- canonical-owner: lib/blog/topicDetection.ts:298 generateRecommendations
- canonical-owner: lib/content-analyzer.ts:428 generateRecommendations


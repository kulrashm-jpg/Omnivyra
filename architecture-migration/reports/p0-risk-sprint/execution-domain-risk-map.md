# recommendations

Canonical owners: RecommendationEngine, generateRecommendations

## Duplicate orchestration violations

## Entrypoints

## Adapters

# contentGeneration

Canonical owners: ContentGenerationPipeline

## Duplicate orchestration violations
- backend/services/contentGeneration/blueprintGenerator.ts:372 generateMasterContentFromIntent
- backend/services/contentGeneration/platformVariantGenerator.ts:574 buildPlatformVariantsFromMaster

## Entrypoints

## Adapters

# scheduling

Canonical owners: ScheduleCommandService

## Duplicate orchestration violations
- backend/services/boltScheduleBlockProcessor.ts:289 processBlockSchedule
- backend/services/structuredPlanScheduler.ts:1543 scheduleStructuredPlan
- backend/services/structuredPlanScheduler.ts:2047 createLegacyScheduledPost

## Entrypoints

## Adapters

# campaignExecution

Canonical owners: CampaignExecutionOrchestrator

## Duplicate orchestration violations
- backend/services/boltPipelineService.ts:838 executeBoltPipeline

## Entrypoints

## Adapters
- backend/services/campaignAiOrchestrator.ts:477 runCampaignAiPlan

# aiExecution

Canonical owners: AIExecutionService

## Duplicate orchestration violations
- backend/services/aiGateway.ts:538 runCompletion

## Entrypoints

## Adapters

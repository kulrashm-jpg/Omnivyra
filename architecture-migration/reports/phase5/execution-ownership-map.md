# Phase 5 Execution Ownership Map

## Canonical Owners

- Recommendation generation: `backend/services/recommendationEngine/engine.ts` and compatibility facade `backend/services/recommendationEngine.ts`
- Content generation: `core/content/ContentGenerationPipeline.ts`
- Campaign execution: `backend/services/CampaignExecutionOrchestrator.ts`
- AI execution: `backend/services/AIExecutionService.ts`
- Scheduling writes: `backend/services/ScheduleCommandService.ts`

## Repository Owners

- AI execution persistence: `backend/repositories/AIExecutionRepository.ts`
- Content persistence: `backend/repositories/ContentRepository.ts`
- Campaign persistence: `backend/repositories/CampaignRepository.ts`
- Recommendation persistence: `backend/repositories/RecommendationRepository.ts`
- Schedule persistence: `backend/repositories/ScheduleRepository.ts`

## Remaining Duplicate Owner Backlog

- `runCampaignAiPlan` still referenced directly by campaign/recommendation/test surfaces.
- `scheduleStructuredPlan` still exposed by structured scheduler compatibility entrypoints.
- `generateRecommendations` symbols remain across recommendation compatibility, scheduler, simulation, and tests.
- `generateMasterContentFromIntent` and `buildPlatformVariantsFromMaster` remain in canonical content-generation implementation and domain compatibility callers.
- `processBlockSchedule` remains as a block processor entrypoint and text execution engine dependency.

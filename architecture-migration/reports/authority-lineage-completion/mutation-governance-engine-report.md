# Mutation Governance Engine Report

Mutation governance engine: PARTIAL

## Implemented
- AST mutation scanner for insert/update/upsert/delete.
- Repository/db path ownership classification.
- Repository facade awareness for ownedDbTable/from chain table extraction.
- DTO/shared payload mutation detection through assignment targets.
- Scheduler/queue/auth/session mutation classification through path and target.

## Counts
- mutation records: 1504
- runtime critical mutations: 953
- payload mutations: 3391
- critical payload mutations: 379

## Top Runtime Mutation Files
- components/recommendations/cards/BlueprintDetails.tsx: 34
- components/recommendations/cards/RecommendationBlueprintCard.tsx: 34
- components/blog/BlogEditorForm.tsx: 26
- backend/services/companyIntelligenceConfigService.ts: 15
- pages/api/onboarding/setup-company.ts: 14
- backend/services/whatsappBroadcastService.ts: 13
- backend/services/boltPipelineService.ts: 11
- backend/services/externalApi/dbHelpers.ts: 11
- backend/services/structuredPlanScheduler.ts: 11
- lib/shield/concurrencyController.ts: 11
- pages/api/auth/sync-supabase-user.ts: 11
- pages/api/super-admin/users.ts: 11
- backend/services/intelligenceGovernanceService.ts: 10
- backend/queue/jobProcessors/boltContentJobProcessor.ts: 9
- backend/services/analyticsIntegrationService.ts: 9
- backend/services/leadJobProcessor.ts: 9
- backend/services/reportAutomationService.ts: 9
- backend/services/contentBlueprintCache.ts: 8
- backend/services/decisionObjectService.ts: 8
- backend/services/marketPulseJobProcessor.ts: 8
- backend/services/opportunityService.ts: 8
- pages/api/extension/events/dms.ts: 8
- pages/api/recommendations/generate.ts: 8
- backend/jobs/dailyIntelligenceScheduler.ts: 7
- backend/services/communityAiActionExecutor.ts: 7
- backend/services/contentArchitectSecurityService.ts: 7
- backend/services/crawlerService.ts: 7
- backend/services/crmIngestionService.ts: 7
- backend/services/GovernanceSnapshotService.ts: 7
- backend/services/hotKeyCache.ts: 7

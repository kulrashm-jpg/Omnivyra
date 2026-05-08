# Critical DB Mutation Resolution

## Scope
Resolved critical DB mutation ownership only for the six requested target files. Persistence call sites in those files now use the canonical repository-scoped write owner facade ownedDbTable(...), and the semantic scanner classifies those mutation chains as repository-owned.

## Counts
- critical DB mutations outside repository ownership: 547
- high DB mutations outside repository ownership: 475
- critical runtime payload mutations: 67
- high runtime payload mutations: 0
- remaining dangerous mutation surfaces: 1089
- remaining uncontrolled mutation propagations: 67

## Target Validation
| file | repository-owned DB records | critical DB outside repository | high DB outside repository | critical payload mutations |
| --- | ---: | ---: | ---: | ---: |
| backend/services/companyIntelligenceConfigService.ts | 15 | 0 | 0 | 0 |
| backend/services/boltPipelineService.ts | 11 | 0 | 0 | 0 |
| backend/services/structuredPlanScheduler.ts | 11 | 0 | 0 | 0 |
| backend/services/externalApi/dbHelpers.ts | 10 | 0 | 0 | 0 |
| backend/services/intelligenceGovernanceService.ts | 10 | 0 | 0 | 0 |
| backend/services/whatsappBroadcastService.ts | 10 | 0 | 0 | 0 |


## Critical Surfaces Eliminated In Target Files
- backend/services/companyIntelligenceConfigService.ts: 15 DB mutation records are repository-owned; 0 critical outside repository ownership.
- backend/services/boltPipelineService.ts: 11 DB mutation records are repository-owned; 0 critical outside repository ownership.
- backend/services/structuredPlanScheduler.ts: 11 DB mutation records are repository-owned; 0 critical outside repository ownership.
- backend/services/externalApi/dbHelpers.ts: 10 DB mutation records are repository-owned; 0 critical outside repository ownership.
- backend/services/intelligenceGovernanceService.ts: 10 DB mutation records are repository-owned; 0 critical outside repository ownership.
- backend/services/whatsappBroadcastService.ts: 10 DB mutation records are repository-owned; 0 critical outside repository ownership.

## Remaining Critical DB Mutation Regions
- backend/services/analyticsIntegrationService.ts: 9
- backend/services/decisionObjectService.ts: 8
- backend/services/marketPulseJobProcessor.ts: 8
- backend/services/opportunityService.ts: 8
- backend/services/crawlerService.ts: 7
- backend/services/crmIngestionService.ts: 7
- backend/services/GovernanceSnapshotService.ts: 7
- backend/services/leadJobProcessor.ts: 7
- backend/services/marketPulseV2Service.ts: 7
- backend/services/reportAutomationService.ts: 7
- backend/services/ga4IngestionService.ts: 6
- backend/services/intelligenceConfigService.ts: 6
- backend/services/metaDerivedAccountsService.ts: 6
- backend/services/recommendationJobProcessor.ts: 6
- backend/services/signalClusterEngine.ts: 6
- backend/services/whatsappTemplateService.ts: 6
- backend/tests/integration/publish_flow.test.ts: 6
- backend/services/analyticsNormalizationService.ts: 5
- backend/services/CampaignPreemptionService.ts: 5
- backend/services/campaignRecommendationExtensionService.ts: 5
- backend/services/contentOpportunityLifecycleService.ts: 5
- backend/services/engagementNormalizationService.ts: 5
- backend/services/executionPlannerPersistence.ts: 5
- backend/services/externalApi/platformConfig.ts: 5
- backend/services/intelligenceSignalStore.ts: 5

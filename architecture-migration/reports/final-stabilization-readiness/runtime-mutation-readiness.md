# Runtime Mutation Readiness

Status: NOT DEBT-FREE. Runtime mutation surface remains material.

## Classification
- execution-critical / scheduler / auth / service writes: execution=516, other=47, queue-job=30
- repository-owned safe writes: 49
- API adapter writes: 431
- dead/test/ignored writes: 58
- raw mutation records: 1082
- dangerous runtime mutation records: 593

## Top Blocking Modules
- backend/services/externalApi/dbHelpers.ts: 10
- backend/services/intelligenceGovernanceService.ts: 10
- backend/services/whatsappBroadcastService.ts: 10
- backend/services/analyticsIntegrationService.ts: 9
- backend/services/decisionObjectService.ts: 8
- backend/services/marketPulseJobProcessor.ts: 8
- backend/services/opportunityService.ts: 8
- backend/jobs/dailyIntelligenceScheduler.ts: 7
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
- backend/services/analyticsNormalizationService.ts: 5
- backend/services/CampaignPreemptionService.ts: 5
- backend/services/campaignRecommendationExtensionService.ts: 5
- backend/services/contentOpportunityLifecycleService.ts: 5
- backend/services/engagementNormalizationService.ts: 5

## Blocking Tables
- campaigns: 16
- external_api_sources: 14
- social_accounts: 11
- lead_jobs_v1: 11
- notifications: 9
- external_api_usage: 8
- engagement_content_opportunities: 7
- decision_objects: 7
- market_pulse_jobs_v1: 7
- scheduled_posts: 6
- engagement_threads: 6
- community_ai_actions: 6
- daily_content_plans: 6
- recommendation_jobs_v2: 6
- whatsapp_broadcast_recipients: 6
- whatsapp_templates: 6
- intelligence_job_runs: 5
- campaign_learnings: 5
- engagement_opportunities: 5
- company_domains: 5

Verdict: remaining dangerous mutation count is 593. This blocks debt-free stabilization until migrated or explicitly tiered.

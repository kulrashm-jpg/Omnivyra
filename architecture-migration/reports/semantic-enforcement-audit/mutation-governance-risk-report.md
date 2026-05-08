# Mutation Governance Risk Report

Mutation governance status: CRITICAL

## Counts
- dangerous runtime mutations: 600
- API adapter mutations: 431
- repository-owned writes: 49
- total mutation records: 1089

## Severity Classification
- critical: 570
- dangerous/high: 30
- moderate/API: 431
- safe repository-owned: 49

## Top Risk Modules
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
- backend/services/executionPlannerPersistence.ts: 5
- backend/services/externalApi/platformConfig.ts: 5
- backend/services/intelligenceSignalStore.ts: 5
- backend/services/leadService.ts: 5
- backend/services/userManagementService.ts: 5
- scripts/run-baseline-conditioning-scenarios.ts: 5
- backend/auth/refreshLock.ts: 4
- backend/auth/tokenStore.ts: 4
- backend/jobs/weeklyPricingAnalysisJob.ts: 4
- backend/security/SessionAuthorityService.ts: 4

## Mutation Governance Exposure
- Unrestricted runtime mutations remain in services, scheduler, auth, queue/job paths.
- API mutation paths are classified medium but can still embed business authority.
- Queue payload mutation and scheduler mutation are not governed by a single authority.
- Repository return mutation and cross-runtime object mutation are not detected by the scanner.
- Wrapper/facade mutation calls can evade direct .from-chain scanning.

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
- governance_lockdown: 5
- intelligence_signals: 5
- opportunity_items: 5
- company_strategic_themes: 5
- token_refresh_locks: 4
- auth_sessions: 4
- webauthn_credentials: 4
- analytics_integrations: 4
- analytics_properties: 4
- audit_logs: 4

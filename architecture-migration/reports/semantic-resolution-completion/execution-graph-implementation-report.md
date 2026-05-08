# Execution Graph Implementation Report

Execution graph status: PARTIAL

## Implemented
- AST call graph with caller/callee/import-source metadata.
- Execution root discovery for orchestrating functions.
- Queue dispatcher edge extraction from queue.add/addBulk.
- Queue target inference for known execution domains.
- Dynamic import execution root capture.

## Current Counts
- call edges: 167861
- execution roots: 5394
- queue edges: 38
- unresolved queue targets: 0
- unresolved execution roots: 805

## Unresolved Queue Targets
- none

## Unresolved Execution Roots
- instrumentation.node.ts:51 register unresolved dynamic import execution root
- lib/config/verification.ts:99 testRedisConnectivity unresolved dynamic import execution root
- pages/api/extension/commands.ts:208 handler unresolved dynamic import execution root
- backend/adapters/engagement/responseAdapter.ts:37 generateEngagementResponse orchestration-like function has no canonical execution domain or resolved lineage
- backend/adapters/engagement/responseAdapter.ts:99 generateBulkEngagementResponses orchestration-like function has no canonical execution domain or resolved lineage
- backend/auth/tokenRefresh.ts:125 refreshTwitterTokenIfNeeded orchestration-like function has no canonical execution domain or resolved lineage
- backend/chatGovernance/CampaignPlanningQAState.ts:68 computeCampaignPlanningQAState orchestration-like function has no canonical execution domain or resolved lineage
- backend/db/platformExecutionStore.ts:42 saveSchedulerJobs orchestration-like function has no canonical execution domain or resolved lineage
- backend/db/supabaseClient.ts:18 ensureServerEnvLoaded orchestration-like function has no canonical execution domain or resolved lineage
- backend/lib/performance/performanceAnalyzer.ts:332 comparePerformance orchestration-like function has no canonical execution domain or resolved lineage
- backend/lib/railwayComputeMiddleware.ts:94 withQueueMetrics orchestration-like function has no canonical execution domain or resolved lineage
- backend/lib/simulation/scenarioSimulator.ts:270 simulateScenario orchestration-like function has no canonical execution domain or resolved lineage
- backend/security/totp/TotpEnrollmentService.ts:69 beginEnrollment orchestration-like function has no canonical execution domain or resolved lineage
- backend/security/webauthn/WebAuthnAuthenticationService.ts:56 beginAuthentication orchestration-like function has no canonical execution domain or resolved lineage
- backend/security/webauthn/WebAuthnRegistrationService.ts:54 beginRegistration orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:144 readKey orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:157 getRateLimitAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:164 getQueueAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:171 getCronAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:200 validateQueueConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:245 saveRateLimitAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:250 saveQueueAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:255 saveCronAdminConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:300 getInfraLimitsConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:310 saveInfraLimitsConfig orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:334 shouldRunCronJob orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/adminRuntimeConfig.ts:391 getQueueMaxJobsCap orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/analyticsDataReadinessService.ts:21 getAnalyticsReadiness orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/analyticsNormalizationService.ts:76 upsertGrowthSnapshot orchestration-like function has no canonical execution domain or resolved lineage
- backend/services/auditLoggingService.ts:60 logAuditEvent orchestration-like function has no canonical execution domain or resolved lineage

# Enforcement Trust Validation Report

Enforcement trust validation: FAILED

## Implemented
- Fails trust on unresolved alias chains.
- Fails trust on unresolved export/re-export chains.
- Fails trust on unresolved queue targets.
- Fails trust on unresolved execution roots.
- Fails trust on unresolved dominance.
- Fails trust on authority-chain drift.
- Fails trust on runtime mutation outside repository authority.
- Fails trust on runtime payload mutation.
- Fails trust on critical transitive unsafe propagation.

## Findings By Tier
- critical: 4640
- high: 1312
- moderate: 0
- low: 0

## Critical Findings Sample
- authority-chain-drift: auth: 
- authority-chain-drift: session: 
- authority-chain-drift: company: 
- authority-chain-drift: role: 
- authority-chain-drift: orchestration: 
- authority-chain-drift: repository: 
- authority-chain-drift: queue: 
- runtime-mutation-outside-repository: backend/auth/credentialEncryption.ts:37 encryptCredential
- runtime-mutation-outside-repository: backend/auth/credentialEncryption.ts:54 decryptCredential
- runtime-mutation-outside-repository: backend/auth/oauthState.ts:32 signStatePayload
- runtime-mutation-outside-repository: backend/auth/refreshLock.ts:43 acquireRefreshLock
- runtime-mutation-outside-repository: backend/auth/refreshLock.ts:58 acquireRefreshLock
- runtime-mutation-outside-repository: backend/auth/refreshLock.ts:71 acquireRefreshLock
- runtime-mutation-outside-repository: backend/auth/refreshLock.ts:88 releaseRefreshLock
- runtime-mutation-outside-repository: backend/auth/tokenRefresh.ts:163 recordTwitterRefreshOutcome
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:64 encrypt
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:91 decrypt
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:185 setToken
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:238 dualWriteSocialAccount
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:255 dualWriteSocialAccount
- runtime-mutation-outside-repository: backend/auth/tokenStore.ts:273 deactivateSocialAccount
- runtime-mutation-outside-repository: backend/chatGovernance/CampaignPlanningQAState.ts:279 computeCampaignPlanningQAState
- runtime-mutation-outside-repository: backend/chatGovernance/CampaignPlanningQAState.ts:296 computeCampaignPlanningQAState
- runtime-mutation-outside-repository: backend/governance/GovernanceLedger.ts:44 computeGovernanceEventHash
- runtime-mutation-outside-repository: backend/governance/GovernancePolicy.ts:36 getGovernancePolicyHash
- runtime-mutation-outside-repository: backend/governance/GovernancePolicyRegistry.ts:44 buildPolicyDefinition
- runtime-mutation-outside-repository: backend/integration/publishIntegration.ts:75 integratePublishError
- runtime-mutation-outside-repository: backend/middleware/withIdempotency.ts:45 buildRequestHash
- runtime-mutation-outside-repository: backend/middleware/withIdempotency.ts:61 createRecord
- runtime-mutation-outside-repository: backend/middleware/withIdempotency.ts:84 markRecord
- runtime-mutation-outside-repository: backend/middleware/withIdempotency.ts:151 run
- runtime-mutation-outside-repository: backend/prompts/contentGeneration.prompt.ts:13 hashString
- runtime-mutation-outside-repository: backend/scheduler/schedulerService.ts:658 enqueueScheduledLeadDetection
- runtime-mutation-outside-repository: backend/scripts/activateCompanyIntelligence.ts:69 main
- runtime-mutation-outside-repository: backend/scripts/activateCompanyIntelligence.ts:94 main
- runtime-mutation-outside-repository: backend/scripts/activateCompanyIntelligence.ts:119 main
- runtime-mutation-outside-repository: backend/scripts/activateIntelligenceSystem.ts:38 main
- runtime-mutation-outside-repository: backend/scripts/activateIntelligenceSystem.ts:53 main
- runtime-mutation-outside-repository: backend/scripts/activateIntelligenceSystem.ts:71 main
- runtime-mutation-outside-repository: backend/scripts/seedPlatformOauthConfigsFromEnv.ts:91 seed
- runtime-mutation-outside-repository: backend/security/audit/SecurityAuditService.ts:106 logSecurityEvent
- runtime-mutation-outside-repository: backend/security/devices/DeviceFingerprintService.ts:31 fingerprintFromInputs
- runtime-mutation-outside-repository: backend/security/devices/DeviceSessionRepository.ts:105 insertTrustedDevice
- runtime-mutation-outside-repository: backend/security/devices/DeviceSessionRepository.ts:125 touchLastSeen
- runtime-mutation-outside-repository: backend/security/devices/DeviceSessionRepository.ts:136 revokeDevice
- runtime-mutation-outside-repository: backend/security/SessionAuthorityService.ts:61 signSessionPayload
- runtime-mutation-outside-repository: backend/security/SessionAuthorityService.ts:144 createSession
- runtime-mutation-outside-repository: backend/security/SessionAuthorityService.ts:229 touchSession
- runtime-mutation-outside-repository: backend/security/SessionAuthorityService.ts:239 revokeSession
- runtime-mutation-outside-repository: backend/security/SessionAuthorityService.ts:251 revokeAllSessionsForUser

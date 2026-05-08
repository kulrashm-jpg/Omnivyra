# Canonical Authority Declaration Report

Canonical authority system:
AUTHORITATIVE

## Declaration Artifact
- architecture-migration/contracts/canonical-authority-runtime-ancestry.json

## Declared Authorities
- auth: owner=AuthAuthority; file=backend/auth/tokenRefresh.ts
- session: owner=SessionAuthority; file=backend/db/supabaseClient.ts
- company: owner=CompanyAuthority; file=backend/services/companyProfileService.ts
- role: owner=RoleAuthority; file=backend/security/CapabilityService.ts
- orchestration: owner=OrchestrationAuthority; file=backend/services/campaignAiOrchestrator.ts
- repository: owner=RepositoryAuthority; file=backend/repositories
- queue: owner=QueueAuthority; file=backend/queue/bullmqClient.ts

## Remaining Authority Gaps
- none

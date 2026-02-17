# Failing Regression Tests — Classification Report

**Date:** 2026-02-16  
**Scope:** 53 failing tests across 21 suites  
**Directive:** Classification only — no code changes, no fixes, no skips

---

## STEP 1 — Failing Test Names (Captured)

| # | File | Test Name |
|---|------|-----------|
| 1 | publish_flow.test.ts | runs the full publish flow |
| 2 | omnivyra_learning_bridge.test.ts | injects learning status into recommendation engine result |
| 3 | omnivyra_learning_bridge.test.ts | exposes learning payload in audit report |
| 4 | user_lifecycle_management.test.ts | Admin can invite user in own company |
| 5 | user_lifecycle_management.test.ts | Role update works |
| 6 | user_lifecycle_management.test.ts | Remove user works |
| 7 | user_lifecycle_management.test.ts | List users scoped to company |
| 8 | user_lifecycle_management.test.ts | Audit logs created |
| 9 | campaign_ai_plan.test.ts | returns orchestrated response |
| 10 | platform_strategy_filtering.test.ts | filters platforms by content type and promotion mode |
| 11 | platform_strategy_filtering.test.ts | includes newly configured platform |
| 12 | external_api_company_scope.test.ts | returns APIs for selected company only |
| 13 | external_api_company_scope.test.ts | fetchExternalApis uses company scope |
| 14 | external_api_service.test.ts | fetches and normalizes trend signals |
| 15 | external_api_service.test.ts | blocks non-admin from creating API sources |
| 16 | external_api_service.test.ts | rejects missing env var when auth is required |
| 17 | external_api_service.test.ts | validate endpoint updates external_api_health |
| 18 | external_api_service.test.ts | skips unreliable APIs when fetching trends |
| 19 | external_api_alignment.test.ts | handles missing env vars and cache hits |
| 20 | external_api_alignment.test.ts | falls back with no_external_signals placeholder |
| 21 | external_api_presets.test.ts | returns 4 presets from GET /api/external-apis/presets |
| 22 | external_api_presets.test.ts | imports a preset via POST /api/external-apis |
| 23 | external_api_presets.test.ts | reports missing env vars safely |
| 24 | omnivyra_fallback_reasons.test.ts | sets fallback reason in recommendation engine status |
| 25 | social_platform_config.test.ts | creates and fetches platform config |
| 26 | recommendation_audit.test.ts | logs audit row during recommendation generation |
| 27 | recommendation_audit.test.ts | fetches audit by recommendation id |
| 28 | recommendation_audit.test.ts | fetches audit by campaign id |
| 29 | external_api_health.test.ts | records cache hit and miss |
| 30 | external_api_health.test.ts | retries on 5xx responses |
| 31 | external_api_health.test.ts | blocks rate limited sources |
| 32 | external_api_health.test.ts | updates health score on success |
| 33 | external_api_health.test.ts | computes signal confidence |
| 34 | recommendation_analytics.test.ts | computes analytics and enforces admin gating |
| 35 | recommendation_analytics.test.ts | blocks non-admin access |
| 36 | recommendation_fusion_scoring.test.ts | boosts consensus for multi-source trends |
| 37 | recommendation_fusion_scoring.test.ts | applies geo relevance scoring |
| 38 | recommendation_fusion_scoring.test.ts | applies audience fit scoring |
| 39 | recommendation_create_campaign.test.ts | creates campaign, links recommendation, and returns response |
| 40 | recommendation_policy_navigation.test.ts | blocks simulate for non-admin |
| 41 | recommendation_policy_navigation.test.ts | passes campaignId to simulation |
| 42 | company_profile_api.test.ts | creates or updates profile |
| 43 | company_profile_api.test.ts | fetches profile |
| 44 | company_profile_api.test.ts | refines profile |
| 45 | recommendation_scheduler.test.ts | runs weekly refresh and persists with auto_weekly source |
| 46 | recommendation_scheduler.test.ts | runs profile refresh and persists with profile_update source |
| 47 | recommendation_simulation.test.ts | simulates recommendations without persistence |
| 48 | campaign_company_scope_fix.test.ts | returns empty list for other company |
| 49 | campaign_company_scope_fix.test.ts | dashboard only shows company campaigns |
| 50 | campaign_company_scope_fix.test.ts | returns 403 when campaign not linked to company |
| 51 | campaign_company_scope_fix.test.ts | returns 403 for mismatched campaignId in progress |

---

## STEP 2 — Per-Test Classification

### publish_flow.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| runs the full publish flow | publish_flow.test.ts | fetch failed (Supabase/network) | Cron → queue_job → worker → published post | A) Active | Fix |

### omnivyra_learning_bridge.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| injects learning status into recommendation engine result | omnivyra_learning_bridge.test.ts | Supabase mock: .select undefined | OmniVyra learning bridge → recommendation flow | A) Active | Refactor |
| exposes learning payload in audit report | omnivyra_learning_bridge.test.ts | campaignAuditService internal | Audit report with learning payload | A) Active | Refactor |

### user_lifecycle_management.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| Admin can invite user in own company | user_lifecycle_management.test.ts | 403 vs 200 | Invite handler RBAC | A) Active | Fix |
| Role update works | user_lifecycle_management.test.ts | 403 vs 200 | Role update RBAC | A) Active | Fix |
| Remove user works | user_lifecycle_management.test.ts | 403 vs 200 | Remove user RBAC | A) Active | Fix |
| List users scoped to company | user_lifecycle_management.test.ts | 403 vs 200 | List users RBAC | A) Active | Fix |
| Audit logs created | user_lifecycle_management.test.ts | toHaveBeenCalled 0 | User mgmt audit | A) Active | Fix |

### campaign_ai_plan.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| returns orchestrated response | campaign_ai_plan.test.ts | 500 vs 200 | AI plan API (OmniVyra + virality) | A) Active | Fix |

### platform_strategy_filtering.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| filters platforms by content type and promotion mode | platform_strategy_filtering.test.ts | Failed to load recommendation policy | Platform filtering in generateRecommendations | A) Active | Refactor |
| includes newly configured platform | platform_strategy_filtering.test.ts | Failed to load recommendation policy | Same | A) Active | Refactor |

### external_api_company_scope.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| returns APIs for selected company only | external_api_company_scope.test.ts | 500 vs 200 | External API company scope | A) Active | Refactor |
| fetchExternalApis uses company scope | external_api_company_scope.test.ts | createQuery().or is not a function | Supabase .or() for company scoping | A) Active | Refactor |

### external_api_service.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| fetches and normalizes trend signals | external_api_service.test.ts | createQuery().or is not a function | External API service fetch | A) Active | Refactor |
| blocks non-admin from creating API sources | external_api_service.test.ts | 400 vs 403 | Admin gating | A) Active | Refactor |
| rejects missing env var when auth is required | external_api_service.test.ts | companyId required vs API key msg | Request validation order | A) Active | Refactor |
| validate endpoint updates external_api_health | external_api_service.test.ts | req.headers undefined | Auth in validate handler | A) Active | Refactor |
| skips unreliable APIs when fetching trends | external_api_service.test.ts | fetch mock not called | Reliability filtering | A) Active | Refactor |

### external_api_alignment.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| handles missing env vars and cache hits | external_api_alignment.test.ts | createQuery().or is not a function | External API alignment | A) Active | Refactor |
| falls back with no_external_signals placeholder | external_api_alignment.test.ts | CAMPAIGN_NOT_IN_COMPANY | Campaign-company link in recommendations | A) Active | Refactor |

### external_api_presets.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| returns 4 presets from GET /api/external-apis/presets | external_api_presets.test.ts | req.query.companyId undefined | Presets handler | A) Active | Refactor |
| imports a preset via POST /api/external-apis | external_api_presets.test.ts | 400 vs 201 | Preset import | A) Active | Refactor |
| reports missing env vars safely | external_api_presets.test.ts | wrong missingEnv array | Env var reporting | A) Active | Refactor |

### external_api_health.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| records cache hit and miss | external_api_health.test.ts | createQuery().or is not a function | API health cache | A) Active | Refactor |
| retries on 5xx responses | external_api_health.test.ts | fetchMock 0 calls | Retry logic | A) Active | Refactor |
| blocks rate limited sources | external_api_health.test.ts | rate_limited_sources empty | Rate limiting | A) Active | Refactor |
| updates health score on success | external_api_health.test.ts | record undefined | Health store | A) Active | Refactor |
| computes signal confidence | external_api_health.test.ts | trends[0] undefined | Signal confidence | A) Active | Refactor |

### omnivyra_fallback_reasons.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| sets fallback reason in recommendation engine status | omnivyra_fallback_reasons.test.ts | fetch failed (ensureCampaignCompanyLink) | OmniVyra fallback reasons | A) Active | Refactor |

### social_platform_config.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| creates and fetches platform config | social_platform_config.test.ts | 400 vs 201 | External API / platform config | A) Active | Refactor |

### recommendation_audit.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| logs audit row during recommendation generation | recommendation_audit.test.ts | supabase.from(...).select undefined | Recommendation audit logging | A) Active | Refactor |
| fetches audit by recommendation id | recommendation_audit.test.ts | req.headers undefined | Audit API RBAC | A) Active | Refactor |
| fetches audit by campaign id | recommendation_audit.test.ts | req.headers undefined | Audit API RBAC | A) Active | Refactor |

### recommendation_analytics.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| computes analytics and enforces admin gating | recommendation_analytics.test.ts | req.headers undefined | Recommendation analytics API | A) Active | Refactor |
| blocks non-admin access | recommendation_analytics.test.ts | req.headers undefined | Same | A) Active | Refactor |

### recommendation_fusion_scoring.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| boosts consensus for multi-source trends | recommendation_fusion_scoring.test.ts | Failed to load recommendation policy | Fusion scoring in generateRecommendations | A) Active | Refactor |
| applies geo relevance scoring | recommendation_fusion_scoring.test.ts | Failed to load recommendation policy | Same | A) Active | Refactor |
| applies audience fit scoring | recommendation_fusion_scoring.test.ts | Failed to load recommendation policy | Same | A) Active | Refactor |

### recommendation_create_campaign.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| creates campaign, links recommendation, and returns response | recommendation_create_campaign.test.ts | req.headers undefined | Create campaign from recommendation API | A) Active | Refactor |

### recommendation_policy_navigation.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| blocks simulate for non-admin | recommendation_policy_navigation.test.ts | req.headers undefined | Policy simulate RBAC | A) Active | Refactor |
| passes campaignId to simulation | recommendation_policy_navigation.test.ts | req.headers undefined | Same | A) Active | Refactor |

### company_profile_api.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| creates or updates profile | company_profile_api.test.ts | saveProfile not called | Company profile API | A) Active | Refactor |
| fetches profile | company_profile_api.test.ts | getLatestProfile not called | Same | A) Active | Refactor |
| refines profile | company_profile_api.test.ts | req.headers undefined | Refine profile RBAC | A) Active | Refactor |

### recommendation_scheduler.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| runs weekly refresh and persists with auto_weekly source | recommendation_scheduler.test.ts | generateRecommendations not called | Weekly recommendation refresh | A) Active | Refactor |
| runs profile refresh and persists with profile_update source | recommendation_scheduler.test.ts | generateRecommendations not called | Profile-triggered refresh | A) Active | Refactor |

### recommendation_simulation.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| simulates recommendations without persistence | recommendation_simulation.test.ts | getCompanyDefaultApiIds is not a function | Recommendation simulation service | B) Transitional | Refactor |

### campaign_company_scope_fix.test.ts

| Test name | File | Failure type | Feature tested | Architecture status | Recommendation |
|-----------|------|--------------|----------------|---------------------|----------------|
| returns empty list for other company | campaign_company_scope_fix.test.ts | resolveUserContext is not a function | Campaign company scope | A) Active | Refactor |
| dashboard only shows company campaigns | campaign_company_scope_fix.test.ts | 500 vs 200 | Same | A) Active | Refactor |
| returns 403 when campaign not linked to company | campaign_company_scope_fix.test.ts | 500 vs 403 | Same | A) Active | Refactor |
| returns 403 for mismatched campaignId in progress | campaign_company_scope_fix.test.ts | resolveUserContext / timeout | Same | A) Active | Refactor |

---

## STEP 3 — Failure Type Summary

| Failure type | Count | Description |
|--------------|-------|-------------|
| req.headers / req.query undefined | 13 | API tests omit auth/query in mock request |
| createQuery().or is not a function | 7 | Supabase mock missing .or() for company-scoped queries |
| Failed to load recommendation policy | 5 | Supabase mock doesn’t return policy for getActivePolicy |
| fetch failed | 2 | Live Supabase/network calls in test env |
| supabase.from(...).select undefined | 3 | Incomplete Supabase chain mock |
| resolveUserContext is not a function | 2 | userContextService mock incomplete |
| getCompanyDefaultApiIds is not a function | 1 | externalApiService API changed/renamed |
| generateRecommendations not called | 2 | Scheduler short-circuits before generateRecommendations |
| Handler returns wrong status (400/403/500) | 8 | Request shape or mocks don’t match handler expectations |
| Mock assertion (toHaveBeenCalled, etc.) | 4 | Handler path or mock setup doesn’t hit expected code |

---

## STEP 4 — Grouping by Subsystem

### Governance
**Count: 0**  
All governance tests pass.

### Duration
**Count: 0**  
No failing tests in duration/constraint subsystems.

### Portfolio
**Count: 0**  
No failing tests in portfolio constraints.

### Preemption
**Count: 0**  
No failing tests in preemption.

### Blueprint
**Count: 1**  
| Test | Status |
|------|--------|
| campaign_ai_plan: returns orchestrated response | A) Active — Fix |

### Scheduler
**Count: 1**  
| Test | Status |
|------|--------|
| publish_flow: runs the full publish flow | A) Active — Fix (infra) |

### Recommendation Engine
**Count: 20**  
| Tests | Status |
|-------|--------|
| platform_strategy_filtering (2) | A) Active |
| recommendation_audit (3) | A) Active |
| recommendation_analytics (2) | A) Active |
| recommendation_fusion_scoring (3) | A) Active |
| recommendation_create_campaign (1) | A) Active |
| recommendation_policy_navigation (2) | A) Active |
| recommendation_scheduler (2) | A) Active |
| recommendation_simulation (1) | B) Transitional |
| omnivyra_learning_bridge (2) | A) Active |
| omnivyra_fallback_reasons (1) | A) Active |

### External API
**Count: 14**  
| Tests | Status |
|-------|--------|
| external_api_company_scope (2) | A) Active |
| external_api_service (5) | A) Active |
| external_api_alignment (2) | A) Active |
| external_api_presets (3) | A) Active |
| external_api_health (5) | A) Active |
| social_platform_config (1) | A) Active |

### Infra / Redis
**Count: 1**  
| Test | Status |
|------|--------|
| publish_flow | A) Active — requires Redis + Supabase |

### Supabase mock
**Count: 25** (tests failing due to mock gaps)  
- Missing `.or()` on query chain  
- Missing `recommendation_policies` mock  
- Missing `req.headers` / `req.query` in request mocks  
- `resolveUserContext` / `userContextService` mock gaps  

### Legacy 12-week flows
**Count: 0**  
No failing tests specific to legacy 12-week flows.

### Company scope / RBAC
**Count: 12**  
| Tests | Status |
|-------|--------|
| campaign_company_scope_fix (4) | A) Active |
| user_lifecycle_management (5) | A) Active |
| company_profile_api (3) | A) Active |

---

## STEP 5 — Final Summary

| Metric | Value |
|--------|-------|
| **Total failures** | 53 |
| **Total failing suites** | 21 |

### Count by Architecture Status

| Status | Count | % |
|--------|-------|---|
| **A) Active** | 52 | 98% |
| **B) Transitional / deprecated** | 1 | 2% |
| **C) Dead / obsolete** | 0 | 0% |

### Recommendation Strategy

| Action | Count | Notes |
|--------|-------|-------|
| **Fix** | 2 | publish_flow (infra), campaign_ai_plan (handler) |
| **Refactor** | 50 | Mock alignment, request shapes, Supabase chain |
| **Delete** | 0 | No tests classified as dead |
| **Migrate** | 1 | recommendation_simulation (getCompanyDefaultApiIds API change) |

### Strategic Takeaway

- **52 of 53** failing tests cover features that are **A) Active**.
- Failures are driven by:
  - Incomplete request mocks (`req.headers`, `req.query`)
  - Supabase mock missing `.or()` and policy tables
  - Scheduler/recommendation flow short-circuits due to mock setup
- There are **no candidates for deletion** in this set.
- `recommendation_simulation` is the only **B) Transitional** case due to `getCompanyDefaultApiIds`; treat as a migration task, not a removal.
- Priority focus: unify request mocks and Supabase chain mocks across API and recommendation tests.

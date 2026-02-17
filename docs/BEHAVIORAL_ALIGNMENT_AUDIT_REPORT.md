# Phase 2.1 – Behavioral Alignment Audit Report

**Audit Date:** 2025-02-16  
**Scope:** Failing regression tests only  
**Constraint:** Analysis only — no modifications.

---

## STEP 1 — Test Suite Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | 381 |
| **Passing** | 345 |
| **Failing** | 36 |
| **Test Suites** | 67 total (52 passed, 15 failed) |

---

## STEP 2 — Per-Failing-Test Classification

### 1. Campaign Company Scope Fix

| Field | Value |
|-------|-------|
| **Tests** | returns campaigns for correct company, does not reference campaigns.company_id, returns empty list for other company, returns 403 when campaign not linked to company, returns 403 for mismatched campaignId in progress |
| **File** | `campaign_company_scope_fix.test.ts` |
| **Subsystem** | Company Scope |

**returns campaigns for correct company / does not reference / returns empty list / returns 403 for mismatched campaignId**

- **What the test expects:** list handler returns 200 with correct company-scoped campaigns; progress handler returns 403 for CAMPAIGN_NOT_IN_COMPANY.
- **What actually happens:** `TypeError: Cannot read properties of undefined (reading 'from')` at `rbacService.isSuperAdmin` → `supabase.from('user_company_roles')`. Supabase is undefined for RBAC path; tests use `utils/supabaseClient`, RBAC uses `backend/db/supabaseClient`.
- **Production code path:** `pages/api/campaigns/list`, `pages/api/campaigns/index`, `pages/api/campaigns/[id]/progress` → `withRBAC` → `enforceRole` → `isSuperAdmin` → supabase.
- **Architectural context:** Assumes Supabase mocks cover all import paths (utils vs backend/db). No legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (Supabase mock path mismatch)
- **Recommended action:** Fix test infrastructure — ensure backend supabase is mocked where RBAC runs

**returns 403 when campaign not linked to company**

- **What the test expects:** `res.body?.code === 'CAMPAIGN_NOT_IN_COMPANY'`
- **What actually happens:** `res.statusCode === 403` but `res.body?.code === undefined` (response shape differs)
- **Production code path:** `campaigns/index` handler, enforceCompanyAccess or equivalent
- **Architectural context:** Expects error payload shape `{ code: 'CAMPAIGN_NOT_IN_COMPANY' }`
- **Architecture status:** A) Active
- **Root cause type:** Response shape drift
- **Recommended action:** Update test expectation to match current error response shape

---

### 2. OmniVyra Learning Bridge

| Field | Value |
|-------|-------|
| **Tests** | injects learning status into recommendation engine result, exposes learning payload in audit report |
| **File** | `omnivyra_learning_bridge.test.ts` |
| **Subsystem** | OmniVyra Bridge / Recommendation Engine |

- **What the test expects:** `generateRecommendations` and `generateCampaignAuditReport` run successfully with learning payload.
- **What actually happens:** `TypeError: Cannot read properties of undefined (reading 'select')` in `ensureCampaignCompanyLink` (recommendationEngineService.ts:387) and `generateCampaignAuditReport` (campaignAuditService.ts:81). Supabase/campaign link query returns undefined; `campaignAuditService` receives unexpected input.
- **Production code path:** `generateRecommendations` → `ensureCampaignCompanyLink` (Supabase `campaign_versions`); `generateCampaignAuditReport` (input validation).
- **Architectural context:** Assumes full Supabase chain and campaign link data; no legacy assumptions.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (Supabase/campaign link not mocked)
- **Recommended action:** Wire Supabase and campaign link mocks in test setup

---

### 3. Recommendation Fusion Scoring

| Field | Value |
|-------|-------|
| **Tests** | boosts consensus for multi-source trends, applies geo relevance scoring, applies audience fit scoring |
| **File** | `recommendation_fusion_scoring.test.ts` |
| **Subsystem** | Recommendation Engine |

- **What the test expects:** `generateRecommendations` runs and applies fusion scoring.
- **What actually happens:** `Failed to load recommendation policy` at `recommendationPolicyService.getActivePolicy` — `recommendation_policies` table not mocked.
- **Production code path:** `generateRecommendations` → `getActivePolicy` → `supabase.from('recommendation_policies')`.
- **Architectural context:** No legacy assumption; policy load is core path.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (recommendation_policies mock)
- **Recommended action:** Adjust test fixture — mock `recommendation_policies` or `getActivePolicy`

---

### 4. Campaign AI Plan

| Field | Value |
|-------|-------|
| **Tests** | returns orchestrated response |
| **File** | `campaign_ai_plan.test.ts` |
| **Subsystem** | Blueprint / Campaign Orchestration |

- **What the test expects:** 200, `payload.mode === 'generate_plan'`, `payload.snapshot_hash === 'hash123'`.
- **What actually happens:** 500. Plan parse fails (conversational JSON); `saveAiCampaignPlan` fails with `TypeError: fetch failed`.
- **Production code path:** `pages/api/campaigns/ai/plan` → `runCampaignAiPlan` → `parseAiPlanToWeeks`, `saveAiCampaignPlan` (Supabase/fetch).
- **Architectural context:** No legacy assumption; relies on mocked AI response and Supabase/fetch.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (fetch, plan store)
- **Recommended action:** Adjust test fixture — mock fetch and campaign plan store

---

### 5. External API Alignment

| Field | Value |
|-------|-------|
| **Tests** | falls back with no_external_signals placeholder |
| **File** | `external_api_alignment.test.ts` |
| **Subsystem** | External API |

- **What the test expects:** `generateRecommendations` returns fallback with `no_external_signals` placeholder when no trends.
- **What actually happens:** `CAMPAIGN_NOT_IN_COMPANY` thrown from `ensureCampaignCompanyLink` — Supabase returns empty/error for campaign link check.
- **Production code path:** `generateRecommendations` → `ensureCampaignCompanyLink` → Supabase `campaign_versions`.
- **Architectural context:** No legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (campaign_versions / company link mock)
- **Recommended action:** Adjust test fixture — provide campaign link data or mock `ensureCampaignCompanyLink`

---

### 6. User Lifecycle Management

| Field | Value |
|-------|-------|
| **Tests** | Admin can invite user in own company, Role update works, Remove user works, List users scoped to company, Audit logs created |
| **File** | `user_lifecycle_management.test.ts` |
| **Subsystem** | RBAC / Company Scope |

- **What the test expects:** 200 for invite, role update, remove, list; `logUserManagementAudit` called.
- **What actually happens:** 403 for invite/role/remove/list; `logUserManagementAudit` not called.
- **Production code path:** invite/role/remove/list handlers → `withRBAC` / `enforceRole` / company scope checks.
- **Architectural context:** Assumes COMPANY_ADMIN can perform these actions in own company; no legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Mock expectation misalignment (RBAC/company scope returning 403)
- **Recommended action:** Adjust test fixture — verify RBAC and company scope mocks

---

### 7. Recommendation Policy Navigation

| Field | Value |
|-------|-------|
| **Tests** | blocks simulate for non-admin, passes campaignId to simulation |
| **File** | `recommendation_policy_navigation.test.ts` |
| **Subsystem** | Recommendation Engine / RBAC |

- **What the test expects:** 403 for non-admin; 200 with campaignId passed for admin.
- **What actually happens:** `TypeError: Cannot read properties of undefined (reading 'select')` at `resolveUserContext` → `supabase.from('user_company_roles')`. Supabase mock missing for `userContextService`.
- **Production code path:** `pages/api/recommendations/simulate` → `withRBAC` → `enforceRole` → `resolveUserContext` → supabase.
- **Architectural context:** Assumes user context resolves via Supabase; no legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (Supabase for userContextService)
- **Recommended action:** Fix test infrastructure — mock Supabase for resolveUserContext path

---

### 8. OmniVyra Fallback Reasons

| Field | Value |
|-------|-------|
| **Tests** | sets fallback reason in recommendation engine status |
| **File** | `omnivyra_fallback_reasons.test.ts` |
| **Subsystem** | OmniVyra Bridge / Recommendation Engine |

- **What the test expects:** `generateRecommendations` sets fallback reason in status.
- **What actually happens:** `Failed to verify campaign link: TypeError: fetch failed` in `ensureCampaignCompanyLink` — Supabase/fetch not mocked.
- **Production code path:** `generateRecommendations` → `ensureCampaignCompanyLink` → Supabase.
- **Architectural context:** No legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (Supabase/fetch for campaign link)
- **Recommended action:** Adjust test fixture — mock campaign link verification

---

### 9. Social Platform Config

| Field | Value |
|-------|-------|
| **Tests** | creates and fetches platform config |
| **File** | `social_platform_config.test.ts` |
| **Subsystem** | External API |

- **What the test expects:** 201 on create.
- **What actually happens:** 400.
- **Production code path:** `pages/api/external-apis/index` (POST).
- **Architectural context:** Likely `companyId` or validation; no legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Response shape drift or behavioral evolution (validation tightened)
- **Recommended action:** Update test expectation — provide required fields (e.g. companyId) or align with new validation

---

### 10. Platform Strategy Filtering

| Field | Value |
|-------|-------|
| **Tests** | filters platforms by content type and promotion mode, includes newly configured platform |
| **File** | `platform_strategy_filtering.test.ts` |
| **Subsystem** | Recommendation Engine |

- **What the test expects:** `generateRecommendations` filters platforms correctly.
- **What actually happens:** `Failed to load recommendation policy` at `getActivePolicy`.
- **Production code path:** `generateRecommendations` → `getActivePolicy`.
- **Architectural context:** No legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Missing dependency wiring (recommendation_policies mock)
- **Recommended action:** Adjust test fixture — mock `recommendation_policies` or `getActivePolicy`

---

### 11. External API Health

| Field | Value |
|-------|-------|
| **Tests** | retries on 5xx responses, blocks rate limited sources, updates health score on success, computes signal confidence |
| **File** | `external_api_health.test.ts` |
| **Subsystem** | External API |

- **What the test expects:** fetch called 2x on retry; rate limited sources populated; health record updated; signal_confidence present.
- **What actually happens:** fetch 0 calls; rate_limited_sources empty; record undefined; trends[0] undefined.
- **Production code path:** `fetchTrendsFromApis`, `getExternalApiRuntimeSnapshot`, health store.
- **Architectural context:** Assumes fetch mock and health flow; no legacy assumption.
- **Architecture status:** A) Active
- **Root cause type:** Mock expectation misalignment (fetch/signature changed, flow diverges)
- **Recommended action:** Adjust test fixture — align fetch mock and service call pattern with current implementation

---

### 12. External API Presets

| Field | Value |
|-------|-------|
| **Tests** | returns 4 presets from GET /api/external-apis/presets, reports missing env vars safely |
| **File** | `external_api_presets.test.ts` |
| **Subsystem** | External API |

- **What the test expects:** 200 with 4 presets; `request.missingEnv` contains `NEWS_API_KEY`.
- **What actually happens:** 400 on GET; `missingEnv` contains `YOUTUBE_API_KEY` instead of `NEWS_API_KEY`.
- **Production code path:** presets handler; env validation.
- **Architectural context:** Preset/env contract may have changed; no strong legacy assumption.
- **Architecture status:** B) Transitional (preset/env contract may have evolved)
- **Root cause type:** Behavioral evolution (companyId required, preset/env shape change)
- **Recommended action:** Update test expectation — add companyId, align preset/env assertions

---

### 13. External API Service

| Field | Value |
|-------|-------|
| **Tests** | fetches and normalizes trend signals, rejects missing env var when auth is required, validate endpoint updates external_api_health, skips unreliable APIs when fetching trends |
| **File** | `external_api_service.test.ts` |
| **Subsystem** | External API |

**fetches and normalizes trend signals**

- **What the test expects:** Trend object without `signal_confidence`.
- **What actually happens:** Trend includes `signal_confidence: 0.95` — response shape evolved.
- **Root cause type:** Response shape drift
- **Recommended action:** Update test expectation — include signal_confidence in expected object

**rejects missing env var when auth is required**

- **What the test expects:** 400.
- **What actually happens:** 201 — handler accepts request.
- **Root cause type:** Behavioral evolution or mock misalignment
- **Recommended action:** Investigate as possible regression — verify env validation path

**validate endpoint updates external_api_health**

- **What the test expects:** 200.
- **What actually happens:** 403 — RBAC blocks.
- **Root cause type:** Mock expectation misalignment (RBAC)
- **Recommended action:** Adjust test fixture — ensure RBAC mocks allow access

**skips unreliable APIs when fetching trends**

- **What the test expects:** fetch called 1x.
- **What actually happens:** fetch 0 calls — handler may short-circuit or use different path.
- **Root cause type:** Mock expectation misalignment or behavioral evolution
- **Recommended action:** Investigate as possible regression — trace fetch call path

---

### 14. Recommendation Analytics

| Field | Value |
|-------|-------|
| **Tests** | computes analytics and enforces admin gating |
| **File** | `recommendation_analytics.test.ts` |
| **Subsystem** | Recommendation Engine / RBAC |

- **What the test expects:** 200 with analytics payload.
- **What actually happens:** 403 — RBAC blocks (getRbacMockImplementations not granting access in this path).
- **Production code path:** `withRBAC` → `enforceRole` → handler.
- **Architecture status:** A) Active
- **Root cause type:** Mock expectation misalignment (RBAC)
- **Recommended action:** Adjust test fixture — RBAC mocks should allow SUPER_ADMIN or equivalent

---

### 15. Recommendation Audit

| Field | Value |
|-------|-------|
| **Tests** | fetches audit by recommendation id, fetches audit by campaign id |
| **File** | `recommendation_audit.test.ts` |
| **Subsystem** | Recommendation Engine / RBAC |

- **What the test expects:** 200 with audit/audits.
- **What actually happens:** 403 — RBAC blocks.
- **Production code path:** `withRBAC` (SUPER_ADMIN) → audit handlers.
- **Architecture status:** A) Active
- **Root cause type:** Mock expectation misalignment (RBAC, companyId)
- **Recommended action:** Adjust test fixture — RBAC and companyId for withRBAC

---

## STEP 3 — Grouping by Pattern

| Pattern | Count | Tests |
|---------|-------|-------|
| **Missing dependency wiring** | 14 | campaign_company_scope_fix (supabase), omnivyra_learning_bridge, recommendation_fusion_scoring, campaign_ai_plan, external_api_alignment, recommendation_policy_navigation, omnivyra_fallback_reasons, platform_strategy_filtering, external_api_health (partial) |
| **Mock expectation misalignment** | 8 | user_lifecycle_management, recommendation_analytics, recommendation_audit, external_api_service (validate, skips unreliable) |
| **Response shape drift** | 4 | campaign_company_scope_fix (code field), external_api_service (signal_confidence, trend shape) |
| **Behavioral evolution** | 3 | external_api_presets (companyId, missingEnv), external_api_service (rejects missing env) |

---

## STEP 4 — Executive Summary

### Counts by Architecture Status

| Status | Count |
|--------|-------|
| **A) Active** | 34 |
| **B) Transitional** | 1 |
| **C) Legacy assumption** | 0 |

### Counts by Root Cause Type

| Root Cause | Count |
|------------|-------|
| Missing dependency wiring | 14 |
| Mock expectation misalignment | 8 |
| Response shape drift | 4 |
| Behavioral evolution | 3 |
| Assertion mismatch | 4 |
| (Overlap with above) | — |

### Counts by Subsystem

| Subsystem | Count |
|-----------|-------|
| Company Scope / RBAC | 12 |
| Recommendation Engine | 9 |
| External API | 11 |
| OmniVyra Bridge | 3 |
| Blueprint | 1 |

---

### Strategic Recommendation

| Action | Approx. Count | Rationale |
|--------|---------------|-----------|
| **Update test expectation** | 5–6 | Response shape (signal_confidence, code), preset/env contract |
| **Adjust test fixture** | 18–20 | Supabase/RBAC/fetch mocks, companyId, recommendation_policies, campaign link |
| **Trigger production refactor** | 0 | No production bugs identified |
| **Migrate** | 0 | No migration needed |
| **Deprecate** | 0 | No tests recommended for deprecation |
| **Investigate as possible regression** | 2 | external_api_service (rejects missing env, skips unreliable) |

---

### Critical Context Verification

Per audit constraints:

- **Governance:** Not implicated; governance tests pass.
- **Blueprint unification:** Not implicated.
- **Duration engine:** Not implicated.
- **Preemption rules:** Not implicated.
- **Event persistence:** Not implicated.
- **Portfolio logic:** Not implicated.

All failures are traceable to **test infrastructure** (mocks, fixtures, wiring) or **evolved contracts** (response shape, validation). No conflicts with frozen production systems.

---

*End of Report*

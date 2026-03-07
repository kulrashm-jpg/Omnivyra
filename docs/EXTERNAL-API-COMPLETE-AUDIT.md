# External API System — Complete Audit

**Date:** 2026-03-05  
**Scope:** Vulnerabilities, consumption flow, and alignment with company needs.  
**Out of scope:** Social media publishing APIs (separate module).

---

## 1. Executive Summary

| Area | Status | Summary |
|------|--------|---------|
| **Vulnerabilities & fixes** | Partial | 403/500 issues addressed with fallbacks and error detail; some routes still lack invited-role fallback. |
| **Consumption** | Documented | External API data is consumed by: UI (external-apis, external-apis-access), recommendation engine, campaign audit, trend relevance, intelligence polling. |
| **Company alignment** | Gaps | Polling is global (ignores company enablement); theme filtering and config are company-scoped. Recommendations for alignment below. |

---

## 2. API Surface & Auth

### 2.1 Routes

| Route | Methods | Auth | Company scope | Notes |
|-------|---------|------|---------------|-------|
| `/api/external-apis` | GET, POST | requireExternalApiAccess (companyId) or requirePlatformAdmin (scope=platform) | Query: companyId or scope=platform | GET uses getPlatformConfigs(companyId); supports skipCache=1. |
| `/api/external-apis/access` | GET, POST, PUT | Same + canManageExternalApis | Body/query: companyId | GET: getEnabledApis, getAvailableApis, company config. POST: preset selection (single or bulk), optional user_access overrides. |
| `/api/external-apis/company-config` | GET, PUT, DELETE | requireCompanyAccess (companyId), canManage | Query/body: companyId, api_source_id | CRUD for company_api_configs. |
| `/api/external-apis/presets` | GET | requireExternalApiAccess or requirePlatformAdmin | companyId or scope=platform | Returns presets (DB + hardcoded merge). |
| `/api/external-apis/requests` | GET, POST | getUserRole + getCompanyRoleIncludingInvited fallback (GET); role for POST | companyId or scope=platform | GET: list requests (all for company if canManage, else own). POST: submit request. |
| `/api/external-apis/requests/[id]` | PUT | getUserRole (no fallback) | companyId | Approve/reject; **no getCompanyRoleIncludingInvited** → invited admins get 403. |
| `/api/external-apis/[id]` | GET, PUT, DELETE | getUserRole (no fallback for company) | companyId or platform | **No getCompanyRoleIncludingInvited** → invited admins get 403. |
| `/api/external-apis/[id]/test` | POST | requireExternalApiAccess | companyId or platform | Test single source. |
| `/api/external-apis/health-summary` | GET | requirePlatformAdmin only | — | Platform-wide health. |
| `/api/external-apis/platforms` | GET | withRBAC(SUPER_ADMIN only) | companyId in query | getPlatformStrategies(companyId). **Only SUPER_ADMIN** can call; may be too strict if other roles need strategies. |

### 2.2 Vulnerabilities & Fixes Applied

| Issue | Severity | Fix / status |
|-------|----------|----------------|
| **403 on GET /requests** | High | Fixed: added getCompanyRoleIncludingInvited fallback; company admins see all company requests, others see own. |
| **500 on POST /access** | High | Fixed: skip external_api_user_access upsert when only saving preset selection (no overrides); added try/catch and response `detail`; safe body handling. |
| **Empty list after “Preset selection saved”** | High | Fixed: getPlatformConfigs fallback to fetch enabled APIs by id when initial query returns none; skipCache=1 after save; cache invalidation on config change. |
| **403 on /requests/[id] (approve)** | Medium | **Open:** No getCompanyRoleIncludingInvited; invited company admins get 403. **Recommendation:** Add same fallback as in requests.ts GET. |
| **403 on /external-apis/[id] (edit source)** | Medium | **Open:** No getCompanyRoleIncludingInvited. **Recommendation:** Add fallback for company-scoped edits. |
| **Company IDOR** | Medium | **Partial:** companyId comes from query/body; requireExternalApiAccess checks getUserRole(user.id, companyId). If the user has no role for that company, they get 403. RBAC must ensure users only have roles for companies they belong to. **Recommendation:** Explicitly document that companyId is “trusted” only after role check; consider validating companyId against a list of user’s companies. |
| **Platforms API** | Low | Only SUPER_ADMIN can call GET /platforms. If other roles need platform strategies for their company, relax to requireExternalApiAccess(companyId) or add role list. |

### 2.3 Consistency Gaps

- **Role resolution:** access, index, presets, company-config, requests (GET) use getCompanyRoleIncludingInvited when getUserRole fails. requests/[id] and [id] do not → inconsistent 403 for invited admins.
- **Error responses:** access and index now return 500 with `detail`; other routes often return generic messages. Standardizing error shape (e.g. `{ error, detail? }`) would help debugging and logging.

---

## 3. How External API Data Is Consumed

### 3.1 UI

| Page | Data used | Source |
|------|-----------|--------|
| **external-apis.tsx** | Catalog, preset selection, configured list, requests, usage | GET index (getPlatformConfigs), GET presets, GET requests; POST access (preset save); loadApis(skipCache=true) after save. |
| **external-apis-access.tsx** | Available APIs, company defaults, global presets, usage, config modal | GET access (getEnabledApis, getAvailableApis, companyDefaultApis, global_presets); PUT company-config; POST access (single API enable/overrides). |

Company context (companyId) comes from useCompanyContext (selected company). No server-side check that the selected company is in the user’s allowed set beyond the role check (user must have a role for that companyId).

### 3.2 Backend Services

| Consumer | What it uses | Company-scoped? |
|----------|----------------|------------------|
| **recommendationEngineService** | getEnabledApis(companyId) | Yes. Used for recommendations; only enabled APIs for that company. |
| **campaignAuditService** | getEnabledApis(resolvedCompanyId) | Yes. Audit uses company’s enabled APIs. |
| **companyTrendRelevanceEngine** | getThemesForCompany(companyId); company_api_configs (include/exclude filters per API) | Yes. Themes filtered by relevance and by company config (per–API source filters). |
| **intelligencePollingWorker** | getExternalApiSourceById; fetchSingleSourceForIntelligencePolling(apiSourceId, companyId) | Job has companyId; worker uses it for profile/runtime. |
| **schedulerService (enqueueIntelligencePolling)** | external_api_sources (is_active = true) only | **No.** Ignores company_api_configs. Polls all active sources; companyId in enqueued job is currently null. |

### 3.3 Data Flow (Company vs Global)

- **Enablement:** company_api_configs.enabled is the single source of truth for “is this API enabled for this company?”. external_api_user_access no longer stores is_enabled.
- **List for company:** getPlatformConfigs(companyId) and getEnabledApis(companyId) both use getEnabledApiIdsFromCompanyConfig(companyId) and return only enabled APIs (plus company-specific sources).
- **Polling:** Scheduler loads all active external_api_sources and enqueues jobs with companyId: null. So **polling is not aligned with company enablement**; every active source is polled regardless of which companies enabled it.
- **Themes:** getThemesForCompany(companyId) applies company config (include/exclude) per API source; only themes from enabled APIs are effectively visible when combined with getPlatformConfigs/getEnabledApis on the API side.

---

## 4. Database & Schema

### 4.1 Tables

| Table | Purpose | Company-scoped |
|-------|---------|----------------|
| external_api_sources | Registry of APIs (name, base_url, auth, is_preset, company_id, etc.) | Rows can be global (company_id null) or per-company. |
| company_api_configs | Per-company config: enabled, polling_frequency, priority, limits, purposes, include_filters, exclude_filters | Yes. Unique (company_id, api_source_id). FK to external_api_sources ON DELETE CASCADE. |
| external_api_user_access | User overrides: api_key_env_name, headers_override, query_params_override, rate_limit_per_min | user_id can be company-scoped (e.g. company:{id}). No is_enabled. |
| external_api_usage | Per source/user/date: request_count, success_count, failure_count, signals_generated | user_id can encode company/feature. |
| external_api_health | Per-source health (reliability, freshness, last test) | No. |
| external_api_source_requests | User-submitted API requests; workflow status | company_id, created_by_user_id. |

### 4.2 Cache

- **companyApiConfigCache:** Key company_api_config:{companyId}, TTL 5 min. Used by getPlatformConfigs, getEnabledApis, company-config, theme filtering. Invalidated on config PUT/DELETE, access bulk/single enable/disable, and when an API source is updated/deleted (invalidateCompanyConfigCacheForApiSource).

---

## 5. Alignment With Company Needs

### 5.1 What Works

- Companies can enable/disable and configure (purpose, include/exclude filters, polling, limits) per API via company_api_configs.
- Theme relevance and filtering use company config per API source (no global merge of filters).
- Recommendation and campaign audit use only that company’s enabled APIs.
- UI has “Tune for company” and company-config modal; presets and approval queue are present.

### 5.2 Gaps

1. **Polling vs company enablement**  
   Scheduler enqueues all active external_api_sources. It does not consider company_api_configs.enabled. So:
   - Cost and load are not tied to “which companies enabled which APIs.”
   - If the product intent is “only poll sources that at least one company has enabled,” the scheduler should be changed to derive source list from company_api_configs (e.g. distinct api_source_id where enabled = true) or from getEnabledApis per company and then dedupe.

2. **Per-company polling frequency**  
   company_api_configs.polling_frequency is stored and validated by plan but is **advisory**: the global scheduler runs on a fixed interval (e.g. 2h). To align consumption with company needs, a future scheduler could:
   - Respect polling_frequency per company/API (e.g. daily vs 2h),
   - Or at least use it for priority/ordering when enqueueing.

3. **Platform strategies**  
   GET /api/external-apis/platforms is SUPER_ADMIN-only. If company admins or other roles need to read platform strategies for their company, access should be broadened (e.g. requireExternalApiAccess with companyId).

4. **Invited admins**  
   Approval and source edit routes (requests/[id], [id]) do not use getCompanyRoleIncludingInvited, so invited company admins get 403. Aligning with “company needs” means they should be able to approve requests and edit their company’s API sources.

5. **Clear error messages**  
   After the recent fixes, access and index return `detail` on 500. Other routes (presets, company-config, requests, [id]) could return the same shape so that debugging and support are consistent.

---

## 6. Recommendations

### 6.1 Immediate (vulnerabilities & consistency)

1. **Add getCompanyRoleIncludingInvited** to:
   - `pages/api/external-apis/requests/[id].ts` (approve/reject),
   - `pages/api/external-apis/[id].ts` (GET/PUT/DELETE when company-scoped),
   so that invited company admins are not 403’d.

2. **Validate companyId** where appropriate: ensure the authenticated user has a role (or invited role) for the given companyId before performing mutations or returning company-scoped data. Today this is implied by getUserRole/getCompanyRoleIncludingInvited returning a role only for allowed companies; document this and consider a single helper (e.g. requireCompanyAccess(companyId)) that returns 403 if the user has no access.

3. **Standardize 500 responses** across external-apis routes: e.g. `{ error: string, detail?: string }` and log server-side.

### 6.2 Short-term (company-aligned consumption)

4. **Document or change polling behavior:** Either document that “polling is global; company enablement only affects which APIs appear and are used in recommendations/themes,” or change enqueueIntelligencePolling to only enqueue sources that have at least one company_api_config with enabled = true (and optionally respect company-level polling_frequency for priority).

5. **Relax /platforms** if needed: Allow company-scoped read for users with requireExternalApiAccess(companyId) (e.g. COMPANY_ADMIN, ADMIN) so they can read platform strategies for their company without being SUPER_ADMIN.

### 6.3 Medium-term (product)

6. **Per-company polling:** Implement scheduler logic that uses company_api_configs.polling_frequency (and plan limits) so that companies with “daily” do not get more frequent polls than configured, or so that high-priority company configs are polled first.

7. **Usage and limits:** Enforce company_api_configs.daily_limit and signal_limit where signals or API calls are attributed to a company (e.g. in recommendation or polling paths), and expose usage in the Usage Analytics tab (signals_generated is already present; ensure it is visible and correct).

8. **Connector framework (optional):** If different APIs need different adapters, introduce a small connector layer (e.g. by source type or category) for fetch/normalize, while keeping a single pipeline and company-scoped config as today.

---

## 7. File Reference

| Area | Files |
|------|--------|
| API routes | pages/api/external-apis/index.ts, access.ts, company-config.ts, presets.ts, requests.ts, requests/[id].ts, [id].ts, [id]/test.ts, health-summary.ts, platforms.ts |
| Services | backend/services/externalApiService.ts, companyApiConfigCache.ts, companyApiConfigService.ts, companyTrendRelevanceEngine.ts |
| Scheduler / worker | backend/scheduler/schedulerService.ts, backend/queue/intelligencePollingQueue.ts, backend/workers/intelligencePollingWorker.ts |
| Consumers | backend/services/recommendationEngineService.ts, campaignAuditService.ts |
| UI | pages/external-apis.tsx, pages/external-apis-access.tsx |
| DB | database/company_api_configs.sql, external-api-sources.sql, external-api-user-access.sql, external_api_usage_signals_generated.sql, external_api_requests_workflow.sql, signal_clusters_source_api_id.sql, external_api_hardening.sql |

---

## 8. Fixes Applied in This Audit Cycle (Pre-Implementation)

- **GET /requests 403:** getCompanyRoleIncludingInvited fallback; canManage sees all company requests.
- **POST /access 500:** Skip external_api_user_access when only preset selection; try/catch and `detail` in 500; safe body handling.
- **Empty list after save:** getPlatformConfigs fallback to fetch by enabled ids; skipCache=1 after save; cache invalidation.
- **Bulk access 500:** Response includes `detail` (configError.message).
- **Requests fallback filter:** By company_id and, for non-managers, by created_by_user_id.

---

## 9. Fixes Implemented (Post-Audit: Immediate + Short + Medium)

### Immediate (vulnerabilities & consistency)
- **requests/[id].ts:** Added `getCompanyRoleIncludingInvited` fallback so invited company admins can approve/reject requests; all 500 responses now include `detail`.
- **[id].ts:** Added `getCompanyRoleIncludingInvited` fallback for GET/PUT/DELETE; all 500 responses now include `detail`.
- **Standardized 500 responses:** All external-apis routes (company-config, requests, presets, index, health-summary, platforms, [id]/test, test.ts, validate) now return `{ error: string, detail?: string }` on 500.

### Short-term (company-aligned consumption)
- **enqueueIntelligencePolling:** Only enqueues sources that have at least one `company_api_config` with `enabled = true` (company-aligned polling).
- **GET /api/external-apis/platforms:** Auth relaxed to allow any user with company access (getUserRole + getCompanyRoleIncludingInvited); no longer SUPER_ADMIN-only when `companyId` is provided.

### Medium-term (product)
- **Scheduler priority:** Company `polling_frequency` (realtime, 2h, 6h, daily, weekly) is used when enqueueing: job priority is `min(reliability_priority, polling_priority)` so company-configured “daily”/“weekly” are not over-polled.
- **Company limits exposure:** GET /api/external-apis (company scope) now returns `company_limits: { daily_limit, signal_limit }` per API from `company_api_configs` for the current company (Usage Analytics can show “used vs limit”).
- **Company limits enforcement:** `checkCompanyApiLimitsForPolling(companyId, apiSourceId)` in externalApiService; intelligence polling worker calls it when `companyId` is set and skips fetch if over `daily_limit` or `signal_limit` (ready for future per-company jobs).

This audit should be used to close any remaining auth/consistency gaps and to align polling and product behavior with company needs.

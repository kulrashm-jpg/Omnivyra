# External API Intelligence Configuration System — Implementation & Audit

**Scope:** Intelligence APIs for market intelligence, competitor monitoring, and campaign opportunity detection.  
**Out of scope:** Social media publishing APIs (LinkedIn, Facebook, etc.) — managed in Social Media Integration.

---

## PHASE 1 — AUDIT SUMMARY

### 1.1 Existing Components

| # | Component | Status | Location / Notes |
|---|-----------|--------|------------------|
| 1 | **External API page** | ✅ Exists (two pages) | `pages/external-apis.tsx` (Super Admin / platform catalog), `pages/external-apis-access.tsx` (company-facing). Dashboard links to `/external-apis`. |
| 2 | **Global preset API configuration** | ✅ Exists | `backend/services/externalApiPresets.ts` — 4 presets (YouTube Trends, YouTube Shorts, NewsAPI Headlines, NewsAPI Everything, SerpAPI Google Trends, SerpAPI Google News, etc.). Presets imported via POST to create rows in `external_api_sources` with `is_preset: true`. Platform scope: GET/POST `/api/external-apis?scope=platform`, `/api/external-apis/presets?scope=platform`. |
| 3 | **Custom API request system** | ✅ Exists (partial) | `external_api_source_requests` table; POST `/api/external-apis/requests` to submit; GET to list. Status: `pending` (default), with `rejection_reason`, `approved_by_user_id`, `approved_at`. **No** multi-step approval (pending_admin_review → approved_by_admin → sent_to_super_admin → approved). **No** `company_id` on requests in schema (code has fallbacks when column missing). |
| 4 | **API approval queue** | ⚠️ Partial | Requests exist; approve/reject in `pages/api/external-apis/requests/[id].ts`. **Missing:** Queue states (pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected). Single “pending” → approved/rejected flow only. No company-admin approval before Super Admin. |
| 5 | **API usage analytics** | ✅ Exists | `external_api_usage` (per api_source_id, user_id, usage_date: request_count, success_count, failure_count, last_*). APIs return `usage_summary`, `usage_daily`, `usage_by_feature`, `usage_by_user` in index/access. **Missing:** signals-generated count, polling frequency display, “estimated API cost impact,” and dedicated Usage Analytics tab content (metrics exist but not grouped as “Usage Analytics” section). |
| 6 | **Connector framework** | ❌ Not present for intelligence | No `/connectors` directory for intelligence APIs (google-trends, serp-api, news-api, rss-feed, industry-api). `externalApiService` builds HTTP requests from `external_api_sources` (base_url, method, headers, query_params, auth) and normalizes via `trendProcessingService` — **no** pluggable `authenticate()` / `fetch_data()` / `normalize_signals()` per connector. Community-AI connectors (`pages/api/community-ai/connectors/*`) are for **social OAuth only**, not intelligence. |
| 7 | **Signal ingestion pipelines** | ✅ Exists | Intelligence polling: `intelligencePollingQueue`, `intelligencePollingWorker`, `enqueueIntelligencePolling()` in scheduler (every 2h). Worker calls `fetchSingleSourceForIntelligencePolling` → `insertFromTrendApiResults` (intelligence_signals). Downstream: signal clustering → signal_intelligence → strategic_themes → campaign_opportunities. **Not** connector-based; single generic fetch + trend normalization. |
| 8 | **API configuration database tables** | ✅ Exists (different shape) | See § 1.2 below. |

### 1.2 Database Schema Currently Used

| Table | Purpose |
|-------|---------|
| **external_api_sources** | API registry: id, name, base_url, purpose, category, is_active, method, auth_type, api_key_env_name, headers, query_params, is_preset, retry_count, timeout_ms, rate_limit_per_min, company_id (nullable), platform_type, etc. **No** provider, api_category, authentication_type, is_global, status as separate semantics; purpose/category exist. |
| **external_api_health** | Per-source health: api_source_id, last_success_at, last_failure_at, success_count, failure_count, freshness_score, reliability_score, last_test_status, last_test_at, last_test_latency_ms. |
| **external_api_usage** | Per source/user/date: api_source_id, user_id, usage_date, request_count, success_count, failure_count, last_* fields. UNIQUE(api_source_id, user_id, usage_date). |
| **external_api_user_access** | Per user/source: api_source_id, user_id, is_enabled, api_key_env_name, headers_override, query_params_override, rate_limit_per_min. Company default APIs driven by company-level config (e.g. default API list); access can be scoped by company in app logic. |
| **external_api_source_requests** | User-submitted requests: id, name, base_url, purpose, category, method, auth_type, status (e.g. pending), created_by_user_id, rejection_reason, approved_by_user_id, approved_at. **No** company_id in schema (code sometimes filters by company_id — column may have been added in migration not shown). **No** approval workflow states. |

**Not present:**  
- `apis` (prompt’s name) — equivalent is `external_api_sources`.  
- `tenant_api_config` (tenant_id, api_id, enabled, polling_frequency, priority, daily_limit).  
- `tenant_api_purpose_config` (tenant_id, api_id, purpose, enabled).  
- `tenant_api_queries` (tenant_id, api_id, query_type, query_value).  
- `tenant_api_filters` (tenant_id, api_id, filter_type include/exclude, filter_value).  

**Intelligence pipeline tables (already in place):**  
- intelligence_signals, signal_topics, signal_companies, signal_keywords, signal_influencers  
- signal_clusters, signal_intelligence, strategic_themes, campaign_opportunities  
- theme_company_relevance  

---

## 1.3 Missing Components

1. **Tenant/company-specific API configuration snapshot**  
   - No table(s) for: per-company enabled APIs, polling_frequency, priority, daily_limit, signal limit.  
   - Current: `external_api_user_access` is user-level; company “default” APIs are applied in app logic (e.g. external-apis-access), not a dedicated tenant_api_config.

2. **Purpose and filter configuration per tenant/API**  
   - No tenant_api_purpose_config (multi-select purposes per API).  
   - No tenant_api_queries / tenant_api_filters (include/exclude keywords, topics, competitors, industries, etc.).  
   - Purpose is a single field on the source; no “Trend Campaign Detection | Market Pulse | Competitor Intelligence | …” multi-select with tooltips.

3. **Approval queue with full workflow**  
   - No states: pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected.  
   - No company-admin approval step before “sent to Super Admin.”

4. **Polling configuration and plan-based restrictions**  
   - No polling_frequency (Real-time / 2h / 6h / Daily / Weekly) stored per tenant/API.  
   - Scheduler uses a global 2h interval for intelligence polling; no per-company or per-API schedule.  
   - No link to pricing plan (Basic → Daily only, Professional → 6h, Enterprise → 2h or Real-time).

5. **API configuration modal (company)**  
   - No modal with: API Purpose (multi-select + tooltips), Include/Exclude filters, Polling configuration, API limits (daily request limit, signal generation limit, priority), Save as company snapshot.  
   - external-apis-access has “Configure” but payload is user-level overrides (headers, query_params, rate_limit), not the above.

6. **Connector framework for intelligence APIs**  
   - No directory structure `/connectors/{google-trends, serp-api, news-api, rss-feed, industry-api}` with authenticate(), fetch_data(), normalize_signals().  
   - Single generic fetch in externalApiService + trend normalization; no per-connector adapters.

7. **Usage analytics section**  
   - Metrics exist in API responses and on cards. No dedicated “Usage Analytics” tab/section with: total API requests, signals generated, polling frequency, usage over time, API priority usage, estimated API cost impact.

8. **Guidance/tooltips on every configuration field**  
   - Purpose, Include/Exclude filters, Polling, Limits lack the specified tooltip/guidance text (e.g. “Signals from this API will be used to generate strategic theme cards…”).

---

## 1.4 Components That Need Restructuring

| Component | Current | Suggested direction |
|-----------|---------|---------------------|
| **Page structure** | external-apis has tabs: global, request-new, queue, usage (activeTab). external-apis-access is a single view (APIs list, request form, usage on cards). | Align both to the same four sections (Global Preset APIs, Request New API, Approval Queue, Usage Analytics) as tabs or panels. Company page: show only Global Preset APIs + Request + Queue + Usage; platform page: same structure with platform-wide data. |
| **Request/approval model** | Single status (pending/approved/rejected); optional company_id. | Add status enum: pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected. Add company_id to external_api_source_requests if missing. Add actions: company admin approves → sent_to_super_admin; Super Admin approves/rejects. |
| **Company API configuration** | User-level access (external_api_user_access) + “company default” list in UI. | Introduce tenant-level config (new table(s) or columns): enabled, polling_frequency, priority, daily_limit, purposes[], include/exclude filters, so “configuration modal” saves a company snapshot. |
| **Preset vs global semantics** | is_preset on source; “platform” scope in APIs. | Optional: add is_global and/or status to align with prompt (apis.is_global, apis.status). Keep is_preset for “created from preset” vs “custom”. |

---

## PHASE 2 — EXTERNAL API PAGE STRUCTURE (TARGET)

The External API page must contain four sections (tabs or panels):

1. **Global Preset APIs** — Platform-provided APIs; companies can enable/disable and open a **configuration modal** (see § Section 1 below).  
2. **Request New API** — Form: API Name, Provider, API Category, Connection Type (REST/Webhook/RSS), Authentication Type, Documentation URL, Expected Signal Purpose, Sample API response; on submit → status = pending_review (or pending_admin_review).  
3. **Approval Queue** — List requests with states: pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected. Company admins approve and “Send to Super Admin”; Super Admin approves/rejects.  
4. **Usage Analytics** — Per configured API: total requests, signals generated, polling frequency, usage over time, priority usage, estimated cost impact.

**Current state:** external-apis.tsx already has `activeTab: 'global' | 'request-new' | 'queue' | 'usage'`. Content of each tab and the company-side page (external-apis-access) need to be aligned to the above and enhanced (modals, queue states, analytics section).

---

## SECTION 1 — GLOBAL PRESET APIs (ENHANCEMENTS)

- **Current:** Presets loaded from code (externalApiPresets); imported into external_api_sources. Platform page shows APIs; company page shows “Available APIs” and company default toggles.  
- **To add:**
  - **Configuration modal** when a company enables an API: API Purpose (multi-select + tooltips), Include Filters, Exclude Filters, Polling Configuration (with plan-based restrictions), API Limits (daily limit, signal limit, priority), Save → company-specific configuration snapshot (new tenant tables or equivalent).
  - **Purpose options** (multi-select): Trend Campaign Detection, Market Pulse Signals, Competitor Intelligence, Market News, Influencer Signals, Technology Signals, Keyword Intelligence. Each with hover tooltip (e.g. “Signals from this API will be used to generate strategic theme cards and campaign opportunities.”).
  - **Include/Exclude filters** (e.g. keywords, topics, competitors, industries, companies, influencers, technologies, geography) with tooltips.
  - **Polling:** Real-time / Every 2 hours / Every 6 hours / Daily / Weekly, restricted by pricing plan (Basic → Daily only, etc.) and tooltip about cost.
  - **Limits:** daily request limit, signal generation limit, priority (HIGH/MEDIUM/LOW) with tooltip.

---

## DATABASE SCHEMA UPDATES (MINIMAL)

Prompt tables use names `apis`, `tenant_api_config`, etc. Current code uses `external_api_sources` and user_access. Prefer **extending** current schema unless a full rename is required.

### Option A — New tables (prompt-aligned)

- **apis** — Only if consolidating/renaming; otherwise keep **external_api_sources** and add columns if needed (e.g. provider, api_category, authentication_type, is_global, status).  
- **tenant_api_config** — tenant_id (company_id), api_id (→ external_api_sources.id), enabled, polling_frequency, priority, daily_limit, signal_limit (optional), created_at.  
- **tenant_api_purpose_config** — tenant_id, api_id, purpose (e.g. trend_campaign_detection), enabled.  
- **tenant_api_queries** — tenant_id, api_id, query_type, query_value (e.g. keyword, topic).  
- **tenant_api_filters** — tenant_id, api_id, filter_type ('include' | 'exclude'), filter_value (JSONB or key/value).

### Option B — Minimal extension (no new tables)

- Add to **external_api_user_access** or new **company_api_config** (company_id, api_source_id): polling_frequency, priority, daily_limit, purposes (JSONB array), include_filters (JSONB), exclude_filters (JSONB).  
- Keep **external_api_source_requests**; add **status** enum and **company_id** if missing; add **approved_by_admin_at**, **sent_to_super_admin_at** for workflow.

### Recommendation

- Add **company_id** to **external_api_source_requests** if not present.  
- Extend status to: **pending_admin_review** | **approved_by_admin** | **sent_to_super_admin** | **approved** | **rejected**.  
- Add one **tenant/company API config** table (or equivalent columns) for: company_id, api_source_id, enabled, polling_frequency, priority, daily_limit, purposes (JSONB), include_filters (JSONB), exclude_filters (JSONB).  
- Optionally add **tenant_api_queries** and **tenant_api_filters** if you need granular query/filter rows; otherwise store as JSONB in the config table.

---

## UI COMPONENTS TO IMPLEMENT

| Component | Description |
|-----------|-------------|
| **Tabs/Panels** | Ensure both external-apis and external-apis-access expose the same four sections (Global Preset APIs, Request New API, Approval Queue, Usage Analytics). |
| **Configuration modal** | Opened when enabling a preset/API for the company. Sections: API Purpose (multi-select + tooltips), Include Filters, Exclude Filters, Polling Configuration (dropdown + plan warning), API Limits, Save. |
| **Purpose multi-select** | Checkboxes or multi-select with tooltips for each purpose (Trend Campaign Detection, Market Pulse, Competitor Intelligence, etc.). |
| **Include/Exclude filter inputs** | Fields (keywords, topics, competitors, industries, etc.) with tooltips. |
| **Polling dropdown** | Real-time / 2h / 6h / Daily / Weekly; disabled options based on plan; tooltip on “Reducing polling intervals increases API usage and infrastructure cost.” |
| **Approval Queue table** | Rows: request name, status (pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected), actions (Approve / Send to Super Admin / Reject). Company admins see company requests; Super Admin sees all. |
| **Usage Analytics panel** | Per-API (or per-company-API) metrics: total API requests, signals generated, polling frequency, usage over time (chart or table), API priority usage, estimated API cost impact (formula/placeholder). |
| **Guidance/tooltips** | Add tooltips to every configuration field (purpose, filters, polling, limits) as specified in the prompt. |

---

## CONNECTOR FRAMEWORK VALIDATION

**Current:**  
- No `/connectors` directory for intelligence APIs.  
- **externalApiService** builds one HTTP request per `external_api_sources` row (base_url, method, headers, query_params, auth from env); **trendProcessingService** normalizes responses to trend signals; **intelligenceSignalStore** persists to intelligence_signals.  
- Community-AI connectors are OAuth for social posting only.

**Prompt expects:**  
- Directory structure: `/connectors` with subdirs google-trends, serp-api, news-api, rss-feed, industry-api.  
- Each connector: authenticate(), fetch_data(), normalize_signals().

**Options:**  
1. **Introduce connector adapters** — For each preset/source type, add a small adapter that implements fetch_data() and normalize_signals() (authenticate optional), and have the worker call the adapter by category/name. This allows per-connector logic (e.g. SerpAPI vs NewsAPI response shape) without changing the rest of the pipeline.  
2. **Keep generic fetch** — Continue single generic HTTP fetch + single normalization path; document that “connector” is the row in external_api_sources and normalization is in trendProcessingService. Add new tables/config for purpose and filters; keep pipeline as is.

**Recommendation:**  
- **Minimal:** Keep generic fetch; add tenant config (purpose, filters, polling, limits) and UI.  
- **Full:** Add connector directory and interface; register adapters for existing presets (YouTube, NewsAPI, SerpAPI) and call them from the intelligence worker.

---

## SIGNAL PIPELINE (CURRENT)

- **External API** → **externalApiService** (fetch by source) → **trendProcessingService** (normalize) → **intelligenceSignalStore** (intelligence_signals) → **signalClusterEngine** → **signalIntelligenceEngine** → **strategic_themes** → **campaign_opportunities**.  
- Signals store: source_api_id, signal_type, topic, entities (topics, companies, keywords, influencers), timestamp, confidence_score, cluster_id.  
- No change required for “signals must store source API, signal type, topic, entities, timestamp, confidence, cluster_id” — already satisfied.

---

## OUTPUT SUMMARY

1. **Audit of current implementation** — § Phase 1 (existing components, DB schema, missing components, restructuring).  
2. **Identified gaps** — Tenant config (purpose, filters, polling, limits), approval workflow states, configuration modal, Usage Analytics section, connector framework, guidance/tooltips.  
3. **Minimal required changes** — (a) Add/extend company-level config (tenant_api_config or equivalent) for purpose, filters, polling, limits. (b) Add approval states and company_id to external_api_source_requests; add company-admin approval step. (c) Add Configuration modal and Usage Analytics section to UI. (d) Optionally add connector adapters.  
4. **Database schema updates** — Add company_id and status enum to external_api_source_requests; add one company/tenant API config table (or columns) for enabled, polling_frequency, priority, daily_limit, purposes, include_filters, exclude_filters; optionally tenant_api_queries / tenant_api_filters.  
5. **UI components to implement** — Tabs/sections (four sections), Configuration modal (purpose, include/exclude, polling, limits), Approval Queue table with workflow actions, Usage Analytics panel, tooltips/guidance on all fields.  
6. **Connector framework validation** — Current: no per-connector directory; generic fetch + normalization. Optional: add /connectors with authenticate/fetch_data/normalize_signals per source type; minimal path: keep generic fetch and add config/UI only.

---

## BOUNDARY REMINDER

**Social media publishing APIs** (LinkedIn, Facebook, Instagram, Twitter, YouTube for posting, etc.) are **not** part of this External API Intelligence configuration. They remain in the Social Media Integration / Community AI connectors. This audit and implementation scope apply only to **intelligence** APIs (trends, news, SERP, technology feeds, competitor/market signals) used for strategic themes and campaign opportunities.

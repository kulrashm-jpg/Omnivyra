# External API Intelligence System — Codebase Audit Report

**Purpose:** Assess existing codebase readiness for implementing an External API Intelligence System.  
**Scope:** Signals/trends, API connectors, workers/queues, campaign intelligence, theme/signal engines, polling, RSS/webhooks, schema normalization, and campaign-related signal storage.  
**No implementation performed; audit only.**

---

## SECTION 1 — Existing Infrastructure

Mapping of current components to the target system layers:

### 1.1 Connector Layer

| Component | Location | Notes |
|-----------|----------|--------|
| **External API catalog & execution** | `backend/services/externalApiService.ts` | Fetches from `external_api_sources`; builds requests (query_params: geo, category); rate limiting, retry, timeout; `fetchTrendsFromApis()` returns `TrendSignal[]`. |
| **External API registry (DB)** | `database/external-api-sources.sql`, `external_api_sources` | id, name, base_url, purpose, auth_type, api_key_env_name, rate_limit_per_min, timeout_ms, platform_type, company_id, etc. |
| **User/tenant access** | `external_api_user_access`, `externalApiService.getExternalApiSourcesForUser()` | Per-user/company enablement and overrides. |
| **Validation & health** | `pages/api/external-apis/[id]/validate.ts`, `externalApiHealthService.ts` | Validate source; update `external_api_health` (freshness_score, reliability_score). |
| **Community-AI connectors** | `pages/api/community-ai/connectors/*` (LinkedIn, Facebook, Instagram, Twitter, Reddit) | OAuth connectors for social posting; **not** Virality External API catalog (explicitly documented in code). |

**Overlap:** Strong. Connector layer exists for trend/signal APIs (catalog, auth, health, usage). No generic “connector framework” for arbitrary intelligence sources (e.g. RSS, webhooks) beyond this.

---

### 1.2 Worker Queue

| Component | Location | Notes |
|-----------|----------|--------|
| **BullMQ + Redis** | `backend/queue/bullmqClient.ts` | Queues: `publish`, `engagement-polling`. Workers: publish processor, engagement-polling processor. |
| **Queue jobs (DB)** | `queue_jobs` (scheduler), `recommendation_jobs_v2`, `market_pulse_jobs_v1`, `lead_jobs_v1` | Job rows in Postgres; BullMQ for execution. |
| **Scheduler** | `backend/scheduler/schedulerService.ts`, `cron.ts` | Finds due posts, enqueues publish jobs; enqueues engagement-polling every 10 min. |
| **Lead queue** | `backend/queue/leadQueue.ts`, `backend/workers/leadWorker.ts` | Dedicated `lead-jobs` queue and worker. |
| **Recommendation v2** | `processRecommendationJobV2()` in `recommendationJobProcessor.ts` | Invoked from API after insert into `recommendation_jobs_v2`; no separate BullMQ queue for v2 (fire-and-forget in process). |
| **Market Pulse** | `marketPulseJobProcessor.ts` | Similar pattern: job row + processing (queue/worker pattern may vary). |

**Overlap:** Worker/queue infrastructure exists for publish, engagement polling, and lead jobs. **No dedicated queue or cron for “external API intelligence” polling** (e.g. scheduled trend/signal fetch). Recommendation and market-pulse jobs are user-triggered or one-off.

---

### 1.3 Signal Processor

| Component | Location | Notes |
|-----------|----------|--------|
| **Trend normalization** | `backend/services/trendProcessingService.ts` | `normalizeTrendSignals()`, `mergeTrendsAcrossSources()`, `scoreByFrequency()`, `tagByPlatform()`; produces `TrendSignalNormalized`. |
| **Trend alignment** | `backend/services/trends/trendAlignmentService.ts` | `buildTrendAssessments()`, `alignTrendsToPlans()`, `getTrendAlerts()`; uses `fetchTrendsFromApis()` and keyword/weekly-theme relevance. |
| **Trend drift** | `backend/services/trendDriftService.ts`, `pages/api/trends/drift-check.ts` | Compares previous trend snapshots to new signals; drift detection. |
| **Strategy scoring** | `backend/services/strategyScoringModifier.ts` | Uses `TrendSignalNormalized` and company DNA for strategy modifier. |
| **OmniVyra (optional)** | `backend/services/omnivyraClientV1.ts` | Trend ranking/relevance from external service; applied after normalization in `fetchTrendsFromApis()`. |
| **Legacy consolidation** | `backend/services/recommendationConsolidator.ts` | Reads `recommendation_raw_signals`, aggregates by region, runs consolidation (LLM); built for legacy `recommendation_jobs`. |

**Overlap:** Solid signal processing for trends: normalize → merge → score → align to plans. No generic “signal processor” abstraction for non-trend sources (e.g. competitor, RSS).

---

### 1.4 Signal Storage

| Component | Location | Notes |
|-----------|----------|--------|
| **Trend snapshots** | `trend_snapshots` table, `backend/db/campaignVersionStore.ts` (`saveTrendSnapshot`, `getTrendSnapshots`) | company_id, campaign_id, snapshot (JSONB); used for drift and audit. |
| **Campaign versions** | `campaign_versions` | campaign_snapshot (JSONB) can hold weekly_plan, trend_influence, etc.; not a dedicated signal store. |
| **Recommendation raw signals (legacy)** | `recommendation_raw_signals` | job_id, region_code, api_id, normalized_trends_json, raw_payload_json, status; used by legacy recommendation flow only. |
| **Recommendation snapshots** | `recommendation_snapshots` | Per-card recommendations; lifecycle fields: status, regions, source_signals_count, signals_source (optional). |
| **Lead signals** | `lead_signals_v1` | Lead engine output (e.g. job_id, problem_domain); not trend/API signals. |
| **External API usage** | `external_api_usage` | Per api_source_id, user_id, usage_date: request/success/failure counts; not payload/signal storage. |

**Overlap:** Trend snapshots and legacy raw_signals provide limited signal storage. **No unified, first-class “intelligence signal” store** (e.g. one table for all normalized signals from external APIs with source, type, payload, timestamp). Campaign-level signal storage is embedded in snapshots/versions, not a dedicated schema.

---

### 1.5 Theme Engine

| Component | Location | Notes |
|-----------|----------|--------|
| **Theme generation (trend-based)** | `backend/services/opportunityGenerators.ts` — `generateTrendOpportunities()` | Uses company context, strategic payload, regions; can use cluster inputs; outputs `OpportunityInput[]` (title, summary, etc.) as “themes”. |
| **Theme suggestion API** | `pages/api/campaigns/[id]/suggest-themes.ts`, `regenerate-blueprint.ts` | Calls `generateTrendOpportunities()` for campaign themes. |
| **Weekly themes (simple)** | `pages/api/campaigns/create-12week-plan.ts` — `generateWeeklyThemes()` | Local function: parses AI content and builds theme list; not fed by external API signals. |
| **Trend alignment to plans** | `trendAlignmentService.alignTrendsToPlans()` | Maps trend assessments to weekly plan (trend_influence, trend_alignment). |

**Overlap:** Theme generation exists and can consume strategic context and cluster inputs; **direct wiring from a dedicated “signal store” or scheduled intelligence pipeline is not present**. Themes are generated on-demand from live API calls or context, not from a pre-aggregated signal table.

---

### 1.6 Campaign Engine

| Component | Location | Notes |
|-----------|----------|--------|
| **Campaign intelligence** | `backend/services/campaignIntelligenceService.ts`, `CampaignRoiIntelligenceService`, `CampaignOptimizationIntelligenceService` | Execution/ROI/optimization summaries; reads campaign_versions, trend_snapshots. |
| **Campaign audit** | `backend/services/campaignAuditService.ts` | Uses `buildTrendAssessments()`, `getTrendSnapshots()`, trend_used/ignored in audit output. |
| **Recommendation engine** | `recommendationEngineService.ts`, `recommendationJobProcessor.ts` | Uses `fetchTrendsFromApis()` (and company/campaign context) for recommendations; campaign_intelligence and recent_campaign_intelligence used. |
| **Blueprint / 12-week plan** | `campaignBlueprintService.ts`, 12-week plan APIs | Plans can reference trends; data from versions/snapshots, not a dedicated signal DB. |

**Overlap:** Campaign and recommendation logic already consume trend signals and snapshots. **No single “campaign intelligence pipeline” that runs on a schedule and writes to a shared signal store** for all consumers.

---

## SECTION 2 — Missing Core Components

The following are **not** present or only partially present for a full External API Intelligence System:

1. **Scheduled / background polling for external APIs**  
   - No cron or queue job that periodically calls `fetchTrendsFromApis()` (or equivalent) and writes to a canonical signal store.  
   - Trend fetches are on-demand (drift-check, recommendation job, optimize-week, etc.).

2. **Unified intelligence signal store**  
   - No single table (e.g. `intelligence_signals` or `external_api_signals`) with: source_id, signal_type, normalized_payload, received_at, company_id, campaign_id (optional).  
   - Current: trend_snapshots (high-level), recommendation_raw_signals (legacy, job-scoped).

3. **Connector abstraction for non-trend sources**  
   - No pluggable “connectors” for RSS, webhooks, or other non–external_api_sources.  
   - RSS exists only for blog (`pages/api/blog/rss.ts`). Webhooks are Community-AI outbound (not inbound intelligence).

4. **Inbound webhook ingestion for intelligence**  
   - No endpoint or worker to receive external webhooks (e.g. trend alerts) and normalize + store them as signals.

5. **Dedicated worker/queue for “intelligence” jobs**  
   - No queue name such as `intelligence-polling` or `signal-ingestion` with a worker that pulls from external APIs (or webhooks) and writes to the signal store.

6. **Market intelligence / competitor monitoring**  
   - No code paths or tables for “market intelligence”, “trend detection”, or “competitor monitoring” (grep returned no matches).

7. **Theme engine fed by stored signals**  
   - Theme generation does not read from a shared, time-series signal table; it uses live API or in-memory context.

8. **Signal retention / TTL policy**  
   - No documented or implemented retention or TTL for trend_snapshots or raw signals; no cleanup jobs.

9. **Idempotent, incremental signal ingestion**  
   - No design for “last run time” per source or idempotency keys to avoid duplicate signal rows when polling.

---

## SECTION 3 — Database Gap Analysis

### 3.1 Tables that exist and are relevant

| Table | Purpose | Relevant to intelligence |
|------|---------|---------------------------|
| `external_api_sources` | API catalog | Yes — connector config. |
| `external_api_health` | Per-source health | Yes — reliability/freshness. |
| `external_api_usage` | Per-day usage counts | Partial — no payload. |
| `external_api_user_access` | Per-user/tenant access | Yes. |
| `external_api_source_requests` | Request log (e.g. status) | Partial — not payload store. |
| `trend_snapshots` | company_id, campaign_id, snapshot JSONB | Yes — but high-level snapshots, not per-signal rows. |
| `campaign_versions` | campaign_snapshot (plan + metadata) | Indirect — stores derived plan, not raw signals. |
| `recommendation_raw_signals` | job_id, api_id, normalized_trends_json, raw_payload_json | Yes — but legacy, job-bound; v2 flow does not use it. |
| `recommendation_snapshots` | Recommendation cards; source_signals_count, signals_source | Partial — summary only. |
| `lead_signals_v1` | Lead engine output | No — different domain. |
| `queue_jobs` | Publish/scheduler jobs | No — not for intelligence. |
| `recommendation_jobs_v2`, `market_pulse_jobs_v1`, `lead_jobs_v1` | Async job state | Yes — pattern for async intelligence jobs. |

### 3.2 Gaps vs a typical “External API Intelligence” architecture

| Requirement | Current state | Gap |
|-------------|----------------|-----|
| **Normalized signal table** | Only trend_snapshots (aggregate) and recommendation_raw_signals (legacy, job-scoped) | New table(s) for normalized signals: source_id, type, payload, received_at, company_id, optional campaign_id, idempotency key. |
| **Polling run log** | Engagement polling has no DB log; cron state in-memory | Optional: e.g. `intelligence_poll_runs` (source_id, started_at, completed_at, status, signal_count). |
| **RSS / webhook source registry** | None | Tables or columns for non–HTTP-API sources (e.g. webhook URL, RSS URL, last_fetched_at). |
| **Signal–campaign linkage** | Via trend_snapshots.campaign_id and campaign_snapshot content | No direct FK or table linking signal rows to campaigns for “signals used by this campaign”. |
| **Retention / TTL** | Not defined | No columns or jobs for expiry/archival of old signals or snapshots. |

### 3.3 Schema normalization patterns in code

- **Trends:** `trendProcessingService` normalizes to `TrendSignal` / `TrendSignalNormalized`; topic lowercased, merged by topic, scored.  
- **Recommendation:** `recommendationExecutionService` uses `normalizeExternalTrends()` and writes to `recommendation_raw_signals`.  
- **Platform/content:** `weeklyLoadBalancer`, `structuredPlanScheduler`, `capacityExpectationValidator` use platform/content-type normalizers.  
- **No shared “intelligence signal” DTO or DB schema** used across trend, competitor, and RSS-style sources.

---

## SECTION 4 — Refactoring Opportunities

Reusable building blocks for an External API Intelligence System:

1. **`externalApiService.ts`**  
   Reuse: source resolution, auth/env handling, rate limiting, `fetchTrendsFromApis()`, health updates, usage logging.  
   Extend: optional “connector type” (e.g. trend vs competitor vs RSS) and a shared “write to signal store” step after fetch.

2. **`trendProcessingService.ts`**  
   Reuse: normalize → merge → score → tag.  
   Extend: generalize to a “signal type” or allow other signal schemas (e.g. competitor alerts) with same pipeline pattern.

3. **`trendAlignmentService.ts`**  
   Reuse: relevance/novelty, alignment to weekly plans, trend alerts.  
   Extend: accept signals from a stored table (by time window) instead of only live `fetchTrendsFromApis()`.

4. **BullMQ + worker pattern**  
   Reuse: `bullmqClient.ts`, worker registration, job payload shape.  
   Add: e.g. `intelligence-polling` queue and worker that calls a “fetch and store” service.

5. **`campaignVersionStore` / `trend_snapshots`**  
   Reuse: save/get trend snapshots for drift and audit.  
   Extend: either add a lower-level signal table and keep snapshots as aggregates, or formalize snapshot schema to reference signal IDs.

6. **Legacy `recommendation_raw_signals`**  
   Reuse: schema concept (job_id, api_id, normalized_trends_json, raw_payload_json, status).  
   Refactor: consider a job-agnostic “intelligence_signals” table and have both legacy and new flows write to it (with job_id nullable or in a separate link table).

7. **Cron / scheduler**  
   Reuse: `cron.ts` and `schedulerService` pattern (intervals, enqueue).  
   Add: scheduled job that enqueues “intelligence poll” jobs per source or per company.

8. **Recommendation v2 flow**  
   Reuse: `recommendationJobProcessor` + `opportunityGenerators` + `generateTrendRecommendationForRegion()`.  
   Extend: optionally read from stored signals (e.g. “last 24h”) when available instead of only live fetch.

9. **Usage and health**  
   Reuse: `usageLedgerService`, `usageMeterService`, `externalApiHealthService`, `external_api_usage` / `external_api_health`.  
   No structural change needed for an intelligence pipeline that uses the same APIs.

10. **Normalization helpers**  
    Reuse: platform/keyword/content-type normalizers across services.  
    Add: one shared “intelligence signal” normalizer (and optional DB type) for all connector types.

---

## SECTION 5 — Implementation Risk Areas

1. **Two recommendation flows (legacy vs v2)**  
   Legacy: `recommendation_jobs` + `recommendation_raw_signals` + `recommendationConsolidator`.  
   V2: `recommendation_jobs_v2` + `opportunityGenerators` + no raw signal table.  
   **Risk:** Introducing a new signal store may require supporting both flows or migrating one; duplicate or inconsistent signal handling if not designed clearly.

2. **No scheduled external API polling**  
   All trend fetches are on-demand. Adding a background poller implies: cron/queue, error handling, backpressure, and possibly different rate limits.  
   **Risk:** Rate limits or cost if many companies/sources are polled frequently; need per-source or per-tenant scheduling.

3. **In-memory cron state**  
   `lastEngagementPollingEnqueue`, `lastOpportunitySlotsRun`, etc. are in-process.  
   **Risk:** Multiple cron instances or restarts can cause duplicate runs or missed runs; any scheduled intelligence job should use DB or distributed state for “last run” and idempotency.

4. **Redis dependency**  
   BullMQ requires Redis.  
   **Risk:** If Redis is unavailable, no queue processing; intelligence jobs would need the same availability story as publish/engagement.

5. **OmniVyra optional path**  
   When enabled, `fetchTrendsFromApis()` calls OmniVyra for ranking.  
   **Risk:** Stored signals that were “OmniVyra-enhanced” vs “raw” may need to be distinguished if replay or debugging is required.

6. **Schema evolution**  
   `trend_snapshots.snapshot`, `campaign_versions.campaign_snapshot`, and `recommendation_raw_signals.normalized_trends_json` are JSONB with no strict contract.  
   **Risk:** Adding a new signal type or schema can fragment consumers; a clear DTO and optional JSON schema for the new store would reduce drift.

7. **Community-AI vs External APIs**  
   Code explicitly separates “Community-AI connectors” from “Virality External APIs”.  
   **Risk:** Confusion or accidental coupling (e.g. treating OAuth social connectors as intelligence sources); keep boundaries documented and enforced.

8. **Engagement polling has no DB log**  
   Polling runs are not persisted.  
   **Risk:** Reusing this pattern for intelligence without a run log makes debugging and idempotency harder; recommend a run table or at least structured logs.

9. **Company vs tenant vs user scope**  
   external_api_sources can be platform-level or company-level; access is via company and user.  
   **Risk:** Intelligence jobs must clearly define scope (e.g. per company, per source) to avoid cross-tenant data and to align with usage metering.

10. **Theme engine not signal-driven**  
    Themes are generated from live context/API, not from a stored signal table.  
    **Risk:** Moving to “themes from stored signals” requires defining which signals feed which theme step and how often themes are refreshed vs signals updated.

---

## Summary Table

| Layer | Exists? | Notes |
|-------|---------|--------|
| Connector (external APIs) | Yes | externalApiService + external_api_sources + health + usage |
| Connector (RSS/webhook) | No | Only blog RSS and outbound webhooks |
| Worker queue | Partial | BullMQ for publish/engagement/lead; no intelligence queue |
| Signal processor | Yes | trendProcessingService, trendAlignmentService, drift |
| Signal storage | Partial | trend_snapshots, legacy recommendation_raw_signals; no unified store |
| Theme engine | Yes | opportunityGenerators; not fed by stored signals |
| Campaign engine | Yes | Consumes trends/snapshots; no scheduled pipeline |
| Scheduled API polling | No | All trend fetches on-demand |
| Market/competitor intelligence | No | Not implemented |
| Normalized signal schema | Partial | In-code DTOs; no single DB schema for all signal types |

---

*End of audit. No code or schema changes were made.*

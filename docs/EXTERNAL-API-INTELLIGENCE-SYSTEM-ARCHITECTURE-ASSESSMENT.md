# External API Intelligence System — Technical Architecture Assessment Report

**Purpose:** Technical assessment of the current implementation before any architectural changes.  
**Scope:** External API integrations, strategic theme generation, market signals, company configuration, admin controls, data storage, and reusable components.  
**Constraints:** No code modifications; analysis only.

---

## SECTION 1 — CURRENT API INTEGRATION ARCHITECTURE

### Files Responsible for External API Integrations

| File | Responsibility |
|------|----------------|
| `backend/services/externalApiService.ts` | Central API orchestration: fetch, rate limit, health, usage logging, normalization |
| `backend/services/trendNormalizationService.ts` | Source-specific normalization (YouTube, NewsAPI, Reddit, SerpAPI, generic) |
| `backend/services/externalApiCacheService.ts` | In-memory response cache (12 min TTL, key: apiId::geo::category::userId) |
| `backend/services/externalApiHealthService.ts` | Health tracking (freshness_score, reliability_score) |
| `backend/services/intelligenceSignalStore.ts` | Persistence of normalized signals to `intelligence_signals` |
| `backend/services/externalApiPresets.ts` | Hardcoded presets for YouTube, NewsAPI, SerpAPI, Reddit, Twitter, GDELT, HN, Stack Overflow |
| `pages/api/external-apis/index.ts` | REST API for listing, creating, validating external API sources |
| `pages/api/external-apis/[id]/validate.ts` | Single-source validation endpoint |
| `pages/api/trending/current.ts` | Fetches current trends (uses external API layer) |
| `pages/api/trends/fetch.ts` | Direct trend fetch via `fetchTrendsFromApis` |

### Services Calling SERP / YouTube / Google or Other Intelligence Sources

- **recommendationEngineService.ts** — Calls `fetchExternalApis()` for Trend Campaign recommendations (multi-region or single-region).
- **recommendationExecutionService.ts** — Calls `fetchExternalTrends()` per region for legacy recommendation jobs; normalizes via `normalizeExternalTrends()`.
- **recommendationScheduler.ts** — Calls `fetchTrendsFromApis()` for scheduled recommendation generation.
- **trendAlignmentService.ts** — Calls `fetchTrendsFromApis()` for drift detection and trend alignment.
- **campaignAuditService.ts** — Uses `getEnabledApis()`, `getExternalApiRuntimeSnapshot()` for audit metadata.
- **intelligencePollingWorker.ts** — Uses `fetchSingleSourceForIntelligencePolling()` for background polling (no direct fetch export; fetches single source).
- **recommendationSimulationService.ts** — Calls `fetchTrendsFromApis()` for simulation.
- **pages/api/campaigns/recommendations/optimize-week.ts** — Direct `fetchTrendsFromApis`.
- **pages/api/campaigns/optimize-week.ts** — Direct `fetchTrendsFromApis`.

### API Aggregation / Normalization Layers

1. **Query building** — `buildExternalApiRequest()` in `externalApiService.ts`:
   - Merges `query_params` from `external_api_sources` with `geo`, `category`.
   - Resolves placeholders `{{category}}`, `{{geo}}`, `{{YOUTUBE_API_KEY}}`, etc. from `runtimeValues` and `process.env`.

2. **Response normalization** — `trendNormalizationService.ts`:
   - `normalizeExternalTrends()` — dispatches by source name (youtube, news, reddit, serp/google, generic).
   - Produces `TrendSignal[]` with `source`, `title`, `description`, `volume`, `geo`, `category`, `confidence`, `raw`.

3. **Signal processing** — `trendProcessingService.ts`:
   - `normalizeTrendSignals()`, `mergeTrendsAcrossSources()`, `removeDuplicates()`, `tagByPlatform()`.
   - Produces `TrendSignalNormalized` with topic, source, geo, velocity, sentiment, volume, signal_confidence.

4. **Intelligence signal store** — `intelligenceSignalStore.ts`:
   - `buildNormalizedSignalsFromTrendResults()` — converts API results to `NormalizedSignalInput[]`.
   - `insertFromTrendApiResults()` — upserts with idempotency on `idempotency_key`.

### Where API Responses Are Parsed and Structured

- **externalApiService.ts** — Raw HTTP response is passed through; structured data expected in `payload.items` or source-specific shape.
- **trendNormalizationService.ts** — Parses `raw.items`, `raw.articles`, `raw.data.children`, etc. per source.
- **intelligenceSignalStore.ts** — Expects `payload.items` with `topic`/`title`; builds `idempotency_key` from `source_api_id + topic + detected_at`.

### How APIs Are Currently Called

1. **Synchronous fetch** — `executeExternalApiRequest()` with `fetchWithRetry()` (retries on 429/5xx).
2. **Placeholder replacement** — `{{category}}`, `{{geo}}` populated from `buildProfileRuntimeValues()` (company profile) and optional `runtimeOverrides`.
3. **Rate limiting** — In-memory `rateLimitState` per `sourceId:usageUserId`, `limitPerMin` from source config.
4. **Usage enforcement** — `checkUsageBeforeExecution()` for plan limits (`external_api_calls`); blocks if over limit.
5. **Health recording** — `updateApiHealth()` on success/failure; `getHealthForSource()` used to skip unreliable sources.
6. **Optional OmniVyra** — When enabled, `getTrendRelevance()` filters/enhances signals post-fetch.

### Centralized vs Scattered Calls

- **Centralized:** All HTTP calls go through `executeExternalApiRequest()` in `externalApiService.ts`.
- **Scattered entry points:** Multiple services call `fetchExternalApis`, `fetchExternalTrends`, or `fetchTrendsFromApis` directly:
  - recommendationEngineService, recommendationExecutionService, recommendationScheduler, trendAlignmentService, recommendationSimulationService, optimize-week APIs, trends/fetch API.

### Normalization and Common Structure

- **Normalization:** Yes. All sources normalize to `TrendSignal` (trendNormalizationService) and then to `TrendSignalNormalized` (trendProcessingService).
- **Common structure:** `TrendSignal` and `TrendSignalNormalized` with `topic`, `source`, `geo`, `velocity`, `sentiment`, `volume`, `signal_confidence`.

### Caching and Reuse

- **In-memory cache** — `externalApiCacheService.ts`: key `apiId::geo::category::userId`, TTL 12 min.
- **Cache used in** — `fetchExternalTrends()` / `fetchTrendsFromApis()`; cache hit skips HTTP request.
- **No distributed cache** — Cache is process-local; not shared across instances.

---

## SECTION 2 — STRATEGIC THEME GENERATION FLOW

### Files Responsible for Generating Strategic Theme Cards

| File | Responsibility |
|------|----------------|
| `backend/services/strategicThemeEngine.ts` | Main engine: `generateStrategicThemes()`, `getStrategicThemesAsOpportunities()` |
| `backend/services/themeAngleEngine.ts` | `generateThemeFromTopic()` — template-based theme titles |
| `backend/services/signalIntelligenceEngine.ts` | Feeds `signal_intelligence` from clusters |
| `backend/services/signalClusterEngine.ts` | Clusters `intelligence_signals` by topic similarity |
| `backend/services/companyTrendRelevanceEngine.ts` | Scores themes per company; filters by `company_api_configs` |
| `backend/services/strategicIntelligenceService.ts` | Strategic aspect scoring (imported elsewhere) |

### Where External Search Results Feed Into Theme Generation

**Pipeline:**
1. **intelligence_signals** ← `insertFromTrendApiResults()` (from `fetchTrendsFromApis` / `fetchExternalTrends`).
2. **signal_clusters** ← `clusterRecentSignals()` groups by topic similarity (Jaccard ≥ 0.75).
3. **signal_intelligence** ← `generateSignalIntelligence()` aggregates clusters (momentum, trend_direction, entities).
4. **strategic_themes** ← `generateStrategicThemes()` only for clusters with `momentum_score >= 0.6` and `trend_direction = 'UP'`.
5. **theme_company_relevance** ← `computeThemeRelevanceForCompany()` scores themes per company.
6. **companyTrendRelevanceEngine.getThemesForCompany()** — applies `company_api_configs` include/exclude filters.

External search results flow: **API → intelligence_signals → signal_clusters → signal_intelligence → strategic_themes**.

### Company Context Usage

- **strategicThemeEngine** — Uses `signal_intelligence.companies`, `keywords`, `influencers` (from cluster aggregation).
- **companyTrendRelevanceEngine** — Uses `company_profiles` (industry, industry_list, competitors, content_themes) and `companies.industry` for relevance scoring.
- **company_api_configs** — `include_filters`, `exclude_filters` (keywords, topics, competitors, industries, etc.) filter themes at read time.
- **opportunityGenerators** — `buildUnifiedContext()` injects company mission/context into LLM prompts for market pulse and trend recommendations.

### Query Generation Logic

- **API query building:** `buildExternalApiRequest()` uses `{{category}}`, `{{geo}}` placeholders.
- **Category:** From `buildProfileRuntimeValues()` — `category` or `industry_list[0]` or `content_themes_list` joined.
- **Geo:** From `pickProfileGeo()` — `geography` or `geography_list[0]`.
- **Dynamic vs static:** Queries are dynamically built from company profile + `runtimeOverrides`; presets define static query param templates (e.g. `q: '{{category}}'`).

### AI or Processing Layers

- **Theme title generation:** `generateThemeFromTopic()` — template-based (themeAngleEngine) + `refineLanguageOutput()` (LLM).
- **Market pulse:** `generateMarketPulseForRegion()` — LLM prompt with company context.
- **Trend recommendations:** `generateTrendRecommendationForRegion()` — LLM with strategic pillars.
- **Company trend relevance:** Rule-based scoring (keyword/competitor/industry match); no LLM.

### Inputs Influencing Theme Results

- Company profile: industry, competitors, content_themes.
- `company_api_configs`: enabled APIs, include_filters, exclude_filters.
- `signal_intelligence`: momentum_score, trend_direction, topic.
- Clustering: topic similarity threshold 0.75, 6-hour window for unclustered signals.

---

## SECTION 3 — MARKET SIGNAL / MARKET PULSE IMPLEMENTATION

### Code Related to Market Signals / Market Intelligence

| File | Purpose |
|------|---------|
| `backend/services/opportunityGenerators.ts` | `generateMarketPulseForRegion()`, `generatePulseOpportunities()` |
| `backend/services/marketPulseConsolidator.ts` | `consolidateMarketPulseResults()` — merges per-region topics |
| `backend/services/marketPulseJobProcessor.ts` | `processMarketPulseJobV1()` — job orchestration |
| `backend/services/signalIntelligenceEngine.ts` | `generateSignalIntelligence()` — momentum, direction, entities |
| `backend/services/signalClusterEngine.ts` | Clusters signals by topic |
| `backend/services/intelligenceSignalStore.ts` | Stores normalized signals |
| `backend/workers/intelligencePollingWorker.ts` | Background polling → signal store |

### Scheduled or Continuous Intelligence Collection

| Job | Interval | Scheduler | Description |
|-----|----------|-----------|-------------|
| Intelligence polling | 2 hours | `enqueueIntelligencePolling()` | Enqueues per-source jobs to `intelligence-polling` queue |
| Signal clustering | 30 min | `runSignalClustering()` | Groups unclustered signals (last 6h) |
| Signal intelligence | 1 hour | `runSignalIntelligenceEngine()` | Clusters → signal_intelligence |
| Strategic themes | 1 hour | `runStrategicThemeEngine()` | signal_intelligence → strategic_themes |
| Campaign opportunities | 1 hour | `runCampaignOpportunityEngine()` | strategic_themes → campaign_opportunities |
| Company trend relevance | 6 hours | `runCompanyTrendRelevance()` | Scores theme–company relevance |

### Signal Classification or Tagging

- **signal_type** in `intelligence_signals`: default `'trend'`; extensible.
- **Entity tables:** `signal_topics`, `signal_companies`, `signal_keywords`, `signal_influencers` — extracted from signals.
- **signal_intelligence:** `trend_direction` (UP, STABLE, DOWN), `momentum_score` (0–1).
- **Market pulse:** `risk_level` (LOW, MEDIUM, HIGH), `trend_velocity`, `narrative_phase` (EMERGING, ACCELERATING, PEAKING, DECLINING, STRUCTURAL).

### Signal Detection System

- Yes. Pipeline: external APIs → intelligence_signals → clustering → signal_intelligence.
- Detection via: count of signals in 6h vs 24h windows; momentum; trend direction.

### Signal Categories

- **Trend direction:** UP, STABLE, DOWN.
- **Narrative phase:** EMERGING, ACCELERATING, PEAKING, DECLINING, STRUCTURAL.
- **Risk level:** LOW, MEDIUM, HIGH (market pulse).
- **Source type:** Implicit from `source_api_id` (YouTube, NewsAPI, SerpAPI, etc.).

### Storage and Retrieval

- **Storage:** `intelligence_signals`, entity tables; `signal_intelligence`; `strategic_themes`; `campaign_opportunities`; `theme_company_relevance`.
- **Retrieval:** Company trend relevance via `getThemesForCompany()`; strategic themes via `getStrategicThemesAsOpportunities()`.

---

## SECTION 4 — COMPANY CONFIGURATION & CONTEXT

### Database Tables for Company Profiles

| Table | Purpose |
|-------|---------|
| `company_profiles` | Canonical company intelligence: industry, competitors, content_themes, geography, strategic_inputs, etc. |
| `companies` | Core company record; `industry` |
| `company_api_configs` | Per-company API config: enabled, polling_frequency, include_filters, exclude_filters, daily_limit, signal_limit |

### Context Fields Influencing Intelligence

- **company_profiles:** industry, industry_list, competitors, competitors_list, content_themes, content_themes_list, geography, geography_list, products_services_list, strategic_inputs, campaign_purpose_intent, brand_voice, ideal_customer_profile, core_problem_statement, authority_domains.
- **company_api_configs:** include_filters (keywords, topics, competitors, industries, geography), exclude_filters; purposes.

### Configuration Affecting Intelligence

- **company_api_configs.enabled** — Which APIs a company can use (single source of truth).
- **company_api_configs.include_filters** / **exclude_filters** — Used by `companyTrendRelevanceEngine.themePassesConfigFilters()`.
- **buildProfileRuntimeValues()** — Feeds `{{category}}`, `{{geo}}`, `brand`, `website`, `keywords` into API templates.

### Company Context in API Queries

- Yes. `geo` and `category` come from profile; `runtimeValues` include category, brand, website, keywords.
- `runtimeOverrides` allow caller overrides (e.g. user-selected geo/category).

### Intelligence Configuration

- `company_api_configs` — per-company, per-api: enabled, polling_frequency, filters, limits.
- No separate "intelligence mode" or "intelligence categories" config at company level.

### Company-Specific Filtering

- **theme_company_relevance** — Relevance score per company/theme.
- **companyTrendRelevanceEngine.getThemesForCompany()** — Applies include/exclude filters; returns themes ranked by relevance.

---

## SECTION 5 — ADMIN / SUPER ADMIN CONTROLS

### Admin Configuration for APIs

| File / Endpoint | Purpose |
|-----------------|---------|
| `pages/external-apis.tsx` | UI for managing external API sources |
| `pages/api/external-apis/index.ts` | GET/POST APIs; company vs platform scope |
| `pages/api/external-apis/access.ts` | Bulk/single API enablement; writes to `company_api_configs` |
| `pages/api/external-apis/company-config.ts` | GET/PUT/DELETE per-company API config |
| `pages/api/external-apis/presets.ts` | List presets; hidden-by-config logic |
| `pages/api/external-apis/[id]/validate.ts` | Validate single source |
| `pages/social-platforms.tsx` | Links to external APIs; `MANAGE_EXTERNAL_APIS` permission |
| `pages/system-dashboard.tsx` | Displays `external_api_calls` from usage meter |

### Enabling / Disabling APIs

- **company_api_configs.enabled** — Per-company enablement (single source of truth).
- **external_api_user_access** — User-level overrides (api_key_env_name, headers_override, query_params_override); no longer controls enablement.
- **external_api_sources.is_active** — Platform-level activation.
- **external_api_sources.company_id** — Null = platform preset; non-null = company-specific source.

### Plan-Based Feature Access

- **usageEnforcementService** — `checkUsageBeforeExecution()` for `external_api_calls` blocks when plan limit exceeded.
- **companyApiConfigService** — `getAllowedPollingForCompany()` by plan_key: basic (daily/weekly), pro (6h/daily/weekly), enterprise (realtime/2h/6h/daily).
- **company_api_configs.polling_frequency** — Validated against plan’s allowed options.

### API Presets

- **externalApiPresets.ts** — Hardcoded presets: YouTube Trends, NewsAPI, SerpAPI Google Trends/News, Reddit, Twitter, GDELT, HN, Stack Overflow, Google Trends proxy.
- Presets can be seeded/merged with DB; `is_preset` in `external_api_sources`.

### Companies Choosing APIs

- Yes. Via `company_api_configs`: companies enable/disable APIs, set filters, polling, limits.
- `getEnabledApis(companyId)` uses `getEnabledApiIdsFromCompanyConfig()` (from company_api_configs).

---

## SECTION 6 — DATA STORAGE

### Intelligence-Related Tables

| Table | Purpose |
|-------|---------|
| `intelligence_signals` | Normalized signals from APIs: source_api_id, company_id, signal_type, topic, cluster_id, confidence_score, detected_at, idempotency_key |
| `signal_topics` | Topic values per signal (FK intelligence_signals) |
| `signal_companies` | Company references per signal |
| `signal_keywords` | Keywords per signal |
| `signal_influencers` | Influencer references per signal |
| `signal_clusters` | Cluster_id, cluster_topic, signal_count, source_api_id |
| `signal_intelligence` | Cluster-level: topic, momentum_score, trend_direction, companies, keywords, influencers |
| `strategic_themes` | theme_title, theme_description, cluster_id, intelligence_id, momentum_score, companies, keywords, influencers |
| `theme_company_relevance` | company_id, theme_id, relevance_score, matched_keywords, matched_companies |
| `campaign_opportunities` | theme_id, opportunity_type, title, description |
| `external_api_sources` | API catalog |
| `external_api_health` | Per-source health |
| `external_api_usage` | Per-day usage counts |
| `recommendation_raw_signals` | Legacy: job_id, api_id, normalized_trends_json, raw_payload_json |
| `trend_snapshots` | company_id, campaign_id, snapshot JSONB |
| `recommendation_snapshots` | Recommendation cards; source_signals_count |

### Normalization

- **intelligence_signals** — Normalized schema; idempotency via `idempotency_key`.
- **signal_intelligence** — One row per cluster; upsert on cluster_id.
- **strategic_themes** — One theme per cluster (UNIQUE cluster_id).
- Entity tables normalize topics, companies, keywords, influencers.

### Duplicate Prevention

- **intelligence_signals:** UNIQUE on `idempotency_key`; upsert with `ignoreDuplicates: true`.
- **strategic_themes:** UNIQUE on `cluster_id`.
- **theme_company_relevance:** UNIQUE on (company_id, theme_id).

### Categorization

- **signal_type** in intelligence_signals (e.g. 'trend').
- **trend_direction** in signal_intelligence (UP, STABLE, DOWN).
- **opportunity_type** in campaign_opportunities (content_marketing, thought_leadership, product_positioning, industry_education).

---

## SECTION 7 — LIMITATIONS IN CURRENT IMPLEMENTATION

### Technical Gaps

1. **Direct API calls from multiple entry points** — recommendationEngineService, recommendationExecutionService, trendAlignmentService, optimize-week APIs, trends/fetch API all call external APIs directly; no single orchestration layer.

2. **Limited query abstraction** — Placeholders `{{category}}`, `{{geo}}` are fixed; no pluggable query builders or source-specific query strategies.

3. **No formal signal classification taxonomy** — signal_type is a string; no enum or registry of signal categories (trend vs competitor vs market_event, etc.).

4. **No intelligence categories at company level** — No config for "which intelligence categories matter" per company (e.g. competitor_only, trend_only).

5. **Inability to fully customize intelligence per company** — Filtering exists (include/exclude) but no per-category or per-source custom queries.

6. **Plan-based controls are partial** — Polling frequency is plan-gated; API enablement is not plan-gated (any company can enable any API if configured). Usage metering gates execution, not configuration.

7. **Two recommendation flows** — Legacy (`recommendation_jobs` + `recommendation_raw_signals`) vs v2 (recommendationEngineService + fetchExternalApis). Different storage and flow.

8. **In-memory cache** — Not distributed; multiple instances cause duplicate fetches.

9. **In-memory rate limiting** — `rateLimitState` is process-local; no cross-instance coordination.

10. **Theme generation not fully signal-driven for all paths** — Trend Campaign recommendations use live `fetchExternalApis`; strategic themes use stored `signal_intelligence`. Recommendation flow does not consistently read from `intelligence_signals` when available.

11. **No generic connector framework** — Only HTTP APIs from `external_api_sources`; no RSS, webhooks, or pluggable connectors.

12. **OmniVyra optional path** — When enabled, post-fetch enhancement; stored signals do not record whether OmniVyra was applied, making replay/debugging harder.

---

## SECTION 8 — REUSABLE COMPONENTS

### API Connectors

- **externalApiService.ts** — Source resolution, auth, rate limit, retry, health, usage logging.
- **buildExternalApiRequest()** — Placeholder resolution, URL building.
- **executeExternalApiRequest()** — HTTP execution with plan enforcement.
- **externalApiPresets** — Preset definitions.
- **external_api_sources** — DB-backed catalog.

### Theme Generation Engine

- **strategicThemeEngine.ts** — `generateStrategicThemes()`, `getStrategicThemesAsOpportunities()`.
- **themeAngleEngine.ts** — Template-based theme titles.
- **languageRefinementService** — LLM refinement for theme titles.

### Company Context Tables

- **company_profiles** — Rich context fields.
- **company_api_configs** — Per-company API config with filters.
- **companies** — Base company record.

### Existing Classification Logic

- **signalClusterEngine** — Topic similarity (Jaccard).
- **signalIntelligenceEngine** — Momentum, trend direction.
- **companyTrendRelevanceEngine** — Keyword/competitor/industry scoring.
- **marketPulseConsolidator** — Risk, narrative phase, arbitrage detection.

### Normalization

- **trendNormalizationService** — Per-source normalizers.
- **trendProcessingService** — Merge, dedupe, tag.
- **intelligenceSignalStore** — Idempotent insert, entity extraction.

### Infrastructure

- **externalApiCacheService** — Caching pattern (extend to distributed if needed).
- **intelligencePollingWorker** — Queue-based polling pattern.
- **schedulerService** — Cron orchestration.
- **companyApiConfigCache** — Config caching (5 min TTL).

### Health and Usage

- **externalApiHealthService** — Health tracking.
- **usageLedgerService**, **usageMeterService** — Usage and limits.
- **external_api_health**, **external_api_usage** — DB persistence.

---

## SECTION 9 — ARCHITECTURE SUMMARY

### Current Intelligence Pipeline

```
[External APIs] 
    ↓ (HTTP fetch, rate limit, retry)
[externalApiService]
    ↓ (normalize per source)
[trendNormalizationService / trendProcessingService]
    ↓ (merge, dedupe, score)
[TrendSignal[] / TrendSignalNormalized[]]
    ├→ [recommendationEngineService] (live recommendations)
    ├→ [intelligenceSignalStore] (persist to intelligence_signals)
    └→ [recommendation_raw_signals] (legacy job flow)

[intelligence_signals]
    ↓ (cluster by topic similarity)
[signal_clusters]
    ↓ (aggregate momentum, direction, entities)
[signal_intelligence]
    ↓ (momentum >= 0.6, UP only)
[strategic_themes]
    ↓ (company relevance + config filters)
[theme_company_relevance] + getThemesForCompany()
    ↓ (opportunity types)
[campaign_opportunities]
```

### Dependencies

- **recommendationEngineService** → externalApiService, companyProfileService, trendProcessingService, omnivyraClientV1 (optional).
- **strategicThemeEngine** → signal_intelligence (via loadEligibleIntelligence), themeAngleEngine, languageRefinementService.
- **companyTrendRelevanceEngine** → strategic_themes, signal_intelligence, company_profiles, company_api_configs.
- **intelligencePollingWorker** → externalApiService (fetchSingleSourceForIntelligencePolling), intelligenceSignalStore.

### Architectural Strengths

1. **Centralized API execution** — All HTTP via `executeExternalApiRequest()`.
2. **Normalization layer** — Consistent TrendSignal/TrendSignalNormalized across sources.
3. **Company-scoped configuration** — company_api_configs with filters and plan-aware polling.
4. **Idempotent signal storage** — Prevents duplicate signals from repeated polling.
5. **Scheduled pipeline** — Intelligence polling, clustering, signal intelligence, themes, opportunities, relevance scoring on cron.
6. **Health and usage tracking** — Per-source health; plan-based execution limits.
7. **Entity extraction** — Topics, companies, keywords, influencers in relational tables.

### Architectural Bottlenecks

1. **Multiple live fetch paths** — Recommendation and trend flows call APIs directly instead of preferring stored signals when fresh.
2. **No distributed cache or rate limit** — Single-process assumptions.
3. **Legacy + v2 flows** — recommendation_raw_signals vs recommendationEngineService; dual storage.
4. **Fixed placeholder set** — Only `{{category}}`, `{{geo}}`; limited extensibility.
5. **Theme engine decoupled from recommendation flow** — Strategic themes from stored pipeline; recommendations from live API; potential inconsistency.
6. **No formal signal taxonomy** — Ad-hoc signal_type; no registry of categories.
7. **Company context in API templates** — Limited to a few profile fields; no structured "intelligence config" per company.

---

*End of Technical Architecture Assessment. No code or schema changes were made.*

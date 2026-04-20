# Recommendation Hub — Full Architecture and Implementation Audit Report

**Date:** 2026-03-10  
**Scope:** Omnivyra Recommendation Hub (frontend, backend, database, scheduled jobs)  
**Objective:** Prepare for structural simplification and intelligence upgrade to three core modules  
**Constraint:** Analysis only — no code modifications

---

## 1. System Overview

The Recommendation Hub is a multi-tab intelligence surface that surfaces strategic opportunities for campaigns. It currently has **six UI tabs**:

| Tab Type | Label | Data Source | Backend |
|----------|-------|--------------|---------|
| TREND | Trend Campaigns | Recommendation Engine (OmniVyra/external APIs) | `/api/recommendations/generate`, `recommendationEngineService` |
| LEAD | Active Leads | Lead Detection (social listening) | `/api/leads/job/create`, `leadJobProcessor` |
| PULSE | Market Pulse | LLM regional analysis | `/api/market-pulse/job/create`, `marketPulseJobProcessor` |
| SEASONAL | Seasonal & Regional | `opportunityGenerators` → **empty** | `/api/opportunities` |
| INFLUENCER | Influencers | `opportunityGenerators` → **empty** | `/api/opportunities` |
| DAILY_FOCUS | Daily Focus | `opportunityGenerators` → **empty** | `/api/opportunities` |

**Architecture summary:**
- **Trend Campaigns:** Full recommendation engine; external APIs + OmniVyra; generates strategic theme cards; persisted in `recommendation_snapshots`.
- **Active Leads:** On-demand job; scans Reddit/LinkedIn/Twitter etc.; stores signals in `lead_signals_v1`; clusters in `lead_intent_clusters_v1`.
- **Market Pulse:** On-demand job; LLM per-region; stores in `market_pulse_jobs_v1`, `market_pulse_items_v1`.
- **Seasonal, Influencers, Daily Focus:** Use `opportunity_items` + `fillOpportunitySlots`; generators return **empty arrays** (not implemented).

**Insight source modes:**  
The system has `signals_source: 'EXTERNAL' | 'PROFILE_ONLY'` for Trend recommendations. There is **no** `insight_source = api | llm | hybrid` routing. All three target modules require this to be introduced.

---

## 2. Frontend Architecture

### 2.1 Main Files

| File | Responsibility |
|------|----------------|
| `pages/recommendations.tsx` | Main page; tab routing; engine result state; detected opportunities; workspace (all/shortlisted/discarded); external API selection |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | Trend campaigns; Generate; engine cards; BOLT; strategy intelligence panel |
| `components/recommendations/tabs/ActiveLeadsTab.tsx` | Active leads; Run job; connector status; clusters; funnel (Active/Watchlist/Outreach/Engaged/Converted) |
| `components/recommendations/tabs/MarketPulseTab.tsx` | Market Pulse; Run job; regional topics |
| `components/recommendations/tabs/SeasonalRegionalTab.tsx` | Seasonal & Regional; `useOpportunities` |
| `components/recommendations/tabs/InfluencersTab.tsx` | Influencers; `useOpportunities` |
| `components/recommendations/tabs/DailyFocusTab.tsx` | Daily Focus; `useOpportunities`; Act Now (OPEN_TAB, OPEN_GENERATOR) |
| `components/recommendations/tabs/useOpportunities.ts` | Hook: GET/POST `/api/opportunities?companyId=&type=` for SEASONAL, INFLUENCER, DAILY_FOCUS |
| `components/recommendations/tabs/types.ts` | `OpportunityTabProps`, payload types per tab (`OpportunityPayloadTREND`, `OpportunityPayloadLEAD`, etc.) |

### 2.2 Strategic Theme / Recommendation Card Rendering

| Component | Purpose |
|-----------|---------|
| `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Renders Trend recommendation cards (polished_title, summary, intelligence, execution, duration_weeks, etc.) |
| `components/recommendations/EngineContextPanel.tsx` | Company profile context display |
| `components/recommendations/EngineOverridePanel.tsx` | Strategic direction override |
| `components/recommendations/engine-framework/UnifiedContextModeSelector.tsx` | Context mode (FULL/FOCUSED) selector |
| `components/recommendations/engine-framework/StrategicAspectSelector.tsx` | Campaign aspect selection |
| `components/recommendations/StrategicWorkspacePanel.tsx` | Workspace (all/shortlisted/discarded) |

### 2.3 Data Fetching

| Tab | Primary Fetch | Secondary |
|-----|---------------|-----------|
| **TREND** | POST `/api/recommendations/generate` (with `durationWeeks`, `strategicPayload`, etc.) | GET `/api/recommendations/state-map`, `/api/recommendations/job/[id]`, `/api/recommendations/job/history`, `/api/company-profile` |
| **LEAD** | POST `/api/leads/job/create` → poll GET `/api/leads/job/[id]` | GET `/api/community-ai/connectors/status`, `/api/leads/signal/[id]` |
| **PULSE** | POST `/api/market-pulse/job/create` → poll GET `/api/market-pulse/job/[id]` | — |
| **SEASONAL, INFLUENCER, DAILY_FOCUS** | GET `/api/opportunities?companyId=&type=`; POST `/api/opportunities` to fill slots | — |

### 2.4 Tab Logic

Tabs are **hardcoded** in `pages/recommendations.tsx`:

```ts
const OPPORTUNITY_TAB_TYPES: { type: string; label: string }[] = [
  { type: 'TREND', label: 'Trend Campaigns' },
  { type: 'LEAD', label: 'Active Leads' },
  { type: 'PULSE', label: 'Market Pulse' },
  { type: 'SEASONAL', label: 'Seasonal & Regional' },
  { type: 'INFLUENCER', label: 'Influencers' },
  { type: 'DAILY_FOCUS', label: 'Daily Focus' },
];
```

Conditional rendering switches on `activeOpportunityTab`; each tab renders its component with props.

---

## 3. Backend API Endpoints

### 3.1 Trend Campaigns (Recommendation Engine)

| Endpoint | Method | Request | Response | Service |
|----------|--------|---------|----------|---------|
| `/api/recommendations/generate` | POST | `companyId`, `campaignId?`, `simulate?`, `chat?`, `selected_api_ids?`, `manual_context?`, `regions?`, `enrichmentEnabled?`, `objective?`, `durationWeeks?`, `strategicPayload?` | `RecommendationEngineResult` (trends_used, trends_ignored, weekly_plan, daily_plan, confidence_score, explanation, sources, persona_summary, scenario_outcomes, signals_source, etc.) | `recommendationEngineService`, `recommendationCardEnrichmentService` |
| `/api/recommendations/state-map` | GET | `companyId`, `snapshot_hashes?` | `{ states, details, summaries, detailsBySnapshot, recommendations }` | `audit_logs`, `recommendation_snapshots` |
| `/api/recommendations/[id]/state` | POST | `state`, `opinion_note?`, `confidence_rating?`, `accept_preview?` | `{ success }` | — |
| `/api/recommendations/[id]/prepare-plan` | POST | `draft?`, `priority_bucket?` | Planning context JSON | — |
| `/api/recommendations/[id]/create-campaign` | POST | `durationWeeks?` | `{ campaign_id }` | `recommendationCampaignBuilder` |
| `/api/recommendations/create-campaign-from-group` | POST | `company_id`, `selected_recommendations`, `groups` | `{ campaign_id, snapshot_hash? }` | `recommendationCampaignBuilder` |
| `/api/recommendations/detected-opportunities` | GET | `companyId`, `campaignId` | `{ opportunities: DetectedOpportunity[] }` | Engine simulate + snapshots |
| `/api/recommendations/strategy-history` | GET | `companyId` | Strategy history | `strategyHistoryService` |
| `/api/recommendations/job/create` | POST | Job params | `{ jobId, status }` | Async recommendation job |
| `/api/recommendations/job/[id]` | GET | — | Job status/result | — |

### 3.2 Active Leads

| Endpoint | Method | Request | Response | Service |
|----------|--------|---------|----------|---------|
| `/api/leads/job/create` | POST | `companyId`, `platforms`, `regions`, `keywords?`, `mode?`, `context_mode?`, `focused_modules?`, `additional_direction?` | `{ jobId, status }` | `leadJobProcessor` (via BullMQ) |
| `/api/leads/job/[id]` | GET | — | `{ status, total_found, total_qualified, results, clusters, ... }` | — |
| `/api/leads/signal/[id]` | GET | — | Signal detail | — |

### 3.3 Market Pulse

| Endpoint | Method | Request | Response | Service |
|----------|--------|---------|----------|---------|
| `/api/market-pulse/job/create` | POST | `companyId`, `regions`, `context_mode?`, `focused_modules?`, `additional_direction?` | `{ jobId, status }` | `marketPulseJobProcessor` (via BullMQ) |
| `/api/market-pulse/job/[id]` | GET | — | Job + consolidated_result, region_results | — |
| `/api/market-pulse/job/[id]/cancel` | POST | — | Cancel | — |

### 3.4 Opportunities (Seasonal, Influencers, Daily Focus)

| Endpoint | Method | Request | Response | Service |
|----------|--------|---------|----------|---------|
| `/api/opportunities` | GET | `companyId`, `type` | `{ opportunities, activeCount }` | `opportunityService.listActiveOpportunities`, `countActive` |
| `/api/opportunities` | POST | `companyId`, `type`, `strategicPayload?`, `regions?` | Same as GET | `opportunityService.fillOpportunitySlots` |
| `/api/opportunities/[id]/promote` | POST | — | `{ campaign_id }` | `opportunityService.promoteToCampaign` |
| `/api/opportunities/[id]/action` | POST | `action`, `scheduled_for?` | — | `opportunityService.takeAction` |

---

## 4. Intelligence Engines

### 4.1 Trend Generation (Recommendation Engine)

| Service | Responsibility |
|---------|-----------------|
| `recommendationEngineService.ts` | Main orchestrator; fetches external APIs, OmniVyra; merges signals; filters/disqualifies; polishes; sequences; builds blueprint |
| `externalApiService.ts` | `fetchExternalApis`, `getEnabledApis`, trend signal fetch |
| `trendNormalizationService.ts` | Normalize trends across sources |
| `trendProcessingService.ts` | `mergeTrendsAcrossSources`, `removeDuplicates`, `tagByPlatform` |
| `recommendationPolishService.ts` | Polish titles, summaries |
| `recommendationIntelligenceService.ts` | Enrich intelligence fields |
| `recommendationSequencingService.ts` | Sequence by strategy |
| `recommendationBlueprintService.ts` | Build campaign blueprint |
| `recommendationCardEnrichmentService.ts` | Enrich cards (duration_weeks, execution, company_context_snapshot) |

**Signal flow (Trend):**  
External APIs (NewsAPI, SerpAPI, YouTube, etc.) + OmniVyra → `fetchExternalApis` → `normalizeTrends` → `mergeTrendsAcrossSources` → filtering/scoring → polish → sequencing → blueprint → enrichment.

### 4.2 Signal Processing (Intelligence Pipeline)

| Service | Responsibility |
|---------|-----------------|
| `intelligenceIngestionModule.ts` | Poll external APIs; insert into `intelligence_signals` |
| `signalClusterEngine.ts` | `clusterRecentSignals` → `signal_clusters` |
| `signalIntelligenceEngine.ts` | `generateSignalIntelligence` → `signal_intelligence` |
| `strategicThemeEngine.ts` | `generateStrategicThemes` → `strategic_themes`; `getStrategicThemesAsOpportunities` for opportunity slots |
| `campaignOpportunityEngine.ts` | `generateCampaignOpportunities` → `campaign_opportunities` |
| `contentOpportunityEngine.ts` | `generateContentOpportunities` → `content_opportunities` |
| `narrativeEngine.ts` | `generateCampaignNarratives` → `campaign_narratives` |
| `communityPostEngine.ts` | `generateCommunityPosts` → `community_posts` |
| `threadEngine.ts` | `generateCommunityThreads` → `community_threads` |

### 4.3 Lead Detection

| Service | Responsibility |
|---------|-----------------|
| `leadJobProcessor.ts` | Scans platforms via `postDiscoveryConnectors`; inserts `lead_signals_v1`; qualifies via `leadQualifier` or `leadPredictiveQualifier`; archives excess (TOP_SLOTS_PER_COMPANY=50); runs `generateIntentClusters` |
| `leadQualifier.ts` | REACTIVE: ICP, urgency, intent scoring |
| `leadPredictiveQualifier.ts` | PREDICTIVE: latent intent, trend_velocity |
| `leadNoiseFilter.ts` | `shouldRejectPost` |
| `leadClusterService.ts` | `generateIntentClusters` → `lead_intent_clusters_v1` |
| `postDiscoveryConnectors/*` | Reddit, LinkedIn, Twitter, etc. |

**Execution:** User-initiated only. No scheduled runs.

### 4.4 Market Pulse (Market Insights)

| Service | Responsibility |
|---------|-----------------|
| `marketPulseJobProcessor.ts` | Per-region LLM call via `generateMarketPulseForRegion`; writes `market_pulse_items_v1`; consolidates via `marketPulseConsolidator` |
| `opportunityGenerators.ts` | `generateMarketPulseForRegion` — LLM prompt with company context |
| `marketPulseConsolidator.ts` | Merge regional topics; risk, narrative phase, arbitrage |

---

## 5. Database Tables

### 5.1 Trend Campaigns & Recommendations

| Table | Purpose | Key Columns |
|-------|---------|--------------|
| `recommendation_snapshots` | Per-topic snapshots; lifecycle | company_id, campaign_id, snapshot_hash, trend_topic, category, status, regions, source_signals_count, signals_source |
| `recommendation_audit_logs` | State changes (shortlisted, discarded) | — |
| `recommendation_jobs` | Multi-region jobs | company_id, regions, status |
| `recommendation_raw_signals` | Per-job, per-region signals | — |
| `recommendation_analysis` | Job results | — |

### 5.2 Signals & Intelligence Pipeline

| Table | Purpose | Retention / Indexes |
|-------|---------|--------------------|
| `intelligence_signals` | Normalized signals from APIs | 365-day retention function; idempotency_key unique |
| `signal_clusters` | Clustered signals | — |
| `signal_intelligence` | Cluster-level intelligence | — |
| `strategic_themes` | theme_title, theme_description, momentum_score | — |
| `campaign_opportunities` | Themes → opportunities | — |
| `content_opportunities` | Content opportunities | — |
| `company_intelligence_signals` | Company-scoped signals | — |

### 5.3 Leads

| Table | Purpose | Schema Notes |
|-------|---------|--------------|
| `lead_jobs_v1` | Job metadata | company_id, platforms, regions, status, total_found, total_qualified |
| `lead_signals_v1` | Individual lead signals | icp_score, urgency_score, intent_score, total_score, status (ACTIVE/ARCHIVED) |
| `lead_intent_clusters_v1` | Clustered leads | problem_domain, signal_count |
| `lead_outreach_plans` | LLM outreach plans | — |

**Retention / rolling window:**  
`leadJobProcessor` keeps `TOP_SLOTS_PER_COMPANY = 50` active leads; excess archived. **No** per-day cap or rolling-window by age. No automatic retention/cleanup for old signals.

### 5.4 Market Pulse

| Table | Purpose |
|-------|---------|
| `market_pulse_jobs_v1` | Job; consolidated_result, region_results |
| `market_pulse_items_v1` | Per-region topics; narrative_phase, velocity_score, momentum_score |

### 5.5 Opportunities (Seasonal, Influencer, Daily Focus)

| Table | Purpose |
|-------|---------|
| `opportunity_items` | company_id, type (TREND|LEAD|PULSE|SEASONAL|INFLUENCER|DAILY_FOCUS), title, summary, payload (jsonb), slot_state, status |
| `opportunity_to_campaign` | Link promoted opportunities to campaigns |

**Growth risks:**  
- `intelligence_signals` — unbounded per-API polling; 365-day retention exists but must be invoked.  
- `lead_signals_v1` — grows with each job; archived rows remain; no automatic purge.  
- `recommendation_snapshots` — one per topic per generate; accumulates.

---

## 6. Scheduled Jobs

### 6.1 Cron Scheduler (`backend/scheduler/cron.ts`)

| Job | Interval | Function |
|-----|----------|----------|
| Opportunity slots | 24h | `runOpportunitySlotsScheduler` — fill slots for all types, reopen scheduled |
| Governance audit | 24h | `runAllCompanyAudits` |
| Auto-optimization | 24h | `runAutoOptimizationForEligibleCampaigns` |
| Engagement polling | 10 min | `enqueueEngagementPolling` |
| Intelligence polling | 2h | `enqueueIntelligencePolling` → external APIs → `intelligence_signals` |
| Signal clustering | 30 min | `runSignalClustering` |
| Signal intelligence | 1h | `runSignalIntelligenceEngine` |
| Strategic theme engine | 1h | `runStrategicThemeEngine` |
| Campaign opportunity | 1h | `runCampaignOpportunityEngine` |
| Content opportunity | 2h | `runContentOpportunityEngine` |
| Narrative engine | 4h | `runNarrativeEngine` |
| Community post engine | 3h | `runCommunityPostEngine` |
| Thread engine | 3h | `runThreadEngine` |
| Engagement capture | 30 min | `runEngagementCapture` |
| Feedback intelligence | 6h | `runFeedbackIntelligenceEngine` |
| Company trend relevance | 6h | `runCompanyTrendRelevance` |
| Performance ingestion | 6h | `runPerformanceIngestion` |
| Performance aggregation | 24h | `runPerformanceAggregation` |
| Campaign health evaluation | 24h | `runCampaignHealthEvaluation` |
| Engagement digest | 24h | `runEngagementDigestWorker` |

### 6.2 Lead Detection — No Scheduled Runs

**Active Leads is 100% on-demand.**  
- User clicks Run → POST `/api/leads/job/create` → job enqueued to BullMQ `engine-jobs` (type `LEAD`) → `leadJobProcessor` runs.  
- Rate limit: 20 jobs per company per 24h; 2-minute dedupe for PENDING/RUNNING.

### 6.3 Market Pulse — No Scheduled Runs

**Market Pulse is on-demand.**  
- User clicks Run → POST `/api/market-pulse/job/create` → BullMQ → `marketPulseJobProcessor`.

### 6.4 Risk of Over-Execution

- **Intelligence polling:** Every 2h; can be heavy if many APIs/companies.  
- **Strategic theme / campaign opportunity:** Every 1h; cascades through pipeline.  
- **Lead detection:** User-initiated; 20/day limit per company. No automatic “morning/evening” run.

---

## 7. Signal Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ EXTERNAL APIs (NewsAPI, SerpAPI, YouTube, etc.)                                   │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Intelligence Polling (2h cron) → intelligenceIngestionModule.ingestSignals()      │
│   → normalizeTrends() → intelligence_signals                                      │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Signal Clustering (30 min) → signalClusterEngine.clusterRecentSignals()           │
│   → signal_clusters                                                               │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Signal Intelligence (1h) → signalIntelligenceEngine.generateSignalIntelligence()   │
│   → signal_intelligence                                                           │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Strategic Theme Engine (1h) → strategicThemeEngine.generateStrategicThemes()     │
│   → strategic_themes                                                              │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Campaign Opportunity Engine (1h) → campaignOpportunityEngine                       │
│   → campaign_opportunities                                                       │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Content Opportunity (2h) → contentOpportunityEngine                               │
│   → content_opportunities                                                         │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Narrative Engine (4h) → narrativeEngine                                           │
│   → campaign_narratives                                                           │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Community Post Engine (3h) → communityPostEngine                                   │
│   → community_posts                                                               │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Thread Engine (3h) → threadEngine                                                  │
│   → community_threads                                                             │
└─────────────────────────────────────────────────────────────────────────────────┘

PARALLEL PATH (Trend Tab - Generate):
┌─────────────────────────────────────────────────────────────────────────────────┐
│ POST /api/recommendations/generate                                               │
│   → recommendationEngineService (fetchExternalApis + OmniVyra)                   │
│   → mergeTrendsAcrossSources, removeDuplicates                                    │
│   → polish, intelligence, sequencing, blueprint                                   │
│   → enrichRecommendationCards                                                     │
│   → recommendation_snapshots + API response (trends_used)                          │
└─────────────────────────────────────────────────────────────────────────────────┘

OPPORTUNITY SLOTS PATH (Seasonal, Influencer, Daily Focus):
┌─────────────────────────────────────────────────────────────────────────────────┐
│ runOpportunitySlotsScheduler (24h)                                                │
│   → fillOpportunitySlots(companyId, type)                                         │
│   → opportunityGenerators.getGenerator(type)                                      │
│   → TREND: getStrategicThemesAsOpportunities (from strategic_themes)               │
│   → LEAD, PULSE, SEASONAL, INFLUENCER, DAILY_FOCUS: return [] (empty)             │
│   → opportunity_items (upsert)                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Market Pulse Coverage

### 8.1 Signal Categories

| Category | Exists? | Implementation |
|----------|---------|----------------|
| **Competitor intelligence** | Partial | `marketPulseEngine` / `competitiveIntelligenceEngine` in `intelligenceStrategyModule`; not used by Market Pulse tab (tab uses LLM regional prompts) |
| **Market trends** | Yes | `generateMarketPulseForRegion` — LLM identifies trending conversations, shelf life, risk |
| **Influencer tracking** | Yes | `influencer_intelligence` table; `influencerIntelligenceService`; Influencers tab uses `opportunityGenerators` which returns `[]` |
| **Seasonal signals** | No | `generateSeasonalOpportunities` returns `[]` |
| **Regional discussions** | Yes | Market Pulse job accepts `regions`; per-region LLM analysis |
| **Buying intent signals** | Yes | `buyer_intent_accounts`, `leadDetectionService`, `opportunityRadarService` (BUYING_INTENT_LEAD_INTENTS); Active Leads tab uses this via lead qualifier |

### 8.2 Where Implemented

- **Market Pulse tab:** `marketPulseJobProcessor` + `generateMarketPulseForRegion` (LLM).  
- **Active Leads:** Buying intent via `leadQualifier`, `leadPredictiveQualifier`, `leadDetectionService`.  
- **Influencer:** `influencer_intelligence`, `influencerIntelligenceService` — not wired to Influencers tab UI.  
- **Seasonal / Regional:** No implementation; generators return `[]`.

---

## 9. Active Leads Behavior (Special Constraints Audit)

### 9.1 Current State vs. Target

| Requirement | Current | Target |
|-------------|---------|--------|
| Run 1–2 times per day | **Not implemented** — user-initiated only | Morning + evening scheduled |
| NOT continuous (every few minutes) | ✅ No cron for leads | — |
| Max 10–15 leads per run | **50** (`TOP_SLOTS_PER_COMPANY`) | 10–15 |
| Rolling window of leads | Partial — archive excess by score; no age-based purge | Rolling window; oldest removed when >15 |
| Daily refresh | User can run multiple times (up to 20/day) | Single daily refresh with latest |

### 9.2 Gaps

1. **No scheduled lead detection.** Need cron/scheduler to run lead detection 1–2×/day.  
2. **Lead cap is 50, not 15.** `leadJobProcessor.ts` line 18: `TOP_SLOTS_PER_COMPANY = 50`.  
3. **No rolling window by age.** Archives by score only; no “remove oldest when count > limit.”  
4. **No explicit “daily refresh” semantics.** Multiple user runs can add/update signals; no single daily snapshot.

### 9.3 Files to Change for Target Behavior

- `backend/services/leadJobProcessor.ts` — reduce `TOP_SLOTS_PER_COMPANY` to 15; add age-based rolling window.  
- `backend/scheduler/cron.ts` — add scheduled lead detection (e.g. 7:00, 18:00); enqueue lead jobs per company.  
- `backend/services/opportunitySlotsScheduler.ts` — if LEAD uses opportunity_items, align with new cap.  
- `pages/api/leads/job/create.ts` — optionally restrict to scheduled runs only or add `scheduled_run` flag.

---

## 10. Strategic Theme Card Structure

### 10.1 Current Schema (Trend Recommendation Card)

From `recommendationCardEnrichmentService` and `RecommendationBlueprintCard`:

| Field | Source | Used By |
|-------|--------|---------|
| `topic` | Engine | Required |
| `polished_title` | Engine / polish | Card header |
| `summary` | Engine | Card body |
| `estimated_reach` / `volume` | Engine | Display |
| `formats` | Engine | Content formats |
| `regions` | Engine | Geo |
| `aspect` / `facets` | Engine | Strategy |
| `audience_personas` | Engine | Personas |
| `messaging_hooks` | Engine | Messaging |
| `intelligence` | Engine + enrichment | problem_being_solved, gap_being_filled, why_now, authority_reason, expected_transformation, campaign_angle |
| `alignment_score`, `final_alignment_score` | Engine / enrichment | Ranking |
| `strategy_modifier`, `strategy_mode` | Engine | Mode badge |
| `diamond_type` | Polish | Badge |
| `execution` | Enrichment | stage_objective, psychological_goal, momentum_level |
| `duration_weeks` | Blueprint | Execution |
| `progression_summary` | Blueprint | Weekly plan |
| `primary_recommendations`, `supporting_recommendations` | Blueprint | Related themes |
| `company_context_snapshot` | Enrichment | core_problem_statement, pain_symptoms, desired_transformation, etc. |

**Schema is effectively fixed** for Trend cards; APIs return this structure.  
**LLM integration:** Enrichment and polish already use LLM; adding `insight_source=llm` would fit by swapping signal source (API vs. LLM-generated themes).  
**opportunity_items payload (per type):** TREND, LEAD, PULSE, SEASONAL, INFLUENCER, DAILY_FOCUS each have type-specific payload shapes in `types.ts`.

---

## 11. Refactor Readiness Assessment

### 11.1 Consolidation Map: Current → Target

| Target Module | Current Sources | Consolidation Action |
|---------------|-----------------|----------------------|
| **Trend Campaigns** | TREND tab | Keep; add insight_source routing (api \| llm \| hybrid) |
| **Active Leads** | LEAD tab | Keep; enforce 1–2 runs/day, max 15, rolling window |
| **Market Pulse** | PULSE tab | Keep; add insight_source routing |
| — | **Seasonal & Regional** | Merge into **Market Pulse** (seasonal/regional signals) |
| — | **Influencers** | Merge into **Market Pulse** (influencer tracking) or **Trend Campaigns** (influencer themes) |
| — | **Daily Focus** | Merge into **Market Pulse** (curated daily priorities) or standalone “daily digest” |

### 11.2 Missing Capabilities

1. **`insight_source = api | llm | hybrid`** — Not implemented. Need routing in recommendation engine and Market Pulse.  
2. **Scheduled lead detection** — Not implemented.  
3. **Lead cap 15 and rolling window** — Not implemented (currently 50, score-based archive).  
4. **Seasonal, Influencer, Daily Focus generators** — Return `[]`; logic must be built or migrated into Market Pulse / Trend.

### 11.3 Technical Debt

- **Duplicate paths:** Trend engine fetches external APIs directly; intelligence pipeline also ingests → strategic_themes. Two paths to “trends.”  
- **Empty generators:** SEASONAL, INFLUENCER, DAILY_FOCUS generators are stubs.  
- **signals_source** only `EXTERNAL` | `PROFILE_ONLY`; no `api` | `llm` | `hybrid`.  
- **Lead job queue:** Uses `engine-jobs` (shared with Market Pulse); separate `lead-jobs` queue exists in `leadWorker.ts` but `pages/api/leads/job/create` enqueues to `jobQueue` (engine-jobs). Verify queue wiring.

### 11.4 Files That Must Change During Refactor

| Category | Files |
|----------|-------|
| **Frontend** | `pages/recommendations.tsx` (tab list, conditional render), `components/recommendations/tabs/*` (merge/remove tabs) |
| **API routing** | New or modified params for `insight_source` on generate, market-pulse, leads |
| **Recommendation engine** | `recommendationEngineService.ts`, `recommendationEngine.ts` (if separate) |
| **Market Pulse** | `marketPulseJobProcessor.ts`, `opportunityGenerators.ts` (`generateMarketPulseForRegion`) |
| **Leads** | `leadJobProcessor.ts`, `backend/scheduler/cron.ts`, `pages/api/leads/job/create.ts` |
| **Opportunity generators** | `opportunityGenerators.ts` — implement or remove SEASONAL, INFLUENCER, DAILY_FOCUS |
| **Database** | Possibly `opportunity_items` type enum; `lead_signals_v1` retention/rolling logic |

---

## 12. Performance Risks

| Risk | Location | Recommendation |
|------|----------|----------------|
| Heavy external API polling | Intelligence polling every 2h; multiple APIs × companies | Throttle; consolidate; consider per-company cadence |
| Duplicate signal scans | Trend engine fetches APIs; pipeline also ingests | Unify or clearly separate “live generate” vs. “precomputed pipeline” |
| Unnecessary polling | Lead/Market Pulse job status polling from UI | Consider SSE or webhooks when job completes |
| Opportunity slots scheduler | 24h run fills ALL types for ALL companies | Batch; consider queue per company |
| No retention on lead_signals_v1 | Archived rows never deleted | Add retention (e.g. 90 days) or purge when ARCHIVED |
| intelligence_signals retention | Function exists but may not be invoked | Ensure `delete_intelligence_signals_older_than_365_days` runs daily |

---

## 13. Summary

The Recommendation Hub has **six tabs**, but only **three** have working backend logic (Trend, Lead, Market Pulse). Seasonal, Influencers, and Daily Focus use `opportunity_items` with generators that return empty arrays.

To align with the target structure:

1. **Consolidate** Seasonal, Influencers, Daily Focus into **Trend Campaigns** and **Market Pulse**.  
2. **Introduce** `insight_source = api | llm | hybrid` for Trend, Active Leads, and Market Pulse.  
3. **Implement** scheduled lead detection (1–2×/day), cap at 15 leads, and a rolling window.  
4. **Reduce** `TOP_SLOTS_PER_COMPANY` for leads from 50 to 15 and add age-based eviction.

The codebase is structured to support this refactor; the main work is routing logic, scheduler changes, and generator implementation or migration.

---

*End of audit report. No code was modified.*

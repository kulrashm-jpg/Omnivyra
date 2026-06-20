# OMNIVYRA COST ACTIVITY INVENTORY

**Discovery audit — cost-generating activity inventory only. No pricing, credits, or subscription math.**
Generated 2026-06-17 from source at `c:\virality`. Every claim is file-cited. This is the foundational inventory for later credit-economy / pricing design.

---

## 0. EXECUTIVE FINDINGS (read first — several overturn assumptions)

1. **One AI chokepoint.** Every LLM call funnels through `backend/services/aiGateway.ts`. Default model is **`gpt-4o-mini`**; long-form blog *body* drafts use **`gpt-4o`**; cross-provider fallback is **`claude-3-5-sonnet`** (`aiGateway.ts:1045`). The only image-generation model is **`gpt-image-1`**.

2. **Image generation is far smaller than assumed.** Only **Single Image** and **Banner** creator assets call the paid image API (`gpt-image-1`, 1 call each). **Carousels, decks/sliders, PDFs, infographics, brand cards generate ZERO images** — they are rendered with programmatic SVG + `sharp` rasterization (`creatorAssetRenderer.ts`). A 10-slide carousel = **0** image API calls. Slide count multiplies only CPU + (optional) OCR HTTP calls.

3. **The dominant *variable* cost is the campaign content fan-out.** BOLT / Intelligent Mix planning is a fixed ~1–3 LLM calls, but the *schedule stage* fans out: **rows = Σ(format frequency) × weeks**, each row = 1 uncapped `generateMasterContent` call + 1–2 variant calls per platform (+ creator LLM/image if visual). Intelligent Mix's 12-week ceiling makes it the heaviest single user action.

4. **The dominant *recurring* cost is two background loops:** (a) the **lead qualifier** — 1 uncached, uncapped LLM call *per discovered post* × platforms × regions × ≤500 companies × 2 scheduled runs/day; (b) the **conversation-triage** loop — up to 15 calls every 3 minutes (≤7,200/day). Both bypass caching.

5. **Most "intelligence / analytics / reporting" is deterministic — zero AI.** ~90 `*intelligence*.ts` files plus all analytics/reporting services do **not** import the AI gateway. They are signal-scoring / weighted-math / DB-aggregation. Their cost is **background-worker compute**, not tokens.

6. **SERP search APIs are background-only.** `serpAcquisitionService` runs solely from `pages/api/cron/serp-acquisition.ts` (daily) and super-admin — **never inline from a report request**. Reports read a pre-warehoused DB layer.

7. **The Digital Presence / Snapshot report is the heaviest single *probe* action:** up to **~60 LLM "visibility probe" calls** (5 providers × up to 12 queries) on a cold cache — `canonicalReportBuilder.ts`.

8. **Fixed cost backbone:** one Railway worker process runs 24/7 hosting ~11 BullMQ workers + a `startCron()` loop with sub-30s/60s/90s timers and ~30 recurring jobs (`backend/workers/main.ts`, `backend/scheduler/cron.ts`). This burns continuously regardless of user activity.

---

## 1. COST INFRASTRUCTURE (the shared cost-bearing endpoints)

### 1.1 AI models & where they are used
| Model ID | Provider | Used for | Token ceiling | Source |
|---|---|---|---|---|
| `gpt-4o-mini` | OpenAI | Platform default for **all** gateway ops; long-form *sections*; planning; downgrade target | per-call | `config/env.schema.ts:171,176`; `jobCostEstimator.ts:211` |
| `gpt-4o` | OpenAI | Blog/long-form **body** draft + retries (compat-core engine) | ≤16384 out | `runStandardBlogGeneration.ts:143`; `runBlogGeneration.ts:701-706` |
| `claude-3-5-sonnet` | Anthropic | Cross-provider **fallback** only | `max_tokens ?? 4096` | `aiGateway.ts:1045,756,942` |
| `gpt-image-1` | OpenAI Images | The **only** image generation path; `n:1`, quality `low` | n/a | `creatorAssetRenderer.ts:1942-1969`; `openAIRenderProvider.ts:48` |
| `text-embedding-3-small` | OpenAI | Signal clustering embeddings | n/a | `signalEmbeddingService.ts:16` |
| `sonar` (Perplexity), Gemini, Azure Copilot, Claude Haiku | various | Intelligence **visibility probes** (AEO/GEO citation scan), budget-governed | per-1M priced | `intelligence/costGovernance.ts:94-105`; `perplexityAdapter.ts:11` |

**Timeout tiers** (`aiGateway.ts:289-294`): long-form op OR `max_tokens>8192` → 240s; `>4096` → 120s; else 30s.
**LONG_FORM_OPERATIONS** (uncapped/high-token) — `aiGateway.ts:261-275`: `generateMasterContent`, `generateContentBlueprint`, `blogGeneration`, `blogOptimization`, `newsletterGeneration`, `generateCampaignPlan`.

### 1.2 Call-multiplier mechanics (apply everywhere)
- **Gateway retry + fallback**: 429/529 → 1 same-provider retry, then 1 cross-provider fallback = up to **3 dispatched calls per logical op** (`aiGateway.ts:1285-1369`).
- **De-multipliers**: in-flight coalescing (`aiGateway.ts:1478`) + response cache with TTLs (`aiResponseCache.ts`; e.g. `generateRecommendation`/`generateCampaignRecommendations` cached 6h). **NO_CACHE_OPS** explicitly excludes the 4 engagement reply/triage/memory ops (`aiResponseCache.ts:37-58`).

### 1.3 Non-AI external cost endpoints
| Endpoint | Purpose | Unit | Source |
|---|---|---|---|
| Unsplash / Pexels / Pixabay | Stock image *search* (free-tier, rate-limited) | up to 3 providers × N variants / search | `imageService.ts:28,496,531` |
| dataforseo / serpapi / scaleserp | SERP queries (background cron only) | 1/query; cap 8/run, 25/day | `serpAcquisitionService.ts:165,195,225,377` |
| Perplexity/OpenAI/Anthropic/Gemini/Azure probes | Visibility/citation scan | 1 LLM call per (provider, query) | `intelligence/providerRegistry.ts`, `llmAdapterBase.ts:111` |
| Ahrefs / Wikidata | Backlink authority / knowledge graph | 1 HTTP lookup (if keyed) | `canonicalReportBuilder.ts:935,941` |
| Social platform APIs | Publish, metrics sync, token refresh | per op (see §6) | `backend/adapters/platformAdapter.ts` |
| Community connectors (Reddit/HN OAuth) | Lead/engagement listening | per scan | `connectors/*`, `creditEstimationService.ts:28` |

### 1.4 Existing cost catalog (already in repo — reuse for pricing design)
`shared/monetization/featureRegistry.ts` is the canonical map. **25 CREDIT_ACTIONS** (`:7-33`): `ai_reply, auto_post, content_rewrite, content_basic, content_generation, reply_generation, trend_analysis, market_insight_manual, campaign_creation, website_audit, prediction, insight_generation, pattern_detection, market_positioning, competitor_signals, lead_detection, daily_insight_scan, campaign_optimization, optimization_loop, portfolio_decision, strategy_evolution, voice_per_minute, deep_analysis, full_strategy, campaign_generation`. Charge modes: `free | fixed_credits | metered_usage | token_priced | bundled | internal`. Companion estimators: `pricingService.ts` (real billing math), `jobCostEstimator.ts` (`OPERATION_OUTPUT_TOKENS` per-op budgets, plan cost limits, downgrade), `creditEstimationService.ts` (`PLATFORM_BASE_COST` listening burn), `campaignCostEstimator.ts` (full-campaign projection). *(Note: `backend/services/activityEconomyCatalog.ts` referenced in older notes was not found; `featureRegistry.ts` is the live catalog.)*

---

## 2–6. MASTER ACTIVITY INVENTORY BY MODULE

Legend — **AI** = LLM completion calls · **Img** = `gpt-image-1` image-gen calls · **Search** = SERP/probe/HTTP-fetch external calls · **Intel** = AI-backed scoring (vs deterministic) · **Wkr** = BullMQ/queue jobs · token magnitude S/M/L.

### MODULE: CONTENT CREATION (long-form / writer)
All types route through `runUnifiedLongFormGeneration`. Variants = `target_word_count` (800/1200/1600/2000), NOT separate pipelines. Two engines: **planned-sectionwise** (primary, `gpt-4o-mini`, 1 plan + 1/section + repairs) and **compat-core fallback** (`gpt-4o` monolithic, ≤16384 tok). **No image/search calls anywhere in long-form.** SEO/competitor "intelligence" here is deterministic/simulated.

| Activity → Variant | Execution steps | AI (min/avg/max) | Img | Search | Wkr | Token | Primary driver |
|---|---|---|---|---|---|---|---|
| Blog → Short (~800w) | plan→~4 sections→3 repair gates | 5 / 8 / 16 | 0 | 0 | 0¹ | M | section count × repair loops |
| Blog → Medium (~1200w) | plan→~5 sections→3 gates | 6 / 10 / 19 | 0 | 0 | 0¹ | M | sections + repairs |
| Blog → Deep (~1600w) | plan→~5–6 sections→3 gates | 7 / 11 / 21 | 0 | 0 | 0¹ | M | sections + repairs |
| Blog → Long/Pillar (~2000w) | plan→~6–7 sections→3 gates | 8 / 13 / 24 | 0 | 0 | 0¹ | M–L | section count × per-section tokens × repairs |
| Newsletter | planned flow (also fans 5–12 `newsletterGeneration` in some templates) | 6 / 9 / 18 | 0 | 0 | 0 | M | sections + repairs |
| Article | planned flow | 6 / 10 / 19 | 0 | 0 | 0 | M | sections + repairs |
| Whitepaper | planned flow, most sections (6–8) | 8 / 13 / 26 | 0 | 0 | 0 | L | section count (highest) × repairs |
| Guide | planned flow | 7 / 11 / 21 | 0 | 0 | 0 | M | sections + repairs |
| Story | story-beat flow, skips TL gate | 5 / 8 / 16 | 0 | 0 | 0 | M | section count |
| Case study | normalized to blog flow | 6 / 10 / 19 | 0 | 0 | 0 | M | sections + repairs |
| *(any) → compat-core fallback path* | monolithic draft + ≤2 depth retries + 1 quality retry + hook | 2 / 3 / 6 | 0 | 0 | 0 | **L (≤16384/call)** | full-document regen at token ceiling |

¹ Modal flows are synchronous (no queue). Legacy no-mode blog path enqueues 1 `content-blog` job. **Burn-in mode** (default OFF) runs BOTH engines → doubles all counts.
Sources: `lib/content/unifiedLongFormEngine.ts`, `longFormPlanningEngine.ts:1244,1416,1735,1952,2052`, `runBlogGeneration.ts:701`, `runStandardBlogGeneration.ts`, `runTemplateBlogGeneration.ts`.

### MODULE: CREATOR STUDIO (visual assets)
1 blueprint LLM call emits **all** slide copy regardless of count (`creatorExecutionEngine.ts:479`). `generateProviderImage` is called exactly once in the whole renderer, only for image/banner (`creatorAssetRenderer.ts:2336`). OCR (`creatorOcrProvider.ts:187`) is per-slide HTTP **only if `CREATOR_OCR_ENDPOINT` configured** (else 0).

| Activity → Variant | Execution steps | AI | Img | OCR (min→max) | Wkr | Primary driver |
|---|---|---|---|---|---|---|
| Single Image | blueprint→AI image→composite | 1 | **1** | 0→1 | 0 (inline) | **AI image gen** |
| Banner | blueprint→AI image→composite | 1 | **1** | 0→1 | 0 (inline) | **AI image gen** |
| Infographic | blueprint→copy composer→SVG render | 2 (1 + `creator.infographic.copy` mini) | 0 | 0→1 | 1 | LLM copy (×2) |
| Brand Card | blueprint→SVG render | 1 | 0 | 0 | 0 (inline) | **cheapest asset** |
| Carousel → 5-slide | 1 blueprint (all 5)→5 SVG pages | 1 | 0 | 0→5 | 1 | OCR×5 if cfg, else 1 LLM + CPU |
| Carousel → 10-slide | 1 blueprint (all 10)→10 SVG pages | 1 | 0 | 0→10 | 1 | OCR×10 if cfg, else 1 LLM + CPU |
| Carousel → N-slide | 1 blueprint→N SVG pages | 1 | 0 | 0→N | 1 | linear in slides (OCR+CPU) |
| Deck / Slider → N | 1 blueprint→N SVG (1600×900) | 1 | 0 | 0→N | 1 | OCR×N / CPU |
| PDF deck → N | 1 blueprint→N SVG (1200×1500) | 1 | 0 | 0→N | 1 | OCR×N / CPU |
| Video | blueprint only (renderer = placeholder stub) | 1 | 0 | 0 | 0 | **no render consumption** |

Dormant `ENABLE_CREATOR_RENDERING` substrate (default OFF) would add 1 `gpt-image-1` hold per image asset if enabled. Sources: `creatorAssetRenderer.ts`, `executionEngines/creatorExecutionEngine.ts`, `creator/infographicCopyComposer.ts:364`, `creatorRenderDurableQueue.ts`.

### MODULE: BOLT & INTELLIGENT MIX CAMPAIGNS
Shared pipeline `executeBoltPipelineRuntime` (`boltPipelineService.ts:1285`). Stages: source-rec → **ai/plan** (1–3 LLM, large tokens) → commit → **generate-weekly-structure** (0 LLM, deterministic) → creator-asset-gen → **schedule (fan-out)**. Let **R = Σ(frequency) × weeks**, **P = platforms/row**.

| Activity → Variant | Planning AI | Per-row content | Fan-out AI | Img | Wkr | Primary driver |
|---|---|---|---|---|---|---|
| BOLT Text → week_plan (preview only) | 1–3 | none (stops stage 3) | 0 | 0 | 1 | planning only |
| BOLT Text → Standard (1–4 wk cap) | 1–3 | 1 master (uncapped) + 1–2 variant×P | ~R master + R·P variant | 0 | 1 + ~R | **schedule fan-out (R)** |
| BOLT Creator (1–4 wk) | 1–3 | text lane + 2 LLM/creator row | ~R text + ~2/visual row | 1 per image/banner row (carousel=0) | 1 + ~R | fan-out + image rows |
| Intelligent Mix / Combined (**1–12 wk cap**) | 1–3 | text lane + creator lane mixed | up to ~48 master + ~96 variant + ~48 creator (12wk example) | ~24 (image/banner rows) | 1 + ~R (≈72) | **duration×frequency fan-out (heaviest)** |
| Campaign Chat (Architect/brainstorm) | 1 (`gpt-4o-mini`) per message | — | — | 0 | 0 | 1 call/message |

Token magnitude: planning + every text `master` are **uncapped long-form**; variants + creator angle/content are `gpt-4o-mini` capped. Queues: `bolt-execution` (1/run), `bolt-content-jobs` (1 per content_type×topic group, attempts 3), creator row exec (1/renderable row, parallel cap 8). Mitigations: master-content caching + reuse skip + refinement-phase skipping under budget. Sources: `boltPipelineService.ts:455,507,552,760,911,1242,1392`, `boltContentGenerationForSchedule.ts:268,278`, `platformVariantGenerator.ts:503,570`, `creatorContentProcessor.ts:505,573`, `structuredPlanScheduler.ts:1017`.

### MODULE: MARKET PULSE / DIGITAL PRESENCE / COMPANY PROFILE (search-heavy reports)
| Activity → Variant | Execution steps | AI | Probe/Search calls | Img | Wkr | Primary driver |
|---|---|---|---|---|---|---|
| Market Pulse → Scan Standard (1 region, hybrid) | resolve region→1 LLM diagnostic→DB aggregate | 0 / 1 / 1 | 0 (SERP is cron-only) | 0 | 1 (`market-pulse-job`) or inline | LLM (1/region) |
| Market Pulse → Deep / Regional (N regions) | loop 1 LLM per region | 0 / N / N | 0 | 0 | 1 | **LLM, linear in region count (unbounded)** |
| Digital Presence / Snapshot Report → Standard | compose decisions → `buildCanonicalReport` → AI citation matrix (5 providers × ≤12 queries) + ≤4 adapter lookups | **0 / ~12–24 / ~60** probe calls | up to 60 LLM probes + Wikidata/Ahrefs/benchmark lookups (each only if keyed); **0 inline SERP** | 0 | 0 (inline) | **multi-provider LLM visibility probes** |
| Snapshot Report → Deep profile | same but budget 400 req/$12, `preferCache:false` (forces re-bill); not reachable from public snapshot API | up to ~60 (more actually fire) | same | 0 | 0 | probes (cache disabled) |
| Performance Intelligence Report | wraps `composeSnapshotReport` | inherits Snapshot's 0–60 | inherits | 0 | 0 | inherited snapshot probes |
| Market Growth Intelligence Report | decision-object composition | **0** | **0** | 0 | 0 | none (DB-only) |
| Company Profile / onboarding refine | crawl→≤40 source fetches→clean-evidence AI→extraction→missing-field Q→competitor discovery→strategy draft→marketing intel→≤8 field refines→problem-transform→2 enrich | **~5 / 10–12 / 18–20** | ≤40 HTTP crawl/fetch (largest input-token stage) | 0 | inline | **LLM completions + crawl fan-out** |
| Company Intelligence engine/dashboard | token/relevance scoring over signals | **0** | 0 | 0 | 0 | DB-only |

Probe pricing per-1M (`costGovernance.ts:94-105`): chatgpt .15/.60, claude(Haiku) .80/4.00, gemini .075/.30, perplexity 1.00/1.00, copilot .15/.60. Sources: `marketPulseJobProcessor.ts:104,129`, `opportunityGenerators.ts:223,319`, `snapshotReportService.ts:406`, `canonicalReportBuilder.ts:911,925-956`, `aiCitationMatrixService.ts:152`, `companyProfileService.ts:2214-2364`.

### MODULE: ENGAGEMENT CENTER (high-frequency background AI)
All `gpt-4o-mini`, default output cap 800. The 4 reply/triage/memory ops are **uncached** (`NO_CACHE_OPS`).
| Activity → Variant | AI op | AI per item | Search | Wkr / cadence | Primary driver |
|---|---|---|---|---|---|
| Inbound comment ingest | `analyzeMessage` (Omnivyra) + `sentiment_classification` | 0 / ~1 / 2 | platform poll (10-min cron) | `recentPublishedPostsIngest` 10 min | comment volume × Omnivyra-enabled |
| Conversation triage (recurring) | `conversationTriage` (uncached) | 0 / 1 / 1 per thread/cycle | — | **worker every 3 min, BATCH 15 → ≤7,200/day** | **highest-frequency AI loop** |
| Conversation memory summary | `conversationMemorySummary` (uncached) | 1 (gated ≥5 new msgs) | — | 5-min safety-net drain | summary calls, self-throttled |
| Reply generation | `responseGeneration` (uncached) +retry | 1 / 1.2 / 2 | — | user or auto | input context size + retry |
| Reply suggestion (inbox) | `engagement_reply_suggestions` (`max_tokens:700`) | 1 | — | user-initiated | single call |
| Community execution (auto-post) | `community_execution` | **0 AI** (posts pre-generated) | social publish API | action | social-API quota |

Deterministic (0 AI): opportunity engine (regex), signal capture, learning/aggregation workers. Sources: `conversationTriageWorker.ts:13,64`, `cron.ts:147-207`, `responseGenerationService.ts:159,188`, `engagementIngestService.ts:28,60`, `engagementConversationIntelligenceService.ts:140`.

### MODULE: ACTIVE LEADS
| Activity → Variant | AI op | AI per item | Listening calls | Wkr / cadence | Primary driver |
|---|---|---|---|---|---|
| Lead qualification (Reactive) | `qualifyLead` (uncached, uncapped) | **1 per discovered post** | 1 connector call × platforms × regions | scheduled lead-job | **per-post LLM (largest aggregate AI burn)** |
| Lead qualification (Predictive) | `qualifyPredictiveLead` | 1 per post | same | same | per-post LLM |
| Lead detection / clustering / noise filter | — | **0 AI** (regex + math) | — | — | none |
| Scheduled lead scan (recurring) | fans out qualifiers | Σ(platforms × regions × posts) | 3 platforms global (`reddit,linkedin,twitter`) | **07:00 & 18:00 daily**, ≤500 cos, 2 jobs/co/24h | per-post fan-out × companies |
| Autonomous-listening burn (activation estimate) | deterministic projection | n/a | `PLATFORM_BASE_COST`: LI 8, FB/IG 6, X/Pin 4, Reddit 3, Threads/YT/TikTok 5, HN 2 | per-run × runs/month × volatility | listening platform quota |

Sources: `leadJobProcessor.ts:189-244`, `leadQualifier.ts:98`, `leadPredictiveQualifier.ts:97`, `schedulerService.ts:914,931,945`, `creditEstimationService.ts:28,46,55`.

### MODULE: RECOMMENDATIONS / INTELLIGENCE LAYER / ANALYTICS / REPORTING
Overwhelmingly **deterministic** — only 4 AI ops in scope (all `gpt-4o-mini`, several fallback-only, 6h-cached).
| Activity | AI? | AI calls | Search | Cadence / Wkr | Primary driver |
|---|---|---|---|---|---|
| `/recommendations/generate` (core engine) | mostly **deterministic** | 0 (happy path); **2** max on empty-signal fallback (`generateAdditionalStrategicThemes`+`generateRecommendation`) | 1 trend-API fetch × regions + 2 Omnivyra HTTP | inline | external trend-API search |
| `/recommendations/long-form/generate` | **AI** | 1 to MAX_RETRY_ROUNDS+1, ≤6000 tok each | 0 | inline | retry rounds |
| `/campaigns/[id]/recommendations` | **AI** | 1 (`generateCampaignRecommendations`, heuristic fallback) | 0 | inline | single call |
| Legacy scoring engine / multi-region job | deterministic | 0 | 0 | scheduler | worker compute |
| All other recommendation services (optimization, feedback, blueprint, builder, source, behavior, community) | deterministic | 0 | 0 | varies | DB/compute |
| Intelligence layer (core engine, signal, strategic, predictive, decision, simulation) | deterministic | 0 | 0 | hourly–daily | worker compute |
| **Daily intelligence sweep** (`dataDrivenIntelligenceScheduler`) | deterministic | 0 | trend/signal reads | **daily, 19 decision generators × N companies** | **largest compute burn (0 tokens)** |
| All analytics services + reporting (exec/automation/decision/composer) | deterministic | 0 | 0 | varies | DB aggregation |

Note: `blogAnalyticsInsight` AI op lives in `pages/api/track/ai-insights.ts:156` (on-demand), not the analytics service layer. The `intelligence/` adapter subfolder is the AEO/GEO citation product (covered under Snapshot Report), not this scope. Sources: `recommendationEngine/engine.ts:123,310,366`, `longFormRecommendationEngine.ts:283,465`, `strategicThemeEngine.ts:767`, `jobCostEstimator.ts:65-67`, `aiResponseCache.ts:75`, `dataDrivenIntelligenceScheduler.ts:46,67-120,260`.

### MODULE: PUBLISHING / SOCIAL / SCHEDULER / WORKERS / QUEUES (recurring backbone — ~0 AI)
**Per-publish external social-API calls** (`platformAdapter.ts:174-211`): LinkedIn 1(+media), X 1 (+token refresh per publish), Instagram **2–3** (container→poll→publish), Facebook 1–2, YouTube **~6** (resumable upload), TikTok ~5, Pinterest ~4, WordPress/CMS via `publishing_jobs`. Community platforms (Reddit/Discord/Quora/Slack/Threads/WhatsApp) via community-AI / Playwright RPA.

**BullMQ queues** (each = worker compute + Redis load): `publish`, `posting`, `engagement-polling` (c1), `bolt-execution`, `ai-heavy` (c3, 5/s), `engine-jobs` (c2), `intelligence-polling`, `lead-thread-recompute` (c1), `conversation-memory-rebuild` (c1), `creator-render`, `publishing_jobs` (30s DB-poll), plus 14 content queues (`content-blog/post/whitepaper/story/newsletter/engagement/refinement`, `bolt-content-jobs`, `creator-video/carousel/story`, `whatsapp-broadcast/webhook`, `analytics-ingestion`) and `lead-jobs/lead-dlq`, `planner-refinement`, `engagement-signals`, `listening-executions`, `semantic-indexing`, `replay-partition`.

**Vercel crons** (`vercel.json:3-46`, the only platform-scheduled): `process-scheduled-posts` (daily 3am), `analytics-ingestion` (daily 2am→4 sub-jobs), `serp-acquisition` (2:30am), `market-pulse-automation` (4:30am), `email-jobs` (1am), `integration-health-sweep` (3:30am), `sweep-stuck-publishing` (every 5 min, DB-only), `reconcile-recent-publishes` (every 10 min, default OFF).

**Worker `startCron()` recurring burn** (`cron.ts` — the real continuous cost): social-account token refresh 10 min, engagement-polling enqueue 10 min, recent-posts ingest 10 min, intelligence polling 2h, GA4 ingestion 6h, engagement signal scheduler 15 min, community-AI lease reaper 30s, metric DLQ flush 60s, RPA backpressure 60s / retry 90s (Playwright), creator-render orphan recovery 10 min, autoscaling+metrics snapshot 5 min, ~20 learning engines 30 min–weekly.

**Primary drivers (ranked):** (1) **Railway worker uptime 24/7** (fixed); (2) **Redis/queue compute** (idle-poll workers + CronGuard + 20+ queues); (3) **social-API quota** (per-publish + 10-min polling + 15-min signal scheduler + token refresh); (4) **CPU/render** (creator-render + RPA browser). Sources: `backend/workers/main.ts:62-326`, `backend/scheduler/cron.ts:142-211`, `backend/adapters/platformAdapter.ts:64-211`, `backend/queue/bullmqClient.ts:485-647`, `contentGenerationQueues.ts:38-207`, `vercel.json:3-46`.

---

## 7. COST-DRIVER SUMMARY — TOP THREE (system-wide)

1. **LLM tokens — content-generation fan-out** (BOLT/Intelligent Mix schedule stage + long-form content). Uncapped `generateMasterContent` + per-platform variants, scaling with frequency × weeks × platforms. The single largest *variable, user-driven* cost.
2. **LLM tokens — recurring background loops** (lead qualifier per-post × 500 companies × 2/day, conversation-triage ≤7,200/day, snapshot visibility probes ≤60/report). Uncached, continuous; the largest *aggregate* token burn over time.
3. **Background-worker compute + Redis/queue load** (Railway worker 24/7, daily 19-service intelligence sweep × companies, ~20 BullMQ queues, sub-minute cron timers). Fixed infrastructure cost independent of user activity.

Secondary drivers: **image generation** (`gpt-image-1`, narrow — single-image/banner only), **social-API quota** (publishing + 10-min polling), **external search/probe APIs** (SERP cron + multi-provider citation probes + Ahrefs/trend-API quota), **CPU render** (creator SVG/sharp + RPA Playwright).

---

## 8. AUDIT NOTES & CAVEATS
- All counts are **per single invocation** unless marked "recurring/cycle." "Max" reflects worst-case (cold cache, all retries, all providers keyed, largest variant).
- Token magnitude is qualitative (S/M/L) with `max_tokens` cited where set; the codebase does no tiktoken counting (real usage comes from provider response — `aiGateway.ts:1656`).
- Feature flags that gate cost OFF by default: `ENABLE_CREATOR_RENDERING`, `RECONCILIATION_CRON_ENABLED`, `autonomous-scheduler`, Omnivyra microservice (`isOmnivyraEnabled()`), burn-in mode, OCR endpoint. Several "max" paths only fire when these or external API keys are present.
- Deterministic ≠ free: ~90 intelligence/analytics services consume **worker CPU + DB**, not tokens — fold them into infrastructure cost, not per-action credit cost.

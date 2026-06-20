# OMNIVYRA — ACTIVITY CONSUMPTION & CREDIT CALIBRATION AUDIT

**Audit only. No code/migration/pricing changed.** Evidence = actual code paths, max_tokens caps, content/campaign configuration, and a **live read-only token census** of prod. Credits in Section J are derived **independently** (not from the existing catalog).

> **Live corroboration of the token estimates (census, prod):** `usage_events` holds **585 LLM calls = Σ 1.1M tokens** → **~1,900 tokens/call average**, model `gpt-4o-mini`, across `generateCampaignPlan / parsePlanToWeeks / generateMasterContent / profileExtraction / runDiagnosticPrompt …`. This confirms the structure-derived per-call token figures below are in the right magnitude. (Cost USD is *not* persisted — see `CREDIT_ENGINE_TELEMETRY_AUDIT.md` — so credit calibration here is grounded in token structure, not measured $.)

---

## SECTION A — ACTIVITY INVENTORY (route / service / worker / queue / processor)
| Group | Activity | Route | Service | Worker / Queue / Processor |
|---|---|---|---|---|
| Content | Post / Thread / Story / Blog / Article | `pages/api/blogs/*`, `pages/api/bolt/*` | `lib/content/unifiedLongFormEngine.ts`, `longFormPlanningEngine.ts`, `aiGateway.ts` | `content-blog/post/story/...` queues; `contentGenerationProcessor` |
| Creator | Image / Banner | `pages/api/creator-assets/*` | `creatorAssetRenderer.ts` (`composeSingleVisualAsset:2336`), `creatorExecutionEngine.ts:479` | `creator-render` queue; `creatorRenderWorkerProcessor` |
| Creator | Carousel / Infographic | same | `creatorAssetRenderer.ts` (SVG+sharp; `infographicCopyComposer.ts`) | `creator-render` queue |
| Campaigns | BOLT / BOLT Creator / Intelligent Mix / Strategic | `pages/api/bolt/execute.ts` | `boltPipelineService.ts:1285`, `structuredPlanScheduler.ts`, `campaignAiOrchestrator.ts` | `bolt-execution`, `bolt-content-jobs` queues; `boltContentJobProcessor`, `creatorContentProcessor` |
| Intelligence | Digital Snapshot / Growth / Market Pulse | `pages/api/reports/snapshot.ts`, `pages/api/market-pulse/run.ts` | `snapshotReportService.ts`, `canonicalReportBuilder.ts`, `marketPulseJobProcessor.ts:104` | `engine-jobs`, `market-pulse-job` queues |
| Engagement | Reply / Inbox Analysis / Triage | `pages/api/engagement/*` | `responseGenerationService.ts:159`, `engagementIngestService.ts:60`, `conversationTriageService.ts:126` | `engagement-polling` queue; `conversationTriageWorker` (cron 3 min) |
| Voice | Transcription / Processing | `pages/api/voice/transcribe.ts` | Whisper (`:112`), AssemblyAI (`:152`) | synchronous HTTP |
| Leads | Active Leads Discovery | `pages/api/active-leads/*` | `leadQualifier.ts`, `leadPredictiveQualifier.ts:97` (`runDiagnosticPrompt`) | `lead-jobs` queue; `leadJobProcessor:189`; cron 07:00 & 18:00 |
| Analytics | AI Insights / Recommendations / Summaries | `pages/api/recommendations/*`, `pages/api/track/ai-insights.ts:156` | `recommendationEngine` (mostly deterministic), `strategicThemeEngine.ts:767`, `longFormRecommendationEngine.ts:283` | `recommendation` jobs; daily intelligence scheduler |

---

## SECTION B — CONTENT SIZE ANALYSIS (actual config)
Drivers: `target_word_count` UI options **800 / 1200 / 1600 / 2000** (`BlogGenerateModal.tsx:605-608`); planned engine = 1 plan + 1/section + ≤3 repair gates; section cap `min(5000,max(1800,wt×3.2))` (`longFormPlanningEngine.ts:1416`); compat-core body cap **16,384** (`runBlogGeneration.ts:701-706`); `OPERATION_OUTPUT_TOKENS` (`jobCostEstimator.ts:49-75`). ~6 chars/word.

| Activity | Min chars / words / tok | Typical chars / words / tok | Max chars / words / tok |
|---|---|---|---|
| Blog | 4,200 / 700 / **13,500** | 7,200 / 1,200 / **40,000** | 12,600 / 2,100 / **180,000** |
| Article | 4,800 / 800 / **16,200** | 9,000 / 1,500 / **45,000** | 9,600 / 1,600 / **142,500** |
| Post | ~600 / 100 / **1,500** | ~1,200 / 200 / **5,000** | ~3,000 / 500 / **12,000** |
| Thread | ~1,800 / 300 / **3,000** | ~3,600 / 600 / **10,000** | ~9,000 / 1,500 / **25,000** |
| Story | 3,600 / 600 / **8,000** | 6,000 / 1,000 / **25,000** | 7,200 / 1,200 / **120,000** |

| Activity | Min Tokens | Typical Tokens | Max Tokens |
|---|---|---|---|
| Blog | 13,500 | 40,000 | 180,000 |
| Article | 16,200 | 45,000 | 142,500 |
| Thread | 3,000 | 10,000 | 25,000 |
| Story | 8,000 | 25,000 | 120,000 |
| Post | 1,500 | 5,000 | 12,000 |

---

## SECTION C — CREATOR ASSET ANALYSIS (actual paths)
1 blueprint LLM call emits all slide copy (`creatorExecutionEngine.ts:479`); `generateProviderImage` fires **once, image/banner only** (`creatorAssetRenderer.ts:2336`, `gpt-image-1`); carousel/infographic = **SVG+sharp, zero image gen**; OCR is per-slide HTTP only if `CREATOR_OCR_ENDPOINT` set; retries = gateway 1 retry +1 fallback.

| Asset | Min Tok | Typical Tok | Max Tok | External API Usage |
|---|---|---|---|---|
| Image | 2,100 | 4,000 | 6,000 | **1 `gpt-image-1`** (~$0.011) |
| Banner | 2,100 | 4,000 | 6,000 | **1 `gpt-image-1`** (~$0.011) |
| Carousel | 3,300 | 6,500 | 11,000 | 0 image; 0→N OCR (if configured) |
| Infographic | 3,300 | 6,000 | 8,500 | 0 image (+1 mini copy call) |

---

## SECTION D — CAMPAIGN ANALYSIS (actual structure)
Rows **R = Σ(format frequency) × weeks** (`boltPipelineService.ts:552-570`); duration caps **1–4 wk** BOLT / **1–12 wk** Intelligent Mix (`:760`). Stages: source-rec (0 LLM) → **ai/plan** (1–3 LLM) → commit (0) → **generate-weekly-structure** (0 LLM, deterministic) → **creator-asset-gen** (per-row, combined/creator) → **schedule fan-out** (1 uncapped master + 1–2 variants/platform per row). Min = week_plan preview (stops at stage 3); Typical/Max scale with R.

| Campaign | Min Tok | Typical Tok | Max Tok |
|---|---|---|---|
| BOLT Campaign | 6,000 (week_plan) | 150,000 (freq 5 / 2wk) | 695,000 (freq 7 / 4wk / 4 platforms) |
| BOLT Creator Campaign | 60,000 | 200,000 | 450,000 (+ image rows) |
| Intelligent Mix | 100,000 | 300,000 | 900,000 (12wk, text+creator) |
| Strategic Campaign* | 200,000 | 500,000 | 900,000 (+ intelligence probes) |

*Strategic = highest-tier orchestration (Intelligent Mix 12wk + `full_strategy` intelligence). Campaign token counts are the **planning + fan-out** sum; the fan-out (R × per-row) dominates.

---

## SECTION E — INTELLIGENCE ANALYSIS (actual paths)
Market Pulse = `generateMarketPulseForRegion`, **1 LLM/region** (`opportunityGenerators.ts:223`, `marketPulseJobProcessor.ts:129`). Digital Snapshot = `buildCanonicalReport` → AI citation matrix, **up to 60 visibility probes** (5 providers × ≤12 queries, `aiCitationMatrixService.ts:152`) + ≤4 adapter lookups (own gpt-4o-mini ≈ 0). Growth Intelligence = **0 external** (DB composition, `growthReportService.ts`).

| Activity | Min Tok | Typical Tok | Max Tok | API Calls |
|---|---|---|---|---|
| Digital Snapshot | 6,000 | 40,000 | 84,000 | 12–60 probe calls (provider-keyed) + ≤4 lookups |
| Growth Intelligence | 0 | 0 | 0 | 0 (DB only) |
| Market Pulse | 2,700 (1 region) | 12,000 | 180,000 (N regions deep) | 0 inline (SERP is cron-only) |

---

## SECTION F — ENGAGEMENT ANALYSIS (actual paths)
| Activity | Min Tok | Typical Tok | Max Tok | Path |
|---|---|---|---|---|
| Reply Generation | 1,600 | 3,000 | 5,600 | `responseGeneration` gateway, +1 perspective-retry (`responseGenerationService.ts:188`); uncached |
| Inbox Analysis | 140 | 250 | 310 | `sentiment_classification` direct OpenAI, cap 60 out (`engagementIngestService.ts:60`); rule fast-path first |
| Conversation Triage | 600 | 1,200 | 1,800 | `conversationTriage` gateway, BATCH 15 / 3 min (`conversationTriageWorker.ts:13`); uncached |

---

## SECTION G — VOICE ANALYSIS (actual paths)
Whisper `fetch /v1/audio/transcriptions` (`voice/transcribe.ts:112`) or AssemblyAI (`:152`); cost via `captureFlatProviderCost` = seconds/60 × **$0.006/min** (Whisper) (`blackHoleCostCapture.ts:143`). Token-less (audio). **Org-gated** (skips if no `companyId`/`organization_id`).

| Activity | Min Tok | Typical Tok | Max Tok | External Cost Factors |
|---|---|---|---|---|
| Voice Transcription | n/a (1 min) | n/a (3 min) | n/a (10 min) | Whisper $0.006/min → $0.006 / $0.018 / $0.060 |
| Voice Processing | folds into transcription | — | — | same provider; no separate LLM unless summarized (then +1 gateway call) |

---

## SECTION H — LEADS ANALYSIS (actual paths)
`leadJobProcessor.ts:189-244`: per platform → per region → **per discovered post** → `qualifyLead`/`qualifyPredictiveLead` = **1 LLM call/post** (`runDiagnosticPrompt`, 400–900 in / 100–300 out). Community scanning = connector calls (Reddit/HN/LinkedIn). No batching/cache.

| Activity | Min Tok | Typical Tok | Max Tok |
|---|---|---|---|
| Active Leads Discovery (per scan) | 5,000 (≈10 posts) | 40,000 (≈40 posts × 3 platforms) | 150,000+ (hundreds of posts) |

---

## SECTION I — EXTERNAL API COST MATRIX
| Provider | Used By | Consumption Unit | Cost Driver |
|---|---|---|---|
| OpenAI (gpt-4o-mini) | ~all LLM activities | token (in/out) | $0.15/$0.60 per 1M |
| OpenAI gpt-image-1 | Image, Banner, campaign image rows | per image | ~$0.011 (low, 1024²) |
| OpenAI Whisper | Voice Transcription | per audio-minute | $0.006/min |
| AssemblyAI | Voice (alt provider) | per audio-minute | provider rate |
| Perplexity / Anthropic / Gemini / Azure | Digital Snapshot, deep Market Pulse probes | per-1M probe tokens | Perplexity $1/$1 (priciest) |
| DataForSEO / SerpAPI / ScaleSERP | SERP warehouse (**cron only**) | per query | $0.002 / $0.01 / $0.01 |
| Ahrefs / Wikidata | Snapshot authority/KG | subscription / free | — |
| X / LinkedIn / Meta / YouTube / TikTok | Publishing + polling | per request | **$0** (free quota) |

---

## SECTION J — CREDIT CALIBRATION (derived independently)
**Method (transparent, evidence-based):** `credits = round( BASE × max(consumption_factor, value_factor) )`, BASE = 1 credit = the cheapest meaningful outcome (an AI reply: ~1,900 tok, ~$0.002). `consumption_factor` = activity typical-token (and image/API) ÷ base; `value_factor` = customer-outcome value (1–10) scaled. Credit = the higher of the two, lightly rounded — so a credit reflects **AI + API + workload OR value, whichever is greater**. (Independent of the current `credit_cost_config`.)

| Activity | Recommended Credits | Reason (consumption ∥ value) |
|---|---|---|
| AI Reply / Inbox / Triage | **1** | base unit; ~250–3k tok, value 1–2 |
| Post | **3** | short content; value 2 |
| Thread | **5** | multi-post; value 3 |
| Story | **8** | ~25k tok; value 4 |
| Blog | **12** | ~40k tok typical; value 6 |
| Article | **12** | ~45k tok; value 5 |
| Whitepaper / Deep Blog | **20–25** | high token + value 6 |
| Carousel / Infographic | **8** | low token, **0 image**; value 5 (cost-cheap → value-led) |
| Image / Banner | **12** | image-gen COGS ($0.011) + value 4–5 |
| Market Pulse (standard) | **10** | 1 LLM/region; value 7 (value-led) |
| Market Pulse (deep) | **30** | N-region fan-out; value 8 |
| Digital Snapshot | **25** | up to 60 probes (real API $) + value 8 |
| Growth Intelligence | **15** | 0 cost but value 8 (pure value) |
| BOLT Campaign | **25** (plan) + items | planning value 8; content billed per-item |
| BOLT Creator Campaign | **35** (plan) + items | + image rows |
| Intelligent Mix | **50** (plan) + items | strategic, value 9 |
| Strategic Campaign | **75** (plan) + items | highest value 10 + probes |
| Active Leads Discovery (per scan) | **15** | per-post fan-out; value 8 |
| Lead Qualification (per lead) | **2** | per-result option |
| Voice Transcription | **2 / min** | $0.006/min × value 3 |
| AI Insight / Recommendation / Summary | **3** | mostly deterministic; value 4 |

**Two calibration notes from the evidence:** (1) **Carousel/Infographic generate no images** — pricing them like Image (12) would *overprice* them vs COGS; derived at **8** (value-led). (2) **Growth Intelligence / Market Pulse have near-zero COGS but high value** — credits are value-led, not cost-led (the intended divergence).

---

## SECTION K — PLAN SIMULATION (against the proposed 300 / 300 / 700 / 1500)
Using a "BOLT Campaign" = plan 25 + ~5 posts (5×3=15) = **40**; "Asset" = avg creator **10** (mix of image 12 / carousel 8).

### FREE COMPANY — 300 credits — target bundle
| Item | Qty | Credits |
|---|---|---|
| BOLT Campaign | 2 | 80 |
| Blog | 2 | 24 |
| Asset | 10 | 100 |
| Market Pulse exploration | 2 | 20 |
| Engagement assistance | 20 replies | 20 |
| **Total** | | **244** |
**→ YES.** Remaining **56** (81% used). The free bundle fits with modest headroom. *(If all 10 assets are images @12 → 264, remaining 36 — still YES but tight.)*

### STARTER — 300 credits/mo — typical monthly
| Item | Qty | Credits |
|---|---|---|
| Blog | 4 | 48 |
| BOLT Campaign | 1 | 40 |
| Asset | 8 | 80 |
| Market Pulse | 2 | 20 |
| Engagement | 40 replies | 40 |
| Digital Snapshot | 1 | 25 |
| **Total** | | **253** |
**→ YES (light/typical).** Remaining **47**. ⚠ A *moderately active* Starter (8 blogs, 2 campaigns, 15 assets) ≈ **416 > 300 → NO** — Starter at 300 caps active creators; expect frequent top-ups.

### GROWTH — 700 credits/mo — typical monthly
| Item | Qty | Credits |
|---|---|---|
| Blog | 8 | 96 |
| BOLT Campaign | 3 | 120 |
| Asset | 20 | 200 |
| Market Pulse | 4 | 40 |
| Reports (Snapshot/Growth) | 2 | 45 |
| Active Leads Discovery | 4 scans | 60 |
| Engagement | 80 replies | 80 |
| **Total** | | **641** |
**→ YES.** Remaining **59** (92% used). Fits typical Growth; little slack for spikes.

### BUSINESS — 1500 credits/mo — typical (agency)
| Item | Qty | Credits |
|---|---|---|
| Blog | 20 | 240 |
| BOLT / Mix Campaigns | 8 | 360 |
| Asset | 40 | 400 |
| Reports + deep Market Pulse | 8 | 200 |
| Active Leads Discovery | 8 scans | 120 |
| Engagement | 150 replies | 150 |
| **Total** | | **1,470** |
**→ JUST FITS.** Remaining **30** (98% used). ⚠ A true heavy agency exceeds 1,500 → **top-ups expected**.

---

## SECTION L — FINAL RECOMMENDATION
| Question | Answer (evidence) |
|---|---|
| **300 free sufficient?** | **YES** — target trial bundle = 244 cr (81% used). Good activation design; touches all modules with headroom. |
| **Starter 300 sufficient?** | **PARTIALLY** — fits a light/typical Starter (~253) but an *active* Starter exceeds it (~416). 300 is on the low side for a paid tier; consider 500–750 or expect top-up reliance. |
| **Growth 700 sufficient?** | **YES** for typical (~641, 92% used); thin slack for busy months. |
| **Business 1500 sufficient?** | **TIGHT** — typical agency ≈ 1,470 (98%); heavy agencies overflow → top-ups. Consider 2,000–2,500 for headroom. |

**Overpriced (vs consumption):** Carousel/Infographic if priced like images (no image-gen COGS) — derived down to 8. Voice if flat-rated above $0.006/min value.
**Underpriced (vs value/COGS):** Digital Snapshot & deep Market Pulse (real multi-provider probe COGS up to ~$0.085 + high value) — 25/30 is a floor, not generous. Intelligent Mix / Strategic plan base (50/75) is low relative to the fan-out value they unlock. Lead Discovery (per-post LLM aggregate) at 15/scan is value-fair but COGS-sensitive at high post volumes (fair-use cap needed).

**Recommended final credit catalog:** the Section-J table (reply 1 · post 3 · thread 5 · story 8 · blog/article 12 · whitepaper 20–25 · carousel/infographic 8 · image/banner 12 · market pulse 10/30 · snapshot 25 · growth 15 · campaigns 25/35/50/75 + items · leads 15/scan · voice 2/min · insights 3).

**Recommended final subscription capacities (revised from the proposal):** Free **300** (keep), Starter **500–750** (300 caps active users), Growth **700–1,000**, Business **2,000–2,500** (1,500 too tight for agencies). The proposed 300/700/1500 *work for light–typical usage* but leave little headroom at Starter and Business.

**Recommended top-up capacities:** 250 / 1,000 / 3,000 / 10,000 — sized to bridge the Starter and Business overflow points identified above.

**Confidence level: 72 / 100.** Token ranges are **structure-derived and corroborated by live token data** (585 calls / 1.1M tokens, gpt-4o-mini), so consumption is well-grounded. But two evidence limits cap confidence: (1) **per-call USD cost is not persisted in prod** (`total_cost_usd` null on 0/585 — see telemetry audit), so credit calibration is grounded in *tokens + structure*, not measured $; and (2) **"typical monthly usage" profiles are assumed**, not derived from real per-customer behavior (no live usage distribution exists yet). **Both resolve the same way: run credit metering in SHADOW, capture real per-activity token+cost and real per-customer monthly volumes, then re-confirm the catalog and capacities before launch.**

*(Audit only. No code, schema, migration, credit rule, or price was created or modified. Live checks were read-only.)*

# OMNIVYRA — CONSUMPTION ECONOMICS & CREDIT-ENGINE TELEMETRY AUDIT

**Question:** does Omnivyra have enough telemetry / token accounting / API accounting / attribution **today** to run a production credit economy?
**Audit only — no code changed.** Evidence = repository code (file:line) **+ a live read-only census of the production database** (2026-06-17). Every conclusion is cited.

> ## VERDICT (one line)
> The **instrumentation is largely built** (comprehensive `usage_events` + a bank-grade ledger), but the **production telemetry is not operationally complete**: tokens are captured but **USD cost is null on 100% of rows**, the **usage_events pipeline has been stale since 2026-03-14**, **image/voice cost rows have never been written**, and **enforcement is dark** (only ~3 routes deduct). → **Activity-based (fixed) credits = READY. Token-based credits = NOT READY (cost dark + stale). Hybrid = PARTIALLY READY (coded, not operational).**

### Evidence pillars (live census, prod project `klkiseupptzbecbxwrky`)
| Telemetry table | Rows | Signal |
|---|---|---|
| `usage_events` | **585** | token capture exists |
| ↳ `total_tokens > 0` | **582** | ✅ tokens populated (Σ 1.1M tokens, `gpt-4o-mini`) |
| ↳ `total_cost_usd` not null | **0** | ❌ **cost never populated** |
| ↳ `source_type=llm / system / embedding / external_api` | 582 / **0** / **0** / 3 | ❌ no image/voice/embedding rows |
| ↳ newest event | **2026-03-14** | ❌ **pipeline stale ~3 months** |
| ↳ `action_key` populated | **0 / 585** | ❌ attribution key null (process_type present) |
| `unified_transactions` | 67,485 | analytics table populated (provenance ≠ usage_events 1:1) |
| ↳ `credits_charged > 0` | **79** | enforcement sparse |
| `credit_transactions` (ledger) | 333 | ✅ ledger live & recent |
| `credit_usage_log` | 138 | ✅ deduction log live (recent) |
| `organization_credits` (wallets) | 27 | ✅ wallets live |
| `usage_meter_monthly` / `usage_billing_snapshots` | 22 / 1 | partial rollups |

---

## SECTION A — CHARGEABLE ACTIVITY INVENTORY (route / service / worker / queue / processor)
| Group | Activity | Route | Service | Worker / Queue / Processor |
|---|---|---|---|---|
| Content | Post/Thread/Story/Blog/Article | `pages/api/blogs/*`, `bolt/*`, content modal | `lib/content/unifiedLongFormEngine.ts`, `aiGateway.ts` | `content-blog/post/...` queues; `contentGenerationProcessor` |
| Creator | Image/Banner | `pages/api/creator-assets/*` | `creatorAssetRenderer.ts` (`composeSingleVisualAsset:2336`) | `creator-render` queue; `creatorRenderWorkerProcessor` |
| Creator | Carousel/Infographic | same | `creatorAssetRenderer.ts` (SVG+sharp) | `creator-render` queue |
| Campaigns | BOLT / BOLT Creator / Intelligent Mix / Strategic | `pages/api/bolt/execute.ts` | `boltPipelineService.ts`, `structuredPlanScheduler.ts` | `bolt-execution`, `bolt-content-jobs` queues; `boltContentJobProcessor`, `creatorContentProcessor` |
| Intelligence | Digital Snapshot / Growth / Market Pulse | `pages/api/reports/snapshot.ts`, `market-pulse/run.ts` | `snapshotReportService.ts`, `canonicalReportBuilder.ts`, `marketPulseJobProcessor.ts` | `engine-jobs`, `market-pulse-job` queues |
| Engagement | Reply / Inbox Analysis / Triage | `pages/api/engagement/*` | `responseGenerationService.ts`, `engagementIngestService.ts:60`, `conversationTriageService.ts:126` | `engagement-polling` queue; `conversationTriageWorker` (cron 3 min) |
| Voice | Transcription / Processing | **`pages/api/voice/transcribe.ts`** | Whisper (`:112`) / AssemblyAI (`:152`) | synchronous HTTP |
| Leads | Active Leads Discovery | `pages/api/active-leads/*` | `leadQualifier.ts`, `leadPredictiveQualifier.ts:97` → `runDiagnosticPrompt` | `lead-jobs` queue; `leadJobProcessor`; cron 07:00/18:00 |
| Analytics | AI recommendations / insights / summaries | `pages/api/recommendations/*`, `track/ai-insights.ts` | `recommendationEngine` (mostly deterministic), `strategicThemeEngine.ts:767` | `recommendation` jobs; daily intelligence scheduler |

---

## SECTION B — TOKEN ACCOUNTING COVERAGE
Canonical writer: `usageLedgerService.logUsageEvent()` (`:165-499`, insert `:418-455`). Gateway writes per LLM call: success `aiGateway.ts:1674-1702` (tokens from `normalized.usage`), error `:1616-1636`, retries `logIntermediateAttempt:1077`.

| Activity | Token Tracking | Evidence |
|---|---|---|
| Content (blog/article/post/master) | **YES** | gateway `:1674`; live: `generateCampaignPlan/parsePlanToWeeks/profileExtraction…` rows with tokens |
| Campaign planning + fan-out | **YES** | `generateCampaignPlan` `aiGateway.ts:1815` → gateway write; live rows present |
| Creator blueprint LLM | **YES** | `creatorExecutionEngine.ts:479` → `runCompletionWithOperation` → gateway |
| Engagement reply / triage | **YES** | `responseGenerationService.ts:159`, `conversationTriageService.ts:126` → gateway |
| Engagement sentiment | **YES** | `engagementIngestService.ts:83-101` self-logs tokens (source `system`) |
| Lead qualification | **YES** | `runDiagnosticPrompt` `llm/openaiAdapter.ts:112-137` self-logs tokens (live: `runDiagnosticPrompt` rows present) |
| Embeddings | **YES (coded)** | `signalEmbeddingService.ts:116-134`; **live: 0 embedding rows** |
| **Image (production)** | **NO (token); PARTIAL (cost-as-estimate)** | `captureImageProviderCost`→`blackHoleCostCapture.ts:203` writes `total_tokens:0`, static $; **live: 0 system rows** ⇒ not firing |
| **Image (openAIRenderProvider, flagged)** | **NO** | direct `fetch` `openAIRenderProvider.ts:95`, zero telemetry (flag off) |
| **Voice transcription** | **NO (token); PARTIAL (flat $/min, org-gated)** | `captureFlatProviderCost` `:143`, `total_tokens:0`; **live: 0 system rows** ⇒ not firing |
| Background intelligence (recommendation/campaign/content) | **N/A — 0 AI** | deterministic services; correctly no tokens |
| Credit Advisor | **N/A — 0 AI** | read-only/deterministic (verified) |

**Coverage reality:** token *capture* is wired for **every LLM path** (gateway + 3 self-logging adapters) and is **proven populated** (582/585 rows). Image/voice are token-less by nature and, in practice, **not being written at all** (0 `system` rows). **The pipeline is stale (newest 2026-03-14).**

---

## SECTION C — MODEL ATTRIBUTION MATRIX
| Activity | Model Known? | Provider Known? | Storage |
|---|---|---|---|
| All gateway LLM | **YES** | **YES** | `usage_events.model_name/provider_name` — live: all `gpt-4o-mini` |
| Lead qualification / sentiment / embeddings | YES | YES | self-logged on the same columns |
| Image (gpt-image-1) | YES (if row written) | YES | `process_type=creator_content`, `model` in metadata — but **0 rows live** |
| Voice (Whisper/AssemblyAI) | YES (if row written) | YES | `voice/transcribe.ts` provider — but **0 rows live** |

Model/provider attribution is **structurally complete and live-confirmed** for LLM. *("GPT-5.5 Mini" referenced in the brief does not exist — only `gpt-4o-mini` appears in prod data.)*

---

## SECTION D — API COST COVERAGE MATRIX
| Provider | Usage Captured? | Cost Captured? | Gap |
|---|---|---|---|
| OpenAI (LLM) | **YES** (tokens, live) | **NO** (`total_cost_usd` null on 100% of rows) | cost-resolution not populating |
| OpenAI Images (`gpt-image-1`) | Partial (static count) | Partial (static $0.02 estimate) | org-gated; 0 rows live; not invoice-grade |
| OpenAI Whisper / AssemblyAI | Partial (per-min) | Partial (flat $0.006/min) | org-gated; 0 rows live |
| Perplexity/Anthropic/Gemini/Azure (probes) | **YES** in-memory | **YES** in-memory | `costGovernance.ts:51` per-scan ledger is **ephemeral** (`Map`), not persisted to `usage_events` |
| DataForSEO / SerpAPI / ScaleSERP | YES (per query) | YES (`costPerQueryUsd`) | `serpAcquisitionService.ts` tracks; background-only; not tied to user activity |
| Ahrefs / Wikidata | Partial | subscription/free | no per-call cost |
| Social APIs (X/LinkedIn/Meta/…) | request-level | $0 (quota) | no $ to capture |

**Gap headline:** external API *usage* is mostly captured; external API *cost* is either **ephemeral** (probes — in-memory Map) or **estimate-only** (image/voice) or **unpopulated** (LLM `total_cost_usd` = 0). Only 3 `external_api` rows exist live.

---

## SECTION E — ASSET COST COVERAGE MATRIX
| Asset | Usage (gen count)? | Retries captured? | Gap |
|---|---|---|---|
| Image | Partial (`imageCount:1` in `captureImageProviderCost`) | **NO** | org-gated; **0 rows in prod**; gateway retries logged for LLM but image retries not distinctly tracked |
| Banner | Partial | NO | same |
| Carousel | **N/A — 0 image gen** (SVG render) | N/A | only optional OCR HTTP if configured |
| Infographic | **N/A — 0 image gen** | N/A | — |

Asset cost accounting is the **weakest area**: the production image path's capture is org-gated and **has never written a row in prod**; the flagged `openAIRenderProvider` bypasses telemetry entirely; regeneration/retry counts for images are not separately recorded.

---

## SECTION F — CREDIT DEDUCTION READINESS MATRIX
| Activity | Readiness | Reason |
|---|---|---|
| Any activity in `credit_cost_config` | **READY (fixed)** | `getCreditCost` `creditDeductionService.ts:134` + immutable/idempotent ledger (`credit_transactions`, 333 rows live, `executeWithCredits`) |
| Content / campaign / creator (token-priced) | **PARTIALLY READY** | tokens captured, but `resolveLlmCost`→`total_cost_usd` **null in prod**; `llm_model_pricing`/`action_pricing_config` must be populated; pipeline stale |
| Reports / Market Pulse | **PARTIALLY READY** | probe cost is ephemeral (not persisted); fixed-price deduction possible today |
| Lead discovery | **PARTIALLY READY** | tokens captured (`runDiagnosticPrompt`), but per-scan aggregation + cost not wired to deduction |
| Image / Voice | **NOT READY** | cost rows org-gated & absent in prod; static estimates only |
| Engagement (reply/triage/inbox) | **READY (fixed) / PARTIAL (metered)** | could deduct fixed per-reply today; metered blocked by cost-null |
| Background intelligence / Credit Advisor | **N/A** | deterministic, nothing to charge |

Overall: **fixed-activity deduction is production-ready; usage/token-metered deduction is blocked by the null-cost + stale-pipeline reality.** Only **~3 routes + 79 unified rows** actually carry a credit charge today (matches `CREDIT_COVERAGE_AUDIT.md`).

---

## SECTION G — ECONOMIC OBSERVABILITY SCORES (0–100)
| Dimension | Score | Justification |
|---|---|---|
| **Token observability** | **70** | Capture wired for every LLM path & proven (582/585 rows, 1.1M tokens); but cost field null and pipeline stale since 2026-03-14 |
| **Model observability** | **90** | model + provider on every row, live-confirmed; only missing where image/voice rows aren't written |
| **API observability** | **50** | usage tracked; cost ephemeral (probes in-memory) / estimate-only (image/voice) / unpopulated (LLM $); 3 external_api rows live |
| **Asset observability** | **30** | image capture org-gated & **0 rows in prod**; flagged provider bypasses; no retry/regen count; carousel/infographic correctly N/A |
| **Activity attribution** | **60** | `process_type` populated & maps to activities; `action_key` **null on 100%**; `feature_area` has no migration; `credit_cost_config` maps actions |
| **Credit readiness** | **65** | bank-grade ledger live (333 txns, idempotent/immutable) + fixed-cost catalog ready; but enforcement dark (~3 routes) and metered path blocked |

---

## SECTION H — GAPS (ranked)
**CRITICAL (block token/cost-based credits):**
1. `usage_events.total_cost_usd` **null on 100% of rows** — no per-call USD cost is being persisted (`resolveLlmCost` not populating / `llm_model_pricing` likely unconfigured / system-org path). Evidence: 0/585 live.
2. **`usage_events` pipeline stale since 2026-03-14** — current LLM traffic not reaching the telemetry table (while credit deduction continues elsewhere). Evidence: newest event 2026-03-14, today 2026-06-17.
3. **Enforcement dark** — only ~3 routes + 79 unified rows deduct credits; most chargeable activities have no deduction wired (`CREDIT_COVERAGE_AUDIT.md` Appendix G).

**IMPORTANT:**
4. `action_key` null on all `usage_events` — activity attribution at the telemetry layer relies on `process_type` only (the canonical billing key isn't stamped).
5. **Image/voice cost rows never written in prod** (0 `system` rows) — org-gated capture silently skips; costs invisible.
6. **Probe (Perplexity/etc.) cost is ephemeral** — `costGovernance` ledger is an in-memory `Map`, never persisted to `usage_events`.
7. **usage↔ledger linkage implicit/nullable** — no FK from a credit charge to its token rows; can't reconcile charge ↔ cost (`CREDIT_COVERAGE_AUDIT.md` gap #2).
8. **Three decoupled tables** (`usage_events` 585 / `credit_usage_log` 138 / `unified_transactions` 67,485) with no 1:1 provenance — no single source of truth for "what did this activity cost and charge."
9. `feature_area` written by code but **no migration defines the column** (defensive `select('*')`).

**NICE-TO-HAVE:**
10. `openAIRenderProvider` bypass (zero telemetry) — only matters if `ENABLE_CREATOR_RENDERING` is turned on.
11. No pre-call tiktoken count — only char/3.8 estimate (`jobCostEstimator.ts:175`); post-call actuals are sufficient for metered billing.
12. Image retry/regeneration count not separately tracked.

---

## SECTION I — FINAL VERDICT
**1. Activity-based credits today?** **YES.** The fixed-cost catalog (`credit_cost_config`) + `getCreditCost` + the immutable/idempotent ledger are production-grade and live (333 txns, 27 wallets). Deduction works for any catalogued action; the only work is *wiring more routes*, not building telemetry.

**2. Token-based credits today?** **NO.** Tokens are captured, but **USD cost is null on 100% of `usage_events`** and the pipeline is **stale since 2026-03-14**. Token→cost→credit cannot run until cost population and pipeline freshness are fixed.

**3. Hybrid credits today?** **PARTIALLY.** Every architectural piece exists (tokens + fixed catalog + `action_pricing_config` + `resolveLlmCost`), but it is **coded, not operational** — the metered half is blocked by gaps #1–#2.

**4. % of required telemetry that already exists:**
- **Instrumentation / schema: ~85%** (comprehensive; the hard parts — per-call token capture, immutable ledger, pricing config tables — are built).
- **Operationally live & cost-complete: ~45%** (tokens flow historically but cost is dark, image/voice absent, pipeline stale, enforcement on ~3 routes).

**5. Top 10 blockers:**
1. `total_cost_usd` unpopulated (0/585) — cost accounting dark.
2. `usage_events` pipeline stale since 2026-03-14.
3. Enforcement dark — only ~3 routes / 79 rows deduct.
4. `action_key` null on all telemetry rows.
5. Image/voice cost rows never written (org-gated skip).
6. Probe cost ephemeral (in-memory, not persisted).
7. No usage↔ledger FK (can't reconcile charge to cost).
8. Three decoupled usage tables, no single source of truth.
9. `llm_model_pricing` / `action_pricing_config` population unverified (likely empty → null cost).
10. `feature_area` column undefined by migration.

> **Bottom line:** Omnivyra can launch an **activity-based (fixed-price) credit economy today** on a genuinely bank-grade ledger. It **cannot** run **token/cost-metered** credits until the cost field is populated and the telemetry pipeline is confirmed live — the *capability* is built (~85% of code), but the *operational data* (~45%) isn't there yet. This is a **wiring + data-population problem, not an architecture problem.**

*(Audit performed read-only; the temporary census script was removed after the run. No code, schema, or migration was created or modified.)*

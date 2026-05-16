# Credit Consumption Matrix

**Date:** 2026-05-15
**Scope:** Every credit-spending callsite in the codebase, classified by safety posture
**Status:** AUDIT ONLY

---

## 1. Consumption Patterns Glossary

| Pattern | Path through `creditExecutionService` | Safety |
|---|---|---|
| **PRE-HOLD (atomic)** | `executeWithCredits<T>` / `reserveCreditsForWork` → executor → `confirmCreditReservation`/`releaseCreditReservation` | ✅ Safe: HOLD before work; CONFIRM/RELEASE idempotent |
| **POST-DEDUCT (best-effort)** | `deductCreditsAwaited` | ⚠️ Risk: retry-after-success may double-deduct |
| **POST-DEDUCT IF-VALUE** | `deductCreditsIfValueAwaited` | ⚠️ Risk: re-detected value re-charges |
| **DIRECT RPC** | `callCreditReservation` (repository) | ⚠️ Should be wrapped — used only by service layer internally |
| **UNTRACKED LLM** | Direct `aiGateway.runCompletionWithOperation()` with no credit wrapper | 🚨 GAP: cost absorbed by `usage_events` only, no credit deduction |

---

## 2. Master Matrix — All Identified Consumption Sites

Severity legend: **CRITICAL** (silent double-charge possible) / **HIGH** (retry-induced over-charge under known conditions) / **MEDIUM** (race possible under load) / **LOW** (post-charge but bounded by smart-mode dedup) / **OK** (atomic).

### 2.1 Content Generation & Publishing

| Site | File:Line | Pattern | Idempotency | Severity | Notes |
|---|---|---|---|---|---|
| Master content gen (LLM) | [pages/api/activity-workspace/content.ts:668-699](../../pages/api/activity-workspace/content.ts) | PRE-HOLD (token-priced) | `makeIdempotencyKey(userId, action, refId)` | OK | Uses `executeWithCredits` + `apply_credit_partial_confirm` |
| Platform variants | [pages/api/activity-workspace/content.ts:806-853](../../pages/api/activity-workspace/content.ts) | PRE-HOLD (fixed) | ✅ | OK | |
| Content rewrite (improve hook/CTA) | [pages/api/activity-workspace/content.ts:229-283, 358-395](../../pages/api/activity-workspace/content.ts) | PRE-HOLD (fixed) | ✅ | OK | |
| **Refine variant** | [pages/api/activity-workspace/content.ts:726-793](../../pages/api/activity-workspace/content.ts) | UNTRACKED LLM | ✗ | **CRITICAL** | Calls `aiGateway.runCompletionWithOperation()` directly — no credit deduction |
| Engagement reply gen | [backend/services/replyGenerationService.ts:152](../../backend/services/replyGenerationService.ts) | POST-DEDUCT | smart-mode bucket | HIGH | Retry doubles charge |
| Content job processor (queue) | [backend/queue/jobProcessors/contentGenerationProcessor.ts:267, 372, 447, 517](../../backend/queue/jobProcessors/contentGenerationProcessor.ts) | POST-DEDUCT | bucket only | **CRITICAL** | Bull MQ retry → re-charge possible |
| BOLT content job | [backend/queue/jobProcessors/boltContentJobProcessor.ts](../../backend/queue/jobProcessors/boltContentJobProcessor.ts) | POST-DEDUCT or untracked | weak | **CRITICAL** | Needs HOLD-first migration |
| Creator content job | [backend/queue/jobProcessors/creatorContentProcessor.ts](../../backend/queue/jobProcessors/creatorContentProcessor.ts) | POST-DEDUCT or untracked | weak | **CRITICAL** | |
| Campaign planning job | [backend/queue/jobProcessors/campaignPlanningProcessor.ts](../../backend/queue/jobProcessors/campaignPlanningProcessor.ts) | POST-DEDUCT or untracked | weak | **CRITICAL** | |
| Publish-now | [backend/services/publishNowService.ts](../../backend/services/publishNowService.ts) | Needs audit | — | MEDIUM | Confirm path through `creditExecutionService` not verified for all branches |

### 2.2 Analysis & Intelligence (AI-driven)

| Site | File:Line | Pattern | Severity | Notes |
|---|---|---|---|---|
| Campaign prediction | [backend/services/campaignPredictionEngine.ts:254](../../backend/services/campaignPredictionEngine.ts) | POST-DEDUCT (10c) | HIGH | Retry-after-success doubles |
| Competitor intelligence | [backend/services/competitorIntelligenceService.ts:163](../../backend/services/competitorIntelligenceService.ts) | POST-DEDUCT-IF-VALUE (8c) | MEDIUM | Re-detection re-charges; smart-mode partially mitigates |
| Market positioning | [backend/services/marketPositioningEngine.ts:221](../../backend/services/marketPositioningEngine.ts) | POST-DEDUCT-IF-VALUE (10c) | MEDIUM | Same risk |
| Pattern detection | [backend/services/patternDetectionService.ts:234](../../backend/services/patternDetectionService.ts) | POST-DEDUCT-IF-VALUE (12c) | MEDIUM | |
| Strategy evolution | [backend/services/strategyEvolutionEngine.ts:242](../../backend/services/strategyEvolutionEngine.ts) | POST-DEDUCT-IF-VALUE (15c) | MEDIUM | |
| Portfolio decision | [backend/services/portfolioDecisionEngine.ts:190](../../backend/services/portfolioDecisionEngine.ts) | POST-DEDUCT (20c) | HIGH | |

### 2.3 Autonomous Campaign / Scheduler

| Site | File:Line | Pattern | Severity | Notes |
|---|---|---|---|---|
| Autonomous campaign agent | [backend/services/autonomousCampaignAgent.ts:129-147](../../backend/services/autonomousCampaignAgent.ts) | PRE-HOLD (50c) | OK | Daily-bucket idempotency salt |
| Autonomous scheduler | [backend/services/autonomousScheduler.ts:127-225](../../backend/services/autonomousScheduler.ts) | Wraps agent above | OK | |
| Cron core | [backend/scheduler/cron.ts](../../backend/scheduler/cron.ts) + [backend/scheduler/schedulerService.ts](../../backend/scheduler/schedulerService.ts) | Routes work to agents | — | Kill-switch: `AUTONOMOUS_CRON_ENABLED` env (see commit `70956490`) |

### 2.4 Reports & Exports

| Site | File:Line | Pattern | Severity | Notes |
|---|---|---|---|---|
| Paid report generation | [pages/api/reports/generate.ts:217-226](../../pages/api/reports/generate.ts) | PRE-HOLD | OK | requestId-based idempotency |
| Report card async confirm | [backend/services/reportCardService.ts:49-52](../../backend/services/reportCardService.ts) | CONFIRM/RELEASE | OK | Tied to holdIdempotencyKey from generator |
| Free report | [pages/api/reports/generate.ts:263-268](../../pages/api/reports/generate.ts) | No charge | OK | |

### 2.5 Adjustments / Manual

| Site | File:Line | Pattern | Notes |
|---|---|---|---|
| Consumption adjustment | [backend/services/consumptionAnalyticsService.ts:568](../../backend/services/consumptionAnalyticsService.ts) | `executeWithCredits` no-op executor | OK (admin-gated) |

---

## 3. Action Type Registry

Source: [backend/services/creditDeductionService.ts:25-81](../../backend/services/creditDeductionService.ts) + `credit_cost_config` table.

| Tier | Action | Credits | Token-priced? |
|---|---|---|---|
| Micro | `ai_reply` | 1 | — |
| Micro | `auto_post` | 2 | — |
| Low | `content_rewrite` | 3 | — |
| Low | `content_basic` | 5 | — |
| Low | `competitor_signals` | 8 | — |
| Low | `insight_generation` | 8 | — |
| Mid | `prediction` | 10 | — |
| Mid | `market_positioning` | 10 | — |
| Mid | `voice_per_minute` | 10/min | — |
| Mid | `pattern_detection` | 12 | — |
| Mid | `lead_detection` | 15 | — |
| Mid | `optimization_loop` | 15 | — |
| Mid | `strategy_evolution` | 15 | — |
| Mid | `portfolio_decision` | 20 | — |
| High | `trend_analysis` | 25 | — |
| High | `market_insight_manual` | 30 | — |
| High | `campaign_creation` | 40 | — |
| Heavy | `website_audit` | 50 | — |
| Heavy | `campaign_generation` | 50 | — |
| Heavy | `deep_analysis` | 60 | — |
| Heavy | `full_strategy` | 80 | — |
| Token | `content_generation` | **dynamic** | ✓ (estimate → partial confirm) |

---

## 4. Identified Consumption Gaps (Unguarded Cost)

Each is a **CRITICAL severity** finding for the financial risk audit ([credit-financial-risk-audit.md](./credit-financial-risk-audit.md#a-missing-deductions)).

| Gap | Service | Reason it matters |
|---|---|---|
| **G1: Refine variant** | [pages/api/activity-workspace/content.ts:743-766](../../pages/api/activity-workspace/content.ts) | Direct `aiGateway` call: real LLM cost incurred, zero credits deducted |
| **G2: BOLT pipeline main loop** | [backend/services/boltPipelineService.ts](../../backend/services/boltPipelineService.ts), [boltScheduleBlockProcessor.ts](../../backend/services/boltScheduleBlockProcessor.ts) | LLM content generation across the BOLT scheduling path — credit wrapping not consistently applied; needs per-stage audit |
| **G3: Listening / social ingestion** | [backend/events/listeningEvents.ts](../../backend/events/listeningEvents.ts), [backend/services/listeningSourceService.ts](../../backend/services/listeningSourceService.ts) | Inbound enrichment can trigger AI classification — no credit gating |
| **G4: Lead enrichment** | [backend/services/leadQualifier.ts](../../backend/services/leadQualifier.ts), [leadPredictiveQualifier.ts](../../backend/services/leadPredictiveQualifier.ts) | `lead_detection` action defined but not wired in every enrichment branch |
| **G5: Creator asset rendering** | [backend/services/creatorAssetGenerationRuntime.ts](../../backend/services/creatorAssetGenerationRuntime.ts), [creatorAssetRenderer.ts](../../backend/services/creatorAssetRenderer.ts), [creatorBrandKit.ts](../../backend/services/creatorBrandKit.ts), [creatorTemplateRegistryService.ts](../../backend/services/creatorTemplateRegistryService.ts) | Image / template / brand-kit generation paths — no observed credit wrap |
| **G6: GA4 / GSC ingestion intelligence** | [backend/services/ga4IngestionService.ts](../../backend/services/ga4IngestionService.ts), [googleAnalyticsExperienceService.ts](../../backend/services/googleAnalyticsExperienceService.ts), [googleProviderReadinessService.ts](../../backend/services/googleProviderReadinessService.ts), [performanceSearchIntelligenceService.ts](../../backend/services/performanceSearchIntelligenceService.ts) | If any branch summarizes data via LLM, cost is invisible to credit ledger |
| **G7: Recommendation engine / consolidator** | [backend/services/recommendationEngine/engine.ts](../../backend/services/recommendationEngine/engine.ts), [recommendationConsolidator.ts](../../backend/services/recommendationConsolidator.ts), [recommendationIntelligenceService.ts](../../backend/services/recommendationIntelligenceService.ts), [recommendationJobProcessor.ts](../../backend/services/recommendationJobProcessor.ts) | Heavy AI use likely; consumption not verified |
| **G8: Performance behavior intelligence** | [backend/services/performanceBehaviorIntelligenceService.ts](../../backend/services/performanceBehaviorIntelligenceService.ts), [performanceReportService.ts](../../backend/services/performanceReportService.ts) | Same |
| **G9: Growth report** | [backend/services/growthReportService.ts](../../backend/services/growthReportService.ts) | Free vs paid branching — free branch may invoke LLM without charge |
| **G10: Market Pulse v2** | [backend/services/marketPulseV2Service.ts](../../backend/services/marketPulseV2Service.ts), [opportunityGenerators.ts](../../backend/services/opportunityGenerators.ts) | Heavy generation surface; needs explicit credit wrap audit |
| **G11: Omnivyra website company service** | [backend/services/omnivyraWebsiteCompanyService.ts](../../backend/services/omnivyraWebsiteCompanyService.ts), [companyContextService.ts](../../backend/services/companyContextService.ts), [companyProfileService.ts](../../backend/services/companyProfileService.ts) | Profile enrichment / context generation may call AI |

> Each gap should produce a unique finding in the financial risk audit. The systemic root cause is that `aiGateway.runCompletionWithOperation()` records `usage_events` for cost telemetry but does **not** force the caller through `executeWithCredits`. The two are not bound.

---

## 5. Retry & Idempotency Posture by Caller Class

| Caller class | Idempotency basis | Failure mode |
|---|---|---|
| HTTP routes (`pages/api/*`) | `requestId` or hash of body | Browser retry on 5xx → safe (idempotency key matches) |
| Cron tasks | Day-bucket salt | Cron re-fire → safe |
| Queue processors (Bull MQ) | Job-id bucket only | **Re-enqueue after success but before ledger insert → double-charge** |
| Background engines (analysis) | Smart-mode time window | Re-detection in next window → may re-charge |
| Webhooks (Razorpay) | `payment_provider_events(provider, provider_event_id)` UNIQUE | Safe at DB layer |

---

## 6. Smart-Mode Dedup

`creditDeductionService.wasRecentlyRun(orgId, action, windowSeconds)` ([backend/services/creditDeductionService.ts:150-166](../../backend/services/creditDeductionService.ts)) queries `credit_transactions` for a `confirm` phase within the window. Used by `deductCreditsAwaited` and `deductCreditsIfValueAwaited` to skip re-charge for fast-fire actions.

- **Strength:** suppresses repeated charges in tight loops
- **Weakness:** windows are configurable per action (`smart_dedup_seconds`) but **not currently surfaced in `credit_cost_config` policy review**; default windows may be too short for slow background engines (HIGH-tier engines run minutes-to-hours apart, so smart mode rarely catches them)

---

## 7. Risk-Tier Distribution

| Tier | Count | Examples |
|---|---|---|
| GREEN (atomic, idempotent) | 6 | Master content, variants, rewrites, paid reports, autonomous campaign, adjustments |
| YELLOW (post-deduct, dedup window) | 6 | competitor intel, pattern detection, market positioning, strategy evolution, portfolio decision, prediction |
| RED (queue retry doubles cost) | 3+ | content gen job, BOLT job, creator content job |
| UNKNOWN (suspected untracked AI) | 11 (G1–G11 above) | Refine variant, BOLT pipeline, listening, leads, creator assets, GA/GSC, recommendations, performance, growth, market pulse, omnivyra website |

---

## 8. Remediation Priority

1. **P0** — Move queue processors to PRE-HOLD using `reserveCreditsForWork(jobId)` keyed on the job's deterministic ID; CONFIRM only when the Bull job is marked `completed`; RELEASE on `failed`.
2. **P0** — Add a CI grep to fail PRs that introduce `aiGateway.runCompletionWithOperation` without an enclosing `executeWithCredits` (or explicit ignore comment with operator approval).
3. **P1** — Audit G1–G11 line-by-line; for any LLM call, wrap with `executeWithCredits` or add a justified bypass entry to a new `credit_untracked_actions` table.
4. **P1** — Lift smart-mode dedup windows for engines (≥1h) and surface them in admin UI.
5. **P2** — Add `usage_events`-vs-`credit_transactions` reconciliation job (find usage_events with no matching CONFIRM within window N → alert).

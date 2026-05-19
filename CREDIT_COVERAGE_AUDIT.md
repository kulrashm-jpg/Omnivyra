# Credit Coverage Audit

**Date:** 2026-05-19
**Question answered:** Do we have (A) a per-activity cost catalog, (B) a per-org deduction ledger, and (C) does every activity actually deduct?
**Verdict:** (A) ✅ exists and is authoritative. (B) ✅ exists and is robust. (C) ❌ **No — only 3 routes + 2 flag-gated processors charge; ~19 AI routes charge nothing, and the intelligence suite deducts fail-open.**

This document is a findings audit only. No code was changed. Recommended costs map onto the **existing** catalog tiers so they only need approval, not new pricing invention.

---

## A. Cost catalog — "how many credits per activity"

**Source of truth:** table `credit_cost_config` — [supabase/migrations/20260320_credit_intelligence.sql:21-47](supabase/migrations/20260320_credit_intelligence.sql#L21-L47).
**Read path:** [getCreditCost()](backend/services/creditDeductionService.ts#L86) — DB lookup keyed by `action_type`, remappable via the monetization feature registry. **Fail-closed:** an action with no cost row throws `missing credit cost config` (it does **not** run free).
**Type:** `CreditAction` union — [creditDeductionService.ts:25-81](backend/services/creditDeductionService.ts#L25-L81) (25 actions).

| action_type | credits | category | smart dedup | meaning |
|---|--:|---|--:|---|
| ai_reply | 1 | low | – | AI reply suggestion |
| auto_post | 2 | low | – | social auto-post |
| reply_generation | 2 | low | – | community reply |
| content_rewrite | 3 | low | – | content rewrite |
| content_basic | 5 | low | – | basic content generation |
| content_generation | token-priced | heavy | – | master content (activity workspace) |
| competitor_signals | 8 | medium | 6h | competitor intelligence (value-gated) |
| insight_generation | 8 | medium | 1h | intelligence insight |
| prediction | 10 | medium | – | campaign outcome prediction |
| market_positioning | 10 | medium | 1d | market positioning (value-gated) |
| voice_per_minute | 10 | heavy | – | voice, ×minutes |
| pattern_detection | 12 | medium | 1d | pattern sweep (value-gated) |
| lead_detection | 15 | high | 6h | lead signal (value-gated) |
| optimization_loop | 15 | high | – | live optimization iteration |
| strategy_evolution | 15 | high | 1d | strategy evolution (value-gated) |
| daily_insight_scan | 20 | high | 1d | daily scan (value-gated) |
| portfolio_decision | 20 | high | 12h | multi-campaign rebalancing (value-gated) |
| trend_analysis | 25 | medium | 1h | trend analysis |
| market_insight_manual | 30 | medium | – | market insight (manual) |
| campaign_optimization | 30 | high | 12h | optimization scan (value-gated) |
| campaign_creation | 40 | medium | – | campaign creation |
| campaign_generation | 50 | heavy | – | autonomous campaign generation |
| website_audit | 50 | medium | 1d | website audit |
| deep_analysis | 60 | heavy | – | deep multi-step analysis |
| full_strategy | 80 | heavy | – | full campaign strategy |

Token-heavy LLM flows additionally use dynamic per-model pricing (`llm_model_pricing`, `20260515_pricing_engine.sql`) to settle actual cost.

**Catalog gap:** several real activities (blog generation, repurpose, content suggestions, theme chat, platform-adapt) have **no `action_type` at all** in the catalog — see §C.4.

---

## B. Per-org deduction ledger — recording

**Central engine:** [backend/services/creditExecutionService.ts](backend/services/creditExecutionService.ts). All credit mutation goes through it; [creditDeductionService.ts](backend/services/creditDeductionService.ts) is read-only utilities.

| Function | Line | Use | Enforcement |
|---|--:|---|---|
| `executeWithCredits<T>()` | [535](backend/services/creditExecutionService.ts#L535) | primary path; HOLD→EXECUTE→CONFIRM/RELEASE; **idempotency required** | **Pre-check (fail-closed)** — 402 if insufficient |
| `deductCreditsAwaited()` | [1142](backend/services/creditExecutionService.ts#L1142) | background best-effort | **Post-facto (fail-open)** |
| `deductCreditsIfValueAwaited()` | [1210](backend/services/creditExecutionService.ts#L1210) | charge only if output had value | **Post-facto, value-gated (fail-open)** |

**Ledger tables:**
- `credit_transactions` (`20260321_credit_ledger_hardening.sql`) — phased rows (`hold`/`confirm`/`release`/`grant`), `balance_after`, `idempotency_key` UNIQUE, **`reference_type` = the CreditAction (the activity)**, `reference_id` = work unit. Exactly-once via `(organization_id, idempotency_key)`.
- `usage_events` — token-granular per LLM call (`process_type`/`action_key`, input/output tokens, cost, credits_charged).
- `credit_alert_log` — depletion threshold notifications.

**Conclusion:** Every deduction that flows through the engine is recorded and attributed to the activity via `reference_type`. The recording layer is sound. The problem is purely **which activities reach the engine**.

---

## C. Coverage — does every activity deduct? (No)

### C.1 Activities that DO charge correctly (pre-check, fail-closed) ✅

| Activity | Route | Action | Model |
|---|---|---|---|
| Master content / variants (activity workspace) | [activity-workspace/content.ts](pages/api/activity-workspace/content.ts) | `content_generation` | HOLD pre-check, token-settled |
| Workspace platform-variant content | [planner/generate-workspace-content.ts](pages/api/planner/generate-workspace-content.ts) | `content_basic` (×platforms) | HOLD pre-check |
| Premium report generation | [reports/generate.ts](pages/api/reports/generate.ts) | `report_premium_*` (dynamic) | `reserveCreditsForWork` HOLD pre-check (free reports not charged) |

### C.2 Activities charged ONLY behind a feature flag ⚠️

Behind env flag **`RESERVATIONS_REQUIRED`** via `withQueueBilling` ([queueBillingMiddleware.ts:79](backend/services/billing/queueBillingMiddleware.ts#L79)):

| Processor | Action | Risk |
|---|---|---|
| [contentGenerationProcessor.ts](backend/queue/jobProcessors/contentGenerationProcessor.ts#L75) | `content_generation`/`content_basic` | **If flag off → bulk content generates free** |
| [creatorContentProcessor.ts](backend/queue/jobProcessors/creatorContentProcessor.ts#L53) | `content_generation` | Same |

> Confirm whether `RESERVATIONS_REQUIRED` is enabled in production. If not, BOLT/bulk content is currently free.

### C.3 Activities charged but FAIL-OPEN (result returned even if unpaid) ⚠️

Service-level `deductCreditsAwaited` / `deductCreditsIfValueAwaited`, **after** the work, result returned regardless of deduction success; value-gated ones are free when the analysis yields nothing:

| Activity | Service (file:line of charge) | Action |
|---|---|---|
| Campaign prediction | [campaignPredictionEngine.ts:128](backend/services/campaignPredictionEngine.ts#L128) | `prediction` |
| Pattern detection | patternDetectionService.ts | `pattern_detection` (value-gated) |
| Market positioning | marketPositioningEngine.ts | `market_positioning` (value-gated) |
| Competitor signals | competitorIntelligenceService.ts | `competitor_signals` (value-gated) |
| Strategy evolution | strategyEvolutionEngine.ts | `strategy_evolution` (value-gated) |
| Portfolio decision | portfolioDecisionEngine.ts | `portfolio_decision` (value-gated) |
| Engagement reply | replyGenerationService.ts | `reply_generation` |

> Note: the exact API surface that triggers each of these (route vs scheduler vs processor) was not pinned in this pass — the deduction itself is service-level. To confirm during implementation.

### C.4 Activities that charge NOTHING — zero credit calls (verified) ❌

These call `aiGateway` / `runCompletionWithOperation` directly with **no** `executeWithCredits` / billing wrapper. Real LLM cost, zero credits, no balance gate. They also have **no `action_type` in the catalog**.

| # | Route | AI entrypoint | Recommended action / cost (maps to existing tier) |
|--:|---|---|---|
| 1 | [admin/blog/generate.ts](pages/api/admin/blog/generate.ts) | runUnifiedLongFormGeneration | new `blog_generation` ≈ `deep_analysis` (60) or token-priced like `content_generation` |
| 2 | [admin/blog/rewrite-hook.ts](pages/api/admin/blog/rewrite-hook.ts) | runCompletionWithOperation | reuse `content_rewrite` (3) |
| 3 | [admin/blog/brief-suggestions.ts](pages/api/admin/blog/brief-suggestions.ts) | runCompletionWithOperation | reuse `ai_reply` (1) |
| 4 | [company/blog/brief-suggestions.ts](pages/api/company/blog/brief-suggestions.ts) | runCompletionWithOperation | reuse `ai_reply` (1) |
| 5 | [blogs/[id]/repurpose.ts](pages/api/blogs/[id]/repurpose.ts) | runCompletionWithOperation | new `content_repurpose` ≈ `content_basic` (5) |
| 6 | [ai/content-suggestions.ts](pages/api/ai/content-suggestions.ts) | runCompletionWithOperation | reuse `content_rewrite` (3) |
| 7 | [planner/chat-themes.ts](pages/api/planner/chat-themes.ts) | runCompletionWithOperation | reuse `ai_reply` (1) per turn |
| 8 | [engagement/refine-suggestion.ts](pages/api/engagement/refine-suggestion.ts) | runCompletionWithOperation | reuse `ai_reply` (1) |
| 9 | [content/quick-platform-adapt.ts](pages/api/content/quick-platform-adapt.ts) | aiGateway | reuse `content_rewrite` (3) |
| 10 | [command-center/creator-content/generate.ts](pages/api/command-center/creator-content/generate.ts) | aiGateway | reuse `content_basic` (5) — or route via the billed creatorContentProcessor |
| 11 | [bolt/campaign-chat.ts](pages/api/bolt/campaign-chat.ts) | aiGateway | reuse `ai_reply` (1) per turn |
| 12 | [campaigns/planner/suggest-update.ts](pages/api/campaigns/planner/suggest-update.ts) | aiGateway | reuse `ai_reply` (1) |
| 13 | [campaigns/suggest-duration.ts](pages/api/campaigns/suggest-duration.ts) | aiGateway | reuse `ai_reply` (1) |
| 14 | [campaigns/run-preplanning.ts](pages/api/campaigns/run-preplanning.ts) | generatePrePlanningExplanation | reuse `ai_reply` (1) — explanation only; verify upstream gate exists |
| 15 | [planner/skeleton-command.ts](pages/api/planner/skeleton-command.ts) | aiGateway | reuse `content_basic` (5) |
| 16 | [recommendations/generate.ts](pages/api/recommendations/generate.ts) | aiGateway | reuse `insight_generation` (8) |
| 17 | [recommendations/detected-opportunities.ts](pages/api/recommendations/detected-opportunities.ts) | aiGateway | reuse `insight_generation` (8, value-gated) |
| 18 | [recommendations/[id]/preview-strategy.ts](pages/api/recommendations/[id]/preview-strategy.ts) | aiGateway | reuse `ai_reply` (1) |
| 19 | [recommendations/group-preview.ts](pages/api/recommendations/group-preview.ts) | aiGateway | reuse `ai_reply` (1) |

### C.5 Queue processors doing AI work with NO billing ❌

| Processor | AI work | Status |
|---|---|---|
| [boltContentJobProcessor.ts](backend/queue/jobProcessors/boltContentJobProcessor.ts) | generateMasterContentFromIntent + platform variants | **not wrapped** (legacy) — BOLT content path may be free |
| [campaignPlanningProcessor.ts](backend/queue/jobProcessors/campaignPlanningProcessor.ts) | generateCampaignStrategy, blueprint | **not wrapped** — async campaign planning free |

---

## D. Enforcement model summary

| Mode | Used by | Behavior on no credits |
|---|---|---|
| Pre-check / HOLD (fail-closed) | content.ts, generate-workspace-content.ts, reports, flag-gated processors | Blocks with 402 ✅ |
| Post-facto best-effort (fail-open) | prediction, reply | Work returned free, warning logged ⚠️ |
| Post-facto value-gated (fail-open) | pattern/market/competitor/strategy/portfolio | Free if no value; free if deduction fails ⚠️ |
| None | §C.4 routes, §C.5 processors | Always free ❌ |

---

## E. Risks & recommended remediation order

1. **🔴 Confirm `RESERVATIONS_REQUIRED` is ON in prod.** If off, the *only* enforced charging is 3 routes — the single highest-leverage check, zero code.
2. **🔴 Catalog the missing actions** (§C.4): add `credit_cost_config` rows (recommended costs above all reuse existing tiers). Cheap, no behavior change until wired.
3. **🔴 Wire §C.4 routes** through `executeWithCredits` (pre-check) — biggest revenue leak; ~19 routes. Highest value: blog generation (1), repurpose (5), creator-content (10), recommendations (16-17), BOLT/campaign-chat (11).
4. **🟡 Wrap §C.5 processors** (boltContentJobProcessor, campaignPlanningProcessor) with `withQueueBilling`.
5. **🟡 Decide fail-open → fail-closed** for §C.3 intelligence/reply. Higher regression risk (touches working paths under the auth/billing stability lock) — do last, with contract-test updates.

**Decisions needed from you before implementation:**
- Approve the recommended cost mapping in §C.4 (or supply your own numbers).
- Per-turn vs per-session charging for interactive surfaces (chat-themes, campaign-chat, theme refinement).
- Keep intelligence value-gating (free when no value) or always charge on run?
- Fail-open vs fail-closed for §C.3.

No code will change until you approve scope and pricing.

---

# Appendix F — Financial-Grade Architecture: Target vs Actual

You specified a bank-grade target (policy engine + versioning, immutable ledger, metering layer, provider-cost reconciliation, reservations, idempotency, refunds, billing snapshots, atomicity) and asked to verify before building. **Verified finding: ~80% of that foundation already exists and is hardened at the database layer. Do not rebuild it.** The real problem is the §C coverage gap (a bank-grade ledger that ~19 routes bypass), plus 5 narrow hardening gaps below.

Three highest-stakes claims were verified by reading the migrations directly:

- **Immutable ledger is real and DB-enforced.** `raise_ledger_immutable()` trigger ([20260663_ledger_immutability_and_governance.sql:27](supabase/migrations/20260663_ledger_immutability_and_governance.sql#L27)) raises `LEDGER_IMMUTABLE` on `BEFORE UPDATE`/`BEFORE DELETE` for `credit_transactions`, `credit_admin_grants`, `super_admin_audit_logs`, `payment_provider_events`, `credit_action_approval_signatures` (lines 41-92). Not convention — enforced below the app, can't be bypassed by RLS.
- **Idempotency is required, not optional.** `apply_credit_*` RPC raises `idempotency_key is required` ([20260625:139-140](supabase/migrations/20260625_monetization_invariant_hardening.sql#L139-L140)) plus a wall of invariant guards: parent-HOLD required for confirm/release, "HOLD already settled" guard, amount-exceeds-parent guard, reserved-cannot-go-negative, insufficient-balance ([20260625:169-214](supabase/migrations/20260625_monetization_invariant_hardening.sql#L169-L214)).
- **Wallet is a ledger projection (your exact model).** [20260634:1-13](supabase/migrations/20260634_rebuild_canonical_credit_wallet_projection.sql#L1-L13): "`organization_credits` [is] the transactional wallet projection while `credit_transactions` remains the append-only ledger record … rebuild every wallet row from ledger deltas." The immutable ledger is the source of truth; the wallet is rebuildable from it.

## Your spec → actual

| Your target entity | Status | Where it already lives | Gap |
|---|---|---|---|
| **1. Policy: action cost catalog** (`credit_action_catalog`) | ✅ | `credit_cost_config` + `action_pricing_config` (override + `cost_multiplier` margin) + monetization featureRegistry → pricingResolver | Catalog missing rows for §C.4 activities (your `ai_writer_blog_generate` etc. don't exist as keys) |
| **1. min/max/enabled/module/provider/unit_type** | ⚠️ PARTIAL | `action_pricing_config` has multiplier + is_active + effective_from | No `min`/`max`/`module`/`unit_type` columns |
| **1. Provider mapping** (`credit_provider_mapping`) | ✅ | `llm_model_pricing` (provider, model, input/output per-1k USD, `effective_from`, `is_active`) | No `infra_multiplier`; token→credit formula lives in code (pricingResolver), not a row |
| **1. Policy versioning** (effective/deprecated/version) | ⚠️ PARTIAL | `effective_from` + partial-unique `is_active` on `llm_model_pricing` & `action_pricing_config` | **No `policy_version`/`action_key` frozen INTO each ledger row** — historical cost is reconstructed by timestamp-join, not stamped. `credit_cost_config` (legacy) unversioned. **Gap #1** |
| **2. Wallet** (`company_credit_wallet`) | ✅ | `organization_credits` — free/paid/incentive balance + reserved_* + `lifetime_purchased`/`lifetime_consumed` | `available` computed in app (balance−reserved), not stored — fine for a projection |
| **2. Immutable append-only ledger** (`company_credit_ledger`) | ✅ | `credit_transactions` — `credits_delta`, `balance_after`, per-category deltas, `execution_phase`, `parent_transaction_id`, `idempotency_key` UNIQUE, `metadata`, immutability trigger | No `balance_before`, no `actor_type` (only `performed_by` uuid), no `policy_version` (see Gap #1) |
| **3. Usage metering** (`usage_meter_events`) | ✅ | `usage_events` via `usageLedgerService.logUsageEvent()` — raw input/output tokens, provider/model, `total_cost_usd`, `credits_charged`; dual-writes `unified_transactions` | Linkage to ledger is implicit (idempotency/reference, no `linked_ledger_id` FK). **Not every LLM call metered** — internal/cache/error calls exempt by design. **Gap #2** |
| **4. Recommended flow** (usage→credits→ledger→wallet) | ✅ | Exactly this: HOLD→EXECUTE→CONFIRM/RELEASE in `creditExecutionService`, atomic in `apply_credit_reservation()` RPC | — |
| **5A. Reservation system** | ✅ | `apply_credit_reservation()` HOLD/CONFIRM/RELEASE + `apply_credit_partial_confirm()` (settles actual, releases remainder) | If actual > HOLD → hard EXCEPTION; shortfall not tracked as org debt. **Gap #3** |
| **5B. Idempotency / retry-safe** | ✅ | UNIQUE partial index ([20260321:50](supabase/migrations/20260321_credit_ledger_hardening.sql#L50)) + RPC `idempotency_key is required`; duplicate → returns existing row | NULLs allowed by partial index (caller must always pass key) |
| **5C. Refund / reversal** | ✅ | Compensating RELEASE rows + `parent_transaction_id`; admin refund behind multi-approver workflow (`credit_action_approvals`, `sign_credit_action_approval()`), `admin_financial_audit_events` immutable | No self-service refund API (approval-only — arguably correct) |
| **5D. Monthly billing snapshots** | ✅ | `usage_billing_snapshots` (immutable) + `invoices`/`invoice_line_items`/`payment_transactions`/`billing_subscriptions` ([20260664](supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql)), tax_rate/tax_jurisdiction fields | Invoice **generation/dunning automation** is scaffold (Sprint 4+); generic tax, no GST-specific rate rules. **Gap #4** |
| **Provider-cost reconciliation / profitability** | ⚠️ PARTIAL | `org_weekly_metrics` computes `total_api_cost_usd` vs `credits_value_usd` → `margin_usd`/`is_negative_margin`; `payment_provider_events` immutable | No closed loop matching our computed cost against **actual** Anthropic/OpenAI/Stripe invoices; margin is output-only, no remediation. **Gap #5** |
| **Atomicity** (wallet+ledger one tx) | ✅ | Single plpgsql `apply_credit_reservation()` — wallet UPDATE + ledger INSERT in one transaction; UNIQUE-violation race caught | Orphan holds rely on external reaper (`creditOrphanHoldReaper`), no SLA/escalation. (folds into Gap #3) |
| **Admin governance / audit trail** | ✅ | Multi-approver `credit_action_approvals` + immutable signatures + `admin_financial_audit_events` | — |

## The 5 real hardening gaps (everything else exists)

1. **No policy version frozen in the ledger row.** Historical cost is reconstructed by joining on `effective_from` timestamps. For audit-grade "what did this cost the day it ran," stamp `action_key` + resolved `policy_version`/`cost_snapshot` into `credit_transactions.metadata` at HOLD. Low effort, high audit value.
2. **Metering↔ledger linkage is implicit + incomplete.** Add an explicit `ledger_txn_id` on `usage_events`; decide policy for currently-exempt internal/cache LLM calls (visibility-only or billable).
3. **Overfund + orphan-hold handling.** `actual > HOLD` hard-fails with no debt record; reaper is fire-and-forget. Add shortfall tracking + a reaper SLA/alert.
4. **Invoicing automation is scaffold.** Tables exist; no generation/dunning/subscription-overage engine; no GST rule table. Needed before real paid/enterprise billing.
5. **No provider-cost reconciliation loop.** We compute USD cost and margin but never reconcile against actual provider/PSP invoices — required for true profitability/leak detection.

## Reframed recommendation

You asked "audit before adding more AI features / before retrofitting a financial ledger." **The financial ledger is not the thing to retrofit — it's already bank-grade.** The retrofit that matters is **§C coverage**: a hardened, immutable, idempotent, atomic ledger is worthless if ~19 revenue activities never call it. Priority order is unchanged from §E (flag check → catalog rows → wire routes → processors → fail-open), with Gaps #1–#5 above as a parallel "financial hardening" track that does **not** block coverage work. Recommend: do coverage first (direct revenue), schedule Gaps #1/#2 next (cheap, audit-critical), Gaps #3–#5 before turning on real paid billing.

---

# Appendix G — Phase 1: Zero-Leakage Foundation Audit (audit-only, no code changed)

Audit-only per the Phase-1 mandate. Nothing was modified. Verification basis: production `.env.local` read directly for flag values; billing-flag resolver, immutability trigger, and reservation RPC read firsthand; three independent surface sweeps. Confidence marked **[V]** = I verified the source directly, **[R]** = agent-reported with file:line (verify at implementation).

## Task 1 — Runtime enforcement flags (actual production state)

**Headline [V]: every billing/monetization gate is OFF or shadow in production.** `.env.local` (which is production per project knowledge) sets **none** of these variables; billing feature flags default **OFF for safety** ([billingFeatureFlags.ts:8](backend/services/billing/billingFeatureFlags.ts#L8)); flag-eval error returns `enabled:false` ([billingFeatureFlags.ts:79](backend/services/billing/billingFeatureFlags.ts#L79)).

| Flag | Type | Prod value | Default behavior | Consumed at | Posture |
|---|---|---|---|---|---|
| `billing.reservations_required` | org feature_flag | **unset → OFF** | queue billing middleware inert | [contentGenerationProcessor.ts:76-80](backend/queue/jobProcessors/contentGenerationProcessor.ts#L76), creatorContentProcessor | **Fail-open** — bulk/creator content bills nothing in prod |
| `BILLING_REQUIRE_AI_HANDLE` / `billing.ai_enforced` | env + org flag | **unset → shadow** | guard logs anomaly, **does not throw** ([aiGatewayBillingGuard.ts:9-12](backend/services/billing/aiGatewayBillingGuard.ts#L9)) | runCompletionWithOperation guard | **Fail-open** — unguarded AI calls allowed |
| `REFINE_VARIANT_BILLING_ENABLED` | env | unset → **enabled** | refine-variant billing ON ([billingFeatureFlags.ts:111,146](backend/services/billing/billingFeatureFlags.ts#L111)) | runBilledAiCompletion | Fail-closed (the one default-on path) |
| `billing.orchestrator_enforced` | org flag | unset → OFF | new-code CI check still active; runtime not enforced | orchestrator | Fail-open at runtime |
| `billing.reconciliation_blocking` | org flag | unset → OFF | reconciliation async only, never blocks | high-value paths | Fail-open |
| `billing.dual_approval_required` | org flag | unset → OFF | threshold ladder applies (still 2-of-N for refunds) | approval workflow | Acceptable (ladder is the floor) |
| `MONETIZATION_STAGING_KILL_SWITCH` / `_WEBHOOK_PROCESSING_DISABLED` / `_FULFILLMENT_PAUSED` / `_READ_ONLY_AUDIT_MODE` / `_REPLAY_DRY_RUN_ONLY` | env | **all unset → false** | not in kill/pause mode | monetizationOpsService.ts:49-53 | Neutral (good) |
| `MONETIZATION_BETA_DISABLED` / `_FREEZE` / `_REPLAY_PAUSED` / allowlists | env | unset | beta access default cohort | monetizationBetaAccessService.ts:47-99 | Neutral |
| `CONTENT_AUDIT_BYPASS_COST_GUARD` | env | only set inside `scripts/audit-*` | bypass cost guard | audit scripts only — **not a runtime route** | Contained |
| `DEV_EXTENSION_AUTH_BYPASS` | env | unset | dev-only extension auth bypass | extensionAuthMiddleware.ts:63 | Not billing; unset in prod ✓ |

**Net:** the only billing actually enforced in production is the 3 fail-closed routes (§C.1) + refine-variant. Everything flag-gated is dark.

## Task 2 / 3 — AI execution surface map → universal coverage matrix

Full per-entrypoint table is large; the canonical bucketed matrix (every AI surface lands in exactly one):

| Bucket | Meaning | Surfaces | Monetization risk |
|---|---|---|---|
| **A — Fully protected** (pre-check, fail-closed) | HOLD before execute | activity-workspace/content.ts; planner/generate-workspace-content.ts; reports/generate.ts (premium); runBilledAiCompletion orchestrator | none |
| **B — Protected only behind a flag** (flag OFF in prod ⇒ effectively E) | contentGenerationProcessor, creatorContentProcessor (`reservations_required`); autonomous-scheduler cron (its own flag) | **HIGH — currently free in prod** |
| **C — Fail-open billed** (post-facto / value-gated; result returned even if unpaid/free-on-no-value) | prediction, pattern/market/competitor/strategy/portfolio, reply; market-pulse cron | medium (revenue slips, cost still visible) |
| **D — Metered but unbilled** (usage_events written, no ledger charge — by design) | signalEmbeddingService (source=system); sentiment classification | low (visible, not charged) |
| **E — Completely unprotected** (no metering, no billing) [R] | ai/blog-card-chat (direct OpenAI); voice/transcribe (Whisper + AssemblyAI); ~17 `runCompletionWithOperation` routes from §C.4; lib/content/unifiedLongFormEngine & lib/blog/runBlogGeneration when imported outside queue; admin/blog/*; responseGenerationService | **HIGHEST — real cost, zero capture** |
| **F — Internal/system exempt** (by design) | whatsappWebhookProcessor (no AI); cache hits; internal loopback | n/a |

> Inter-pass discrepancy to resolve at implementation: §C.4 listed ~19 unbilled routes; this sweep adds **direct-SDK** surfaces not in §C.4 (blog-card-chat, voice/transcribe) and notes library-level leaks. Treat §C.4 as a floor, not a ceiling.

## Task 4 — Usage ↔ ledger traceability

- **Deterministic:** organization (explicit FK on `usage_events`/`unified_transactions`/`credit_transactions`); provider USD cost (`usage_events.total_cost_usd`, Phase-7 refuses null for metered sources); action_key (resolved at write, first-class column). **[R]**
- **Implicit / weak:** ledger linkage is `credit_transactions.reference_id → usage_events.id` — **nullable text, not an enforced FK**; manual grants break the chain (`reference_id` NULL by design). No request-level idempotency token in schema — caller must supply. **[R]**
- **Retry duplication risk MEDIUM:** one logical call → N `usage_events` rows (one per attempt, by design); dedup for margin relies on `final_attempt=true` with **no DB unique constraint** — an app double-write inflates `margin_usd`. **[R]**
- **Orphans (by design, surfaced):** usage-without-ledger (system/cache/internal); ledger-without-usage (admin grants); unified-txn CHECK failure → row skipped + `cost_anomalies` emitted.

## Task 5 — Provider cost visibility ⚠️ **NEW CRITICAL**

Metered correctly (cost → usage_events → margin): OpenAI completions, Anthropic fallback, OpenAI embeddings, sentiment. Missing model in `llm_model_pricing` → main gateway **blocks pre-flight** (good).

**Accounting black holes — real provider cost incurred, never captured anywhere [R] (verify file:line before acting):**

| Path | File | Cost captured? | Severity |
|---|---|---|---|
| Google Gemini (direct HTTP) | intelligence/adapters/geminiAdapter.ts | ✗ none | **CRITICAL** |
| Image gen (DALL·E / gpt-image-1) | creatorAssetRenderer.ts (~L860) | ✗ none | **CRITICAL** |
| Reply generation (direct OpenAI SDK) | replyGenerationService.ts (~L133) — credits deducted but `total_cost_usd` NULL → margin wrong | ✗ cost | **CRITICAL** |
| Voice transcription (Whisper + AssemblyAI) | pages/api/voice/transcribe.ts | ✗ none | HIGH |
| External APIs (GA4 / adapters) | externalApi/** | request counts only, no USD | HIGH |

This is worse than the coverage gap: for these you cannot even compute loss because the cost is invisible.

## Task 6 — Billing consistency model

**Six coexisting philosophies** today: (1) fail-closed pre-check; (2) flag-gated (currently inert); (3) fail-open post-facto; (4) value-gated (free when no value); (5) metered-unbilled; (6) completely unmetered; plus shadow-mode guard. Target: one model — **pre-check fail-closed for user-initiated, reserve-before-execute for async, metered-always for cost capture**, value-gating kept only as an explicit product decision. Normalizing §C.3 (philosophy 3/4) is the highest-regression-risk change (auth/billing stability lock).

## Task 7 — Processor / async coverage

| Question | Verdict | Evidence |
|---|---|---|
| HOLD before execute? | **SAFE** | executeWithCredits HOLD then EXECUTE ([creditExecutionService.ts:636](backend/services/creditExecutionService.ts#L636)) **[R]** |
| Retry double-charge? | **SAFE** | deterministic SHA256 `makeIdempotencyKey` + DB UNIQUE; RPC returns existing row on replay **[V-partial]** |
| Retry free-execute? | SAFE-empirically | all processors go through `withQueueBilling`; residual only if release-row manually deleted (blocked by immutability trigger) |
| Orphan HOLD leak? | SAFE-with-cron | `creditOrphanHoldReaper` 1–24h window; **no hard SLA/escalation if cron dies** (Gap #3) |
| actual > HOLD? | **SAFE** | RPC raises, RELEASE issued, critical anomaly, org auto-block — no silent debt |
| Dead-letter replay? | **SAFE** | idempotent — same key returns existing txns |

## Task 8 — Financial immutability & bypass vectors

- **Immutability holds for service_role too [V]:** `raise_ledger_immutable()` ([20260663:27](supabase/migrations/20260663_ledger_immutability_and_governance.sql#L27)) raises unconditionally (no role check) on UPDATE/DELETE; Postgres triggers fire regardless of role — service_role **cannot** bypass it.
- **No direct mutation paths [R]:** all balance writes go through `apply_credit_*` RPCs; no raw `.update()/.delete()` on financial tables found.
- **Admin grant/adjust/refund fully governed [R]:** multi-approver thresholds, proposer-cannot-self-approve, frozen-after-execute, immutable audit ([20260663:174-372](supabase/migrations/20260663_ledger_immutability_and_governance.sql#L174)).
- **GAP — no RLS on `credit_transactions` / `organization_credits` [R]:** service_role has unfettered cross-org read/write; sole control is app-layer auth. Defense-in-depth missing (immutability still prevents tampering; this is a cross-org *confidentiality/forgery-via-bad-RPC-arg* risk, not a tampering risk).

## OUTPUT A — Executive summary

- **Monetization maturity:** Foundation is bank-grade (Appendix F). Enforcement maturity is **low**: in production only ~3 routes + refine-variant actually charge; every flag-gated control is OFF/shadow.
- **Biggest revenue leak:** Bucket B+E — flag-gated processors are dark in prod **and** ~19+ routes/direct-SDK paths never bill (§C.4 + Task 5).
- **Biggest accounting risk:** Task 5 black holes — Gemini, image-gen, reply-gen, voice incur real provider cost with **zero capture** → margin/profitability unknowable for those.
- **Biggest scalability blocker:** Six inconsistent billing philosophies; no single enforcement contract.
- **Biggest reconciliation blocker:** usage↔ledger linkage implicit (nullable `reference_id`, no FK), no DB-level final_attempt uniqueness, no provider-invoice reconciliation loop.

## OUTPUT B — Implementation order (no code yet)

- **Immediate (zero/low code, highest leverage):** (1) Decide + enable `billing.reservations_required` rollout (turns on the 2 already-built processor billings); (2) add `credit_cost_config` rows for §C.4 (no behavior change until wired); (3) route Gemini/image/voice/reply through the metered gateway *for cost capture only* (no user billing yet) to close the accounting black holes.
- **Short-term:** wire §C.4 routes through `executeWithCredits` pre-check; wrap boltContentJobProcessor & campaignPlanningProcessor; flip `BILLING_REQUIRE_AI_HANDLE` to enforce after Bucket E is wired.
- **Pre-paid-launch:** normalize §C.3 fail-open→fail-closed (with contract-test updates); Gaps #1–#3 (policy_version stamp, usage↔ledger FK, reaper SLA); add RLS to financial tables.
- **Enterprise-hardening:** provider-invoice reconciliation loop (Gap #5); invoicing/dunning automation (Gap #4); final_attempt DB uniqueness.

## OUTPUT C — Safe implementation boundaries (do NOT touch when implementing)

- **Must NOT refactor:** `creditExecutionService` HOLD/CONFIRM/RELEASE; `apply_credit_reservation` / `apply_credit_partial_confirm` RPCs; `raise_ledger_immutable` trigger; the multi-approver governance + thresholds.
- **Invariants to preserve:** ledger append-only; idempotency-key required + deterministic derivation; HOLD-before-execute; actual>HOLD hard-fail; auth/billing stability-lock contracts (memory: contract tests + stability.yml) and the 300-credit onboarding grant path.
- **Migration-risk areas:** anything touching `credit_transactions`/`organization_credits` shape; the disabled `bootstrapCompanyFromSignupIntent` (CI-locked).
- **Concurrency/transaction-critical:** wallet projection rebuild; reservation RPC row-locking; idempotency UNIQUE races; queue `execution_hash` uniqueness.

## OUTPUT D — Required next implementation phase (work items only, no code yet)

1. Product/pricing decision: approve §C.4 cost mapping; per-turn vs per-session for chat surfaces; keep/kill value-gating; fail-open→fail-closed yes/no.
2. Cost-capture wrapper for the 5 Task-5 black-hole paths (capture-only first, bill later).
3. `reservations_required` rollout plan (which orgs/cohort, monitoring).
4. Catalog migration: add missing `action_type` rows.
5. Route-wiring batch: §C.4 through `executeWithCredits`.
6. Processor billing: boltContentJobProcessor, campaignPlanningProcessor.
7. Hardening: policy_version stamp, usage↔ledger FK + final_attempt uniqueness, reaper SLA/alert, RLS on financial tables, provider-invoice reconciliation.
8. Consistency: collapse to one enforcement contract; update stability/contract tests in lockstep.

No code will change until you approve Output D scope and the pricing/philosophy decisions.

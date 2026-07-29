# LEAD-INTELLIGENCE-001 — Wave W4
## LC-401 — Explainable Campaign Intelligence & Multi-Channel Orchestration Platform

**Program:** LEAD-INTELLIGENCE-001 · **Wave:** W4 (Campaign Intelligence) · **Type:** Campaign Intelligence + Decision Engine + Orchestration (no execution).
**Predecessors:** W0/LC-000 … W3/LC-301 (all certified).
**Branch:** `feat/lead-intelligence-w4-campaign-intelligence` (off committed W3 `6a61908d`).
**Method:** Reuse-first GTM campaign layer verified against the **live prod DB** (test tenant `0eda0896`); schema applied additive/dark; jest regression; synthetic data cleaned up (18 seeds intact).

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

**Campaign Intelligence is now the explainable decision + orchestration layer** connecting Audience Intelligence → Operational Platform → (future) execution. Prod-verified: a GTM campaign **references an audience** (18-member reach, zero recipient copy), produces an **explainable strategy** (`educate_awareness`, evidence + confidence 0.44) and channel plan (`email`), **simulates** reach/engagement/workload/overlap with **`executed:false`**, reuses the **W2 operational core** (`entity_type='gtm_campaign'`, campaign lifecycle), and stores reusable messaging assets — **all without sending anything**. Zero architectural drift; no runtime regression; 36/36 tests green. The prod run **surfaced and fixed** a per-entity state-model gap and a count-extraction bug.

**W5 (Autonomous GTM / AI Execution) is authorized** — it turns these recommendations + simulations into guarded execution. Adjustments (refinements, not architecture):
- **A — Live channel availability:** channel recommendation uses source-mix affinity + defaults; wiring real connector/integration availability (`connectors/`, `emailService`, `linkedinEngagementWorkspaceService`) is a refinement.
- **B — Deeper strategy inputs:** strategy aggregates audience intent bands; per-member journey/company-context/`leadActions` aggregation would enrich it.
- **C — Messaging performance loop:** assets store fit + a `performance` slot; real performance requires execution (W5).
- **D — Campaign UI:** backend + API delivered; a campaign console is a consumption slice (like W2b).

---

## 1. Entry Gate — PASS

| Check | Result |
|---|---|
| W3 certified; Audience + Operational Platform operational | ✅ |
| Canonical scoring operational | ✅ |
| Runtime Evidence Baseline unchanged | ✅ |
| No campaign execution engine to extend | ✅ existing `campaigns` + `campaignAiOrchestrator`/`campaignRecommendationService` are **content-planning** (creator/BOLT weekly plans) — a different domain; GTM orchestration is new |
| No duplicate messaging platform | ✅ reuses existing channel services (`emailService`, `engagementMessageService`, `linkedinEngagementWorkspaceService`, `connectors/`) for evidence; `gtm_messages` is a net-new reusable asset store |

---

## 2. Campaign Domain Model Report (WP-401.1)

`gtm_campaigns` (new): `status` (draft/active/paused/completed/archived), `objective`, **`audience_id` (reference to `audiences.id` — no recipient copy)**, `channels`, `kpis`, `schedule`, **`strategy` jsonb** (explainable recommendation snapshot), `version`, ownership via operational core. Distinct from the content-planning `campaigns` table (documented, no overload).

**Prod-verified:** campaign persisted `audience_id` == the referenced audience (no membership duplication).

---

## 3. Strategy Engine Report (WP-401.2)

`lib/campaign/campaignStrategy.ts` (pure, **configurable — no hidden heuristics**). Inputs: audience intelligence aggregate (reused). Outputs, each with **why + evidence + confidence**: `objective` (book_meetings / nurture_to_meeting / educate_awareness by avg-intent thresholds), `timing`, `cadence`, `channelMix`, `successMetrics`. **No new scoring engine** — decisions derive from already-materialized scores. Unit: 6/6.

**Prod-verified:** low-avg-intent audience → `educate_awareness`, 6-touch/7-day cadence, evidence `["avg intent 15%", "18 low-intent members"]`, confidence 0.44.

---

## 4. Channel Recommendation Report (WP-401.4)

`recommendChannelPlan`: best channel / sequence / cadence / send-window, each **evidence-backed + confidence-scored**, from source-mix affinity (email universal; linkedin for social/community/engagement; in_app for website/blog) filtered by availability. **Recommends only — no execution.** Prod-verified: `bestChannel=email` with source evidence.

---

## 5. Operational Reuse Report (WP-401.5)

Campaigns reuse the **W2 operational core** (`entity_type='gtm_campaign'`): owner, status, notes, tasks, timeline. **Engineering extension (reuse-first, not a fork):** the core now selects the state model **per entity type** (`modelForEntity`) — lead / campaign / audience lifecycles are different *configs* of the ONE state engine. **Prod-verified:** campaign `draft→active` accepted; a lead-state (`qualified`) on a campaign correctly **rejected** (`invalid_transition:unknown_to`).

---

## 6. Campaign Intelligence Report (WP-401.6)

`getCampaignIntelligence` aggregates the referenced audience's intelligence (members, avg intent, bands, sources) + reusable-message count — **reusing existing materialized scores**, no new scorer. Prod-verified: 18 members surfaced.

---

## 7. Campaign API Report (WP-401.7)

**One** endpoint `/api/lead-intelligence/campaigns` — one read model (list/get/messages/intelligence/operational overlay), one mutation model (`action`: create/update/delete/recommend/preview_strategy/simulate/intelligence/create_message), one permission model (`enforceCompanyAccess`). Operational mutations reuse `/operations` with `entity_type='gtm_campaign'`.

---

## 8. Simulation Report (WP-401.8)

`simulateCampaign` (before execution; **sends nothing**): expected reach (audience `member_count`), **audience overlap** (shared members vs other campaigns' audiences), estimated engagement (explainable weights over intent bands), estimated workload (members × touches), operational impact (tasks if executed). Every field explainable; `executed:false`.

**Prod-verified:** reach 18, engaged 1 (`high×0.5+med×0.2+low×0.05`), workload 108 tasks (18×6), overlap computed, **`executed:false`**.

---

## 9. Runtime Validation Report + Regression

`audience → strategy → message rec → channel rec → operational → simulation → explainability` verified end to end against prod, **no execution, no duplicate data** (campaign references the audience). Canonical scores/tracking/attribution untouched. **36/36** unit tests across 6 suites.

---

## 10. Performance Certification

Campaign create/recommend/simulate = a bounded set of reused audience reads + pure engine calls (no per-member scoring). Overlap is O(other campaigns × members) — fine at current scale; batchable later. No regression to W3 (campaign reads additive).

---

## 11. Observability Report

`trackEvent('campaign.created'|'campaign.recommended')` with objective + confidence; recommendations carry confidence; simulation returns explainable bases; typed `CampaignError` → precise HTTP status; DB timing via `ownedDbTable`; correlation IDs via the route factory.

---

## 12. Architectural Drift Report

| Prohibited | Introduced? | Evidence |
|---|---|---|
| Duplicate campaign engine | ❌ | `gtm_campaigns` = GTM strategy object; content `campaigns` is a separate domain (documented) |
| Duplicate audience storage | ❌ | campaign **references** `audiences.id`; reuses `audienceService` for members/intelligence |
| Duplicate messaging platform | ❌ | reuses existing channel services; `gtm_messages` is a net-new reusable asset store |
| Duplicate scoring | ❌ | reuses materialized scores; strategy engine adds no scorer |
| Duplicate operational model / APIs | ❌ | reuses W2 core (`entity_type='gtm_campaign'`, per-entity state config); one campaigns endpoint |

**Change surface:** 5 new files + 2 additive extensions to the W2 core (per-entity state models). No parallel implementations.

---

## 13. W5 Readiness Assessment

| W5 (Autonomous GTM / AI Execution) needs | Provided |
|---|---|
| Explainable strategy + channel recommendation to execute | ✅ evidence + confidence per recommendation |
| Simulation before execution | ✅ reach/engagement/workload/overlap, `executed:false` |
| Campaigns referencing audiences (targets) | ✅ `audience_id` reference |
| Operational execution surface (tasks/owner/timeline) | ✅ W2 core (`entity_type='gtm_campaign'`) + member bulk-tasks |
| Reusable messaging assets to send | ✅ `gtm_messages` |
| Human→AI ladder | ✅ task `origin`, recommend-not-execute boundary |

**W5 authorized.**

---

## 14. W4 Exit Criteria

| Criterion | Status |
|---|---|
| Campaigns are first-class platform objects | ✅ |
| Campaigns reference audiences (no duplicate members) | ✅ (`audience_id` reference; reach via audience layer) |
| Strategy recommendations explainable | ✅ (why + evidence + confidence) |
| Messaging assets reusable | ✅ (`gtm_messages`) |
| Channel recommendations evidence-backed | ✅ |
| Operational Platform fully reused | ✅ (per-entity state model) |
| Simulation works without execution | ✅ (`executed:false`) |
| Runtime validation passes | ✅ |
| Performance regression absent | ✅ |
| Observability complete | ✅ |
| Zero architectural drift | ✅ |
| W5 readiness certified | ✅ |

---

## 15. Certification Statement

W4 delivers **Campaign Intelligence** as the reusable, explainable decision + orchestration layer of the GTM platform: a first-class GTM Campaign object that **references** audiences (never copies members), an explainable + configurable strategy and channel-recommendation engine over already-materialized scores (no new scorer), reusable messaging assets, full reuse of the W2 operational platform (extended to per-entity lifecycles), and pre-execution simulation that sends nothing. Introduces **zero architectural drift**, preserves the runtime baseline, and was verified end to end against the production database — hardened by fixing a per-entity state-model gap and a count bug found during the prod run.

**Decision: CERTIFIED WITH ADJUSTMENTS. Wave W5 (Autonomous GTM Execution) is authorized.** Adjustments A–D (live channel availability, deeper strategy inputs, messaging performance loop, campaign UI) are refinements, not architecture.

*Prod schema `gtm_campaigns` / `gtm_messages` applied additive + RLS + dark. Migration `supabase/migrations/20260727020000_campaign_intelligence.sql`. Code on `feat/lead-intelligence-w4-campaign-intelligence`, unpushed, ready for review/commit.*

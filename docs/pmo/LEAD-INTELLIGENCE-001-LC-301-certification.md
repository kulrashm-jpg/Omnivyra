# LEAD-INTELLIGENCE-001 — Wave W3
## LC-301 — Dynamic Audience Intelligence & Segmentation Platform

**Program:** LEAD-INTELLIGENCE-001 · **Wave:** W3 (Audience Intelligence) · **Type:** Intelligence Platform + Segmentation Engine + Production Implementation.
**Predecessors:** W0/LC-000 … W2/LC-201 (all certified).
**Branch:** `feat/lead-intelligence-w3-audience-intelligence` (off committed W2 `1c1c5968`).
**Method:** Reuse-first audience layer verified against the **live prod DB** (test tenant `0eda0896`, evaluated over the 18 backfilled seed leads); schema applied additive/dark; jest regression; all synthetic data cleaned up.

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

**Audience is now a first-class, dynamically-evaluated, explainable platform object**, built entirely on the certified foundation. Prod-verified: an audience evaluated to **18 evidence-backed members**, narrowing the rule to `intent≥0.9` correctly dropped to **0** (with prior members incrementally deactivated), the audience itself carries operational status/notes via the **W2 core** (`entity_type='audience'`), and audience intelligence reuses existing scores (no new scorer). **Zero architectural drift**, no runtime regression, 29/29 regression tests green. The prod run also **surfaced and fixed a real latent platform bug** (mixed 0–1 / 0–100 score scales).

**W4 (Campaign Intelligence) is authorized** — it reuses audiences + operational primitives directly. Adjustments (refinements, not architecture):
- **A — Auto-evaluation triggers:** evaluation is on-demand (via the `evaluate` action). Event-driven re-evaluation on lead change (true continuous membership) is a follow-on; today membership refreshes on evaluate/preview.
- **B — Broader score normalization:** the mixed-scale bug is fixed **in the segmentation engine**; the wider read model (e.g. `LeadListPanel` intent badge) still renders raw legacy `canonical_leads` 0–100 scores — a pre-existing inconsistency to normalize platform-wide.
- **C — Audience-object timeline:** audience-level operational actions emit telemetry but do not persist to a timeline (the `lead_intelligence_events` FK is lead-scoped); an entity-agnostic timeline is a W2 refinement. **Member-level** ops retain the full lead timeline.
- **D — W2b UI:** the profile now has an operational console (`OperationalPanel`); `LeadListPanel` bulk-selection UI and visual QA remain a frontend follow-on.

---

## 1. Entry Gate — PASS

| Check | Result |
|---|---|
| W2 certified; Operational Platform available | ✅ |
| Entity-agnostic operational core available | ✅ (`operational_*`, `entity_type`) |
| Canonical scoring / tracking operational | ✅ (W1.2) |
| Runtime Evidence Baseline unchanged | ✅ |
| No duplicate segmentation engine | ✅ (`audienceCategories.ts` = campaign-targeting taxonomy; `promptSegmentation.ts` = AI-prompt blocks — neither is a lead segmenter) |

---

## 2. Audience Domain Model Report (WP-301.1)

`audiences` table (new): `name`, `description`, `kind` (dynamic/static), **`rules` jsonb** (composable tree), `metadata`, `member_count`, `last_evaluated_at`. Audience is a first-class object; its operational layer is the W2 core (`entity_type='audience'`) — no per-audience operational tables.

---

## 3. Segmentation Engine Report (WP-301.2)

`lib/audience/segmentation.ts` (new, pure): a **composable** boolean engine over `RuleGroup { op:and|or, conditions[], groups[] }` (nested), operators `eq/neq/contains/in/gt/gte/lt/lte/exists/…`, across lead fields (source/campaign/status/**intent**/company/industry/utm/…) **and** operational fields (`op_status`, `op_assignee`). Rules are **data, never hardcoded segments**. It reuses the canonical view field model — **no second scoring engine**; intent comes from the already-materialized `scores`, normalized to 0–1.

**Latent bug found + fixed:** legacy `canonical_leads` carry scores on a **0–100** scale while website leads use **0–1**; `intent≥0.9` was matching `40≥0.9`. The engine now normalizes score fields (`>1 → /100`). Unit: 6/6.

---

## 4. Dynamic Evaluation Report (WP-301.3)

`audienceService.evaluateAudience`: pulls members from the **ONE unified read surface** (`searchLeads` → `CanonicalLeadView`), applies the rule engine, and materializes membership. **Incremental**: upsert current matches (on `audience_id,entity_type,entity_id`), then **deactivate stale** members (evaluated before this run) — no full-table churn, no scheduled export, no manual sync.

**Prod-verified:** `intent≥0.1 & source=website` → 18 members; re-evaluate after narrowing to `intent≥0.9` → 0 active, 18 total rows (prior deactivated, not duplicated).

---

## 5. Audience Explainability Report (WP-301.4)

`audience_memberships` stores per member: **`matched_rules`**, **`evidence`** (`{field, operator, expected, actual}`), **`confidence`** (0–1; rule coverage blended with the lead's own score confidence), **`evaluated_at`**, **`evaluation_source`**. `explainMembership()` / the API `explain` action answer *why this entity, which rule, which evidence, when, confidence*.

**Prod-verified:** all 18 memberships carried non-empty evidence; sample confidence 0.6.

---

## 6. Operational Reuse Report (WP-301.5)

Audiences reuse the **W2 operational core** unchanged (`entity_type='audience'`): owner, status, notes, tasks. Member bulk-actions reuse `bulkAssign`/`bulkSetStatus`/`bulkCreateTask` over the audience's active members. **No new operational implementation.**

**Prod-verified:** audience status set to `working` + a note added, both surfaced via `getOperationalOverlay`.

---

## 7. Audience Intelligence Report (WP-301.6)

`getAudienceIntelligence` aggregates **existing** intelligence over members — member count, avg intent, intent bands (high/med/low), source breakdown — from the already-materialized `scores`. **No new scoring engine.** Prod-verified: `avgIntent 0.15`, all-low band, `{website:18}`.

---

## 8. Audience API Consolidation Report (WP-301.7)

**One** endpoint `/api/lead-intelligence/audiences` — one read model (list/get/members/intelligence/operational overlay/explain), one mutation model (`action`: create/update/delete/preview/evaluate/explain/intelligence/bulk_members), one permission model (`enforceCompanyAccess`). Audience-level operational mutations reuse `/operations` with `entity_type='audience'`; member bulk reuses the W2 core.

---

## 9. Runtime Evaluation Report (WP-301.8) + Regression

`lead → audience membership → operational overlay → explainability` verified end to end against prod. **No duplicate evaluations** (incremental upsert + stale-deactivate). Canonical scores/tracking/attribution untouched. **29/29** unit tests across 5 suites (segmentation + operational + read service + read model + repository).

---

## 10. Performance Certification

| Metric | Note |
|---|---|
| Audience evaluation | one bulk unified read (`searchLeads`) + one bulk operational-overlay read, then pure in-memory rule eval; O(members) upserts |
| Rule execution | pure, per-view, no I/O |
| Preview | evaluate-without-persist (no writes) |
| API / membership refresh | remote-RTT bound in validation; deployed co-located sub-second |

No regression to Lead Intelligence (audience reads are additive; capture/read path untouched). Membership materialization is O(matched); large audiences would benefit from batched upserts (noted).

---

## 11. Observability Report

Audience evaluation returns `member_count` + `evaluated_at`; memberships carry `evaluation_source` + `evaluated_at`; operational actions on audiences/members emit `trackEvent('operations.*')`; DB timing via `ownedDbTable` (`observability_slow_db`); typed errors (`AudienceError`) → precise HTTP status. Correlation IDs via the route factory.

---

## 12. Architectural Drift Report

| Prohibited | Introduced? | Evidence |
|---|---|---|
| Duplicate rule engine | ❌ | `segmentation.ts` IS the engine; reuses the canonical view field model |
| Duplicate scoring | ❌ | reuses materialized `scores` (normalized) — no new scorer |
| Duplicate operational model / timeline / ownership | ❌ | reuses the W2 core (`entity_type='audience'`) + `lead_intelligence_events` |
| Duplicate APIs | ❌ | one `audiences` endpoint |
| Duplicate audience storage | ❌ | `audiences` + `audience_memberships` are THE storage |

**Change surface:** W3 = 5 new files (migration, engine lib, service, API, test) — zero existing-code edits. W2b = frontend-only consumption (`OperationalPanel` + client functions + mount), **no backend change**.

---

## 13. W4 Readiness Assessment

| W4 (Campaign Intelligence) needs | Provided |
|---|---|
| Audiences as targetable, evaluated objects | ✅ first-class `audiences` + membership |
| Explainable membership (who/why) | ✅ evidence + confidence per member |
| Operational layer on audiences | ✅ W2 core (`entity_type='audience'`) |
| One API to extend | ✅ audiences + operations endpoints |
| Reusable intent/intelligence per audience | ✅ aggregation over materialized scores |

**W4 authorized.**

---

## 14. W3 Exit Criteria

| Criterion | Status |
|---|---|
| Audience is a first-class platform object | ✅ |
| Segmentation dynamic + explainable | ✅ (prod: 18 members w/ evidence; narrowing → 0) |
| Operational Platform fully reused | ✅ (`entity_type='audience'` + member bulk) |
| No duplicate scoring / rule engines | ✅ |
| Every member has evidence-backed membership | ✅ (matched_rules + evidence + confidence) |
| Runtime evaluation passes | ✅ + incremental deactivation |
| Performance regression absent | ✅ additive |
| Observability complete | ✅ |
| Zero architectural drift | ✅ |
| W4 readiness certified | ✅ |

---

## 15. W2b — Operational Workspace UI Consumption (parallel slice)

Backend-neutral: added `fetchOperationalOverlay`/`operationsAction` to the workspace client and an `OperationalPanel` (status select, owner assign/unassign, notes add/list, tasks add/complete) mounted on the lead profile page. **All mutations flow through the single `/api/lead-intelligence/operations` API.** No new backend APIs/tables/logic/auth. Remaining: `LeadListPanel` bulk-selection UI + visual QA (frontend).

---

## 16. Certification Statement

W3 delivers **Audience Intelligence** as a reusable platform capability: a first-class Audience object, a composable/explainable segmentation engine (rules as data, scores reused + normalized), dynamic incremental evaluation with per-member evidence, and full reuse of the W2 operational platform — introducing **zero architectural drift** and preserving the runtime baseline. Verified end to end against the production database (18 evidence-backed members; correct narrowing to 0; audience operationalization), and hardened by fixing a real latent mixed-score-scale bug. The W2b consumption slice makes the workspace operational from the UI without any backend change.

**Decision: CERTIFIED WITH ADJUSTMENTS. Wave W4 (Campaign Intelligence) is authorized.** Adjustments A–D (auto-eval triggers, platform-wide score normalization, audience-object timeline, `LeadListPanel` bulk UI + visual QA) are refinements, not architecture.

*Prod schema `audiences` / `audience_memberships` applied additive + RLS + dark. Migration `supabase/migrations/20260727010000_audience_intelligence.sql`. Code on `feat/lead-intelligence-w3-audience-intelligence`, unpushed, ready for review/commit.*

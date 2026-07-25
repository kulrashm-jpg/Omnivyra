# PRODUCT-ARCH-001 — Strategic Recommendation Intelligence: Product Architecture Decision

**Assigned:** Agent 2 (Product Architecture) · **Authority:** Product Architecture Review · **Priority:** Critical.
**Type:** decision package — **no code was modified, no migration created, nothing restored or deleted.**
**Date:** 2026-07-22.

---

## 1. Executive summary

Strategic Recommendation Intelligence is the six-field narrative layer on a recommendation card —
`problem_being_solved`, `gap_being_filled`, `why_now`, `authority_reason`, `expected_transformation`,
`campaign_angle` — carried as `card.intelligence.*`.

Its sole engine-path producer, `enrichRecommendationIntelligence()`, was **destroyed as collateral in a
901-file bulk commit**, not retired by decision. The evidence is unambiguous (§2). Today:

- **Zero** of the six fields are produced anywhere in `backend/services/recommendationEngine/**` (verified).
- The step named `recommendationCardEnrichmentService` "enriches" nothing — it is a literal `?? null`
  passthrough that provably cannot invent values.
- **But the capability is not dead.** The Planner still produces 4 of 6 fields deterministically, three
  Bolt hooks produce `campaign_angle`, and the product ships a **full six-field human editor**. The UI
  renders all six. A validator scores all six. The content bridge and week-topic generator consume them.

So this is not "an active capability" versus "a retired capability" — it is an **active capability with a
deleted producer on its primary path**, masked from view because every consumer null-coalesces instead
of failing. The correct architecture decision is **OPTION A**.

**Decision: OPTION A — Strategic Recommendation Intelligence remains part of Omnivyra.**

---

## 2. Historical timeline (evidence, not inference)

| When | Commit | What happened |
|---|---|---|
| pre-2026-05-16 | — | `backend/services/recommendationIntelligenceService.ts` = *"Recommendation Intelligence Enrichment Layer… **Deterministic only. No external API. No scoring changes.**"* 185 lines. Exports `RecommendationIntelligence` (the 6 fields), `EnrichedRecommendation`, `enrichRecommendationIntelligence()`. Six deterministic rules **A–F** derive each field from `CompanyProfile` + `PolishFlags` + signal strength. A `catch` branch fills **all six with non-null fallbacks** — the design guaranteed these were never null. |
| 2026-05-16 22:37 | **`6cd30522` "Bolt Creator"** | **901 files, +135,357 / −2,324, empty commit body**, subject names an unrelated feature. The file is replaced wholesale (185 → 93 lines) by an unrelated SEO/growth analytics service exporting `buildRecommendationIntelligence` and **re-using the exported type name `RecommendationIntelligence`** for an incompatible shape (`{status, recommendations}`). `enrichRecommendationIntelligence` ceases to exist. **Consumers are not updated.** |
| 2026-05-17 01:40 | `45090aa0` | Drops a dead import in `engineHelpers.ts`. Commit body: *"removed **upstream** … **NOTE: engine.ts still calls the removed function (lines 831, 891) — that is a behavior-affecting decision, intentionally left for review (see Phase N report), not a mechanical fix.**"* |
| 2026-05-17 01:49 | `f0e03e8b` | No-ops the two `engine.ts` call sites to stop a *"latent runtime TypeError."* Body: *"Decision: approved no-op over **speculative** restore."* |

**Was the removal intentional?** No. Five independent indicators:

1. It occurred inside a 901-file bulk import with an **empty body** and an unrelated subject.
2. **Callers were left calling a deleted function** → latent `TypeError`. A deliberate retirement removes its callers; this one crashed them.
3. The follow-ups were authored by a *different* actor who describes the function as *"removed upstream"* — i.e. they encountered it, they didn't decide it.
4. That actor explicitly **deferred the product question** (*"intentionally left for review"*, *"speculative restore"*). This review is that deferral being paid off.
5. **No design document, ADR, or release note anywhere in the repo authorizes a retirement** (searched `docs/`, root `*.md`). The only doc that describes the capability still asserts it is produced (§5).

**Was a replacement intentional?** No. The name was **re-used, not replaced** — an unrelated analytics
concept took the filename *and* the exported type name. That is a collision, not a migration.

---

## 3. Consumer inventory

> Disambiguation that matters for any cleanup: `why_now`/`whyNow` **also** exists as an unrelated
> report/PDF/decision-intelligence field (Digital Snapshot priorities, customer-success playbooks). That
> family **has** producers and is **out of scope**. Only the `card.intelligence.*` cluster is at issue.

### 3.1 Producers

| Site | Produces | Nature |
|---|---|---|
| `backend/services/recommendationEngine/**` | **NONE (0/6)** — verified by exhaustive grep | the deleted producer's path |
| `lib/plannerStrategicCard.ts:198–215` | **4/6** — `problem_being_solved`, `why_now`, `expected_transformation`, `campaign_angle` | deterministic template strings; can still emit `null` |
| `components/command-center/BoltCombinedStrategyController.tsx:506`, `hooks/useBoltStrategy.tsx:1012`, `hooks/useBoltCreator.tsx:689` | **1/6** — `campaign_angle` only | client-side |
| `lib/recommendationStrategicCard.ts:310–318` | **6/6** | **human editor write-back** |

`backend/services/recommendationCardEnrichmentService.ts:168–175` — named "enrichment", is a pure
`?? null` normalizer; called at `recommendationEngine/engine.ts:1103` as the **last** engine step. It
cannot invent values. **This is the mask**: the shape always exists, so nothing ever fails.

### 3.2 Consumers

| Consumer | Required / optional | Behavior on all-null |
|---|---|---|
| `components/recommendations/cards/RecommendationBlueprintCardCard.tsx` (187–192, 199–205, 240–242, 255–273, 346–376, 565–570) | optional | **Entire "Diamond Intelligence" section hidden**; Conversion-Driver badge absent; decision brief and "Why now" omitted; confidence banner falls back to topic |
| `components/recommendations/cards/BlueprintMetrics.tsx:108–113` | optional | all six rows omitted |
| `components/recommendations/cards/RecommendationBlueprintCardMeta.tsx:478–511`, `BlueprintDetails.tsx:92–97` | — | **six-field editor renders empty** (ships today) |
| `components/planner/StrategicThemeCards.tsx:276–287` | optional | "Why now" / "Intended outcome" omitted |
| `backend/services/strategicContentTransformationValidator.ts:51–69` | **scores all six** (`campaign_angle/why_now/gap_being_filled/problem_being_solved/expected_transformation` = 5, `authority_reason` = 4) | null skipped at `:151` ⇒ **silently scores 0, no error** — quality scores are currently misleading |
| `backend/services/recommendationBlueprintService.ts:244–277, 296–307` | optional | **hard-coded generic strings** (`'current pain patterns'`, `'the current market shift makes this urgent'`…) interpolated into **generated week topics/goals** |
| `lib/content/cardToContentBridge.ts` (+`…Signals/Builders`) | optional | heaviest consumer; the **sparse-card minimum-signal branch (`:280–303`) always fires**, synthesizing generic copy |
| `backend/services/recommendationSequencingService.ts:98–120` | optional | stage classification collapses to `'awareness'` |
| `backend/services/campaignAiOrchestrator/deterministicWeekStrategy.ts:111–151` | optional | alignment reason skipped |
| `pages/api/campaigns/regenerate-blueprint.ts:201–210` | optional | `strategic_theme_intelligence` prompt key never set |

**Independent in-repo corroboration.** Committed diagnostic harnesses already recorded this as a defect:
`__bridge_trace.js:320` — failure mode `fake-decision-block`, **severity `high`**: *"decision_blocks built
entirely from templates … contain no card intelligence when problem_being_solved and gap_being_filled are
empty"*; `:301–302` record `gap_being_filled`/`authority_reason` as unreachable on the Planner card.

---

## 4. Product impact assessment

Per field, on the recommendation-card path:

| Field | Produced? | Consumed? | Displayed? | Exported? | Validated? | Ignored? |
|---|---|---|---|---|---|---|
| `problem_being_solved` | Planner ✅ · engine ❌ · editor ✅ | ✅ bridge, blueprint, sequencing, prompt | ✅ decision brief, detail list, editor | ❌ no dedicated export | ✅ weight 5 | ❌ |
| `gap_being_filled` | **❌ nowhere but the editor** (absent from Planner schema) | ✅ bridge `uniqueness_directive` | ✅ detail list, editor | ❌ | ✅ weight 5 | ❌ |
| `why_now` | Planner ✅ · engine ❌ · editor ✅ | ✅ bridge `trend_context` | ✅ "Why now", Planner card | ❌ (Family-A) | ✅ weight 5 | ❌ |
| `authority_reason` | **❌ nowhere but the editor** (absent from Planner schema) | ✅ sequencing → `authority` stage; bridge insight angle | ✅ detail list, editor | ❌ | ✅ weight 4 | ❌ |
| `expected_transformation` | Planner ✅ · engine ❌ · editor ✅ | ✅ bridge, blueprint | ✅ "Intended outcome", decision brief | ❌ | ✅ weight 5 | ❌ |
| `campaign_angle` | Planner ✅ · Bolt ✅ · engine ❌ · editor ✅ | ✅ week strategy, sequencing, bridge `selected_angle` | ✅ Conversion-Driver badge | ❌ | ✅ weight 5 | ❌ |

**Are users today expected to receive these?** Yes — and partially they do. The product renders them,
ships an editor to author them, scores them, and feeds them into generated campaign content. What users
do **not** receive is the engine-generated version: on the recommendation-engine path all six are `null`,
so the Diamond Intelligence section silently disappears and downstream generation falls back to generic
template prose. **Nothing is ignored; everything degrades quietly.**

---

## 5. Repository consistency report

| Category | Finding |
|---|---|
| Dead schema | **None** — zero SQL columns for any of the six (all 355 migrations + `database/`). Nothing to clean either way. |
| Dead prompts | **None** — no prompt ever asked an LLM for these fields. The original producer was deterministic. |
| Dead DTOs/contracts | **None dead** — every declaration is live. **But a name collision exists:** `RecommendationIntelligence` is exported twice with incompatible meanings — `lib/recommendationStrategicCard.ts:21–28` (6 narrative fields) vs `backend/services/recommendationIntelligenceService.ts:21` (`{status, recommendations}`). |
| Dead UI | **None** — renderers *and* a six-field editor ship today. |
| Dead exports | No dedicated API/CSV/PDF export of the cluster (rides inside the recommendation JSON). |
| Dead validators | **None dead** — the validator is live and scoring these at priority 5, currently always 0. |
| Dead tests | **2 suites, 17 failing tests**, importing the nonexistent `enrichRecommendationIntelligence`: `backend/tests/unit/recommendationIntelligenceEnrichment.test.ts`, `backend/tests/unit/companyContextFoundationFix.test.ts`. |
| Ratcheted debt | The breakage is **accepted into the typecheck baseline**: `scripts/typecheck-certification-fingerprints.json` carries 1× `TS2724` (missing `enrichRecommendationIntelligence`) + 6× `TS2339` (each field missing on the repurposed type). |
| Inconsistent docs | `docs/RECOMMENDATION-CARD-IMPLEMENTATION-REPORT.md:46` (and the archived hub audit) attribute the fields to *"Engine + enrichment (merge)"* — **not supported by the code**. |
| Misleading name | `recommendationCardEnrichmentService` performs no enrichment. |

---

## 6. Recommended product decision — **OPTION A**

**Strategic Recommendation Intelligence remains part of Omnivyra.**

Rationale (decisive, no hybrid):

1. **The removal was never a product decision** (§2). Restoring aligns the repository with the last
   actual product intent; retiring would ratify an accident.
2. **The capability is still live and user-facing.** A product does not ship a six-field editor, six
   render sites, and a scored validator dimension for a retired capability. Option B would require
   *deleting working, user-visible surface* to match a bulk-commit casualty.
3. **The absence is actively degrading output**, not merely inert: week topics and content-bridge
   decision blocks fall back to hard-coded generic prose, and the repo's own committed trace harness
   rates this `high` severity.
4. **The validator is currently lying** — six dimensions weighted 5/5/5/5/5/4 silently score 0.
5. **Restoration is cheap, deterministic and low-risk**: ~185 lines recoverable verbatim from
   `6cd30522^`, no LLM, no external API, no schema, no migration, two call sites.

### Missing producer inventory

| Missing | Where it must live |
|---|---|
| `enrichRecommendationIntelligence()` (rules A–F + the non-null `catch` fallback) | restore from `6cd30522^:backend/services/recommendationIntelligenceService.ts` into a **new, non-colliding module** |
| Engine wiring | `recommendationEngine/engine.ts` — two sites currently no-op comments (~827, ~886) |
| Planner parity | `lib/plannerStrategicCard.ts` produces 4/6; `gap_being_filled` + `authority_reason` are structurally absent from the Planner card |

### Required implementation work / migration / compatibility plan

- **Migration impact: none.** No schema, no data backfill — the fields are runtime-only.
- **Compatibility: fall-back-safe by construction.** Every consumer already tolerates `null`, so a
  restored producer is purely additive; a flag-gated rollout can A/B the generated-content change.
- **Sequencing constraint:** the name collision must be resolved *before* the restore, or the two
  `RecommendationIntelligence` types will conflict.

---

## 7. Required follow-up work packages

| WP | Work | Note |
|---|---|---|
| **WP-1** | Resolve the `RecommendationIntelligence` name collision (rename the analytics export / relocate the narrative type) | **blocks WP-2**; pure rename |
| **WP-2** | Restore the deterministic producer (rules A–F + non-null fallback) into a correctly-named module; re-wire the two `engine.ts` no-op sites | flag-gated; A/B the content change |
| **WP-3** | Reconcile Planner partial production — either extend the Planner card with `gap_being_filled`/`authority_reason` or make the bridge's Planner substitutes canonical | product-shaped decision |
| **WP-4** | Un-ratchet the 7 typecheck fingerprints; return the 2 orphaned suites (17 tests) to green | resolves as a side effect of WP-2 |
| **WP-5** | Correct `docs/RECOMMENDATION-CARD-IMPLEMENTATION-REPORT.md:46` ("Engine + enrichment"); consider renaming `recommendationCardEnrichmentService` | truth-in-naming |
| **WP-6** | Add a regression guard asserting a non-null producer exists on the engine path | prevents silent recurrence |

## 8. Risks

| Risk | Level | Note |
|---|---|---|
| Restoring changes generated output (week topics, decision blocks) from generic fallbacks to specific narrative | **Medium — the real one** | user-visible content change; must be flag-gated and reviewed, not shipped blind |
| Validator scores rise once fields are non-null | Medium | anything calibrated against today's silent 0 will shift; re-baseline expected |
| Name collision mishandled | Medium | two incompatible `RecommendationIntelligence` exports; WP-1 must precede WP-2 |
| Planner vs engine narrative divergence | Low–Med | two producers could speak in different voices; WP-3 addresses |
| Doing nothing | **High** | silent degradation persists, validator keeps misreporting, 17 tests stay red, debt stays ratcheted |

## 9. Final certification

**PRODUCT-ARCH-001 COMPLETE — STRATEGIC RECOMMENDATION INTELLIGENCE IS AN ACTIVE PRODUCT CAPABILITY.**

The capability was never retired by decision; its engine-path producer was destroyed as collateral in a
901-file bulk commit and the product question was explicitly deferred to a review. It remains produced
(partially), rendered, editable, scored, and consumed today. The repository is internally inconsistent
because a *producer* is missing — not because a *capability* was removed.

*No code, schema, or migration was modified by this package.*

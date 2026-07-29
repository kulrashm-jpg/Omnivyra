# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 7 — Execution Intelligence

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Classification:** **C — Mixed** (reference-only core + one projection-owned identity read).
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1–C6 ✅

---

## 1. Executive Summary

"Execution Intelligence" splits in two. The **execution-planner CORE** (`executionPlannerService`,
`dailyPlanAiGenerator`, `executionPlannerPersistence`, planner-ops fleet) is **reference-only** — `company_id`
is an FK; it reads no company identity — certified and guarded. The **campaign-AI / BOLT planning** family
consumes company context, but almost all of it is **strategy/audience** (positioning, growth priorities, ICP,
key messages — not company identity). The one **projection-owned** identity field consumed is `category`, in
the BOLT schedule governance prompt (`boltContentGenerationForSchedule.ts:373`); that acquisition is now
routed through `resolveCompanyProjection`. Flag **OFF** (default) ⇒ same profile reference, byte-identical.
**22/22 tests pass; tsc 0.**

## 2. Consumer Classification

| Population | Reads company identity? | Class | Action |
|---|---|---|---|
| `executionPlannerService` / `dailyPlanAiGenerator` / `executionPlannerPersistence` / planner-ops / `lib/intelligence/executionIntelligence.ts` | No — plan/task/schedule data; `company_id` FK | **B — reference-only** | Certify + guard |
| Campaign-AI planners (`campaignAiPlanningContext`, `campaignPromptBuilder`, `campaignAiOrchestrator/*`, `campaign-chat`) | Yes — **strategy/audience** fields (not company identity) + `industry` | consumer (strategy) | Not migrated (strategy ≠ identity; industry not owned) |
| BOLT schedule governance (`boltContentGenerationForSchedule.ts:373`) | Yes — **`category`** (projection-owned) | **A — consumer** | **Adopt** (this phase) |

Overall: **C — Mixed**; the identity-acquisition path that the projection owns is a single `category` read.

## 3. Inventory Report

- **Adopted:** `boltContentGenerationForSchedule.ts:367-378` — `getProfile` → `profile.category` into the
  governance prompt context. Now `category` flows through the seam.
- **Reference-only core:** grep across `executionPlannerService.ts` + `dailyPlanAiGenerator.ts` +
  `executionPlannerPersistence.ts` for
  `resolveCompanyProjection|getProfile|getCanonicalProfile|company_profiles|report_settings|business_model|operating_model|domain_role|provider_type|solution_domains|.category|.industry|classifiers`
  → **0 matches** (guard-enforced).
- **Fetch seam:** the campaign/BOLT planners read via `getCanonicalProfile` (`canonicalProfileAdapter.ts`) —
  a **shared** adapter (also used by Lead/Market Pulse), so it was **not** repointed (would migrate all
  consumers at once). Adoption is done at the campaign/BOLT-owned read site instead.
- **Not projection-owned:** `industry` + all planner strategy/audience fields — deferred (strategy, not
  company identity; industry is a model-coverage gap).

## 4. Duplicate Reasoning Audit

None in the execution/planning layer. Grep for
`business_model|operating_model|domain_role|provider_type|solution_domains|classifyCompany|inferBusinessModel`
across bolt/campaign/daily/planner files → **0 identity-classification hits**. `buildCompanyStrategyDNA`
(`companyStrategyDNAService.ts`) is a **shared** service the planner *calls* (derives strategy DNA), not a
planner-owned company-identity re-derivation — left untouched (its own migration, if any, is not this
consumer). No prompt asks the LLM to infer company category/business_model/operating_model/domain_role.
Nothing to remove; nothing new to document for U5.

## 5. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/executionIntelligenceConsumer.ts` | NEW | `adoptExecutionCompanyIdentity` (category overlay via seam; flag OFF ⇒ same reference) |
| `backend/services/boltContentGenerationForSchedule.ts` | MODIFIED | import + overlay `category` through the seam before the governance prompt (flag-gated no-op) |
| `backend/tests/unit/executionIntelligenceConsumer.test.ts` | NEW | 22 tests (guard + adoption) |

No planner core, campaign orchestrator, strategy-DNA, scheduling, or automation logic changed. Plan/task
data untouched.

## 6. Projection Integration (and deferrals)

`adoptExecutionCompanyIdentity(profile, companyId, asOf, evidence?)` → `resolveCompanyProjection`; overlays
`category` (flag OFF ⇒ same reference; fail-safe on regression ⇒ stored kept). In production the BOLT path
supplies no evidence ⇒ `canonical_profile` (category echoes stored) ⇒ architectural adoption, byte-identical.
Deferred: `industry` (not projection-owned) and the planner strategy/audience fields (strategy, not identity).

## 7. Tests Added (all required types · 22/22)

Consumer Classification / Guard (13 forbidden owner-identity signals over the core) · Projection Integration ·
Planning Integrity (industry/category_list unchanged) · Output Parity (OFF same reference) · Approved
Improvement (category corrects under evidence) · Unexpected Regression (name divergence ⇒ stored category) ·
Rollback (ON→OFF identical) · Explainability (delta + version) · Performance (1000 adopts) · Consumer
Isolation (input not mutated). Prompt Integrity: covered by the audit — no planner prompt asks the LLM to
infer company identity.

## 8. Performance Report

Pure, in-memory; no network / AI / classification / evidence-fetch during identity acquisition. Flag OFF =
one comparison + early return. 1000 adopts under bound; deterministic.

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptExecutionCompanyIdentity` returns the **same
profile reference**; the governance prompt category is byte-identical to pre-U3·C7. Test asserts OFF ⇒
`=== profile` and ON→OFF restores identical output. **O(1)**.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on production | Flag OFF ⇒ same-reference no-op; asserted | None |
| Planner core drifts into identity consumption | Guard test fails the build on any identity read/fetch/classifier in the core | None |
| Over-broad migration via shared `getCanonicalProfile` | Adopted at the BOLT read site, not the shared adapter | None |
| industry / strategy fields not projected | Documented (industry gap; strategy ≠ identity) | Low |
| Execution plan redefines identity | Consumer only reads/overlays `category`; planning never writes identity | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Architectural role proven (mixed: reference-only core + `category` consumer) | ✅ |
| Reference-only core certified + guarded | ✅ |
| Consumed identity (`category`) acquired via `resolveCompanyProjection` | ✅ |
| No core identity reads / no planner prompt infers company identity | ✅ |
| Planning does not modify/repair/replace/infer company identity | ✅ |
| Flag OFF byte-identical (same reference) | ✅ |
| Approved improvement passes; unexpected regression fails safe | ✅ |
| Explainability preserved | ✅ |
| No network/AI/classification during identity acquisition | ✅ |
| Consumer isolation (BOLT read site only; shared adapter/core untouched) | ✅ |
| Rollback O(1) verified | ✅ |
| Duplicate reasoning addressed/documented | ✅ (none) |
| Tests pass (22/22); tsc 0 | ✅ |

## 12. Recommendation

Execution Intelligence's role is proven: the planner core is reference-only (certified + guarded) and the
one projection-owned identity read (`category`, BOLT governance) is adopted at an isolated, reversible site.
`industry` and planner strategy/audience fields are honestly deferred (model-coverage gap + strategy ≠
identity). Proceed to **Consumer 8 (Competitor Intelligence)** — the final consumer — individually, next.

# READY FOR NEXT CONSUMER

*No Consumer-8 work has begun; awaiting authorization (one-consumer-at-a-time).*

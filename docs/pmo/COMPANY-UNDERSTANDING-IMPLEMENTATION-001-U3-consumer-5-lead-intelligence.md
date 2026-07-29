# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 5 — Lead Intelligence

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Outcome:** MIXED — canonical spine certified reference-only (guarded); source-recommendation surface
adopts projection-owned `category`.
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1/C2/C3/C4 ✅

---

## 1. Executive Summary

"Lead Intelligence" splits across the consume/reference line. The **canonical `leadUnderstanding/` +
`leadIntelligence/` spine is references-only** (keyed by `companyId`; reads no company identity) — certified
and protected by a guard test. The **Active-Leads source-recommendation surface consumes** the company's
projection-owned `category` (→ industry bucket) to score lead sources; that acquisition is now routed
through `resolveCompanyProjection` at its single chokepoint `loadCompanyContext`. Flag **OFF** (default) ⇒
same profile reference, byte-identical. **17/17 tests pass; tsc 0.**

## 2. Consumer Classification

| Population | Reads company identity? | Class | Action |
|---|---|---|---|
| `backend/services/leadUnderstanding/**` (Program-1 spine) | No — defines `OrganizationValue` type + `industry` facet enum; keyed by `companyId` | **B — reference-only** | Certify + guard |
| `backend/services/leadIntelligence/**` (repos/runtime/attribution) | No — lead/behavior data, `organization_id` keys | **B — reference-only** | Certify + guard |
| Active-Leads `activeLeadsCompanyContext.loadCompanyContext` + source-rec engine | Yes — `category` (projection-owned) → industry bucket | **A — consumer** | **Adopt** (this phase) |
| `active-leads/context.ts` keyword classifier; `leadQualifier`/`leadPredictiveQualifier` | Yes — `industry` (+ keyword business-model/category re-derivation) | A — consumer | Documented (see §4/§6) |

## 3. Inventory Report

- **Chokepoint (adopted):** `activeLeadsCompanyContext.loadCompanyContext` (`:210`) — the single gather the
  whole source-rec surface (`sourceRecommendationEngine`, `curatedIndustrySourceService`, discovery/audit
  endpoints) flows through. Reads `profile.category`/`category_list` → industry bucket (`:242-243`).
- **Reference-only spine:** grep across `leadUnderstanding/` + `leadIntelligence/` for
  `getProfile|getCanonicalProfile|resolveCompanyProjection|company_profiles|report_settings|CompanyProfile|classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape` → **0 matches** (guard-enforced).
- **Not projection-owned:** `industry` (the primary field the qualifiers + `context.ts` consume) is not on
  the projection surface — deferred (model-coverage gap).

## 4. Duplicate Reasoning Audit

| Site | Kind | Disposition |
|---|---|---|
| `pages/api/active-leads/context.ts:71-302` — `isB2B`/`isTech`/`isConsumer`/`isCommunityLed`/`isEarlyStage` keyword classifier | lead-surface-owned business-model/category re-derivation | **Documented for U5** (classifier retirement) — not removed (behavior change; separate endpoint) |
| `sourceRecommendationEngine.ts:465-495` — industry ∩ seed verticals | matching (not reclassification) | keep — consumes `context.industry`, no identity derivation |
| `leadQualifier.ts` / `leadPredictiveQualifier.ts` | hand raw `industry` to the LLM (delegated) | no regex/classifier; `industry` not projection-owned → not migrated |
| `leadUnderstanding/` / `leadIntelligence/` | none | reference-only |

## 5. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/leadIntelligenceConsumer.ts` | NEW | `adoptLeadCompanyIdentity` (category overlay via seam; flag OFF ⇒ same reference) |
| `backend/services/activeLeadsCompanyContext.ts` | MODIFIED | import + overlay `category` reads through the seam at `loadCompanyContext` (flag-gated no-op) |
| `backend/tests/unit/leadIntelligenceConsumer.test.ts` | NEW | 17 tests (guard + adoption) |

No lead spine, qualifier, scoring, or source-rec engine logic changed. Lead/behavior/engagement data
untouched.

## 6. Projection Integration (and deferrals)

`adoptLeadCompanyIdentity(profile, companyId, asOf, evidence?)` → `resolveCompanyProjection`; overlays
`category` (flag OFF ⇒ same reference; fail-safe on regression ⇒ stored kept). The source-rec profile row
carries no `name`/`domain`, so evidence-path corrections need those fields — in production `loadCompanyContext`
supplies no evidence, so the path is `canonical_profile` (category echoes stored) — architectural adoption,
byte-identical. Deferred: `industry` (not projection-owned) and the `context.ts` keyword classifier (U5).

## 7. Tests Added (all required types · 17/17)

Inventory/Identity Audit · Guard (7 forbidden-consumption patterns over the spine) · Projection Integration ·
Output Parity (OFF same reference) · Approved Improvement (category corrects under evidence) · Unexpected
Regression (name divergence ⇒ stored category) · Rollback (ON→OFF identical) · Explainability (delta +
version) · Performance (1000 adopts) · Consumer Isolation (input not mutated; `category_list`/lead data
untouched). Prompt Integrity: covered by the audit — no lead prompt asks the LLM to infer company identity.

## 8. Performance Report

Pure, in-memory; no network / AI / classification / evidence-fetch during identity acquisition. Flag OFF =
one comparison + early return. 1000 adopts under bound; deterministic.

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptLeadCompanyIdentity` returns the **same profile
reference**; `loadCompanyContext` industry bucket is byte-identical to pre-U3·C5. Test asserts OFF ⇒
`=== profile` and ON→OFF restores identical output. **O(1)**.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on production | Flag OFF ⇒ same-reference no-op; asserted | None |
| Spine drifts into identity consumption | Guard test fails the build on any profile fetch / identity read / classifier in the spine | None |
| Over-broad migration | Overlay at the source-rec chokepoint only; qualifiers/engine/spine untouched | None |
| industry not projected | Documented model-coverage gap; industry unchanged | Low |
| context.ts keyword classifier | Documented for U5; untouched | Low |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Architectural role proven (mixed: reference-only spine + source-rec consumer) | ✅ |
| Reference-only behavior certified + guarded | ✅ |
| Consumed identity (`category`) acquired via `resolveCompanyProjection` | ✅ |
| No spine identity reads / no lead prompt infers company identity | ✅ |
| Flag OFF byte-identical (same reference) | ✅ |
| Approved improvement passes; unexpected regression fails safe | ✅ |
| Explainability preserved | ✅ |
| No network/AI/classification during identity acquisition | ✅ |
| Consumer isolation (chokepoint only; lead data untouched) | ✅ |
| Rollback O(1) verified | ✅ |
| Duplicate reasoning documented for U5 | ✅ |
| Tests pass (17/17); tsc 0 | ✅ |

## 12. Recommendation

Lead Intelligence's role is proven: the canonical spine is reference-only (certified + guarded) and the
source-recommendation surface adopts its projection-owned `category` at an isolated, reversible chokepoint.
`industry` (not projection-owned) and the `active-leads/context.ts` keyword classifier are honestly deferred
(model-coverage gap + U5 classifier retirement). Proceed to **Consumer 6 (Visitor Intelligence)** —
individually, next.

# READY FOR NEXT CONSUMER

*No Consumer-6 work has begun; awaiting authorization (one-consumer-at-a-time).*

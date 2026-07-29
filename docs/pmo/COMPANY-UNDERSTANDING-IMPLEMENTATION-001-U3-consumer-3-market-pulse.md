# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 3 — Market Pulse

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · reversible
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1 ✅ · U3·C2 ✅

---

## 1. Executive Summary

Migrated **Consumer 3 (Market Pulse)** to obtain its projection-owned interpretive identity —
`business_model`, `operating_model`, `domain_role` — through the canonical seam's new `worldView` view,
at its single read chokepoint `getMarketPulseContext` (which feeds both the UI panel and the
executor/prompt/scoring context). The consumer **consumes**; it never repairs, reinterprets, reclassifies,
or overrides canonical understanding. Flag **OFF** (default) ⇒ same settings reference, byte-identical.
`provider_type`/`solution_domains` (not modeled by the projection) and competitors (discovery pipeline) are
untouched. **45/45 tests (C3 11 + U2/C1/C2 regression) pass; tsc 0.**

## 2. Inventory Report

- **Producer (untouched):** `buildAiMarketPulseSettings` (`companyProfileServiceRest1Rest2Pulse.ts:173`)
  derives `provider_type`/`domain_role`/`operating_model`/`solution_domains` via the shared classifier
  `inferCompanyDomainShape` and writes them to `report_settings.market_pulse`. Retirement is U5.
- **Consumer chokepoint:** `getMarketPulseContext` (`marketPulseV2ServiceModel.ts:182`) loads
  `report_settings.market_pulse` into `settings`; both `marketPulseProfile` (UI) and `rawSettings`
  (→ `buildExecutorContext` → prompt/scoring) derive from it. One overlay point covers all read paths.
- **Identity fields Market Pulse reads:** `business_model`, `provider_type`, `domain_role`,
  `operating_model`, `solution_domains` (from market_pulse); `industry` (from profile). `category` is not
  read from market_pulse by the consumer.
- **Projection ownership:** worldView owns `businessModel` / `primaryMotion`(=operating_model) /
  `marketPosition`(=domain_role). **`provider_type` is not modeled** in CompanyUnderstanding;
  **`solution_domains`** is not a first-class worldView field. Both → documented deferral (model-coverage
  gap, not this consumer's to fix). `industry` is not company-identity in the projection surface.

## 3. Duplicate Reasoning Audit

The Market Pulse **read path does no identity re-derivation** — the prompt (`opportunityGenerators.ts:244`,
`executorContext.ts:207`) treats identity as ground truth and **never asks the LLM to infer**
category/provider_type/operating_model/domain_role. Classifiers run only in the producer (save-time):

| Derivation | Location | Disposition |
|---|---|---|
| `inferCompanyDomainShape` → provider_type/domain_role/operating_model/solution_domains | producer `Pulse.ts:224` (shared classifier) | **U5** (classifier retirement) — not touched |
| `inferBusinessModelLabel`, `inferMarketPulseCategories`, `inferPartnership/Hiring/Regulatory` | producer, `Enrich.ts` | **U5** — producer-side, out of U3 |
| `marketPulseCategoryClassifier` / `alertClassifierService` | signal/finding classifiers (not company identity) | out of scope (unrelated) |

No read-time keyword ladder / taxonomy repair / competitive reinterpretation exists in the consumer.

## 4. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/marketPulseConsumer.ts` | NEW | `adoptMarketPulseIdentity` (worldView overlay; flag OFF ⇒ same reference), `marketPulseSettingsToInput` |
| `backend/services/companyIntelligence/adoption/consumerAdapter.ts` | MODIFIED | additive `worldView: ProjectedWorldView \| null` on the seam output (already-computed canonical values; null on legacy/fail-safe) |
| `backend/services/marketPulseV2ServiceModel.ts` | MODIFIED | import + overlay `settings` at the `getMarketPulseContext` chokepoint (flag-gated no-op) |
| `backend/tests/unit/marketPulseConsumer.test.ts` | NEW | 11 tests (all required types) |

The seam extension is **additive and backward-compatible** — C1/C2/U2 consume `.fields`/`.observation`
and are unaffected (regression suites re-green). No producer, classifier, or competitor pipeline changed.

## 5. Projection Integration

`adoptMarketPulseIdentity(settings, profile, companyId, asOf, evidence?)` maps settings→input, calls
`resolveCompanyProjection`, and overlays `worldView.businessModel/operatingModel/domainRole` onto settings
(`?? stored` — abstention-safe: a null projection value never wipes a stored one). Flag OFF ⇒ same
reference; fail-safe (`legacy_fallback`) ⇒ `worldView: null` ⇒ same reference.

## 6. Prompt / Report Input Mapping

| Market Pulse field | Source | Via projection? |
|---|---|---|
| `business_model` | `worldView.businessModel` | **✅ adopted** |
| `operating_model` | `worldView.operatingModel` (primaryMotion) | **✅ adopted** |
| `domain_role` | `worldView.domainRole` (marketPosition) | **✅ adopted** |
| `provider_type` | stored | deferred — not modeled (U5/evidence-model) |
| `solution_domains` | stored | deferred — not a worldView field |
| competitors | existing discovery/read pipeline | untouched (discovery out of U3) |

The prompt line "Company identity: business:… · provider:… · role:… · ops:…" now consumes the projected
worldView values directly; it still asks the LLM to infer nothing.

## 7. Tests Added (11 types · all pass)

Inventory/mapping · Projection Integration · Prompt Input · Market Report (non-owned fields untouched) ·
Output Parity (OFF same reference) · Approved Improvement (operating_model/domain_role corrected under
evidence) · Unexpected Regression (name divergence ⇒ same-reference settings) · Rollback (ON→OFF identical)
· Explainability (seam worldView + observation deltas/version) · Performance (1000 adopts, deterministic) ·
Consumer Isolation (input not mutated). Regression: U2 + C1 + C2 re-green ⇒ **45/45**.

## 8. Performance Report

Pure, in-memory; no network / AI / classification / evidence-fetch during identity acquisition. Flag OFF =
one comparison + early return (same reference). 1000 adopts under bound; deterministic.

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptMarketPulseIdentity` returns the **same
settings reference**; `getMarketPulseContext` output (UI + executor) is byte-identical to pre-U3·C3. Tests
assert OFF ⇒ `=== settings` and ON→OFF restores identical settings. **O(1)** — one env var.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on production | Flag OFF ⇒ same-reference no-op; asserted | None |
| Seam extension breaks other consumers | `worldView` additive/optional; C1/C2/U2 re-green | None |
| Over-broad migration | Overlay at Market-Pulse chokepoint only; producer/competitors untouched | None |
| Stored value wiped by abstention | `?? stored` keeps stored when projection is null | None |
| Regression reaches report | Fail-safe ⇒ `worldView: null` ⇒ stored settings | None |
| provider_type/solution_domains not projected | Documented model-coverage gap; kept from stored | Low (coverage, not defect) |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Identity (business_model/operating_model/domain_role) via `resolveCompanyProjection` | ✅ |
| No read-time re-derivation/reclassification | ✅ |
| Prompt/report does not reinterpret identity (LLM never asked to infer) | ✅ |
| Flag OFF byte-identical (same reference) | ✅ |
| Approved improvement passes; unexpected regression fails safe | ✅ |
| Explainability preserved (worldView + deltas + version) | ✅ |
| No network/AI/classification/evidence-fetch during identity acquisition | ✅ |
| Consumer isolation (chokepoint only; producer/competitors untouched) | ✅ |
| Competitors not re-ranked/re-discovered/replaced | ✅ |
| Rollback O(1) verified | ✅ |
| Duplicate reasoning documented for U5; classifiers not retired | ✅ |
| Tests pass (45/45); tsc 0 | ✅ |

## 12. Recommendation

Consumer 3 (Market Pulse) reads its projection-owned interpretive identity through the seam's worldView at
an isolated, reversible chokepoint; competitors and producer classifiers are untouched; `provider_type` and
`solution_domains` are honestly deferred as a model-coverage gap (not owned by CompanyUnderstanding yet — a
future evidence-model/U5 decision, not U3). Proceed to **Consumer 4 (Journey Intelligence)** — individually,
next.

# READY FOR NEXT CONSUMER

*No Consumer-4 work has begun; awaiting authorization (one-consumer-at-a-time).*

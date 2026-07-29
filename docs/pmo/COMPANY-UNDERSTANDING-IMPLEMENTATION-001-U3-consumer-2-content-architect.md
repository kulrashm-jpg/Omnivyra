# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 2 — Content Architect

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · reversible
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1 (Company Profile) ✅

---

## 1. Executive Summary

Migrated **Consumer 2 (Content Architect)** — the content-generation prompt pipeline — to obtain its
projection-owned company-identity field (`category`) through the canonical seam `resolveCompanyProjection`
before context/prompt construction. The consumer **consumes**; it never classifies, infers, repairs, or
reclassifies identity. Wired at the **clean, content-owned, isolated** boundary
`buildCompanyContextFoundation` (long-form foundation), **not** the shared `getCanonicalProfile` (used by
opportunities/target-customer/campaign orchestrators) and **not** the concurrently-edited
`canonicalContentContextResolver.ts`. Flag **OFF** (default) ⇒ same profile reference, byte-identical.
**22/22 tests (C1 12 + C2 10) pass; tsc 0.**

## 2. Inventory Report

Two things are called "Content Architect": (A) the admin search/nav UI (no identity→prompt), and (B) the
content-generation prompt pipeline — the real consumer. In (B):

- **Chokepoints:** `canonicalContentContextResolver.ts::extractCompanyIdentity` (core prompt identity —
  reads industry/audience/ICP/problem/unique_value/brand_voice, **not** category); `mapCreatorCompanyContext`
  (Creator overlay — reads `category`); `longForm/companyContextFoundation.ts` (reads `category_list ?? category`).
- **Projection-owned identity Content Architect reads:** `category` (Creator overlay + long-form vocabulary).
- **NOT company identity (correctly not projected):** `industry`, `target_audience`, `ideal_customer_profile`,
  `brand_positioning`, `unique_value` — these are AUDIENCE/STRATEGY context. They remain profile/strategy
  reads; migrating them would require expanding the projection contract (a redesign — forbidden this phase).
- **`products`/`competitors`:** follow their existing pipelines (as in C1) — deferred.
- **`provider_type`/`solution_domains`/`operating_model`/`market_position`:** live under
  `report_settings.market_pulse`; **not read by the content prompt path** — no migration needed here.

## 3. Duplicate Reasoning Audit

The content pipeline **does not re-run** the shared classifiers (`classifyCompanyBusiness`,
`inferEntityArchetype`, `inferCompanyDomainShape`) — those run only in the write/enrichment path; the
pipeline reads their persisted output. Content-pipeline-owned prompt-time heuristics found:

| Heuristic | Location | Disposition |
|---|---|---|
| `inferOperationalModel` (derives operating model from `business_classification` levels) | `companyContextFoundation.ts:163` | **Documented for U5** (classifier retirement) — not removed (removal changes prompt behavior) |
| `inferBuyerMaturity` (keyword/regex over audience+sales) | `companyContextFoundation.ts:130` | **Documented for U5** (buyer-maturity heuristic; identity-adjacent) |
| `shouldUseAudienceLedSynthesis` (reads persisted archetype) | `companyContextBlockBuilders.ts:121` | Not classification — reads persisted archetype; no change |

No regex/keyword **category** classification exists in the consumer. The only category source is the stored
field, now routed through the projection.

## 4. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/contentArchitectConsumer.ts` | NEW | `adoptContentArchitectIdentity` (evidence-capable category overlay via the seam; flag OFF ⇒ same reference) |
| `backend/tests/unit/contentArchitectConsumer.test.ts` | NEW | 10 tests (all required types) |
| `backend/services/longForm/companyContextFoundation.ts` | MODIFIED | import + 1 line: adopt projected identity at `buildCompanyContextFoundation` entry (flag-gated no-op) |

Untouched: the concurrently-edited `canonicalContentContextResolver.ts`, shared `getCanonicalProfile`,
all classifiers, projection primitives, flag defaults.

## 5. Projection Integration

`adoptContentArchitectIdentity(profile, companyId, asOf, evidence?)` → `resolveCompanyProjection` (via the
C1 reader/mapper). Flag OFF ⇒ same reference; ON ⇒ projected `category` (evidence-derived when supplied).
At `buildCompanyContextFoundation` the adopted profile feeds `buildCompanyContext`, so
`businessIdentity.companyCategory` derives from the projected value.

## 6. Prompt Input Mapping

| Prompt field | Source | Via projection? |
|---|---|---|
| `businessIdentity.companyCategory` | `context.identity.category` ← projected `category` | **✅ adopted** |
| industry / target market / ICP / positioning / unique value | profile/strategy (audience & strategy, not company identity) | out of scope (correctly) |
| products / competitors | existing pipelines | deferred (C1 policy) |

## 7. Tests Added (10 types · all pass)

Inventory · Projection Integration · Prompt Input (through real `buildCompanyContextFoundation`) · Output
Parity (OFF same reference) · Approved Improvement (category corrects under evidence) · Unexpected
Regression (name divergence ⇒ stored category kept) · Rollback (ON→OFF identical) · Explainability (seam
deltas + version) · Performance (1000 adopts, deterministic) · Consumer Isolation (input not mutated; only
`category` touched; `business_classification` not reclassified). Regression: C1 12/12 re-green ⇒ **22/22**.

## 8. Performance Report

Pure, in-memory; no network / AI / classification / evidence-fetch during identity acquisition. Flag OFF =
one comparison + early return (same reference), zero added cost on the production path. 1000 adopts under
the 2 s bound; deterministic.

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptContentArchitectIdentity` returns the **same
profile reference**; `buildCompanyContextFoundation` output is byte-identical to pre-U3·C2. Test asserts OFF
⇒ `=== profile` and ON→OFF restores identical output. **O(1)** — one env var, no deploy.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on production | Flag OFF ⇒ same-reference no-op; asserted | None |
| Over-broad migration | Wired at content-owned long-form boundary; shared `getCanonicalProfile`/resolver untouched | None |
| Tangling concurrent resolver edits | Resolver deliberately not modified; Creator-overlay category read deferred (documented) | Low |
| Prompt-time reclassification | Consumer only reads `category`; heuristics documented for U5, unchanged | None |
| category_list dominance masks effect | Architectural adoption achieved regardless; behavior parity preserved | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Identity read through `resolveCompanyProjection` (category) | ✅ |
| No re-derivation/reclassification of category in the consumer | ✅ |
| Prompt construction does not reinterpret identity | ✅ |
| Flag OFF byte-identical (same reference) | ✅ |
| Approved improvement passes; unexpected regression fails safe | ✅ |
| Explainability preserved (deltas + version) | ✅ |
| No network/AI/classification/evidence-fetch during identity acquisition | ✅ |
| Consumer isolation (long-form boundary; shared/resolver untouched) | ✅ |
| Rollback O(1) verified | ✅ |
| Duplicate reasoning removed or documented for U5 | ✅ (documented) |
| Tests pass (22/22); tsc 0 | ✅ |

## 12. Recommendation

Consumer 2 (Content Architect) reads its projection-owned `category` identity through the seam at an
isolated, reversible boundary; audience/strategy fields correctly remain out of the company-identity
projection; prompt-time heuristics are documented for U5. Two open items are honestly scoped, not blockers:
the Creator-overlay category read (in the concurrently-edited resolver) is **deferred** to avoid tangling
concurrent uncommitted work, and `industry`/positioning adoption awaits a projection-contract expansion
(a future decision, not U3). Proceed to **Consumer 3 (Market Pulse)** — individually, next.

# READY FOR NEXT CONSUMER

*No Consumer-3 work has begun; awaiting authorization (one-consumer-at-a-time).*

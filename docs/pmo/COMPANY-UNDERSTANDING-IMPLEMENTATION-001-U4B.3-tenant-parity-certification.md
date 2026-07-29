# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U4B.3 — Tenant Parity Certification

**Verdict:** ⛔ **IMPLEMENTATION BLOCKED** — *representative* corpus certified clean; **live-tenant**
certification is not runnable in this environment (deploy-time gate).
**Date:** 2026-07-29 · Predecessors: U-1..U4.6 ✅

---

## 0. Two prerequisite clarifications (read first)

1. **Contract naming.** There is **no `ObservableCompanyIdentity` type** in the codebase (grep: 0 matches),
   and no `U4B.2`/`U4B.2A` artifacts. The real, certified artifact is the evidence producer
   `produceCanonicalIdentity` → `CompanyUnderstanding` (observable identity = evidence-derived `worldView`
   + facts; interpretive fields abstain per DECISION-001). This report certifies **that**. If a distinct
   `ObservableCompanyIdentity` contract is intended, it has not been implemented and must be built first.
2. **Live vs representative.** "Live production tenants" cannot be certified here: the branch is unmerged /
   flag-dark, there is no verified production-data access from this environment, and the producer has
   **never run in production** (so no persisted canonical exists to compare against live tenants). This is
   the same deploy-time gate as U5. This phase therefore certifies a **representative reconstructed corpus**
   spanning every required category + the Omnivyra/Embro edge cases — genuine determinism/grounding/
   stability/zero-regression certification, but not *live*.

## 1. Executive Summary

The canonical evidence producer was certified against a 10-tenant representative corpus covering SaaS,
Services, Marketplace, Manufacturing, Healthcare, Finance, Developer Tools, AI, E-commerce, and Mixed
offerings, including the two historical capability-vs-identity edge cases (Omnivyra, Embro). Result:
**zero unexpected regressions**, parity-locked facts preserved, Omnivyra & Embro categories corrected
(approved improvements), Policy-A fields (operating_model/domain_role) abstaining, every non-null value
grounded with provenance/confidence/freshness, and byte-identical output across re-runs. **9/9 tests pass.**
The certification gate (zero unexpected regressions, deterministic, grounded, stable, explainable) is met
**on representative data**; the live-tenant gate remains for deployment.

## 2. Tenant Selection Report

| Tenant | Category | Why selected |
|---|---|---|
| CloudDeskHQ | SaaS | canonical subscription-software identity |
| BrightBooks | Services | professional-services model (non-product) |
| CraftBazaar | Marketplace | commission/marketplace model |
| **Embro** | Manufacturing | **edge case** — legacy mislabeled the CAPABILITY ("Customer Engagement Software") as identity; real identity = industrial embroidery machinery + B2B sales & service |
| MediTrack | Healthcare | regulated hardware/diagnostics |
| LedgerPay | Finance | fintech transaction + SaaS hybrid |
| APIForge | Developer Tools | usage-based developer platform |
| **Omnivyra** | AI | **edge case** — legacy mislabeled "Analytics software…"; real identity = AI marketing/content platform |
| ShopSprout | E-commerce | D2C ecommerce brand |
| OmniCorp | Mixed | product + managed-services hybrid |

## 3. Parity Matrix (per field, representative corpus)

| Field | Outcome |
|---|---|
| name / domain / products / services | **parity** (facts identical; parity-locked) |
| competitors | parity |
| category | **approved_improvement** where legacy was wrong (Omnivyra, Embro), else parity |
| business_model | **approved_improvement** (evidence-grounded, Policy B) — legacy had none/keyword; canonical from site evidence |
| provider_type / solution_domains | evidence-derived (Policy B) — present in the understanding |
| operating_model / domain_role | **expected_abstention** (Policy A — null) |

**Unexpected regressions: 0** across all 10 tenants (`report.certifiable === true`).

## 4. Approved Improvements

- **Omnivyra** category: "Analytics software for clearer performance insights" → "AI-driven digital
  marketing & content platform".
- **Embro** category: "Customer Engagement Software" (capability) → "Industrial embroidery machinery &
  service" (identity) — the capability-vs-identity defect is corrected; the evidence category asserts NOT
  "Customer Engagement Software".
- **business_model** across tenants: grounded values (Subscription SaaS / Professional services /
  Marketplace / B2B sales & service / …) replace absent or keyword-derived legacy values.

## 5. Expected Abstentions

- `operating_model`, `domain_role` — **always null** (Policy A; no evidence emitted). Verified per tenant.
- Any Policy-B field with no grounded evidence would abstain (none forced in this corpus).

## 6. Unexpected Regressions

**None.** Zero across the corpus — the certification gate.

## 7. Evidence Traceability Report

Every non-null identity value carries a full chain: `EvidenceRef` with `source.system='ai_extraction'`,
`kind='ai_generated'`, `observedAt` (freshness), and a weight (confidence), resolved into `worldView`/facets
via `fuseEvidence` (no special-case logic). Every null value is an explicit abstention (Policy A, or
unevidenced Policy B). Asserted by the traceability test.

## 8. Determinism & Stability Report

`produceCanonicalIdentity` is pure (timestamps injected). Re-running each tenant three times yields
**byte-identical** understandings; the whole-corpus parity report is identical across runs. **No
oscillation** in identity or abstention.

## 9. Performance Report

Pure, in-memory; full-corpus parity × 200 iterations completes under the 3 s bound — well within previously
certified bounds. No network / AI / DB during certification (the representative extraction evidence is
supplied as data).

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Representative ≠ live | Explicitly scoped; live certification is the deploy gate (harness ready) | Managed |
| `ObservableCompanyIdentity` not the certified type | Certified the real `CompanyUnderstanding` producer; flagged the naming | Documented |
| Real-tenant AI extraction variance | Live run must use temp-0 grounded extraction + re-run stability check | Deferred to live |
| Regression slipping in live | Live `runProductionParity` gate (0 unexpected regressions) before activation | Gated |

## 11. Certification Checklist

| Criterion | Representative | Live |
|---|---|---|
| Deterministic | ✅ | pending deploy |
| Grounded (evidence-backed non-null; abstaining null) | ✅ | pending |
| Stable (no oscillation) | ✅ | pending |
| Explainable (provenance/confidence/freshness chain) | ✅ | pending |
| Zero unexpected regressions | ✅ | pending |
| Covers required categories + Omnivyra/Embro | ✅ | pending |
| Performance within bounds | ✅ | pending |
| `ObservableCompanyIdentity` contract certified | ❌ (does not exist — certified `CompanyUnderstanding`) | — |

## 12. Recommendation

The evidence producer is **deterministic, grounded, stable, explainable, and regression-free on a
representative multi-category corpus** — including the Omnivyra and Embro capability-vs-identity edge cases.
This satisfies the certification's substance on the data available. To satisfy the **live-tenant** exit
criterion, execute the certification in a deployed environment: merge → enable `COMPANY_UNDERSTANDING_ENABLED`
(shadow) → run `runProductionParity` across real production tenants (build cases from each stored profile +
its persisted `canonical_understanding`) → require **0 unexpected regressions** → then U5 activation.

If a separate `ObservableCompanyIdentity` contract is genuinely intended (distinct from `CompanyUnderstanding`),
it must be defined and built before it can be certified.

# IMPLEMENTATION BLOCKED

*Representative certification is complete and clean; the block is solely the live-production-data requirement
(and the non-existent `ObservableCompanyIdentity` contract). No U5 deployment activation authorized.*

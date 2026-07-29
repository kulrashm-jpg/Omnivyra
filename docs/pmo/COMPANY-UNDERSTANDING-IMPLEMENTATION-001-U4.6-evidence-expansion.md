# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U4.6 — Evidence Expansion

**Status:** ✅ **READY FOR U5**
**Mode:** flag-dark · additive · shadow producer (`COMPANY_UNDERSTANDING_ENABLED` default OFF)
**Date:** 2026-07-29 · Predecessors: U-1..U4.5 ✅ · DECISION-001 APPROVED

---

## 1. Executive Summary

Per DECISION-001, U4.6 makes the three Policy-B interpretive fields — `business_model`, `provider_type`,
`solution_domains` — **evidence-derived** from grounded website evidence, while the two Policy-A fields —
`operating_model`, `domain_role` — honestly **abstain** (no evidence work). The grounded AI extraction was
extended to emit the three fields (quote-or-abstain), the evidence adapter ingests them as `ai_generated`
`EvidenceRef`s with provenance/confidence/freshness, and the canonical build resolves them into the
understanding's `worldView`. No keyword ladders, regex, taxonomy repair, or hardcoded mappings were
introduced; unevidenced fields abstain (never fabricated). Resolution still runs through the certified
`fuseEvidence`/facet pipeline — no special-case logic. Projection contracts and consumers are unchanged
(the new worldView fields are additive/optional and read by nothing in the seam). **29/29 new + producer
tests · 63/63 broad regression · tsc 0.**

## 2. Evidence Model Expansion

`CompanyWorldView` gains two additive-optional fields — `providerType?`, `solutionDomains?` — alongside the
existing `businessModel?`. All three resolve from evidence in the canonical build:

| Field | worldView home | Evidence label | Policy |
|---|---|---|---|
| business_model | `worldView.businessModel` | `business_model` (ai_generated) | B — evidence-derived |
| provider_type | `worldView.providerType` (new) | `provider_type` (ai_generated) | B — evidence-derived |
| solution_domains | `worldView.solutionDomains` (new) | `solution_domains` (ai_generated) | B — evidence-derived |
| operating_model | `worldView.primaryMotion` | (no evidence emitted) | **A — abstain** |
| domain_role | `worldView.marketPosition` | (no evidence emitted) | **A — abstain** |

## 3. Extraction Changes

`refinementPrompts.ts` extended (additively) to request `business_model` / `provider_type` /
`solution_domains`, each grounded strictly in observable site evidence (pricing/CTA/sales-motion →
business_model; product-vs-service-vs-agency-vs-media structure → provider_type; offerings → solution_domains)
with an explicit **"QUOTE the grounding evidence … and ABSTAIN (source=\"missing\") rather than guess. Never
invent."** instruction. `CompanyProfileExtractionOutput` (+3 fields) and `extractionSchema.ts`
(`normalizeExtractionOutput` + `buildExtractionWithDefaults`) default them to `{source:'missing'}` so an
absent field abstains. `computeConfidenceScore`/`computeMissingFields` left unchanged (completion % stable).

## 4. Adapter Changes

`evidence/adapters.ts`: `AiExtractionInput` gains `businessModel?` / `providerType?` (and existing
`solutionDomains?`); `aiExtractionEvidence` emits `business_model` / `provider_type` / `solution_domains` as
`ai_generated` evidence (weight 0.6). `buildFromEvidence.ts` resolves them into `worldView` via the same
per-attribute `max(weight × freshnessDecay)` policy — no provider-specific rules, no heuristic fallback.

## 5. Files Modified

| File | Change |
|---|---|
| `backend/services/companyIntelligence/types.ts` | `CompanyWorldView` +`providerType?`/`solutionDomains?` (additive/optional) |
| `backend/services/companyIntelligence/evidence/adapters.ts` | `AiExtractionInput` +`businessModel?`/`providerType?`; emit 2 new labels |
| `backend/services/companyIntelligence/evidence/buildFromEvidence.ts` | resolve providerType/solutionDomains into worldView |
| `backend/services/companyIntelligence/production/canonicalIdentityProducer.ts` | map grounded extraction B-fields (`exValGrounded`/`exListGrounded`) into evidence |
| `backend/services/companyProfile/types.ts` | `CompanyProfileExtractionOutput` +3 fields |
| `backend/services/companyProfile/extractionSchema.ts` | normalize + default the 3 fields |
| `backend/services/companyProfile/refinementPrompts.ts` | prompt +3 grounded fields (quote-or-abstain) |
| `backend/tests/unit/companyEvidenceExpansion.test.ts` | NEW — 8 tests |

No consumer, projection contract, evidence-resolution algorithm, or flag default changed. No classifier
touched (retirement is U5).

## 6. Grounding Verification

- **Prompt-level:** the extraction is instructed to fill the three fields only from observable site evidence
  and set `source:'missing'` otherwise.
- **Producer-level:** `writeInputsFromProfileAndExtraction` accepts the three B-fields **only when the
  extraction source is grounded** (`website`/`user`) via `exValGrounded`/`exListGrounded`; `inferred`/
  `missing` → abstain. Test: `provider_type` with `source:'inferred'` ⇒ abstained; `business_model` with
  `source:'missing'` ⇒ abstained.
- **Adapter-level:** every emitted `EvidenceRef` carries `source.system='ai_extraction'`, `kind='ai_generated'`,
  `observedAt` (freshness), and a weight (confidence) — full provenance.

## 7. Abstention Report

| Field | Unevidenced outcome |
|---|---|
| business_model / provider_type / solution_domains (Policy B) | **abstain** (null / undefined) when the site gives no grounded signal — never fabricated |
| operating_model / domain_role (Policy A) | **always abstain** — no evidence is emitted for them (no evidence work) |

Verified by test: with only `category` evidence, `worldView.businessModel`/`providerType`/`solutionDomains`
and `primaryMotion`/`marketPosition` are all null/undefined.

## 8. Tests Added (8 · all pass)

Evidence Extraction · Adapter (provenance/kind/freshness/weight) · Resolution (into worldView) · Abstention
(Policy A + unevidenced B) · Grounding (quote-or-abstain; website vs inferred/missing) · Producer end-to-end
(B surfaced, A abstains) · Determinism · Performance. Regression: producer (9) + U1 evidence (13) +
classification/extraction/seam/worldView suites (63) all green.

## 9. Performance Report

Pure, in-memory; reuses evidence already fetched at the write path. The extraction prompt gains three fields
(one AI call, unchanged count). 1000 producer runs under bound; deterministic.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Extraction prompt change alters existing fields | Additive fields appended; existing asks unchanged; temp 0/JSON; 63/63 regression green; producer is shadow (flag OFF) | Low |
| Fabrication of B-fields | Grounded-source gate (`exValGrounded`) + prompt abstain instruction + abstention tests | None |
| worldView type change breaks seam/consumers | Additive/optional; C3 seam maps only category/businessModel/operating/domain; consumers read specific fields; 63/63 green | None |
| Policy-A leakage | No evidence emitted for operating_model/domain_role; abstention test guards it | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| business_model / provider_type / solution_domains evidence-derived | ✅ |
| operating_model / domain_role honestly abstain | ✅ |
| No heuristic/keyword-ladder/classifier logic added | ✅ (grounded extraction only) |
| Grounded (quote-or-abstain); provenance/confidence/freshness preserved | ✅ |
| Resolution uses CompanyUnderstanding, no special-case logic | ✅ |
| Canonical persistence contains expanded evidence | ✅ (producer persists understanding incl. new evidence/worldView) |
| Projection contracts + consumers unchanged | ✅ (additive optional worldView; seam untouched) |
| Regressions pass (29 + 63); tsc 0 | ✅ |
| Performance unchanged | ✅ |

## 12. Recommendation

All three Policy-B interpretive fields are now evidence-backed (grounded, quote-or-abstain), and the two
Policy-A fields abstain honestly. Canonical persistence carries the expanded evidence and the projection is
unchanged. The U5 §7 evidence-coverage gate is closed. Proceed to **U5** — Stage A (authoritative activation +
live parity) then Stage B (retire classifier families, one at a time), now that ownership can genuinely
transfer for category/industry **and** business_model/provider_type/solution_domains, with operating_model/
domain_role as accepted abstentions.

# READY FOR U5

*No U5 work has begun. U5 Stage A still requires the deploy-time controlled activation + live parity across
production tenants (per the U5 BLOCKED analysis); U4.6 removes the evidence-coverage blocker.*

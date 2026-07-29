# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 8 (FINAL) — Competitor Intelligence

**Status:** ✅ **CERTIFIED** (final consumer)
**Classification:** **A — Identity Consumer** (with re-derivation surfaces documented for U5).
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1–C7 ✅

---

## 1. Executive Summary

Competitor Intelligence — the origin of prior architectural defects — is an **identity consumer**: it reads
the OWNER company's identity to shape competitor search. That acquisition is now routed through
`resolveCompanyProjection` at its **one deterministic chokepoint** `extractCompetitiveContextFromProfile`
(and at the LLM-grounding path `suggest-competitors`), overlaying the projection-owned worldView identity
(`category`, `business_model`, `operating_model`, `domain_role`). **Competitor evidence is never touched** —
`named_competitors`, `competitor_details`, `provider_type`, `solution_domains`, SERP/domain rows are
preserved verbatim. Flag **OFF** (default) ⇒ same profile reference, byte-identical (the 30 existing
competitor-engine tests re-green). Ranking, discovery, fusion, and SERP acquisition are unchanged.
**32/32 new tests + 30/30 engine regression pass; tsc 0.**

## 2. Consumer Classification

**A — Identity Consumer.** Competitor search is shaped by owner identity; results never flow back into it.
- Deterministic consumer chokepoint: `extractCompetitiveContextFromProfile` / `…FromResolvedInput`
  (`competitorEngineServiceEngineDiscovery.ts:434,543`) → `CompanyCompetitiveContext`.
- LLM-grounding consumer: `buildCompetitorGroundingContext` via `suggest-competitors.ts:56`.
- Re-derivation surfaces (historical defect) → documented for U5 (§4).

## 3. Inventory Report

- **Adopted (owner identity → search):** `extractCompetitiveContextFromProfile` reads
  `market_pulse.{operating_model,domain_role,provider_type,solution_domains}` (`:455-461`),
  `business_classification.level_1/2/3` (`:451-453,467-469`), `category`/`industry` (`:507`). The overlay now
  supplies projected `category`/`business_model`/`operating_model`/`domain_role`.
- **Adopted (LLM grounding):** `suggest-competitors.ts:31` fetch → overlay → `buildCompetitorGroundingContext`.
- **Competitor evidence (kept separate):** owner's declared competitor list (`named_competitors`,
  `competitors_list`, `competitor_details`, `default_inputs.competitors`), enrichment KB, SERP/domain rows.
- **Not projection-owned (deferred):** `provider_type`, `solution_domains`, `industry`,
  `business_classification` (legacy classifier output → U5).
- No competitor module read `company_profiles` directly; none called `resolveCompanyProjection` before U3·C8.

## 4. Duplicate Reasoning Audit

Competitor Intelligence must not **re-derive** owner identity. Current state:

| Surface | Location | Disposition |
|---|---|---|
| `classifyCompanyBusiness` (owner industry/category/business_classification) | write-path `companyProfileServiceRest1Rest2Competitors.ts:395` | **U5** (producer re-derivation; classifier retirement) |
| `inferEntityArchetype` (owner archetype) | write-path `…Competitors.ts:348` | **U5** |
| LLM asks to infer owner category / what-it-sells | `suggest-competitors.ts:81-96` | **U5** (prompt-integrity: projection now supplies category to grounding; U5 removes the "infer" instruction) |
| Hardcoded keyword ladders (HubSpot/Salesforce/wellness) | `reportCompetitorIntelligenceServiceHelpers.ts:474-500` | **U5** (heuristic query packs) |
| Sparse-context identity override (`'B2B SaaS'`, …) | `competitorEngineServiceEngineDiscovery.ts:600-608` | **U5** (hardcoded identity fallback) |
| Taxonomy default `'marketing_seo_software'` | `competitorTaxonomy.ts:88-90` | **U5** |
| Capability-vs-identity guard | `companyProfile/entityArchetype.ts:293-364` | **present & active** (keep) |
| `ARCHETYPE_NAMED_PEER_PACKS` | removed (`companyProfileServiceCore.ts:561`) | already gone ✓ |

Per the migration rule, these re-derivation/heuristic surfaces are **documented for U5** (classifier
retirement), not removed here — removing them changes behavior and is U5's mandate. `inferCategory`/
`inferBusinessModel` in `competitorEnrichmentService.ts` run on **competitor** text (not owner identity) —
correctly left untouched.

## 5. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/competitorIntelligenceConsumer.ts` | NEW | `adoptCompetitorCompanyIdentity` (worldView overlay: category/business_model/operating_model/domain_role; competitor evidence preserved; flag OFF ⇒ same reference) |
| `backend/services/competitorEngineServiceEngineDiscovery.ts` | MODIFIED | import + overlay at `extractCompetitiveContextFromProfile` entry (flag-gated no-op) |
| `pages/api/company-profile/suggest-competitors.ts` | MODIFIED | import + overlay the grounding profile (flag-gated no-op) |
| `backend/tests/unit/competitorIntelligenceConsumer.test.ts` | NEW | 32 tests |

Ranking algorithms, candidate discovery, evidence fusion, SERP acquisition, and the competitor engines are
**unchanged** (30 engine tests re-green under flag OFF).

## 6. Projection Integration

`adoptCompetitorCompanyIdentity` → `resolveCompanyProjection().worldView`; overlays owner identity
(`?? stored` = abstention-safe). Flag OFF / fail-safe (`legacy_fallback` ⇒ `worldView:null`) ⇒ same
reference. In production these paths supply no evidence ⇒ `canonical_profile` (identity echoes stored) ⇒
architectural adoption, byte-identical, until evidence is provisioned.

## 7. Competitive Integrity Report

Company identity flows **in** to shape search; competitor results never flow **back** into identity. The
overlay touches only owner-identity fields (`category`, `market_pulse.{business_model,operating_model,
domain_role}`) and preserves every competitor-evidence field (`named_competitors`, `competitor_details`,
`provider_type`, `solution_domains`) verbatim — asserted by the Competitive Integrity test. Company-identity
evidence and competitor evidence remain separate (identity via projection; competitors via the untouched
discovery/fusion/SERP pipeline).

## 8. Tests Added (all required types · 32/32)

Consumer Classification / Inventory / Identity Audit · Projection Integration · **Competitive Integrity**
(named_competitors/competitor_details/provider_type/solution_domains preserved) · Prompt Integrity (seam
supplies worldView for grounding — no LLM inference needed) · Output Parity (OFF same reference) · Approved
Improvement (category/operating_model/domain_role corrected under evidence) · Unexpected Regression (name
divergence ⇒ same reference) · Rollback (ON→OFF identical) · Performance (1000 adopts) · Explainability
(worldView + deltas + version) · Consumer Isolation (nested input never mutated). **Regression:** 30 existing
competitor-engine tests + C3/U2 seam suites re-green.

## 9. Performance Report

Pure, in-memory; no network / AI / classification / evidence-fetch during identity acquisition. Flag OFF =
one comparison + early return. 1000 adopts under bound; deterministic.

## 10. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptCompetitorCompanyIdentity` returns the **same
profile reference**; competitor context + grounding are byte-identical to pre-U3·C8 (30 engine tests confirm).
ON→OFF restores identical output. **O(1)**.

## 11. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on the defect-prone engine | Flag OFF ⇒ same-reference no-op; 30 engine tests re-green | None |
| Competitor evidence altered | Overlay preserves all competitor fields; Competitive Integrity test asserts it | None |
| Identity re-derivation persists | Documented for U5 (write-path, LLM infer, heuristics) | Low (U5-scoped) |
| Over-broad migration | Overlay at the two identity chokepoints; engines/discovery/fusion untouched | None |
| provider_type/solution_domains/industry not projected | Documented model-coverage gap | Low |

## 12. Certification Checklist

| Criterion | Status |
|---|---|
| Owner identity acquired via `resolveCompanyProjection` at the deterministic chokepoint + grounding | ✅ |
| Competitor evidence never altered by the overlay | ✅ |
| No new re-derivation added; existing re-derivation documented for U5 | ✅ |
| Prompt supplies projected identity (grounding) — inference retirement documented for U5 | ✅ |
| Flag OFF byte-identical (same reference; 30 engine tests re-green) | ✅ |
| Approved improvement passes; unexpected regression fails safe | ✅ |
| Explainability preserved (worldView + deltas + version) | ✅ |
| No network/AI/classification during identity acquisition | ✅ |
| Ranking / discovery / fusion / SERP unchanged | ✅ |
| Rollback O(1) verified | ✅ |
| Tests pass (32/32 + 30 engine); tsc 0 | ✅ |

## 13. Recommendation

Competitor Intelligence — the strictest consumer — is certified: owner identity flows through the projection
at its deterministic and grounding chokepoints, competitor evidence is provably untouched, and the historical
re-derivation surfaces are documented for U5 (classifier retirement). This is the **final consumer**;
proceed to the U3 FINAL CERTIFICATION.

# READY FOR U4

*(pending the U3 FINAL CERTIFICATION below.)*

# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U4 — Competitor Intelligence Hardening

**Status:** ✅ **READY FOR U5**
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · reversible
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3 (all 8 consumers) ✅

---

## 1. Executive Summary

U4 completes the identity/competitor separation inside Competitor Intelligence. Building on U3·C8 (which
routed owner-identity *acquisition* through `resolveCompanyProjection`), U4 eliminates the two remaining
identity-**inference** surfaces that lived inside competitor workflows — both **flag-gated** so the flag-OFF
production path stays byte-identical:

1. **LLM prompt hardening** — the Turn-0 "understand THIS company" prompt no longer asks the model to infer
   the owner's product category; when authoritative it treats the canonical identity as GIVEN and reasons
   about the competitive **arena** only.
2. **Fallback identity inference** — the discovery extractor's hardcoded sparse-context identity fabrication
   (`marketFocus:'business software and marketing automation'`, `businessModel:'B2B SaaS'`, …) is suppressed
   when authoritative; it abstains and relies on canonical identity.

Competitor evidence remains provably independent of company identity. Flag OFF ⇒ byte-identical (the 30
competitor-engine tests re-green). No classifier retired, no engine/ranking/discovery/fusion redesigned, no
projection contract or consumer routing changed. **41/41 tests (hardening + C8 + engine regression); tsc 0.**

## 2. Remaining Identity Surface Audit

| Surface | Location | Kind | U4 disposition |
|---|---|---|---|
| Turn-0 LLM "state the company's product CATEGORY" | `suggest-competitors.ts:96` | identity-inference prompt | **HARDENED** (flag-gated: canonical identity given; arena-only) |
| Sparse-context identity fabrication (`'B2B SaaS'`, …) | `competitorEngineServiceEngineDiscovery.ts:607-614` | fallback identity inference | **HARDENED** (flag-gated: abstain when authoritative) |
| Turn-1 competitor prompt ("same product category, grounded in what this company sells") | `suggest-competitors.ts:124-132` | competitor reasoning (consumes identity) | **OK** — reasons about competitors, does not infer the company |
| `classifyCompanyBusiness` / `inferEntityArchetype` / `inferCompanyDomainShape` (write-path) | `companyProfileServiceRest1Rest2Competitors.ts:348,395` | **legacy classifiers** | **U5** (classifier-retirement program — not U4) |
| Keyword ladders (HubSpot/Salesforce/wellness query packs) | `reportCompetitorIntelligenceServiceHelpers.ts:474-500` | discovery-query heuristics keyed off owner text | **U5** (classifier-retirement-adjacent; competitor-discovery query generation) |
| Taxonomy default `'marketing_seo_software'` | `competitorTaxonomy.ts:88-90` | shared category default (owner + competitor text) | **U5** (classifier retirement — shared normalizer) |
| Capability-vs-identity guard | `companyProfile/entityArchetype.ts:293-364` | protective guard | keep (active) |
| `ARCHETYPE_NAMED_PEER_PACKS` | removed | — | already gone ✓ |

The two HARDENED surfaces are competitor-workflow-local identity inference (not the legacy T1/T2/T3
classifiers) → eliminated now (flag-gated). The classifier/keyword/taxonomy surfaces are part of the legacy
classifier-retirement program → documented for U5 per the migration rule.

## 3. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/competitorIdentityHardening.ts` | NEW | Pure helpers: `buildCompetitorUnderstandingSystemPrompt(authoritative)`, `mayFabricateSparseIdentity(authoritative)` |
| `backend/services/competitorEngineServiceEngineDiscovery.ts` | MODIFIED | Gate the sparse-context identity fabrication behind the authoritative flag (abstain when ON) |
| `pages/api/company-profile/suggest-competitors.ts` | MODIFIED | Turn-0 system prompt built via the hardened builder (flag-gated) |
| `backend/tests/unit/competitorIdentityHardening.test.ts` | NEW | 9 tests |

Ranking, candidate discovery, evidence fusion, SERP acquisition, `resolveCompanyProjection`, projection
contracts, and consumer routing are **unchanged**.

## 4. Prompt Hardening Report

- **Authoritative** Turn-0 prompt: *"The company's canonical identity — its product CATEGORY, what it sells,
  and who it serves — is ALREADY ESTABLISHED and provided … Do NOT re-infer, re-classify, repair, or change
  the company's identity … describe the COMPETITIVE ARENA … using the given identity verbatim."*
- **Non-authoritative** Turn-0 prompt: the exact legacy string (byte-identical) — asserted by test.
- No prompt asks *"what kind of company is this?"* / to infer category when authoritative. The canonical
  identity flows in through the grounding (U3·C8) which already carries the projected `category`.
- Turn-1 (competitor discovery) consumes the grounded identity and reasons about competitors only — left
  unchanged (it never asks the model to characterise the owner).

## 5. Competitor Evidence Isolation Report

Company identity flows **in** to shape search; competitor results never flow **back** into identity.
- The discovery extractor `extractCompetitiveContextFromProfile` reads owner-identity fields into
  `CompanyCompetitiveContext` and never reads the owner's declared competitor list — verified by the
  **identity-leakage test** (`named_competitors:['RivalCorp']` never appears in any identity field of the
  extracted context).
- The C8 overlay preserves `named_competitors`/`competitor_details`/`provider_type`/`solution_domains`
  verbatim. Identity and competitor evidence are independently traceable.

## 6. Explainability Report

Chain: **Company Projection → Competitive Context → Competitor Evidence → Ranking → Recommendation**. Identity
is traceable via the seam's `ProjectionObservation` (version, path, worldView, deltas) — separate from
competitor evidence (discovery/fusion/SERP). Test asserts the projection exposes `version` + `worldView`
independently.

## 7. Observability Report

- **Identity source / version:** `ProjectionObservation` (from `resolveCompanyProjection`) — `path`
  (legacy / canonical_evidence / canonical_profile / legacy_fallback), `version`, `flagAuthoritative`,
  `parity`, `deltas`.
- **Fallback events:** `legacy_fallback` path (unexpected regression) is recorded in the observation; the
  sparse-fabrication suppression is observable as an abstained (non-fabricated) competitive context when
  authoritative.
- **Identity violations:** guarded — the leakage test fails the build if a competitor name reaches an
  identity field; prompt/fabrication gates keep inference out of the authoritative path.

## 8. Tests Added (9 · all pass)

Prompt Hardening (authoritative reasons about arena / forbids re-inference; non-authoritative byte-identical) ·
Fallback-inference gate (`mayFabricateSparseIdentity`) · Competitor Evidence Isolation + Identity Leakage
(no competitor name in identity fields) · Ranking Consistency (deterministic extraction) · Explainability
(projection version + worldView) · Rollback (gates flip with the flag) · Performance (1000 extractions).
**Regression:** 30 competitor-engine tests + C8 (32) re-green under flag OFF.

## 9. Performance Report

Pure, in-memory; no added network / AI / classification / identity resolution. Identity is read once (the C8
overlay / projection); competitor processing reuses it. Flag OFF = one extra boolean check on the sparse
branch. 1000 extractions under bound; deterministic.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on the defect-prone engine | All hardening flag-gated; flag OFF ⇒ byte-identical (30 engine tests re-green) | None |
| Prompt regression | Legacy prompt reproduced byte-for-byte for flag OFF; asserted | None |
| Competitor evidence leaking into identity | Leakage test guards it | None |
| Suppressing fabrication breaks sparse companies | Only when authoritative (canonical identity supplied upstream); OFF keeps legacy fallback | None |
| Over-reach into classifier retirement | Legacy classifiers/keyword/taxonomy documented for U5, untouched | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| No competitor workflow infers/repairs/classifies company identity (authoritative path) | ✅ |
| Identity + competitor evidence fully separated | ✅ |
| All prompts consume canonical identity (never ask to infer it) | ✅ |
| Legacy classifiers/keyword ladders/taxonomy documented for U5 (not retired here) | ✅ |
| Flag OFF byte-identical (30 engine tests re-green) | ✅ |
| Identity read once; competitor processing reuses the projection | ✅ |
| Explainability + observability preserved | ✅ |
| Rollback O(1) | ✅ |
| No change to CompanyUnderstanding / evidence resolution / projection contracts / consumer routing | ✅ |
| Tests pass (41/41); tsc 0 | ✅ |

## 12. Recommendation

Competitor Intelligence now consumes canonical identity and reasons only about competitors; the two
competitor-workflow identity-inference surfaces are eliminated (flag-gated), and the legacy classifier
surfaces are catalogued for U5. Identity ownership remains entirely inside CompanyUnderstanding. Proceed to
**U5 (Classifier Retirement)**.

# READY FOR U5

*No U5 work has begun; per one-phase-at-a-time discipline, awaiting explicit U5 authorization.*

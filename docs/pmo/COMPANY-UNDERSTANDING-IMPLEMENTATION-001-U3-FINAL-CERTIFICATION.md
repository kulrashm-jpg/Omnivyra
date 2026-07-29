# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 — FINAL CERTIFICATION

**Status:** ✅ **U3 COMPLETE — READY FOR U4**
**Date:** 2026-07-28
**Predecessors:** U-1 ✅ · U0 ✅ · U1 ✅ · U2 ✅ · U3 Consumers 1–8 ✅
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · every consumer O(1)-reversible

---

## Executive Summary

All 8 downstream consumers have been individually inventoried, classified, migrated-or-certified, tested,
and certified — one at a time, in the mandated order, with zero cross-consumer batching. Every consumer that
CONSUMES company identity now acquires it through the single seam `resolveCompanyProjection`; every
REFERENCE-ONLY consumer is certified and guarded so it can never begin reinterpreting identity. With the flag
OFF (production default) every consumer is **byte-identical** to pre-U3. No classifier was retired, no engine
redesigned, no shared infrastructure repointed.

---

## Consumer Matrix

| # | Consumer | Class | Action | Seam wiring point | Tests |
|---|---|---|---|---|---|
| 1 | Company Profile | A — identity consumer | Adopt `category` | `pages/api/company-profile/index.ts` (display response) | 12 |
| 2 | Content Architect | A — identity consumer | Adopt `category` | `longForm/companyContextFoundation.ts` | 10 |
| 3 | Market Pulse | A — identity consumer | Adopt `business_model`/`operating_model`/`domain_role` (worldView) | `marketPulseV2ServiceModel.ts` `getMarketPulseContext` | 11 |
| 4 | Journey Intelligence | B — reference-only | Certify + guard | — (no identity read) | 17 |
| 5 | Lead Intelligence | C — mixed | Guard spine + adopt `category` | `activeLeadsCompanyContext.ts` `loadCompanyContext` | 17 |
| 6 | Visitor Intelligence | B — reference-only | Certify + guard | — (no identity read) | 19 |
| 7 | Execution Intelligence | C — mixed | Guard core + adopt `category` | `boltContentGenerationForSchedule.ts` | 22 |
| 8 | Competitor Intelligence | A — identity consumer | Adopt worldView identity (+grounding) | `competitorEngineServiceEngineDiscovery.ts` + `suggest-competitors.ts` | 32 |

**Total new consumer tests: 140** (+ regression: 30 competitor-engine + all prior suites re-green).

## Identity Consumer Matrix (migrated)

| Consumer | Projection fields adopted | Chokepoint | Flag OFF |
|---|---|---|---|
| Company Profile | category | display API | same reference |
| Content Architect | category | long-form foundation | same reference |
| Market Pulse | business_model, operating_model, domain_role | `getMarketPulseContext` | same reference |
| Execution Intelligence | category | BOLT governance prompt | same reference |
| Competitor Intelligence | category, business_model, operating_model, domain_role | `extractCompetitiveContextFromProfile` + grounding | same reference |
| Lead Intelligence (source-rec) | category | `loadCompanyContext` | same reference |

Every adoption: `resolveCompanyProjection` → overlay (`?? stored`, abstention-safe) → fail-safe
`legacy_fallback` on unexpected regression. No consumer reads legacy classifiers / raw evidence / stored
identity directly for the adopted field.

## Reference-only Matrix (certified + guarded)

| Consumer / spine | Company touchpoint | Guard test |
|---|---|---|
| Journey Intelligence (`journeyIntelligence/`) | `companyRef`/`companyId` key/FK only | `journeyIdentityIsolation.test.ts` |
| Visitor Intelligence (`visitorIntelligence/`) | `companyId`/`companyRef` key/FK only | `visitorIdentityIsolation.test.ts` |
| Lead spine (`leadUnderstanding/`+`leadIntelligence/`) | `companyId`/`organization_id` key only | in `leadIntelligenceConsumer.test.ts` |
| Execution planner core (`executionPlannerService`/`dailyPlanAiGenerator`/`executionPlannerPersistence`) | `company_id` FK only | in `executionIntelligenceConsumer.test.ts` |

Each guard fails the build if the module ever adds a profile fetch / owner-identity read / company classifier
/ identity-inferring prompt.

## Mixed Consumer Matrix

| Consumer | Reference-only part (guarded) | Consuming part (adopted) |
|---|---|---|
| Lead Intelligence | canonical `leadUnderstanding/`+`leadIntelligence/` spine | Active-Leads source-rec `category` |
| Execution Intelligence | planner core + planner-ops | BOLT governance `category` |

## Migration Matrix (files)

| File | Consumer | Change |
|---|---|---|
| `companyIntelligence/adoption/consumers/companyProfileConsumer.ts` | C1 | NEW (shared reader/mapper/overlay) |
| `companyIntelligence/adoption/consumers/contentArchitectConsumer.ts` | C2 | NEW |
| `companyIntelligence/adoption/consumers/marketPulseConsumer.ts` | C3 | NEW |
| `companyIntelligence/adoption/consumers/leadIntelligenceConsumer.ts` | C5 | NEW |
| `companyIntelligence/adoption/consumers/executionIntelligenceConsumer.ts` | C7 | NEW |
| `companyIntelligence/adoption/consumers/competitorIntelligenceConsumer.ts` | C8 | NEW |
| `companyIntelligence/adoption/consumerAdapter.ts` | C3 | MODIFIED (additive `worldView` view) |
| `pages/api/company-profile/index.ts` | C1 | MODIFIED (1 overlay line) |
| `longForm/companyContextFoundation.ts` | C2 | MODIFIED (1 overlay line) |
| `marketPulseV2ServiceModel.ts` | C3 | MODIFIED (1 overlay line) |
| `activeLeadsCompanyContext.ts` | C5 | MODIFIED (category reads via seam) |
| `boltContentGenerationForSchedule.ts` | C7 | MODIFIED (1 overlay line) |
| `competitorEngineServiceEngineDiscovery.ts` | C8 | MODIFIED (1 overlay line) |
| `pages/api/company-profile/suggest-competitors.ts` | C8 | MODIFIED (grounding overlay) |
| 8 × `backend/tests/unit/*.test.ts` | C1–C8 | NEW (140 tests) |

## Outstanding U5 Items (classifier retirement — NOT this phase)

1. **Legacy identity classifiers** (still the write-time owners): `classifyCompanyBusiness` (category/industry/
   business_classification), `inferEntityArchetype`, `inferCompanyDomainShape`, `inferBusinessModelLabel`.
2. **Content-owned heuristics:** `inferOperationalModel`, `inferBuyerMaturity` (`companyContextFoundation.ts`).
3. **Lead surface keyword classifier:** `active-leads/context.ts:71-302` (`isB2B`/`isTech`/`isConsumer`/…).
4. **Competitor heuristics/inference:** `suggest-competitors.ts:81-96` LLM infer-category; keyword ladders
   (`reportCompetitorIntelligenceServiceHelpers.ts:474-500`); sparse-context override
   (`competitorEngineServiceEngineDiscovery.ts:600-608`); taxonomy default (`competitorTaxonomy.ts:88-90`).
5. **Model-coverage gaps (not owned by the projection surface):** `industry`, `provider_type`,
   `solution_domains` — a future evidence-model/projection-contract decision (U1/U5), not U3.

## Architectural Invariants (now enforced)

1. `resolveCompanyProjection` is the **single seam** for company-identity acquisition by consumers.
2. Flag OFF (default) ⇒ every consumer is **byte-identical** (same-reference no-op).
3. Consuming a field returns the stored value unless the flag is ON (and, without evidence, echoes stored).
4. **Fail-safe:** an unexpected regression (parity-locked field diverging) is never served — the consumer
   falls back to legacy/stored and records it.
5. Reference-only consumers **cannot** read owner identity (guard tests fail the build otherwise).
6. Competitor evidence stays separate from company identity; competitor results never redefine identity.
7. No consumer classifies/repairs/reinterprets identity; classifiers remain (retirement is U5).
8. Rollback is O(1) via one env var; no deploy, no data migration.

## Migration Statistics

- Consumers processed: **8 / 8** (one at a time, order honored).
- Identity consumers migrated: **6** (C1, C2, C3, C5-source-rec, C7, C8).
- Reference-only certified + guarded: **4 populations** (Journey, Visitor, Lead spine, Execution core).
- Production files modified: **8** (each ≤ a few lines, flag-gated); consumer modules added: **6**; guard/
  test files added: **8** (**140 new tests**).
- Shared seam changes: **1 additive** (`worldView` view) — backward-compatible.
- tsc: **0 errors**. Regression: **all prior suites + 30 competitor-engine tests re-green.**
- Classifiers retired: **0** (by design — U5). Engines redesigned: **0**. Shared adapters repointed: **0**.

## Readiness Assessment

U3 achieves single-ownership of company-identity **acquisition** across every consumer, behind the flag,
fully reversible, with the historical defect surfaces catalogued for U5. The platform is ready for **U4
(Competitor Adoption / deeper competitor-consumption hardening)** and, subsequently, **U5 (Classifier
Retirement)** and **U6 (Invariant Enforcement)**. Flags remain OFF; no production behavior has changed.

# READY FOR U4

*No U4 work has begun; per one-phase-at-a-time discipline, awaiting explicit U4 authorization.*

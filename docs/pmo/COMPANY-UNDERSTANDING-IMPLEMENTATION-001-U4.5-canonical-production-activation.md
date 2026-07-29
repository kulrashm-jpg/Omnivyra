# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U4.5 — Canonical Production Activation

**Status:** ✅ **READY FOR U5** (producer built + shadow-persisting + parity-certified; authoritative
activation is the documented controlled rollout)
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_ENABLED` + `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF**
**Date:** 2026-07-29 · Predecessors: U-1..U4 ✅

---

## 1. Executive Summary

U5 was blocked because no component *produced* evidence-derived company identity in production — the
canonical path only *echoed* the legacy classifier. U4.5 builds and wires **the missing producer**: at the
production write path (`buildRefinedPayload`), it maps the already-available evidence (user profile FACTS +
the AI-extraction output) into `EvidenceSources`, runs `buildCompanyUnderstandingFromEvidence`, and
**persists the canonical understanding** to `report_settings.canonical_understanding`. `category`/`industry`
are now genuinely **evidence-derived**; the ungrounded interpretive fields (`operating_model`, `domain_role`,
`provider_type`, `solution_domains`, `business_model`) **abstain** — they have no evidence source at this
write path and are never fabricated (Evidence Rule honored). Production parity on a representative corpus is
**certifiable (0 unexpected regressions)**.

The producer runs **shadow** (gated by `COMPANY_UNDERSTANDING_ENABLED`, default OFF): it persists canonical
identity **alongside** the legacy fields without changing them, so production (flags OFF) is byte-identical.
The **authoritative activation** — making canonical the stored/consumed identity (write-path gating of stored
fields + live parity + flag flip) — is the controlled rollout, deferred to deploy (it requires live tenant
data this environment cannot access). **36/36 regression + 9/9 new tests; tsc 0.**

## 2. Current Production Write-Path Inventory

| Field | Current producer | Persist site | Evidence available at write path? | Canonical outcome |
|---|---|---|---|---|
| category | `classifyCompanyBusiness.generateCategory` (rule) | `…Competitors.ts:735,757` | ✅ `extraction.category` (AI) | **evidence-derived** |
| industry | `classifyCompanyBusiness` (rule) | `…:733,756` | ✅ `extraction.industry` (AI) | evidence-derived |
| business_model | `inferBusinessModelLabel` / `business_classification.level_1` | `…:698` | ❌ none | **abstain** |
| operating_model | `inferCompanyDomainShape` | `…:794` | ❌ none | **abstain** |
| domain_role | `inferCompanyDomainShape` | `…:794` | ❌ none | **abstain** |
| provider_type | `inferCompanyDomainShape` / `level_2` | `…:699` | ❌ none | **abstain** |
| solution_domains | `inferCompanyDomainShape` / `level_3` | `…:700` | ❌ none | **abstain** |
| archetype | `inferEntityArchetype` (heuristic) | `…:791` | ❌ none | not modeled |
| name / domain / products / competitors | profile facts | payload | ✅ facts | evidence-derived (parity) |

**Key finding:** the AI extraction independently yields `category`/`industry` (so canonical can own them from
evidence), but the interpretive fields exist **only** as keyword-classifier output — there is no evidence for
them at the write path. Per "do not invent new evidence / unknown remains unknown," canonical **abstains** on
them. Making them non-null under canonical would require a NEW evidence source (extended extraction /
firmographics) — out of U4.5 scope; a documented follow-on.

## 3. Canonical Producer Architecture

```
profile FACTS + AI extraction  (already fetched at buildRefinedPayload)
      │  writeInputsFromProfileAndExtraction()   ← no fetch, no fabrication
      ▼
collectWriteEvidence() → EvidenceSources { profile(facts), ai(category/industry/…) }   (firmographics abstain)
      ▼
buildCompanyUnderstandingFromEvidence(sources, asOf)   ← U1 pipeline (reused)
      ▼
CompanyUnderstanding → toShadowRecord → report_settings.canonical_understanding   (persisted, SHADOW)
```

Pure & deterministic (timestamps injected). Reuses U1 (`buildCompanyUnderstandingFromEvidence`), persistence
(`toShadowRecord`/`toLegacyFields`), and projection (`projectCompany`) — no new primitive.

## 4. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/production/canonicalIdentityProducer.ts` | NEW | The producer: `collectWriteEvidence`, `produceCanonicalIdentity`, `writeInputsFromProfileAndExtraction` |
| `backend/services/companyIntelligence/production/productionParity.ts` | NEW | `runProductionParity` (canonical vs legacy, reuses `classifyLegacySurfaceDelta`) |
| `backend/services/companyProfile/types.ts` | MODIFIED | additive optional `report_settings.canonical_understanding` |
| `backend/services/companyProfileServiceRest1Rest2Competitors.ts` | MODIFIED | wire the shadow producer into `buildRefinedPayload` (gated by `COMPANY_UNDERSTANDING_ENABLED`; legacy fields untouched) |
| `backend/tests/unit/canonicalProductionProducer.test.ts` | NEW | 9 tests |

No consumer, projection contract, evidence schema, rollout flag default, competitor/Market-Pulse/Content-
Architect logic changed. Legacy classifiers untouched (no retirement — that's U5).

## 5. Persistence Changes

`report_settings.canonical_understanding` (additive optional) now holds the versioned, evidence-sourced
shadow record (`{company_id, version, built_at, identity_source:'evidence', producer, understanding,
projection, parity}`). It is injected into the `report_settings` object `buildRefinedPayload` assembles
(so a later spread-write preserves it), gated by `COMPANY_UNDERSTANDING_ENABLED`. Legacy identity columns
(`category`, `business_classification`, `market_pulse.*`) are **unchanged** — this is a purely additive
shadow write.

## 6. Parity Report

`runProductionParity` (corpus): **0 unexpected regressions → certifiable.** Omnivyra:
`category` = **approved_improvement** (Analytics → marketing/content), `business_model` =
**expected_abstention** (legacy fabricated `'B2B SaaS'` → canonical honest null), `name`/`domain`/`products` =
**parity**. Live-production parity across real tenants is the deploy-time gate (this environment has no live
data; the harness is ready to run in CI/against prod).

## 7. Rollout Plan

1. **Shadow (now):** `COMPANY_UNDERSTANDING_ENABLED=ON` → canonical persisted alongside legacy; observe
   `canonical_understanding` + run `runProductionParity` across live tenants. `AUTHORITATIVE` stays OFF.
2. **Parity certification:** require 0 unexpected regressions live; classify the interpretive-field
   abstentions as approved (or provision evidence for them first).
3. **Authoritative activation (controlled):** flip `COMPANY_UNDERSTANDING_AUTHORITATIVE` per-tenant so the
   stored/consumed identity is canonical (write-path gating of the identity fields + projection consuming the
   persisted canonical). *(This step + its write-path gating is the remaining implementation, gated on 1–2.)*
4. **Merge** `feat/lead-understanding-foundation`.

## 8. Rollback Verification

Both flags OFF (default) ⇒ the producer does not run and nothing is persisted ⇒ byte-identical (36/36
regression green). Shadow (`ENABLED` ON) is additive — clearing the flag stops the extra write; the field is
inert to consumers. Authoritative rollback = flip `AUTHORITATIVE` OFF ⇒ consumers read legacy again. **O(1)**
per stage. (Note: once authoritative writes land in stored fields, restoring prior *values* is a data
concern — hence per-tenant controlled activation with parity gating.)

## 9. Performance Report

Pure, in-memory; the producer reuses evidence already fetched at the write path (no new network/AI/DB read).
1000 producer runs under bound; deterministic. Shadow adds one in-memory build per refine — negligible.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Write-path behaviour change | Shadow gated by `ENABLED` (default OFF); legacy fields untouched; 36/36 regression green | None |
| Interpretive fields abstain under canonical | Documented; authoritative activation gated on parity/evidence decision; shadow does not change stored values | Medium (product decision at activation) |
| Fabrication creeping back | Producer never sets ungrounded fields / firmographics; abstention test guards it | None |
| Live parity unknown | Harness ready; run in CI/against prod before activation | Managed (gate) |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Canonical producer exists + wired at the write path | ✅ |
| Identity derived from evidence (category/industry); ungrounded fields abstain (no fabrication) | ✅ |
| Canonical persisted as a record (`report_settings.canonical_understanding`) | ✅ (shadow) |
| Production parity certifiable on corpus (0 unexpected regressions) | ✅ (live = deploy gate) |
| Projection no longer echoes legacy | ⏳ at authoritative activation (staged; shadow now) |
| Rollback O(1) per stage | ✅ |
| Performance maintained | ✅ |
| No classifier retired / no consumer/contract/flag-default changed | ✅ |
| Tests pass (9/9 + 36/36 regression); tsc 0 | ✅ |

## 12. Recommendation

The U5 blocker is resolved: a canonical **evidence-derived producer now exists**, persists identity at the
write path, and is parity-certifiable — `category`/`industry` are genuinely evidence-owned; the interpretive
fields abstain honestly. Two things gate the **full** authoritative transfer (and therefore U5's actual
classifier deletion): (a) the **controlled authoritative activation** (write-path gating of stored fields +
projection consuming the persisted canonical + live parity), and (b) a decision on the **abstained
interpretive fields** (accept honest-unknown, or provision an evidence source for operating_model/domain_role/
etc.). Authorize the controlled activation as U5's first step; then retire classifiers as true ownership
transfer, one family at a time.

# READY FOR U5

*U5 must begin with the controlled authoritative activation (§7 step 3) — retiring a classifier only after
its field's ownership has actually transferred to the live canonical producer. No U5 work has begun.*

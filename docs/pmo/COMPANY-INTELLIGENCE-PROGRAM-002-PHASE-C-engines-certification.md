# COMPANY-INTELLIGENCE-PROGRAM-002 — Phase C

## Advanced Company Intelligence Pipeline — Certification

**Type:** Intelligence-engine implementation (flag-dark, shadow-only, additive, deterministic).
**Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`, commit `56b69959`.
**Authority:** Phase A + Phase B (certified). **Nature:** engines are **evidence contributors** into
the Phase B canonical Company runtime — no engine owns Company Understanding.

---

## 0. Certification Decision

# ✅ PHASE C CERTIFIED

All eight Company intelligence engines, the cross-engine reasoning layer, the assembly pipeline, and
shadow validation are implemented as **deterministic, evidence-first contributors** into the single
canonical builder. **No engine owns Company Understanding, the projection, the score, or the graph —
the assembly pipeline is the sole owner.** 100% additive (Program 1 preserved — the one shared-type
edit is a non-breaking union widening; **65/65** tests incl. 44 Program-1 regression), both flags
default OFF, tsc-clean.

| Validation requirement | Result |
|---|---|
| Every engine contributes evidence | ✅ each emits `EvidenceRef`/contributions/traces; abstains on empty input (tested) |
| No engine owns Company Understanding | ✅ only `assembleCompanyUnderstanding` calls `buildCompanyUnderstanding` |
| No duplicate scoring | ✅ engines emit `CompanyContribution`; the shared generic `combineScoresFor` blends (one contract) |
| No duplicate projections | ✅ one `projectCompany`, called once in assembly |
| No duplicate graph ownership | ✅ competitor/customer/partner/executive edges **reference** nodes owned elsewhere |
| Evidence-first / confidence / contradiction / provenance aware | ✅ every facet + trace carries them; contradictions detected in the builder |
| Provenance on every conclusion | ✅ `validateReasoning` rejects ungrounded (tested: all traces valid) |
| Shadow authoritative OFF / production unchanged | ✅ flags OFF; nothing imports the engines; additive |

---

## 1. Deliverables

**CI-C301 Technology** (`technology.ts`) — stack/cloud/languages/db/devops/security/AI/integrations/
migrations → technology facet + `maturity` contribution (breadth + AI + migration proxy). Abstains
without tech evidence.

**CI-C302 Product** (`product.ts`) — products/services/pricing/positioning/differentiators/maturity/
roadmap → offerings + marketPosition facets + `market_authority` contribution.

**CI-C303 Growth** (`growth.ts`) — hiring/funding/customer/partnership/expansion/acquisition/revenue
signals with **freshness + decay + weighting** → growth facet + `momentum` contribution.

**CI-C304 Executive** (`executive.ts`) — leadership/changes/tenure/influence → leadership facet +
`member_of` graph edges (executive → company references) + `market_authority` contribution.

**CI-C305 Customer & Partner** (`customerPartner.ts`) — customers (strategic/concentration) + partners
(channel/technology/reseller/alliance) → customers + partners facets + graph edges (references) +
`fit`/`market_authority` contributions. **Evidence only — no fabricated customers.**

**CI-C306 Financial** (`financial.ts`) — funding stage/valuation/revenue/profitability/runway →
funding + financial facets + `maturity` and (inverse) `risk` contributions; **every inference exposes
assumptions + uncertainty + evidence** (tested).

**CI-C307 Competitive** (`competitive.ts`) — consumes competitor **references** (the Competitor
Intelligence platform stays the owner — `competes_with` edges, **no re-ownership**) → competitive facet
+ `market_authority` contribution.

**CI-C308 Risk** (`risk.ts`) — operational/financial/technology/compliance/hiring/execution/market/
reputational risks with impact → risk facet + `risk` contribution (mean impact, uncertainty on
unspecified impacts).

**CI-C309 Cross-Engine Reasoning** (`crossEngine.ts`) — grounded higher-order traces (digital
transformation = tech-migration + exec-hire + funding; growth initiative = expansion + hiring +
partnership; strategic acceleration = funding + exec-change + product-launch) from evidence the engines
**already produced** — synthesizes, never re-owns.

**CI-C310 Assembly Pipeline** (`assembly.ts`) — **the ONE owner.** Runs the 8 engines + cross-engine +
the profile-adoption baseline, merges/dedupes evidence, resolves facets by confidence, then calls the
canonical `buildCompanyUnderstanding` (score blend + contradiction detection) + one `projectCompany`.

**CI-C311 Shadow Validation** (`shadowValidation.ts`) — per-company field-parity vs legacy +
completeness + per-engine abstention + unsupported-conclusion count. Report-only; authoritative OFF.

**CI-C312 Platform Consistency** — verified below (§2/§3): reuses the shared spine; competitor/lead/
offering nodes referenced, not owned; one builder/projection/scoring/evidence/graph.

---

## 2. Platform Consistency Certification (CI-C312)

| Consistency check | Verdict |
|---|---|
| Aligned with Lead Intelligence (Program 1) | ✅ same shared `intelligence/canonical` contracts + generic scoring |
| Aligned with Offering / Competitor / Content / GTM | ✅ referenced as graph nodes (`competitor`/`offering`/…), never re-owned |
| Zero duplicate ownership | ✅ single builder/projection; engines contribute only |
| Zero duplicate reasoning | ✅ one `ReasoningTrace` contract (shared) |
| Zero duplicate projections | ✅ one `projectCompany` |
| Zero architectural drift | ✅ new contributors abstain-safe; shared spine reused; `GraphNodeType` extended additively (non-breaking; Program 1 44/44 unchanged) |

---

## 3. Verification

- **Tests:** `companyIntelligenceEngines.test.ts` (12) + Company B (9) + Program-1 (44) = **65/65 green**,
  deterministic — each engine's contribution + abstention, cross-engine grounding, assembly ownership +
  determinism + empty-abstention, competitor-reference-not-ownership, financial assumptions/uncertainty,
  shadow parity + completeness + engine-abstention.
- **Types:** company + canonical modules **tsc-clean** (0 errors).
- **Additivity:** only new files + one **non-breaking** shared-union extension (`GraphNodeType`
  `+executive/customer/partner/product/technology/market`); Program 1's 44 tests pass unchanged.

---

## 4. Carried Adjustments (from Phase B — resolve before Phase-D production integration)

- **A1** unify Program 1's `leadUnderstanding/scoring.ts` onto the shared generic `combineScoresFor`
  (Company already uses the shared one; Lead's certified copy is the remaining duplication).
- **A2** rename the shipped `context/companyUnderstandingService.ts` to free the `CompanyUnderstanding`
  name.
- **A3** optional physical re-home of the shared contracts out of `leadUnderstanding`.

None affects Phase C correctness; all are convergence hygiene for Phase D.

---

## 5. Certification Statement

Company Intelligence now has a complete analyst-grade pipeline on the canonical Phase-B foundation:
technology, product, growth, executive, customer/partner, financial, competitive, and risk engines feed
**one Company Understanding** through **one assembly owner**, with cross-engine reasoning, contradiction
handling, and shadow validation — evidence-first, deterministic, provenance- and contradiction-aware,
aligned with the production-certified Lead Intelligence Platform and the shared Product Intelligence
architecture, with **zero drift, zero duplicate ownership, and no production behaviour change**.

**Decision: ✅ PHASE C CERTIFIED. Authorize Phase D — Capability Completion, Canonical Adoption &
Production Integration** (carrying A1–A3).

*Implementation committed on the isolated branch, flag-dark and shadow-only; not merged, not deployed,
no flag enabled, no consumer migrated, no authoritative mode. Advancing to Phase D is your decision.*

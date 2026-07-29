# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U1 — Evidence Unification

**Status:** ✅ **READY FOR U2**
**Mode:** Shadow-only · flags OFF · additive · deterministic · zero production paths touched
**Date:** 2026-07-28
**Predecessors:** U-1 Projection Certification (CERTIFIED) · U0 Shadow Parity (CERTIFIED)

---

## 1. Objective & Scope

**Objective.** Build the canonical `CompanyUnderstanding` from **evidence** rather than from the
pre-classified legacy profile. U0 proved that adopting the legacy profile is *safe* (parity 1.0) but
does **not** correct Omnivyra — because `companyFromProfile` passes the already-derived classification
(`worldView.category`) straight through. U1 closes that gap: raw source evidence enters once, is
resolved by a policy (weight × kind × freshness), and the interpretive fields (category /
solution_domains / operating_model / domain_role) are derived from **AI-extraction evidence**, not from
the legacy category ladder that produced *"Analytics software for clearer performance insights."*

**In scope (delivered).** Evidence adapters (8 sources) → `EvidenceRef[]`; ingestion/normalization;
policy-driven fusion (reuse of certified `fuseEvidence`); per-attribute resolution; facet population;
provenance; contradiction capture; confidence; freshness decay; abstention; explainability; semantic
delta vs legacy; 13 tests.

**Out of scope (untouched, per brief).** No consumer changes, no projection changes, no legacy
classifier changes, no flag flips, no authoritative mode. `COMPANY_UNDERSTANDING_ENABLED` and
`COMPANY_UNDERSTANDING_AUTHORITATIVE` remain **OFF**. The new module is **not** exported from the
`companyIntelligence` barrel and is imported by **nothing** in any request path — only its own test.

---

## 2. Change Surface (additive only)

| File | Type | Purpose |
|---|---|---|
| `backend/services/companyIntelligence/evidence/adapters.ts` | NEW | Pure adapters: raw source input → `EvidenceRef[]` |
| `backend/services/companyIntelligence/evidence/buildFromEvidence.ts` | NEW | Ingest → fuse → resolve → populate facets; `companyFromEvidence`, `buildCompanyUnderstandingFromEvidence`, `explainCompanyField` |
| `backend/services/companyIntelligence/evidence/delta.ts` | NEW | `runSemanticDelta` — evidence-canonical vs legacy, field-classified |
| `backend/services/companyIntelligence/evidence/index.ts` | NEW | Evidence-module barrel (subpath; not wired into the main barrel) |
| `backend/tests/unit/companyEvidenceUnification.test.ts` | NEW | 13 tests / 12 required suites |

**Zero edits** to any existing file. Verified: `git status` shows only additions under
`evidence/` + the test. The legacy classifiers, `fromProfile`, `projection`, `persistence`,
`consumerAdapter`, and `flags` are byte-unchanged.

---

## 3. Reused Certified Primitives (no forks)

| Primitive | Source | Role in U1 |
|---|---|---|
| `mkEvidence` | `intelligence/canonical/helpers` | Raw observation → `EvidenceRef` (deterministic id, source, kind, timestamps, lifecycle) |
| `fuseEvidence` + `DEFAULT_SOURCE_WEIGHTS` | `leadUnderstanding/engines/fusion` (re-exported) | Dedup + source-weighting + contradiction detection — THE resolver |
| `decayFactor` | `intelligence/canonical/helpers` | Freshness half-life (180d) in per-attribute resolution |
| `facet` | `intelligence/canonical` (leadUnderstanding/facets) | Facet construction with confidence + provenance from evidence |
| `detectEvidenceContradictions` | via `fuseEvidence` | Conflict capture (never silent overwrite) |
| `buildCompanyUnderstanding` | `companyIntelligence/builder` | **The sole owner** — U1 feeds it facets+evidence+worldView |

No new primitive was created (LAW 2, LAW 4 honored). Resolution is **policy-driven data**
(`COMPANY_SOURCE_WEIGHTS` table + kind weights + freshness), never `if (source === X)` branching.

---

## 4. Evidence Adapter Matrix

| Adapter | Source system | Kind | Item weight | Labels emitted |
|---|---|---|---|---|
| `companyProfileFactsEvidence` | `company_profile` | structured | 0.7–0.9 | name, domain, products, services, industry, competitors |
| `websiteEvidence` | `website_capture` | observed | 0.7–0.9 | name, domain, products, positioning |
| `aiExtractionEvidence` | `ai_extraction` | ai_generated | 0.5–0.6 | **category, industry, solution_domains, operating_model, domain_role**, products, segments, differentiators |
| `firmographicEvidence` | `linkedin` / `crunchbase` / `public_registry` / `trusted_public` / `wikidata` | external | 0.7 | founded_year, headcount, size, revenue_band, funding_stage, hq |

**Critical rule enforced (LAW 5 / root-cause).** The company-profile adapter ingests **FACTS only**.
It does **not** emit `category` / `operating_model` / `domain_role` / `solution_domains` — those
interpretive fields come exclusively from AI-extraction evidence. Test
*"the company-profile adapter ingests FACTS, never the derived classification"* asserts
`labels` excludes `category` and `operating_model`. This is precisely why the understanding is now
built *from evidence*, not from the legacy pre-classification.

---

## 5. Coverage Matrix (Omnivyra fixture)

| Facet attribute | company_profile | website | ai_extraction | firmographic | Resolved from |
|---|---|---|---|---|---|
| name | ✓ (0.81) | ✓ (0.765) | – | – | company_profile |
| domain | ✓ | ✓ | – | – | company_profile |
| products | ✓ (0.81) | ✓ (0.72) | ✓ (0.28) | – | company_profile |
| category | – | – | ✓ (0.33) | – | **ai_extraction** |
| solution_domains | – | – | ✓ | – | ai_extraction |
| operating_model / domain_role | – | – | ✓ | – | ai_extraction |
| founded_year / size | – | – | – | ✓ crunchbase | crunchbase |
| competitors | (empty) | – | – | – | **abstain** |

(Effective weight = item × source-weight × freshness-decay; shown at asOf where relevant.)

---

## 6. Resolution Matrix (policy: weight × kind × freshness)

| Scenario | Candidates | Winner | Why |
|---|---|---|---|
| Interpretive field (category) | ai_extraction only | ai_extraction value | sole evidence; corrected classification |
| Fact conflict (products) | profile 0.81 / website 0.72 / ai 0.28 | profile | highest effective weight (structured) |
| Equal-weight freshness (founded_year) | wikidata@stale / wikidata@fresh | fresh | decay demotes stale |
| No evidence (competitors) | — | null | **abstain** (never fabricate) |

Resolution is per-attribute `max(weight × decayFactor)`; ties broken by freshness then stable id.
No provider-name truth logic anywhere.

---

## 7. Contradiction Matrix

`fuseEvidence` runs `detectEvidenceContradictions` over the fused set; conflicts are **preserved**,
never dropped. Per-facet, the relevant contradictions are attached (`contrasFor` filters by evidence
id membership). Omnivyra `products` disagree across profile/website/ai → a contradiction is recorded
while the winner (structured) resolves the facet value. Test *"records contradictions without dropping
conflicting evidence"* asserts `contradictions.length > 0`.

---

## 8. Abstention Report

| Facet | Evidence present? | Result |
|---|---|---|
| competitive (Omnivyra) | no competitor evidence | abstain → `competitors: []`, confidence 0 |
| bare company (only name) | no products/category/competitor evidence | category `null`, products `[]`, competitors `[]` |

Test *"facets with no evidence abstain; no fabricated defaults"* verifies `toLegacyFields` returns
`null`/`[]` and `facets.competitive.value === null` with `confidence === 0`. **Honest empty-state is
the correct outcome for Omnivyra's competitors** — the bug was fabrication elsewhere, not here.

---

## 9. Semantic Delta Report

`runSemanticDelta` builds the evidence-canonical understanding and classifies each field against the
legacy profile using the approved whitelist:

- **MUST_MATCH (parity-locked):** name, domain, products, services
- **APPROVED (may diverge):** category, business_model, solution_domains, provider_type, operating_model, domain_role, competitors, firmographics

| Company | category | name | domain | products | competitors | regressions |
|---|---|---|---|---|---|---|
| Omnivyra | **approved_improvement** (Analytics → marketing/content) | parity | parity | parity | parity ([]) | **0** |
| InsightGrid | approved_improvement | parity | parity | parity | parity | 0 |

**Total unexpected regressions across corpus: 0.** The Omnivyra category corrects from
*"Analytics software for clearer performance insights"* to *"AI-driven digital marketing & content
platform"* while every parity-locked fact stays identical.

---

## 10. Explainability Report

`explainCompanyField(sources, asOf, field)` returns the full chain
**Field → Facet → EvidenceRefs → Resolution Policy → Final Value**:

```
field:        category
facet:        worldView
evidence:     [ai_extraction · ai_generated · category="AI-driven digital marketing & content platform"]
resolution:   winner = max(weight × freshnessDecay); contradictions preserved; abstain when empty
winnerSource: ai_extraction
finalValue:   "AI-driven digital marketing & content platform"
```

Every projected field is fully traceable to its source evidence and the policy that selected it.

---

## 11. Performance Report

Pure, in-memory, deterministic — no I/O, no network (adapters consume already-fetched inputs; live
fetch/grounding via `safeFetch` + approved services is the caller's future concern). Full 13-test
suite (build, fuse, resolve, delta, explain across multiple companies) runs in **2.26 s**. Complexity
is O(evidence) for ingest/fuse and O(evidence) per resolved label; negligible at company scale.

---

## 12. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| New module leaks into production | Not barrel-exported; imported only by its test; flags OFF | None |
| Parity-locked fact drifts | `runSemanticDelta` classifies name/domain/products/services drift as `unexpected_regression`; corpus = 0 | None |
| AI evidence hallucination | ai_extraction is lowest-weight (0.5–0.6 × 0.55); adapters normalize already-grounded output only; abstains when absent | Low — grounding remains caller's contract at live wiring (U3) |
| Non-determinism | Timestamps injected (`asOf`/`observedAt`); no `Date.now`/`Math.random`; determinism test asserts identical builds | None |
| Source-weight policy miscalibration | Policy is an external data table, tunable without code change; validated against Omnivyra + corpus | Low |

---

## 13. Certification Checklist

| Gate | Status |
|---|---|
| Evidence adapters emit `EvidenceRef` (never business objects) | ✅ |
| Company-profile adapter ingests FACTS, not derived classification (LAW 5) | ✅ |
| Interpretive fields derived from evidence, not legacy ladder | ✅ |
| Policy-driven resolution; no `if (source === X)` (LAW 3) | ✅ |
| Reuses `fuseEvidence` / `mkEvidence` / `facet` / `buildCompanyUnderstanding`; no new primitive (LAW 2/4) | ✅ |
| Contradictions preserved, never silently overwritten | ✅ |
| Abstention on absent evidence; no fabrication | ✅ |
| Provenance + confidence on every populated facet | ✅ |
| Freshness decay applied | ✅ |
| Explainability chain per field | ✅ |
| Semantic delta: 0 unexpected regressions; Omnivyra category corrected | ✅ |
| Parity-locked facts (name/domain/products/services) identical | ✅ |
| Cross-company isolation | ✅ |
| Determinism | ✅ |
| No consumer/projection/legacy/flag/barrel modifications (LAW 8, shadow) | ✅ |
| `tsc -p tsconfig.backend.json` clean (0 errors) | ✅ |
| Tests: **13/13 passing** (12 required suites covered) | ✅ |

---

## Verdict

**READY FOR U2.**

U1 demonstrates, in shadow, that canonical `CompanyUnderstanding` can be built from **evidence** with
the interpretive classification derived from AI-extraction evidence rather than the legacy category
ladder — correcting Omnivyra's category while holding every parity-locked fact identical and abstaining
honestly where evidence is absent. Flags remain OFF and no production path is touched. The evidence
pipeline is now the certified, explainable substrate that **U2 (Projection Cutover)** can route the
`resolveCompanyProjection` seam through — under flag, with `validateConsumerParity`, still reversible.

**Awaiting authorization for U2.** No U2 work has begun; per the one-phase-at-a-time discipline, I will
not proceed until U2 is explicitly authorized.

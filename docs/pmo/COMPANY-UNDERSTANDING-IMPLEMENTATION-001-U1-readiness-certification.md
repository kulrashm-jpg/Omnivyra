# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1 Readiness Certification

**Role:** Independent readiness certifier (NOT implementation).
**Mission:** Certify the platform is ready to replace **legacy-profile-derived** understanding with
**evidence-derived** understanding (Phase U1 — Evidence Unification).
**Date:** 2026-07-28

---

## Verification (against the real canonical contract)

The shared canonical contract (`leadUnderstanding/types`, re-exported via `intelligence/canonical/contracts`,
certified in Program 1 + reused by Company Program 2) provides:

- **`EvidenceRef`** — `id`, `kind` (`structured|observed|inferred|external|ai_generated`), `label`, `value`,
  `source: SourceRef{system, ref}` (**provenance**), `observedAt` + `recordedAt` (**dual timestamps**),
  `lifecycle` (`created|refreshed|superseded|expired`) + `supersededBy` (**freshness lifecycle**),
  `weight` (0..1).
- **`Facet<T>`** — `value: T | null` (**abstention — "never fabricate"**), `confidence` (0..1),
  `evidence[]`, `provenance: SourceRef[]`, `asOf` (**freshness anchor**), `contradictions: ContradictionRef[]`,
  `unknowns[]`, `assumptions[]`.
- **`ContradictionRef`** — `kind` (`source_conflict|stale_vs_fresh|confidence_divergence|stated_vs_observed|ai_conflict`),
  `a`/`b` evidence ids, `resolution` (`prefer_fresh|prefer_higher_confidence|prefer_structured|flag_unresolved`), `resolved`.
- **`decayFactor(observedAt, asOf, halfLifeDays)`** (`canonical/helpers.ts`) — **freshness decay** in scoring.
- **Scoring** (`canonical/scoring.ts`) — confidence-weighted, method-weighted, **abstains** (`abstained:true`)
  when no usable contributor, spread-based confidence penalty on divergence.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Every evidence source defined | **CONTRACT-READY** (adapters are U1 scope) | `SourceRef.system` + `EvidenceKind` express any source; sources enumerated in ADOPTION §5. |
| 2 | Provenance / confidence / timestamp / freshness | **✅ MET** | `EvidenceRef.source` + `Facet.confidence` + `observedAt`/`recordedAt` + `asOf`/`lifecycle`/`decayFactor`. |
| 3 | Contradictory evidence represented | **✅ MET** | `Facet.contradictions[]` + `ContradictionRef` (5 kinds). |
| 4 | Abstention behavior exists | **✅ MET** | `Facet.value=null` (never fabricate); scoring `abstained`; verified by U-1 test (empty profile ⇒ nulls). |
| 5 | Evidence priority policy-driven, NOT hardcoded | **✅ MET (with U1 discipline)** | Resolution is the typed `ContradictionResolution` policy + `decayFactor` + `weight` + `kind` — not a hardcoded source ladder. **U1 must assign per-source `weight`/`kind`, never `if source==X`.** |
| 6 | No downstream consumer assumes legacy ownership | **U3 GATE (not a U1 blocker)** | Consumers still read legacy today; U1 is **shadow** (understanding built, not consumed) so it introduces no coupling; the seam `resolveCompanyProjection` exists; consumer migration is U3. |
| 7 | Expected U1 semantic divergences documented | **✅ MET** | See Expected Semantic Divergence Matrix below. |

## 1. Evidence Source Matrix

| Priority | Source | `SourceRef.system` | `EvidenceKind` | Suggested `weight` | Compliance | Status |
|---|---|---|---|---|---|---|
| 1 | Official website (domain crawl) | `website_capture` | `structured`/`observed` | 0.9 | first-party (own crawl via safeFetch) | **U1 build** (highest-trust) |
| 2 | AI extraction (from crawl/chat) | `ai_extraction` | `ai_generated`/`inferred` | 0.6 | grounded (safeParse, no fabrication) | **U1 build** (promote T5 → evidence) |
| 3 | Company profile (user-entered/confirmed) | `company_profile` | `structured` | 0.55; **user_confirmed = 0.99** | first-party | **exists** (`companyFromProfile`); U5 user-authority upgrade |
| 4 | LinkedIn (public company page) | `linkedin` | `external` | 0.7 | **compliant API only — no scraping** | **U1 build** (firmographics) |
| 5 | Crunchbase | `crunchbase` | `external` | 0.65 | API | **U1 build** |
| 6 | Public registries | `public_registry` | `external` | 0.6 | public | **U1 build** |
| 7 | Trusted public sources | `trusted_public` | `external` | 0.5 | safeFetch + grounding | **U1 build** |
| 8 | Wikidata | `wikidata` | `external` | 0.4 | public | **exists** (demote adapter into evidence) |

*Priority is expressed as evidence `weight` + `kind` + freshness — resolution is the **policy** (§Conflict), not a
hardcoded per-source ladder. Every source enters via `safeFetch` (SSRF seam) and grounded extraction; each emits
`EvidenceRef`s with full provenance.*

## 2. Evidence Confidence Matrix

Confidence is **derived**, not assigned per-source-name:

| Factor | Mechanism |
|---|---|
| Source trust | `EvidenceRef.weight` (0..1) — higher for first-party (website/user_confirmed) than public (Wikidata). |
| Evidence kind | `structured` > `observed` > `external` > `inferred`/`ai_generated` (method weighting in scoring). |
| Freshness | `decayFactor(observedAt, asOf, halfLife)` — stale evidence contributes less. |
| Agreement | Multiple concordant sources ⇒ calibrated confidence uplift; divergence ⇒ spread penalty. |
| Facet confidence | `Facet.confidence` = confidence-weighted blend of its evidence; abstains (0) when unevidenced. |

No source is trusted absolutely; confidence emerges from weight × method × freshness × agreement.

## 3. Evidence Conflict Policy

Contradictions are first-class (`ContradictionRef`) and resolved by a **typed policy**, applied in order of
specificity:

| Contradiction kind | Default resolution | When |
|---|---|---|
| `stale_vs_fresh` | `prefer_fresh` | timestamps differ materially (via `decayFactor`). |
| `confidence_divergence` | `prefer_higher_confidence` | same recency, different confidence. |
| `stated_vs_observed` / `source_conflict` | `prefer_structured` | first-party structured beats external/inferred. |
| `ai_conflict` | `flag_unresolved` | AI-generated disagrees with structured ⇒ recorded, not silently picked. |
| unresolved | `flag_unresolved` | surfaced in `Facet.contradictions[]` + `unknowns[]`; the facet may abstain or lower confidence. |

The policy is **data** (the resolution enum + weights), so priority can change without code edits — satisfying
"policy-driven, not hardcoded."

## 4. Abstention Policy

- A facet **abstains** (`value = null`) whenever it has no qualifying evidence — **never fabricates** a default.
- Scoring returns `abstained: true` / `value: null` when no contributor has evidence.
- Gaps are explicit (`Facet.unknowns[]`); assumptions are recorded (`Facet.assumptions[]`).
- Downstream projections must surface the abstain as an **honest empty-state** (certified in U-1: empty profile ⇒
  null category/products/competitors).
- **No minimum-count fabrication** (mirrors the certified competitor evidence-only rule — LAW 7).

## 5. Expected Semantic Divergence Matrix (U1)

At U0 parity was 1.0 (canonical adopts the legacy profile). **U1 feeds raw evidence, so canonical will
intentionally diverge from — and correct — legacy.** These are the **approved** divergences to expect and
whitelist in the U1 delta re-run (measured, not surprising):

| Field | Legacy (T1/T3) | Expected evidence-derived | Class |
|---|---|---|---|
| category | `"Analytics software for clearer performance insights"` (Omnivyra) | marketing/content platform (from crawl+products evidence) | **Approved improvement** |
| solution_domains | Marketing Technology + Data & Analytics | marketing / content / SEO / campaign (from products evidence) | Approved improvement |
| provider_type | `ai_product` (level_2) | AI marketing/content platform (from evidence) | Approved improvement |
| operating_model | `"AI software platform"` (T3 regex) | AI-powered marketing & content platform | Approved improvement |
| domain_role | `"AI-powered problem-solution provider"` (generic) | marketing/content solution role | Approved improvement |
| competitors | `[]` (empty) | populated when web/name evidence exists; **abstain** (honest empty) when truly none — gate unchanged | Approved improvement / abstain |
| firmographics | empty (Wikidata miss) | founded/size/revenue from website/LinkedIn/Crunchbase evidence, with provenance | Approved improvement |
| name / domain / products / services | (unchanged) | same | **Parity (must stay 1.0)** |

Any divergence **outside** this whitelist (e.g. a changed `name`/`domain`, or a *worse* category) is an
**unexpected regression** and blocks the U1 authoritative flip.

## 6. Risk Matrix

| Risk | Severity | Mitigation |
|---|---|---|
| Evidence priority implemented as a hardcoded source ladder | High | **Enforced discipline:** priority via `weight`/`kind`/freshness only; U6 lint can flag `if (source ===` in the builder. |
| Firmographic adapters (LinkedIn/Crunchbase) — ToS/cost/compliance | Medium | Compliant API only (no scraping); `safeFetch`; env-gated; fail-soft to abstain; Wikidata floor retained. |
| AI-extraction fabrication entering as evidence | High | `ai_generated` kind, lower weight, grounded (safeParse); conflicts → `flag_unresolved`; abstain on ungrounded. |
| Cross-company evidence leakage (tenant-less cache) | High | Tenant-scoped evidence + cache (cross-company-isolation suite in U1). |
| Divergence misread as regression | Medium | Expected-divergence whitelist (§5) drives the U1 delta classification. |
| U1 changes consumed before parity | Low | U1 is shadow (flag OFF); consumers unaffected; cutover is U2/U3. |
| Hallucination via non-abstaining facet | High | Abstention policy (§4) + hallucination-prevention suite. |

## 7. Migration Readiness Verdict

The canonical evidence contract provides **provenance, confidence, dual timestamps, freshness/decay, typed
contradictions with a data-driven resolution policy, and abstention** — all certified in Programs 1/2. The
requirements are met; the two "open" items are **phase-scoped, not blockers**: U1 *builds* the source adapters
within the ready contract, and consumer legacy-ownership is a **U3** concern (U1 is shadow). The expected U1
semantic divergences are documented and whitelisted. Provided U1 implements priority as **policy (weight/kind/
freshness), not a hardcoded source ladder**, keeps AI-extraction grounded, tenant-scopes evidence, and remains
shadow (flag OFF), the platform is ready to build the evidence-derived understanding.

# ✅ READY FOR U1

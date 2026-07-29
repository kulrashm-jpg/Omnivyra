# COMPANY-UNDERSTANDING-AUDIT-001 — Architectural Audit of the Company Profile / Competitor Intelligence Platform

**Auditor:** Independent Chief Product Architect
**Question:** Does the platform have **one** canonical company-understanding pipeline, or do multiple
independent reasoning systems derive overlapping company identity?
**Nature:** Architecture audit — not a code review, bug fix, or tuning exercise. The Omnivyra failures (wrong
category / operating model / domain role / solution domains, empty competitors, missing firmographics) are
treated as *symptoms*; the object of study is whether the **architecture permits this class of failure to
recur.**
**Date:** 2026-07-28

---

## 0. Verdict (up front)

# ❌ B. MULTIPLE COMPANY UNDERSTANDING ENGINES DETECTED

A canonical `CompanyUnderstanding` object **exists** (`backend/services/companyIntelligence/`, Program 002)
but is **flag-dark / shadow-only and consumed by nothing** on the live path. The live company profile derives
identity through **at least four independent, competing classifiers** plus **discarded AI extraction** plus an
**isolated firmographics island** — with **cross-classifier overwrites, sticky caches, and no enforced single
owner**. The architecture does **not** guarantee consistency; the Omnivyra failures are structural, not
incidental, and **any future module can repeat them.**

---

## 1. Architecture Diagram (as-is)

```
                          RAW EVIDENCE (crawl, chat, user form, SERP)
                                          │
        ┌─────────────────────────────────┼───────────────────────────────────────────┐
        │                                 │                                             │
        ▼                                 ▼                                             ▼
  AI EXTRACTION                  DETERMINISTIC CLASSIFIERS (LIVE)                 EXTERNAL ISLANDS
 refinementPrompts.ts        ┌─────────────────────────────────────┐        ┌──────────────────────┐
 → category_list,            │ 1. classifyCompanyBusiness           │        │ Wikidata firmographics│
   industry_list,            │    businessClassification.ts         │        │ wikidataAdapter.ts    │
   products, etc.            │    → level_1/2/3, category,          │        │ → founded/size/revenue│
        │  (RAW)             │      provider_type, solution_domains │        │  (name-keyed, no link │
        │                    │    + generateCategory ladder         │        │   to any understanding)│
        │                    │    + applyDomainStability CACHE      │        └──────────────────────┘
        │                    ├─────────────────────────────────────┤
        │                    │ 2. inferEntityArchetype              │
        │                    │    entityArchetype.ts                │
        │                    │    → archetype (business-first /     │
        │                    │      audience-led) + cap-vs-identity │
        │                    ├─────────────────────────────────────┤
        │                    │ 3. inferCompanyDomainShape /         │
        │                    │    inferSolutionDomainsFromText      │
        │                    │    companyProfileServiceRest1Enrich  │
        │                    │    → domain_role, operating_model,   │
        │                    │      base provider_type/solution_dom │
        │                    ├─────────────────────────────────────┤
        │                    │ 4. extractCompetitiveContextFromProf │
        │                    │    competitorEngine…RankingFinal/Score│
        │                    │    → the competitor engine's OWN read │
        │                    └─────────────────────────────────────┘
        │                                 │
        ▼                                 ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │  buildRefinedPayload (companyProfileServiceRest1Rest2Competitors)  │
  │  • AI category  →  OVERWRITTEN by businessClassification.category  │
  │  • provider_type ← level_2  •  solution_domains ← level_3          │
  │  • domain_role / operating_model ← inferCompanyDomainShape (STICKY)│
  │  • withExistingText/List prefer stored → manual edits can persist  │
  │    but auto-fields never self-correct                             │
  └───────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
              PERSISTENCE: report_settings.market_pulse (live) + profile columns
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────────┐
        ▼                                 ▼                                       ▼
  Competitor Engine              Content Architect / MarketPulse           Journey / Lead / Visitor
  (its own context read)         (contextAssimilationEngine reads          engines (canonical spine,
                                  solution_domains as merge input)          shadow — do not feed profile)

  ╔══════════════════════════════════════════════════════════════════════════════════════╗
  ║  DORMANT (flag-dark, consumed by NOTHING on the live path):                            ║
  ║   companyIntelligence/  → CANONICAL CompanyUnderstanding + projection + consumerAdapter ║
  ║   report_settings.canonical_understanding  (shadow write; COMPANY_UNDERSTANDING_ENABLED)║
  ║   companyKnowledgeGraph.ts (INERT)                                                     ║
  ╚══════════════════════════════════════════════════════════════════════════════════════╝
```

This is precisely the anti-pattern named in the brief: *Raw Evidence → Classifier A → Classifier B →
Classifier C → Competitor Engine* — **not** *Raw Evidence → Canonical Understanding → everything consumes it.*

## 2. Truth-Source Diagram

```
   TRUTH SOURCES FOR "WHAT IS THIS COMPANY?"  (should be exactly 1; there are 5+ competing)

   [T1] businessClassification.classifyCompanyBusiness   → category, provider_type(L2), solution_domains(L3)
   [T2] entityArchetype.inferEntityArchetype             → archetype / business-first vs audience-led
   [T3] inferCompanyDomainShape (+ inferSolutionDomains) → domain_role, operating_model, base provider_type/sd
   [T4] competitor engine extractCompetitiveContextFromProfile → competitive identity (its own read)
   [T5] AI extraction (refinementPrompts)                → category_list/industry/products  (RAW, then DISCARDED)
   [T6] Wikidata adapter                                 → firmographics  (unlinked island)
   [Tc] companyIntelligence CANONICAL UNDERSTANDING      → all facets  (DORMANT — consumed by none)

   Live "truth" for a given field = whichever of T1–T4 wrote last in buildRefinedPayload.
   There is no arbiter, no single owner, no reconciliation. Tc (the intended arbiter) is switched off.
```

## 3. Derivation Graph (per contested field)

```
category         : evidence → [T5 AI category_list] → DISCARDED
                            → [T1 generateCategory ladder on scored domains] → SAVED (overwrite)
provider_type    : evidence → [T3 base] → OVERWRITTEN by [T1 level_2]        → SAVED
solution_domains : evidence → [T3 inferSolutionDomainsFromText] → OVERWRITTEN by [T1 level_3] → SAVED
domain_role      : evidence → [T3 regex ladder]                → SAVED (STICKY: never self-corrects)
operating_model  : evidence → [T3 regex ladder]                → SAVED (STICKY)
industry         : evidence → [T5 AI industry_list] → normalized → SAVED  (mostly AI-kept)
business_model   : evidence → [T1 level_1]                      → SAVED
products         : evidence → [T5 AI products_services]         → SAVED   (AI-kept)
capabilities     : (no single owner — inferred ad hoc per consumer)
customer_segments: evidence → [T5 AI target_audience] (+ [T2] archetype tint) → SAVED
problems_solved  : evidence → [T5 AI goals/pain]               → SAVED
differentiators  : evidence → [T5 AI UVP/positioning]          → SAVED
company_facts    : name → [T6 Wikidata only] → SAVED or empty  (no fallback, no link to T1–T4)
competitors      : evidence → [T4 competitor-engine context] → assembly → strict gate → SAVED/empty
company_underst. : evidence → [Tc canonical] → report_settings.canonical_understanding (SHADOW, unread)
                            → (separately) a UI "company understanding" text refined from chat (manual-kept)
```

Every contested field has **≥2 potential writers** and **no declared owner**. The AI extraction (T5), which
is the closest thing to an evidence-grounded read, is **overwritten** for exactly the fields that failed.

## 4. Field Ownership Matrix

| Field | Live derivation | Deterministic / AI | Downstream can overwrite? | User edit survives? | Future refine can overwrite user edit? | Duplicate reasoning? |
|---|---|---|---|---|---|---|
| category | T1 `generateCategory` | Deterministic | Yes (T1 over T5) | Only if manual-preserve applies (partial) | **Yes** (classifier re-derives) | Yes (T1 vs T5) |
| industry | T5 AI + normalize | AI | Rarely | Usually | Possible | Low |
| business_model | T1 level_1 | Deterministic | — | Partial | Yes | Yes (T1 vs T2 archetype) |
| provider_type | T1 level_2 (overrides T3) | Deterministic | **Yes** (T1 over T3) | Partial | Yes | **Yes** (T1 vs T3) |
| operating_model | T3 regex ladder | Deterministic | No (but STICKY) | Yes | No (sticky) — but never self-corrects | **Yes** (T3 vs T1 provider) |
| domain_role | T3 regex ladder | Deterministic | No (STICKY) | Yes | No (sticky) | **Yes** (T3 vs T1/T2) |
| solution_domains | T1 level_3 (overrides T3) | Deterministic | **Yes** (T1 over T3) | Partial | Yes | **Yes** (T1 vs T3) |
| products | T5 AI | AI | No | Yes | Possible | Low |
| capabilities | none (ad hoc) | mixed | n/a | n/a | n/a | **Yes** (per-consumer) |
| customer_segments | T5 AI + T2 tint | AI + det | Partial | Yes | Possible | Yes (T2 archetype) |
| problems_solved | T5 AI | AI | No | Yes | Possible | Low |
| differentiators | T5 AI | AI | No | Yes | Possible | Low |
| company_facts | T6 Wikidata | External | n/a | Yes (admin-confirm) | No | Island (no link) |
| competitors | T4 context → assembly/gate | det pipeline over evidence | n/a | Manual names kept | n/a | **Yes** (T4 ≠ T1) |
| company_understanding | Tc canonical (SHADOW) / UI text | AI | — | Manual-kept (UI) | No (UI) | **Yes** (Tc unread vs UI text vs T1–T4) |

**No field is owned by a single canonical source.** The three worst-diverging fields (provider_type,
operating_model, solution_domains) are split across **two or three different classifiers**.

## 5. Duplicate Reasoning Matrix

| Reasoning concern | Systems that independently perform it |
|---|---|
| "What business is this?" | T1 `classifyCompanyBusiness`, T2 `inferEntityArchetype`, T3 `inferCompanyDomainShape`, Tc canonical (dormant) |
| Category / product-type | T1 `generateCategory`, T5 AI `category_list` (discarded) |
| Provider / operating model | T1 level_2, T3 regex ladder (two answers, one overwrites) |
| Solution domains | T1 level_3, T3 `inferSolutionDomainsFromText` (two answers, one overwrites) |
| Audience / segment identity | T2 archetype, T5 AI target_audience |
| Competitive identity | T4 competitor-engine context (a *fifth* independent read of the company) |
| Firmographics | T6 Wikidata (unlinked to any understanding) |
| Canonical understanding | Tc `companyIntelligence` (built, certified shadow, **switched off**) + a separate UI "company understanding" text |

## 6. Architectural-Smell Inventory (all present)

- **Multiple classifiers** — T1, T2, T3, T4 (≥4 live), plus Tc dormant. ✔
- **Keyword-based reclassification** — T1 regex/score tables; T3 regex ladder; T2 keyword archetype. ✔
- **Duplicate reasoning** — §5. ✔
- **Competing truth sources** — §2. ✔
- **Deterministic overrides** — AI category/provider/solution_domains overwritten by T1/T3. ✔
- **Hardcoded taxonomies** — `VERTICAL_DEFINITIONS`/`FUNCTION_DEFINITIONS`, `DOMAIN_DISPLAY_LABELS`, `generateCategory` literal strings. ✔
- **Multiple caches** — `applyDomainStability` in-process Map (T1), `external-knowledge-cache` (T6, tenant-less, 24h negative-cached), `report_settings.market_pulse` (live), `report_settings.canonical_understanding` (shadow), companyIntelligence shadow persistence. ✔ (≥5)
- **Sticky values** — `withExistingText`/`withExistingList` (domain_role/operating_model never self-correct) + `applyDomainStability` (domain won't change without +0.15 confidence). ✔
- **Manual edits ignored / partial** — no uniform per-field authoritative-edit contract; some fields re-derive over user input. ✔
- **Prompt output discarded** — AI `category_list` computed then overwritten. ✔
- **Evidence discarded** — T5's evidence-grounded read replaced by keyword classifiers. ✔
- **Independent inference** — the competitor engine re-reads the company (T4) instead of consuming a shared understanding. ✔
- **Cross-module divergence** — provider_type (T1) vs operating_model (T3) vs domain_role (T3) vs competitors (T4). ✔

## 7. Mandatory Questions

- **Q1 — One canonical understanding object?** A canonical object *exists* (`companyIntelligence` Tc) but is
  **flag-dark and consumed by nothing** on the live path. So functionally **NO** — the live system has no single
  consumed canonical understanding.
- **Q2 — Does every downstream consume it?** No — **zero** live consumers of Tc. Downstream reads
  `report_settings.market_pulse` written by the competing classifiers.
- **Q3 — Which modules independently reason?** T1 `businessClassification`, T2 `entityArchetype`, T3
  `inferCompanyDomainShape`/`inferSolutionDomainsFromText`, T4 competitor-engine context extractor, and T5 AI
  extraction — five independent reasoners (six counting dormant Tc).
- **Q4 — Can category disagree with solution domains?** **Yes.** category comes from T1 `generateCategory`
  (if/else ladder); solution_domains from T1 `level_3` (display-domain list). Different selection functions →
  they can point at different domains.
- **Q5 — Can operating model disagree with provider type?** **Yes — and does in Omnivyra.** operating_model is
  T3 (regex ladder → "AI software platform"); provider_type is T1 level_2 ("ai_product"). Two classifiers, no
  reconciliation.
- **Q6 — Can competitors derive from a different understanding than category?** **Yes.** Competitors use T4's
  own `extractCompetitiveContextFromProfile`, independent of T1's category — so competitor fit can be scored
  against a *different* notion of the company than the one shown as its category.
- **Q7 — Can future modules repeat this mistake?** **Yes.** Nothing structurally forbids a new module
  (journey/lead/visitor) from adding a sixth classifier; there is no single-owner enforcement.
- **Q8 — Does the architecture guarantee consistency?** **No.** Consistency is accidental (whichever classifier
  writes last), not guaranteed.
- **Q9 — Can two modules independently classify the same company?** **Yes — already happens** (≥4 live
  classifiers over the same evidence).
- **Q10 — What eliminates this class permanently?** Adopt the **already-built canonical `CompanyUnderstanding`
  (Tc)** as the *single* truth; make every identity field a **projection** of it (`companyIntelligence/
  projection.ts` already exists); **retire** T1/T3's identity outputs and T4's independent read into the
  projection; route all consumers through `consumerAdapter`; and enforce **single-ownership** as an invariant
  (the same law the platform governance constitution already encodes — I-3). See §9.

## 8. Architectural Risk Assessment

| Risk | Severity | Rationale |
|---|---|---|
| No single source of truth for company identity | **Critical** | Five competing reasoners; last-writer-wins; no arbiter. |
| Cross-field incoherence (Omnivyra class) | **Critical** | provider_type ≠ operating_model ≠ domain_role ≠ category by construction. |
| Competitor quality coupled to the *wrong* read | **High** | T4 scores fit against its own context; a mis-classified subject starves the gate → empty competitors. |
| Sticky/stale identity | **High** | domain_role/operating_model never self-correct; in-process domain cache resists change. |
| Manual edits not durably authoritative | **High** | No uniform per-field authoritative-edit contract. |
| Firmographics island | **Medium** | Wikidata-only, tenant-less cache, unlinked to understanding. |
| Certified canonical engine wasted | **High** | Program 002 canonical understanding built + certified, then left dark — divergence grows while the fix sits unused. |
| Unbounded future divergence | **Critical** | Every new intelligence module can add another classifier. |

## 9. Recommended Target Architecture

```
                    RAW EVIDENCE (crawl · chat · user form · SERP · firmographics)
                                          │
                                          ▼
              ┌───────────────────────────────────────────────────────────┐
              │   CANONICAL COMPANY UNDERSTANDING  (single owner = Tc)      │
              │   backend/services/companyIntelligence/ (already built)     │
              │   builder + fromProfile + evidence + confidence + provenance│
              │   — the ONLY system that reasons about company identity     │
              └───────────────────────────────────────────────────────────┘
                                          │  (single, versioned, immutable-per-derivation object)
                    ┌─────────────────────┼───────────────────────────────┐
                    ▼                     ▼                               ▼
             PROJECTIONS (pure)     consumerAdapter                 firmographics folded in
   projection.ts derives, from the ONE understanding:      (Wikidata + web fallback) as an
   category · provider_type · operating_model ·            EVIDENCE input to the understanding,
   domain_role · solution_domains · business_model ·       not a separate island
   products · segments · problems · differentiators
                    │
                    ▼
     ALL CONSUMERS read the projection (never re-classify):
     Company Profile UI · Competitor Engine · Content Architect · MarketPulse ·
     Journey / Lead / Visitor engines
```

Design laws (enforced, not aspirational):
1. **Single owner:** exactly one module (Tc) may *derive* company identity. All others *project* or *consume*.
2. **Projection, not re-inference:** category/provider_type/operating_model/domain_role/solution_domains become
   deterministic **projections** of the one understanding — so they can never disagree (they share a source).
3. **Evidence in, understanding once:** AI extraction + firmographics + SERP feed the understanding as
   *evidence*; nothing downstream re-reads raw evidence to re-classify.
4. **Authoritative user edits:** a uniform per-field edit contract; a confirmed edit is an evidence override in
   the understanding, honored by every projection, never silently re-derived.
5. **Competitors consume the understanding:** the competitor engine's context is a *projection* of Tc, not an
   independent read — so competitor fit and category are always about the same company.
6. **No new classifiers:** adding a company-identity classifier is a governance violation (platform
   constitution I-3 single ownership); new modules consume Tc.

## 10. Migration Strategy

Non-breaking, shadow-first, reversible — the canonical engine is already certified in shadow, so this is
**adoption**, not new construction:

1. **Parity (shadow → observed):** run Tc `companyIntelligence` alongside the live classifiers on real
   profiles; compare its projected category/provider_type/operating_model/domain_role/solution_domains against
   the current T1/T3 outputs; log deltas (the Omnivyra case becomes a fixture). Uses the existing
   `shadowRuntime`/`shadowValidation`.
2. **Fold firmographics + web into evidence:** attach Wikidata + a grounded web fallback as *evidence* to Tc
   (removing the island), so company_facts share the same understanding + provenance.
3. **Projection cutover (field by field, flag-gated):** replace each live write in `buildRefinedPayload` with
   the corresponding **projection of Tc**, one field at a time behind the existing flag — starting with the
   split-owner fields (provider_type, operating_model, solution_domains, category) so cross-field coherence is
   restored first.
4. **Competitor engine adopts Tc:** replace `extractCompetitiveContextFromProfile` with a projection of Tc via
   `consumerAdapter`, so competitor fit is scored against the canonical understanding (this alone addresses the
   "empty competitors on a mis-classified subject" failure).
5. **Retire the competing classifiers:** once every projection is cut over and parity holds, retire T1's
   identity outputs, T3, T2's identity role, and the duplicate caches (`applyDomainStability`, the sticky
   `withExistingText` preference) — via the governance capability-lifecycle (retire, not delete).
6. **Enforce single-owner:** add the invariant check to the review cadence so no future module may add a
   company-identity classifier.

Each step is flag-gated, shadow-validated, and reversible; the live behavior is unchanged until a field's
projection reaches parity.

## 11. Implementation Roadmap

| Phase | Outcome | Gate |
|---|---|---|
| **U0 — Parity harness** | Tc runs in shadow over live profiles; delta report (incl. Omnivyra fixture) | Deltas characterized; no live change |
| **U1 — Evidence unification** | Firmographics (Wikidata + web fallback) + AI extraction feed Tc as evidence | Facts share understanding + provenance |
| **U2 — Coherence cutover** | provider_type · operating_model · solution_domains · category become Tc projections (flag-gated) | Cross-field coherence proven; parity ≥ target |
| **U3 — Competitor adoption** | Competitor context = projection of Tc | Competitor fit scored on canonical read; empty-state only when evidence truly absent |
| **U4 — Full projection + edit contract** | All identity fields project from Tc; uniform authoritative user-edit override | Manual edits durable; no re-inference |
| **U5 — Classifier retirement** | T1(identity)/T2(identity)/T3 + duplicate caches retired via capability-lifecycle | Single owner; no competing classifier remains |
| **U6 — Invariant enforcement** | Single-ownership check in the review cadence | New modules cannot add a classifier |

---

## Final Determination

The platform does **not** have one canonical company-understanding pipeline. It has a **certified canonical
engine sitting dark** while **five independent reasoners** derive and overwrite overlapping company identity,
with no arbiter, sticky caches, discarded evidence, and no single-owner guarantee. The Omnivyra failures are
the *expected* output of this topology and will recur for every company whose evidence trips a different
classifier than its neighbors — and every future intelligence module can add a sixth reasoner.

The remedy is not tuning; it is **adopting the already-built canonical `CompanyUnderstanding` as the single
source of truth**, projecting every identity field from it, folding firmographics into its evidence, routing
competitors and all downstream engines through it, and **enforcing single-ownership** so this class of bug is
eliminated permanently.

# ❌ VERDICT: B — MULTIPLE COMPANY UNDERSTANDING ENGINES DETECTED

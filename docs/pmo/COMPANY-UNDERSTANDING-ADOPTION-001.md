# COMPANY-UNDERSTANDING-ADOPTION-001 — Canonical Adoption Migration Plan

**Architect:** Chief Platform Migration Architect
**Mission:** Adopt the already-certified canonical `CompanyUnderstanding` capability
(`backend/services/companyIntelligence/`, COMPANY-INTELLIGENCE-PROGRAM-002) as the **one and only** owner of
company identity, migrating every live consumer onto it via shadow validation, parity gates, feature flags,
and reversible rollout. **Not** a redesign, new engine, or classifier-tuning exercise.
**Basis:** COMPANY-UNDERSTANDING-AUDIT-001 (verdict B — multiple engines).
**Date:** 2026-07-28

> **Grounding fact (why this is adoption, not construction):** the canonical engine already exposes the full
> pipeline — `companyFromProfile` → `buildCompanyUnderstanding` → `projectCompany` → `toLegacyFields`; **the
> consumer seam** `resolveCompanyProjection(profile)` (flag OFF ⇒ byte-identical legacy, flag ON ⇒ canonical
> projection in legacy shape, O(1) rollback); the adoption gate `validateConsumerParity` (parity ≥ 0.999);
> `compareToLegacy` shadow parity; 22 facets (identity, offerings, marketPosition, customers, competitive,
> financial, funding, geography, brand, …); world-view (category/businessModel/primaryMotion/marketPosition);
> and flags `COMPANY_UNDERSTANDING_ENABLED` + `COMPANY_UNDERSTANDING_AUTHORITATIVE`, **both default OFF.**

---

## Part 1 — Inventory of Company-Identity Producers

| # | Producer | Purpose | Inputs | Outputs | Current consumers | Replacement | Retirement |
|---|---|---|---|---|---|---|---|
| T1 | `businessClassification.classifyCompanyBusiness` | domain/category/model classifier | profile + AI extraction text | level_1/2/3, category, provider_type, solution_domains | `…Rest1Rest2Competitors`, `…Pulse`, `…Core`, `competitorEngineDiscovery`, `define-target-customer`, `completeness` | **Projection of Tc** (worldView.category/businessModel; marketPosition/offerings) | Retire identity outputs via §10 lifecycle; keep only if any non-identity use remains |
| T2 | `entityArchetype.inferEntityArchetype` | business-first vs audience-led + capability-vs-identity guard | profile signals | archetype label + guard flags | `…Core`, `profileConversationOrchestrator`, competitor synthesis | **Projection** (worldView.primaryMotion / marketPosition) + keep the *capability-vs-identity guard* as an **evidence-quality rule inside `companyFromProfile`**, not a competing classifier | Retire the archetype-as-identity role; fold the guard into evidence intake |
| T3 | `inferCompanyDomainShape` / `inferSolutionDomainsFromText` (`…Rest1Enrich`) | domain_role / operating_model / solution_domains regex ladder | signal text | domain_role, operating_model, base provider_type/solution_domains | `buildAiMarketPulseSettings` (`…Pulse`) | **Projection of Tc** (see Part 3) | Retire entirely |
| T4 | `extractCompetitiveContextFromProfile` (`competitorEngine…RankingFinal/Score`) | competitor engine's OWN read of the company | profile | competitive context (category/ICP/problem/solution) | competitor ranking/scoring | **Projection of Tc** (competitive facet + worldView) via `resolveCompanyProjection` | Retire the *identity* portion; keep rank/score/discover/validate |
| T5 | AI extraction (`refinementPrompts.buildExtractionPrompt`) | evidence-grounded read | crawl/chat/form | category_list, industry_list, products, audience, goals, UVP, positioning | fed into T1/T3 then overwritten | **Becomes the primary evidence input to `companyFromProfile`** (already its design) | Not retired — promoted to *evidence*, never overwritten |
| T6 | Wikidata (`wikidataAdapter.lookupCompanyFirmographicsFromWikidata`) | firmographics | company name | founded/size/revenue | `company-facts-lookup` route | **One evidence source** feeding the identity/organization/financial/funding facets (lowest priority) | Not retired — demoted to an evidence adapter behind the canonical firmographic graph |
| Tc | `companyIntelligence` **CompanyUnderstanding** (certified, shadow) | canonical identity | all evidence | facets + score + projection | **none (dormant)** | **BECOMES THE SINGLE OWNER** | n/a — target |

**Hidden producers found (must also route through Tc):** `companyKnowledgeGraph.ts` (INERT — retire/keep-inert),
per-consumer ad-hoc "capabilities" inference (no owner today), `contextAssimilationEngine` reads of
`solution_domains`/`core_offerings` (become reads of the Tc projection), and `savePayload`/`normalization`
field massaging in `companyProfile/` (must not re-derive identity — only shape the projection).

## Part 2 — Canonical Ownership Map (future)

Single owner for **every** identity field = **`CompanyUnderstanding` (Tc)**, exposed via a named facet;
each field reaches consumers only through a **projection**. No field has two owners.

| Field | Single owner (Tc facet) | Projection | Consumer access |
|---|---|---|---|
| category | `worldView.category` | `project.category` | via `resolveCompanyProjection` |
| industry | `worldView` + `marketPosition.segment` | `project.industry` | seam |
| provider_type | `worldView` + `offerings` | `project.provider_type` | seam |
| business_model | `worldView.businessModel` | `project.business_model` | seam |
| operating_model | `worldView.primaryMotion` | `project.operating_model` | seam |
| domain_role | `worldView.marketPosition` + `offerings` | `project.domain_role` | seam |
| solution_domains | `marketPosition.segment` + `offerings` | `project.solution_domains` | seam |
| products | `offerings.products` | `project.products` | seam |
| customer_segments | `customers.segments` | `project.customer_segments` | seam |
| problems | `marketPosition` + `recommendations` | `project.problems` | seam |
| capabilities | `offerings` + `technology` | `project.capabilities` | seam |
| differentiators | `marketPosition.differentiators` | `project.differentiators` | seam |
| firmographics (founded/size/revenue/funding/geo) | `identity`/`organization`/`financial`/`funding`/`geography` | `project.firmographics` | seam |
| competitors | `competitive.competitors` (evidence) → competitor engine ranks | `project.competitive` | seam (engine ranks, does not classify) |
| company_understanding | Tc itself | the projection object | seam |
| confidence | `score.confidence` / `facetConfidence` | `project.confidence` | seam |
| provenance | `EvidenceRef` on each facet | `project` + evidence refs | seam |

**Projection surface extension (allowed — pure reshape, not new reasoning):** the current `projectCompany`
/`toLegacyFields` project category/business_model/products/services/competitors/confidence. This plan
**extends** the projection to also emit provider_type/operating_model/domain_role/solution_domains/industry/
segments/problems/capabilities/differentiators/firmographics — each a **deterministic read of an existing
decided facet value** (never a re-inference). Where a facet does not yet carry a needed semantic, it is
**populated from evidence in `companyFromProfile` (U1)**, not by a projection-time classifier.

## Part 3 — Projection Layer (design)

Every projection is **pure · deterministic · stateless · derived only from `CompanyUnderstanding`**, matching
the existing `projection.ts` contract ("reads decided facet/score values, never recomputes a semantic").

- One function per field or a single `projectCompanyFields(u, projectedAt)` returning the full legacy+extended
  field set; `projectedAt` passed in (no `Date.now`).
- A projection MUST NOT run regex/keyword classification, call an LLM, or read raw evidence — it maps
  `u.facets.*.value` → field. If the value is unevidenced (facet abstains), the projection returns the
  abstain/empty value (honest empty-state), never a fabricated default.
- Cross-field coherence is **structural**: because provider_type, operating_model, domain_role,
  solution_domains, and category all read the *same* `worldView`/`marketPosition`/`offerings` facets, they
  cannot disagree (they share one source) — this is what eliminates the Omnivyra class of bug.

## Part 4 — Consumer Adoption Matrix

Every consumer reads via the single seam `resolveCompanyProjection` (flag-gated). Rollback = flag OFF ⇒
legacy fields, byte-identical.

| Consumer | Current input | Future (projection) | Migration path | Rollback | Validation |
|---|---|---|---|---|---|
| Company Profile (`buildRefinedPayload`) | T1/T3 writes to market_pulse | `resolveCompanyProjection` → project fields | U2 field-by-field behind flag | flag OFF | production-parity + cross-field-coherence suites |
| Competitor Intelligence | T4 own read | `project.competitive` + worldView | U4 | flag OFF | competitor-parity suite (gate unchanged) |
| Content Architect / `contextAssimilationEngine` | reads market_pulse solution_domains | `project.solution_domains`/`offerings` | U3 | flag OFF | consumer-consistency suite |
| Market Pulse | T1/T3 pulse settings | projection | U3 | flag OFF | consumer-consistency |
| Journey Intelligence | canonical spine (shadow) | consumes Tc projection | U3 | flag OFF | consumer-consistency |
| Lead Intelligence | canonical spine (shadow) | consumes Tc projection | U3 | flag OFF | consumer-consistency |
| Visitor Intelligence | canonical spine (shadow) | consumes Tc projection | U3 | flag OFF | consumer-consistency |
| Execution Intelligence | derived downstream | consumes Tc projection | U3 | flag OFF | consumer-consistency |

## Part 5 — Firmographics into the Canonical Evidence Graph

`CompanyUnderstanding` becomes the firmographics owner via the identity/organization/financial/funding/
geography facets. Firmographics are **evidence**, emitted as `EvidenceRef`s (each carrying source, timestamp,
confidence, provenance) into those facets, in priority order:

1. Official Website (the domain crawl — highest trust)
2. LinkedIn public company page (compliant means only — API, never scraping)
3. Crunchbase
4. Public registries
5. Trusted public sources
6. Wikidata (lowest — the current adapter, demoted)

- All sources go through the mandated `lib/security/safeFetch` (SSRF seam) + grounded extraction (`safeParse`,
  no fabrication).
- Conflict resolution is the canonical facet-decision (highest-confidence/fresh evidence wins; contradictions
  recorded), **not** a per-source override.
- **No consumer reads an external source directly** — the `company-facts-lookup` route reads the projection's
  `firmographics`. The Wikidata-only island is dissolved.

## Part 6 — Competitor Intelligence Adoption

Competitor Intelligence **consumes** `CompanyUnderstanding`; it may **rank, score, discover, validate** but
**never reinterpret** category, market, ICP, problem, solution, business model, operating model, or customer.

- Replace `extractCompetitiveContextFromProfile` with the Tc projection (`project.competitive` + worldView) via
  `resolveCompanyProjection`.
- The certified **evidence-only gate stays intact** (no weakening — the fabrication fix is preserved). With a
  correct canonical read feeding fit-scoring, real competitors clear the gate; genuinely evidence-poor
  companies still show the honest empty-state.
- Competitor names discovered by the engine feed **back** into `competitive` as evidence (closing the loop),
  but the engine does not own identity.

## Part 7 — Authoritative User Edits

A confirmed user edit becomes **evidence inside `CompanyUnderstanding`** — a `user_confirmed` `EvidenceRef`
with the highest trust weight on the relevant facet. Because every projection reads the decided facet value,
the edit is reflected everywhere and **no projection may overwrite it** (the facet decision now favors the
user evidence). This replaces the ad-hoc `withExistingText` stickiness with a uniform, evidence-based
authority contract. Re-refinement re-decides *unconfirmed* facets only.

## Part 8 — Migration Phases

| Phase | Scope | Files (representative) | Flags | Tests | Rollback | Success criteria |
|---|---|---|---|---|---|---|
| **U0 Shadow parity** | Run Tc in shadow over live profiles; delta report (Omnivyra fixture) | `companyIntelligence/shadowRuntime`, `shadowValidation`, `metrics`; a parity harness/CLI | `COMPANY_UNDERSTANDING_ENABLED` (shadow) | production-parity suite; delta report | n/a (no live write) | Deltas characterized; zero live change |
| **U1 Evidence unification** | Promote AI extraction to primary evidence; add firmographic evidence adapters (website/LinkedIn/Crunchbase/registry/Wikidata); populate facets needed by extended projections | `companyIntelligence/fromProfile`, new `evidence/*` adapters, `wikidataAdapter` (demoted), `safeFetch` | `COMPANY_UNDERSTANDING_ENABLED` | firmographic-provenance suite; hallucination-prevention suite | flag OFF | Facts + identity facets carry source/confidence/provenance; no fabrication |
| **U2 Projection cutover** | Extend `projectCompany`/`toLegacyFields` to all identity fields; route `buildRefinedPayload` writes through `resolveCompanyProjection`, field-by-field | `companyIntelligence/projection`, `persistence`; `companyProfileServiceRest1Rest2Competitors`, `…Enrich`, `…Pulse` | `COMPANY_UNDERSTANDING_AUTHORITATIVE` | projection-consistency + cross-field-coherence suites | flag OFF (per field) | provider_type/operating_model/domain_role/solution_domains/category coherent; parity ≥ 0.999 |
| **U3 Consumer adoption** | Content Architect, Market Pulse, Journey/Lead/Visitor/Execution read the seam | `contextAssimilationEngine`, `canonicalContentContextResolver`, journey/lead/visitor consumers, `consumerAdapter` | authoritative | consumer-consistency suite | flag OFF | All consumers read one projection; identical downstream outputs at parity |
| **U4 Competitor adoption** | Competitor engine context = Tc projection; gate unchanged | `competitorEngine…RankingFinal/Score`, `competitorCandidateAssembly` | authoritative | competitor-parity suite | flag OFF | Competitors scored on canonical read; no gate weakening |
| **U5 Classifier retirement** | Retire T1(identity)/T2(identity)/T3 + duplicate caches via governance lifecycle | `businessClassification`, `entityArchetype`, `…Enrich` (T3), `applyDomainStability`, `withExistingText` | — | full regression | re-enable behind flag if needed | No competing classifier / dead identity logic remains |
| **U6 Invariant enforcement** | Add single-ownership check to CI/review cadence | governance check / lint rule | — | invariant test | — | New modules cannot add an identity classifier |

## Part 9 — Regression Protection Suites

1. **Production parity** — canonical vs legacy fields per real profile; parity ≥ 0.999 gate (`validateConsumerParity`/`compareToLegacy`).
2. **Cross-field coherence** — provider_type/operating_model/domain_role/solution_domains/category derive from the same facets and never contradict (the Omnivyra assertion).
3. **Projection consistency** — projections are pure/deterministic: same understanding ⇒ identical fields; no `Date.now`/regex/LLM in projection.
4. **Consumer consistency** — every consumer reading the seam yields identical downstream output at parity.
5. **Competitor parity** — competitor results equal-or-better with canonical context; the evidence gate is unchanged (no fabrication).
6. **Firmographic provenance** — every firmographic field carries source/confidence/timestamp/provenance; safeFetch-only; no direct consumer external reads.
7. **Manual-edit persistence** — a confirmed edit becomes evidence and survives re-refinement + every projection.
8. **Cross-company isolation** — no company's evidence/understanding leaks into another (tenant-scoped; fixes the tenant-less firmographic cache).
9. **Hallucination prevention** — facets abstain when unevidenced; projections return honest empty-state; no fabricated identity.

## Part 10 — Classifier Retirement Matrix

| Classifier | Replacement | Retirement order | Deprecation | Rollback | Lifecycle action (governance) |
|---|---|---|---|---|---|
| T3 `inferCompanyDomainShape`/`inferSolutionDomainsFromText` | Tc projection (operating_model/domain_role/solution_domains) | 1st (fully replaced by U2) | mark deprecated at U2; remove at U5 | flag OFF | **Capability retirement** (§11 lifecycle) |
| T1 identity outputs (category/provider_type/solution_domains) | Tc projection | 2nd | deprecated at U2; remove at U5 | flag OFF | Capability retirement (keep any non-identity use) |
| T2 archetype-as-identity | Tc worldView; guard → evidence rule | 3rd | deprecated at U3; guard folded U1 | flag OFF | Capability transfer (guard → evidence intake) + retirement |
| T4 `extractCompetitiveContextFromProfile` | Tc projection | 4th (U4) | deprecated at U4; remove after | flag OFF | Capability retirement (identity portion only) |
| duplicate caches (`applyDomainStability`, `withExistingText` stickiness) | canonical facet decision + user-evidence authority | with U5 | — | — | Retire |
| `companyKnowledgeGraph` (INERT) | Tc graph | anytime | — | — | Retire/keep-inert |

**No dead logic remains** post-U5: retired code is removed after its projection reaches parity and the flag is
default-ON.

## Part 11 — Platform Invariants (enforced)

- **INV-CU-1 Single identity owner:** exactly **one** platform capability (`CompanyUnderstanding`) may derive
  company identity. Every other module **consumes** it (via `resolveCompanyProjection`) or **projects** from it.
- **INV-CU-2 No re-derivation:** no capability may derive category, provider_type, operating_model,
  solution_domains, domain_role, company identity, customer identity, or competitor context unless it is a
  **pure projection** of `CompanyUnderstanding`. Any regex/keyword/LLM identity classifier outside Tc is an
  architectural defect.
- **INV-CU-3 Evidence-in-once:** raw evidence (crawl/chat/form/firmographics/SERP) feeds Tc only; nothing
  downstream re-reads raw evidence to classify.
- **INV-CU-4 User edits are evidence:** a confirmed edit is evidence in Tc; no projection overwrites it.
- **INV-CU-5 Gate integrity:** the competitor evidence gate is never weakened by this migration.
These map onto the platform governance constitution's I-3 (single ownership) / I-4 (delegation, no
duplication) and are added to the §7/§8 review cadence + a CI check (U6).

## Part 12 — Certification Checklist (pre-completion)

- [ ] **Single ownership** — only Tc derives identity (grep: no identity classifier outside `companyIntelligence`).
- [ ] **Projection consistency** — projections pure/deterministic (no Date/regex/LLM).
- [ ] **Consumer consistency** — all consumers on the seam; parity suites green.
- [ ] **Cross-field coherence** — Omnivyra + fixtures: provider_type/operating_model/domain_role/solution_domains/category coherent.
- [ ] **Manual authority** — confirmed edits survive re-refine + projection.
- [ ] **Firmographic provenance** — source/confidence/timestamp/provenance on every fact; safeFetch-only.
- [ ] **Competitor consistency** — competitor parity ≥ baseline; gate unchanged.
- [ ] **Shadow parity** — ≥ 0.999 across the parity corpus before each authoritative flip.
- [ ] **Backward compatibility** — flag OFF ⇒ byte-identical legacy (verified).
- [ ] **Production readiness** — tsc clean, full regression green, migration guard green, per-tenant flag plan.

## Deliverables (produced above)

Architecture (Part 2/3/9 target) · Migration roadmap (Part 8) · Ownership matrix (Part 2) · Projection matrix
(Part 2/3) · Consumer matrix (Part 4) · Retirement matrix (Part 10) · Implementation phases (Part 8) ·
Regression suite (Part 9) · Certification checklist (Part 12) · Rollback strategy (every phase: flag OFF ⇒
legacy, O(1)) · Risk assessment (below).

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Parity gap between canonical projection and legacy on some companies | Medium | U0 shadow parity characterizes deltas per tenant *before* any flip; field-by-field flag; parity ≥ 0.999 gate |
| Projection surface extension accidentally re-infers (adds a classifier) | High | INV-CU-2 + projection-consistency suite bans regex/LLM in projections; code review gate |
| Firmographic adapters (LinkedIn/Crunchbase) — ToS/compliance/cost | Medium | Compliant API only (no scraping), safeFetch, env-gated, fail-soft; Wikidata retained as floor |
| Competitor regressions from context change | Medium | Competitor-parity suite; gate unchanged; U4 gated + reversible |
| Tenant leakage via shared firmographic cache | High | Tenant-scoped evidence + cache (cross-company-isolation suite) |
| Big-bang risk | High | Strictly phased U0→U6, each flag-gated + reversible; live behavior unchanged until parity |
| Retiring classifiers still referenced by a non-identity path | Medium | Retirement matrix keeps non-identity uses; lifecycle deprecate→remove only after parity |

---

## Decision

The canonical engine, consumer seam, parity gate, flags, 22-facet model, and shadow runtime **already exist
and are certified**; this plan is additive, flag-gated, shadow-validated, field-by-field, and O(1) reversible,
with every identity field assigned a single owner, every consumer routed through one seam, firmographics
folded into evidence, the competitor gate preserved, user edits promoted to evidence, and the competing
classifiers retired via the governance capability-lifecycle. The single design dependency — extending the
**projection** surface to the currently-divergent fields — is a pure deterministic reshape (explicitly
permitted), not a new engine.

# ✅ READY FOR IMPLEMENTATION

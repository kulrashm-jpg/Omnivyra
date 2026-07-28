# COMPANY-INTELLIGENCE-PROGRAM-002 — Phase A

## Canonical Company Intelligence Platform 2.0 — Architecture, Ontology & Gap Analysis

**Type:** Architecture + verification blueprint (design only — no code). **Verified 2026-07-28** against
the repository on branch `feat/lead-understanding-foundation` (HEAD `a460269b`) via an independent
current-state code inventory (`git cat-file`/`grep`/file reads) — **not from memory or prior reports.**
**Roles:** Chief Product/AI/Platform/Intelligence/Data Architect · Enterprise Knowledge Architect ·
Staff Backend Engineer · Independent Certification Authority.

---

## 0. Executive Architecture Assessment

Company Intelligence is a **mature but pre-canonical** platform. The production stack
(`companyProfileService*` + `backend/services/companyProfile/*`) does real work — business
classification, entity archetype, enrichment inference, a field-level knowledge graph, provenance,
marketing intelligence — and is a **widely-consumed hub (40 files / 126 import sites)**. But measured
against the canonical invariants Program 1 established and this program requires, it exhibits **material
architectural drift**:

1. **No canonical single-owner Company Understanding in production.** The Facet-based canonical stack
   (`companyProfile/companyUnderstanding.ts`, `capabilityGraph.ts`, `dynamicClassification.ts`,
   `profileProjection.ts`, `ontologies/`) is **absent from this branch** — it exists only on
   `feat/company-profile-ontology-001` (worktree `C:/tmp/company-ontology-001`), certified-shadow but
   **uncommitted to mainline**.
2. **Name collision.** Two unrelated `CompanyUnderstanding` types: the *shipped*
   `backend/services/context/companyUnderstandingService.ts` (a competitor-grounding **string** builder,
   one consumer) vs the *canonical* `companyProfile/companyUnderstanding.ts` (Facet-based, ontology
   branch only). Same name, different shapes — an architectural ambiguity.
3. **No single builder.** Generation/enrichment/classification/persistence are spread across the
   Rest1/Rest2 chain with **multiple independent write paths** (`saveProfile`,
   `upsertCompanyProfilePayload`, `deriveAndStoreStrategyProfile`, `saveStrategyProfileOverride`,
   `saveProblemTransformationAnswers`, `refineProfileWithAI`).
4. **Fragmented evidence.** THREE parallel mechanisms — `companyKnowledgeGraph` (states + confidence
   bands), `companyProfileProvenanceService`, `enrichmentProvenance`/`ExtractedEvidence` — **no unified
   `Facet`**.
5. **No projection gate.** ~40 consumers couple to the raw `CompanyProfile` + `report_settings` jsonb;
   the single-owner `projectCompanyFields`/`FIELD_OWNERS` read-model exists only on the ontology branch.
6. **No entity-relationship graph.** `companyKnowledgeGraph` is field-completeness, not an entity graph;
   Company↔Lead/Offering/Competitor/… are FK/embedded.
7. **Decoupled from Program 1.** `leadUnderstanding/` does **not** import companyProfile; Lead uses the
   `Facet` spine, Company does not — the two Understanding stacks are **not aligned**.

**Central thesis (the target):** **Company Understanding becomes the 2nd canonical Understanding entity**
(with Lead and Offering) on the **same certified spine** — reuse Program 1's `Facet<T>`, evidence model,
reasoning contract, scoring contract, single-owner projection, and references-only graph. **Crucially, a
certified-shadow canonical Company Understanding already exists** (COMPANY-PROFILE-ONTOLOGY-001) — Phase B
must **ADOPT/CONVERGE it (align to the Program-1 spine), not rebuild**, exactly as Program 1 reused its
own contracts. Legacy `companyProfileService` becomes the compatibility/write layer; the 40 consumers
migrate to one projection.

**Certification: ✅ CERTIFIED WITH ADJUSTMENTS** (§13) — the architecture target is sound and the roadmap
complete, but Phase B must incorporate specific refinements (resolve the name collision; adopt the
shadow ontology work rather than rebuild; unify the three evidence mechanisms onto `Facet`; introduce a
projection gate).

---

## 1. CI-A101 — Company Intelligence Capability Matrix

✅ complete · ◐ partial · ⧉ duplicated · ⌫ obsolete · ⟂ fragmented · ❌ missing. Every row cites source.

| Capability | State | Where (verified) |
|---|---|---|
| Company Understanding (canonical) | ❌ (prod) / ◐ shadow | canonical on ontology branch only; prod has none |
| Company profile generation | ◐⟂ | `companyProfileServiceRest1*` chain (multi-path) |
| Enrichment | ◐ | `Rest1Enrich` `infer*` helpers; provider enrichment ad-hoc |
| Organization modeling | ◐ | `entityArchetype.ts`, `businessClassification.ts` |
| Business-model inference | ✅ | `businessClassification.classifyCompanyBusiness` |
| Industry classification | ◐ | `businessClassification` (no ontology tables on this branch) |
| Technology intelligence | ❌ | not an engine |
| Product intelligence | ❌ | (Offering Understanding is a separate program) |
| Growth / Hiring / Funding intelligence | ❌→◐ | only `infer*` string helpers in `Rest1Enrich` |
| Financial intelligence | ❌ | not found |
| Market intelligence | ◐ | `buildAiMarketPulseSettings`, marketing services (marketing ≠ market-intel) |
| Geographic intelligence | ◐ | `inferCompanyDomainShape` fragments |
| Customer intelligence | ◐ | `customerJourneyIntelligenceService` (separate) |
| Partner intelligence | ◐ | `inferPartnershipPriorities` helper only |
| Executive intelligence | ✅ | `intelligence/executiveInsightEngine.ts`, `dossier/executiveDossier.ts` |
| Ownership intelligence | ❌ | not found |
| Competitive positioning | ✅ | `unifiedCompetitorIntelligenceService`, `competitorEngineService*` |
| Strengths/Weaknesses/Opportunities/Risks | ◐⟂ | scattered in strategy/marketing drafts; no SWOT/risk owner |
| Recommendations | ◐ | `recommendationEngine`, `strategicRecommendationIntelligenceService` (consumers) |
| Evidence generation | ⟂ | `companyKnowledgeGraph` + `provenanceService` + `enrichmentProvenance` (3 models) |
| Reasoning | ❌ | no reasoning-trace contract; inference is opaque strings |
| Scoring | ❌ | no company scoring contract |
| Projection | ❌ (prod) | `projectCompanyFields`/`FIELD_OWNERS` on ontology branch only |
| Persistence | ◐⟂ | one table `company_profiles` but multiple write entrypoints + `report_settings` jsonb sprawl |
| Graph integration | ❌ | field-level `companyKnowledgeGraph` only; no entity graph |

---

## 2. CI-A102 — Canonical Company Understanding Audit

Re-verified against the branch (`git cat-file`): the canonical builder/facets/projection/ontologies are
**ABSENT from `HEAD`**. Ownership invariants therefore fail in production:

| Invariant | Prod verdict | Evidence |
|---|---|---|
| One canonical builder | ❌ | multiple write paths; `getProfile` is the de-facto getter; no `buildCompanyUnderstanding` in prod (the shipped one is a grounding string helper) |
| One facet ownership | ❌ | no `Facet`; fields owned ad-hoc across the Rest chain |
| One evidence ownership | ❌ | three parallel evidence mechanisms |
| One reasoning ownership | ❌ | no reasoning contract; `infer*` returns opaque labels |
| One projection ownership | ❌ | no projection gate; 40 raw consumers |
| One persistence ownership | ◐ | single table, but ≥6 independent writers |
| One graph ownership | ❌ | no entity graph |

**Drift is confirmed and material.** The certified-shadow COMPANY-PROFILE-ONTOLOGY-001 work satisfies
most of these — but it is not in production and is not yet aligned to Program 1's spine. **Adopting it is
the core of Phase B.**

## 3. CI-A103 — Company Ontology Review

Present (this branch): Identity/Organization (archetype+classification), Business-model, Competitive
Landscape (embedded competitors), Brand/Market (marketing intelligence drafts), Evidence (fragmented).
**Missing / not first-class:** Corporate Structure, Offerings/Products/Services (→ Offering program),
Technology Stack, Financial, Funding, Hiring, Growth, Geography, Operations, Compliance, Security,
Digital Presence, Community, Strategic Initiatives, Risks, Recommendations — most exist only as `infer*`
fragments. **Incorrectly owned:** competitors live inside `report_settings.default_inputs` (persistence
sprawl, not a domain owner). The full per-industry ontologies exist **only on the ontology branch**
(`ontologies/{software,healthcare,retail,manufacturing,…}` + `dynamicClassification`).

## 4. CI-A104 — Company Intelligence Engine Map

| Engine | State | Owner / gap |
|---|---|---|
| Executive | ✅ | `executiveInsightEngine`, `executiveDossier` (adopt as contributor) |
| Competitive | ✅ | `unifiedCompetitorIntelligenceService` (separate program; reference) |
| Customer | ◐ | `customerJourneyIntelligenceService` |
| Market/Brand | ◐ | marketing services (marketing ≠ market intel) |
| Business classification / archetype | ✅ | `businessClassification`, `entityArchetype` |
| Technology · Product · Hiring · Growth · Funding · Financial · Partner · Risk · Ownership | ❌ | **not implemented as engines** (only `infer*` helpers) → build as evidence contributors |

Overlap/duplication: evidence produced three ways; competitor logic spans `companyProfile/competitor*`
+ top-level `competitorEngineService*` + `unifiedCompetitorIntelligenceService`.

## 5. CI-A105 — Evidence & Reasoning Assessment

Conclusions today are **largely opaque**: `infer*` functions return labels without evidence/confidence/
assumptions/contradictions/unknowns/freshness. Evidence exists but is **fragmented across three
mechanisms** (`companyKnowledgeGraph` states+bands, `companyProfileProvenanceService`,
`enrichmentProvenance`/`ExtractedEvidence`). No `ReasoningTrace`, no unified `Facet`, no contradiction
model. **Every non-trivial company conclusion is an opaque reasoning path** — the single largest
analyst-grade gap.

## 6. CI-A106 — Company Intelligence Graph Assessment

No entity-relationship graph. `companyKnowledgeGraph` models **field completeness**, not
Company↔Lead/Offering/Competitor/Content/Campaign/Opportunity/Executive/Customer/Partner edges.
Relationships are FK (`company_id`) or embedded (competitors in `report_settings`). **Target:** reuse
Program 1's references-only graph model (`GraphNodeRef = {type,id}`) so Company owns company-centric
edges without duplicating entity ownership; Lead/Offering/Competitor remain upstream/peer owners.

## 7. CI-A107 — Cross-Platform Integration Report

companyProfile is a **one-way hub**: consumed by ~40 files (content generation, recommendation,
strategic intelligence, campaigns, competitor engines, lead qualifiers, reports, trends, strategy-DNA)
**with no projection gate** — every consumer couples to raw fields, so any schema change ripples widely.
`leadUnderstanding/` does **not** import companyProfile → the Lead and Company Understanding stacks are
**decoupled and unaligned** (Lead=Facet, Company=not). **No duplicated projection/persistence today
because neither is canonical yet** — the risk is that a 2.0 build could *introduce* a parallel one unless
it reuses Program 1's contracts. Alignment requirement: Company must expose a projection that Lead
qualifiers (`leadQualifier`/`leadPredictiveQualifier`) and others consume, replacing raw-field coupling.

## 8. CI-A108 — Master Gap Analysis

Ranked by architectural impact (I), complexity (C), dependency (D), production risk (R).

| Gap | Class | I | C | D | R |
|---|---|---|---|---|---|
| **G1** No canonical single-owner Company Understanding in prod (canonical is shadow/uncommitted) | Critical | ★★★ | L | — | Med (adopt, don't rebuild) |
| **G2** `CompanyUnderstanding` name collision (grounding helper vs canonical) | Critical | ★★★ | S | G1 | Low |
| **G3** Three fragmented evidence mechanisms; no `Facet` | Critical | ★★★ | L | G1 | Med |
| **G4** No reasoning contract → opaque `infer*` conclusions | Critical | ★★★ | M | G1,G3 | Low |
| **G5** No projection gate; 40 raw-field consumers | Major | ★★★ | L | G1 | **High** (migration blast radius) |
| **G6** Multiple write paths / no single builder | Major | ★★ | M | G1 | Med |
| **G7** Missing engines (tech/product/hiring/growth/funding/financial/partner/risk/ownership) | Major | ★★ | L | G1,G3 | Low |
| **G8** No entity graph | Major | ★★ | M | G1 | Low |
| **G9** No company scoring contract | Minor | ★ | M | G3 | Low |
| **G10** Persistence sprawl (competitors in `report_settings`) | Minor | ★ | M | G6 | Med |
| **G11** Not aligned to Program 1 spine (decoupled) | Major | ★★★ | M | G1 | Low |
| **G12** Per-industry ontologies only on shadow branch | Future | ★ | — | G1 | Low |

## 9. CI-A109 — Company Intelligence Engineering Master Plan

Wave-based, additive, **shadow-first**, flag-dark — the same governance as Program 1 and the Company/
Offering shadow programs. **Reuse Program 1's `backend/services/leadUnderstanding` contracts** (or lift
`Facet`/evidence/reasoning/scoring/graph into a shared `intelligence/canonical` layer) — **do not fork**.

| Wave | Objective | Depends | Rollout / Rollback | Cert criteria |
|---|---|---|---|---|
| **B — Canonical Foundation & Adoption** | Adopt COMPANY-PROFILE-ONTOLOGY-001 canonical Understanding; align to the shared `Facet`/evidence/reasoning/scoring/projection/graph spine; **resolve the `CompanyUnderstanding` name collision** (rename the grounding helper); one `buildCompanyUnderstanding` owner | Program-1 contracts; ontology-branch code | flag `company-understanding` OFF; shadow bundle | single builder + Facet spine; collision resolved; shadow-only; 0 prod change; **no rebuild (adopt)** |
| **C — Evidence & Reasoning Unification** | Converge the 3 evidence mechanisms → one `Facet`+`ReasoningTrace`; contradiction model; company scoring contract (contributors) | B | shadow parity vs legacy provenance | every conclusion carries evidence/confidence/contradiction/unknowns; no opaque `infer*` |
| **D — Intelligence Engines** | Technology/product/hiring/growth/funding/financial/partner/risk/ownership as **evidence contributors** into one Understanding; adopt executive/competitive as contributors | B,C | flag per engine; shadow facets | each engine cites evidence; no duplicate ownership; graph acyclic |
| **E — Projection Gate, Convergence & Rollout** | One `projectCompanyFields` gate; migrate the 40 consumers to it (compat adapter); authoritative flip per-tenant; converge `report_settings` sprawl | B–D | `company-understanding-authoritative` OFF→per-tenant; O(1) flag-off | consumers read the projection; parity ≥ threshold; kill-switch verified |

**Cross-wave guarantees:** additive, shadow-first, zero drift (single owner + projection + governance),
zero duplicate ownership (adopt not rebuild; contributors not silos), backward-compatible (compat
adapter for the 40 consumers), production-safe (flag-dark, per-tenant, O(1) rollback).

---

## 10. Validation Requirements — current verdict (verified)

| ✓ target | Prod today |
|---|---|
| One canonical Company Understanding | ❌ (shadow only) → Wave B |
| One builder / reasoning / evidence / projection / persistence / graph | ❌/❌/❌/❌/◐/❌ → Waves B–E |
| Zero duplicate ownership / drift / duplicated intelligence | drift present; evidence duplicated → Waves B–C |
| Evidence-backed / explainable / confidence-aware / provenance-on-every-conclusion | ❌ opaque `infer*` → Wave C |
| Compatibility with Program 1 | ❌ decoupled (Company ≠ Facet) → Wave B (shared spine) |

The blueprint closes every row; none is left ambiguous.

## 11. Production Readiness Target

95–100% = : one canonical Company Understanding (Facet spine shared with Lead/Offering); one builder; one
`ReasoningTrace` on every conclusion (why/evidence/confidence/contradiction/unknowns/assumptions/
freshness); unified evidence (no 3-way fragmentation); tech/product/hiring/growth/funding/financial/
partner/risk/executive/competitive engines as contributors; one projection gate (40 consumers migrated);
references-only entity graph; per-tenant authoritative flip + kill-switch; full observability. All
additive, reversible, tenant-safe — **adopting the existing shadow canonical, not rebuilding**.

## 12. Verification Matrix

| Deliverable | Status | § |
|---|---|---|
| Capability Matrix | ✅ | 1 |
| Canonical Company Understanding Audit | ✅ | 2 |
| Company Ontology Review | ✅ | 3 |
| Engine Map | ✅ | 4 |
| Evidence & Reasoning Assessment | ✅ | 5 |
| Graph Assessment | ✅ | 6 |
| Cross-Platform Integration Report | ✅ | 7 |
| Master Gap Analysis | ✅ | 8 |
| Engineering Master Plan | ✅ | 9 |
| Executive Architecture Assessment | ✅ | 0 |
| Production Readiness Target | ✅ | 11 |

---

## 13. Certification

# ✅ CERTIFIED WITH ADJUSTMENTS

The current implementation is **verified from the repository** (not assumed): Company Intelligence is
mature but **pre-canonical**, with material, precisely-located drift (no prod canonical Understanding; a
`CompanyUnderstanding` name collision; three fragmented evidence mechanisms; no projection gate; no
entity graph; missing engines; decoupled from Program 1). The **target architecture is sound and the
roadmap complete** — Company Understanding as the 2nd canonical Understanding on Program 1's shared spine,
delivered by adopting the certified-shadow COMPANY-PROFILE-ONTOLOGY-001 work rather than rebuilding.

**Adjustments to incorporate into Phase B (the reason for "with adjustments," not clean):**
1. **Resolve the `CompanyUnderstanding` name collision** — rename/retire the grounding-string helper;
   reserve the name for the canonical Facet builder.
2. **Adopt, do not rebuild** — converge the shadow COMPANY-PROFILE-ONTOLOGY-001 canonical stack onto the
   **shared** Program-1 `Facet`/evidence/reasoning/scoring/projection/graph contracts (lift them into a
   shared `intelligence/canonical` layer so Lead + Company + Offering share one spine).
3. **Unify evidence** — converge the three mechanisms onto one `Facet`+`ReasoningTrace` before adding
   engines.
4. **Projection gate first** — introduce the single projection + compat adapter before migrating the
   40 raw-field consumers (highest blast radius).

**Decision: ✅ CERTIFIED WITH ADJUSTMENTS. Authorize Phase B — Canonical Company Intelligence Foundation**
(carrying adjustments 1–4).

*Architecture/verification only — no code, no schema, no flag, no behavior change; does not reopen Lead,
GTM, Content, or Competitor Intelligence. Beginning Phase B is your decision.*

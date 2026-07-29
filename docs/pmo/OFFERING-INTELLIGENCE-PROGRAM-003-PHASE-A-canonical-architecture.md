# OFFERING-INTELLIGENCE-PROGRAM-003 — Phase A

## Canonical Offering Intelligence Platform — Architecture, Ontology & Reuse Validation

**Type:** Architecture + repository audit (design only — no code). **Verified 2026-07-28** against the
repository on branch `feat/lead-understanding-foundation` (HEAD `1df1e306`) via an independent code
inventory — **not from memory.**
**Roles:** Chief Product/AI/Platform/Intelligence/Data Architect · Enterprise Knowledge Architect ·
Staff Backend Engineer · Repository Auditor · Independent Certification Authority.
**Question audited:** can Offering become the **third** canonical Understanding entity entirely on the
existing Product-Intelligence spine, with **no new foundational abstractions**?

---

## 0. Executive Architecture Assessment (OI-A111)

**Answer: YES — the existing platform is sufficient.** The falsification audit (§9) could **not** find a
single foundational contract Offering requires that Programs 1 & 2 do not already provide. Offering
Understanding is expressible entirely through **additive domain semantics** — new facet domains, new
score dimensions, new evidence-contributor engines, and a small non-breaking graph-node widening — on
the **shared** `intelligence/canonical` spine that Lead and Company already prove entity-agnostic.

Verified current state:
- **No canonical Offering Understanding exists on this branch** (production or shadow). Today Offering is
  a **sub-facet of Company** (`companyIntelligence/engines/product.ts` emits an `offerings` facet) — never
  an independently-owned entity.
- A certified-shadow Offering design exists only as **uncommitted worktree state** (`C:/tmp/company-
  ontology-001`, branch `feat/company-profile-ontology-001`): `offering/{discovery,resolution,projection,
  types,category/resolver,capabilityAssignment/assigner,ontology/*}` — evidence-first, abstain-null,
  deterministic, shadow-only — **but it re-declares its own trivial `Facet<T>` (`evidence: string[]`)**
  instead of importing the shared canonical one.
- The shared spine (`intelligence/canonical`) exports Facet / EvidenceRef / ReasoningTrace /
  ContradictionRef / GraphNodeRef / dimension-generic scoring / fusion / explain; `companyIntelligence`
  proves an entity consumes it end-to-end (engines → scoring → projection → graph → shadow).

**Central thesis:** Offering = the 3rd canonical Understanding on the shared spine — **adopt-and-align**
the certified-shadow OFFERING-UNDERSTANDING-001 domain design onto the shared contracts (reconcile its
bespoke Facet), exactly as Company Phase B adopted the ontology work. **No rebuild, no fork.**

**Certification: ✅ CERTIFIED WITH ADJUSTMENTS** (§9/§12) — the platform is sufficient and the
architecture sound; Phase B must carry three adjustments (adopt-and-align the shadow Offering onto the
shared Facet; additive graph-node/edge widening; resolve the Company-`offerings`-facet vs Offering-entity
boundary so it references, not duplicates).

---

## 1. OI-A101 — Capability Matrix

✅ implemented · ◐ partial · ⟂ fragmented · ⌫ obsolete · ❌ missing. Cited.

| Capability | State | Where (verified) |
|---|---|---|
| Offering as an independent entity | ❌ | none — it's a Company sub-facet |
| Products / services model | ◐ | `companyIntelligence/engines/product.ts` → `offerings` facet (company-scoped) |
| Pricing / packaging / plans / SKUs / subscriptions | ❌ | no commercial catalog model on this branch (only content/campaign vocabulary) |
| Proposals / quoting | ❌ | not found |
| Offering category / classification | ◐ shadow | `offering/category/resolver.ts` (worktree only) |
| Capabilities / features | ◐ shadow | `offering/capabilityAssignment/assigner.ts` (worktree only) |
| Offering discovery / resolution / projection | ◐ shadow | `offering/{discovery,resolution,projection}.ts` (worktree, own Facet) |
| Differentiation / positioning / value-prop / outcomes | ◐ | inside Company product/marketPosition facets |
| Adoption / usage / lifecycle / roadmap / integration / compliance intel | ❌ | not implemented |
| GTM module | ❌ | no `backend/services/gtm/` exists |

**Conclusion:** Offering is nascent — a company sub-facet + an uncommitted shadow design; **no owned
Offering entity, no commercial catalog, no offering-specific engines.**

## 2. OI-A102 — Offering Understanding Audit

On this branch: **absent** (`git ls-files backend/services/offering/` empty; grep for
`OfferingUnderstanding`/`projectOffering`/`discoverOfferings` → none). On the worktree: an
`OfferingUnderstanding` (identity + `offering_type: product|service|bundle` + `category: Facet<string|null>`
+ `capabilities: Facet<string[]>` + provenance) with `projectOffering`/`discoverOfferings` — **spine-
compatible in shape** but on a **local trivial Facet** (`{value, confidence, evidence: string[]}`), which
diverges from the shared `Facet<T>` (`value:T|null, confidence, evidence:EvidenceRef[], provenance, asOf,
contradictions, unknowns, assumptions`). **Ownership/duplication risk:** Company already owns an
`offerings` facet; the Offering entity must be the single owner of offering semantics and Company must
**reference** it (boundary adjustment §9).

## 3. OI-A103 — Canonical Offering Ontology

Offering facet domains (all `Facet<T>` on the shared spine; abstain when unevidenced):

**Core:** identity (canonical_id/name/aliases), offering_type (product|service|bundle, extensible),
category, positioning, valueProposition, customerProblems, outcomes, differentiators.
**Commercial:** pricing, packaging, plans, features, usage, adoption, lifecycle, roadmap.
**Fit:** industries, personas, icpAlignment, strategicFit, marketFit.
**Technical:** deployment, integrations, compliance, maturity, support, ecosystem.
**Meta:** evidenceSummary, recommendations.

Ownership: **Offering Understanding is the sole owner** of these; `capabilities` references the shared
Capability layer; `industries/personas/icpAlignment` reference Company/Lead nodes (no duplication).

## 4. OI-A104 — Intelligence Capability Map

| Engine | State | Note |
|---|---|---|
| Feature / Pricing / Packaging / Differentiation / Positioning | ❌ missing | build as contributors (Phase C) |
| Market-Fit / ICP-Alignment | ❌ | reference Company/Lead ICP evidence |
| Adoption / Usage / Lifecycle / Roadmap | ❌ | build as contributors |
| Integration / Compliance | ❌ | build as contributors |
| Competitive Mapping | ◐ | reuse Competitor Intelligence via graph references (no re-ownership) |
| Category resolution / Capability assignment | ◐ shadow | adopt from worktree, align to shared spine |

All are **evidence contributors** into one Offering builder — none owns the score/projection/graph.

## 5. OI-A105 — Evidence & Reasoning Audit

Today: offering knowledge is produced **rule-based/deterministic** inside Company's product engine + the
worktree's deterministic resolvers (exact-match category/capability, no AI/fuzzy). The worktree carries
evidence (`string[]`) + confidence + provenance but **not** the shared `EvidenceRef`/`ReasoningTrace`/
contradiction/unknowns model. **Migratable? YES** — swap `evidence: string[]` → `EvidenceRef[]`, wrap
conclusions in `ReasoningTrace`, adopt `Facet<T>` + contradiction detection from the shared spine. No
opaque AI to untangle (it's deterministic).

## 6. OI-A106 — Offering Graph Architecture

Offering-centric edges (references only; `GraphNodeRef = {type,id}`): Offering→Company (`belongs_to`),
Offering→Feature (`references`/new `has_feature`), Offering→PricingPlan (`references`/new `priced_as`),
Offering→Persona (`targets`/new `serves_persona`), Offering→Industry, Offering→Integration,
Offering→Competitor (`competes_with`), Offering→Lead (`converted_from` via opportunities), Offering→Market.

**`GraphNodeType` today** has `offering`, `product`, `market`; **needs additive widening**: `feature`,
`pricing_plan`, `persona`, `industry`, `integration`. **`GraphEdgeType`** may add `has_feature`,
`priced_as`, `serves_persona` (or reuse generic `references`/`belongs_to`/`targets`). **Non-breaking union
widening** — precedented in Program 2; **not** a new foundational primitive.

## 7. OI-A107 — Cross-Platform Integration Report

| Platform | Relationship | Ownership |
|---|---|---|
| Company | **upstream** — Offering seeds from company offering evidence (`discoverOfferings(companyUnderstanding)`); Company's `offerings` facet **references** the Offering entity | Offering owns offering semantics; Company references |
| Lead | Lead's opportunity/intent references offerings (which offering a lead engages) | reference only |
| Competitor | Offering→Competitor via graph references (Competitor owns competitor nodes) | reference only |
| Content / GTM | consume the Offering **projection** (a later adoption phase) | reference only |
| Capability layer | Offering `capabilities` reference the shared Capability graph | shared |

**No duplicate ownership** provided the Company-`offerings`-facet-vs-Offering-entity boundary is resolved
(§9 adjustment): Company references the canonical Offering rather than re-deriving it.

## 8. OI-A108 — Gap Analysis

| Gap | Class | Note |
|---|---|---|
| **G1** No canonical Offering Understanding in prod (only uncommitted worktree) | Critical | adopt-and-align onto shared spine (Phase B) |
| **G2** Worktree Offering forks `Facet<T>` (own trivial version) | Critical | reconcile to shared Facet/EvidenceRef (Phase B) |
| **G3** Offering owned as a Company sub-facet (boundary/duplication) | Major | Company references the Offering entity (Phase B/D) |
| **G4** `GraphNodeType`/`GraphEdgeType` lack offering nodes/edges | Minor | additive union widening (Phase B) |
| **G5** No offering-specific engines (feature/pricing/adoption/…) | Major | build as contributors (Phase C) |
| **G6** No commercial catalog model (pricing/plans/SKUs) | Major | new offering facets (domain semantics) |
| **G7** No offering scoring dimensions | Minor | define offering dims (adoption/fit/differentiation/maturity) — additive |
| **G8** No offering projection/persistence/shadow/consumer-adoption | Major | mirror Company (Phase B/D) |

**Zero gaps require a new foundational abstraction** — all are domain semantics or additive extensions.

## 9. OI-A109 — Platform Reuse Assessment (the key audit — falsification attempted)

**Attempt to falsify:** does Offering require any NEW foundational contract? Verified against the shared
spine:

| Candidate new abstraction | Needed? | Why the platform suffices |
|---|---|---|
| New canonical contracts (Facet/Evidence/Reasoning/Contradiction) | ❌ NO | shared `Facet<T>`/`EvidenceRef`/`ReasoningTrace`/`ContradictionRef` express every offering facet (the worktree's own Facet is a *divergence to reconcile*, not a needed new type) |
| New builder abstraction | ❌ NO | mirror `buildCompanyUnderstanding` (one builder assembling facets + score + contradictions) |
| New evidence contract | ❌ NO | `EvidenceRef` + fusion cover offering evidence |
| New graph primitive | ❌ NO | `GraphNodeRef`/`GraphEdge` cover it; only additive **member** widening (not a new primitive) |
| New projection model | ❌ NO | mirror `projectCompany` (single-owner derived reshape) |
| New reasoning contract | ❌ NO | shared `ReasoningTrace` + `validateReasoning` |
| New scoring contract | ❌ NO | dimension-generic `combineScoresFor<OfferingDim>` — Offering just supplies its dimension set |

**Falsification FAILS — no new foundational abstraction is required.** The preferred outcome holds. The
only additive needs are **domain semantics** (offering facets, score dimensions, engines) and a
**non-breaking union widening** of `GraphNodeType`/`GraphEdgeType` — both precedented (Company added 6
node types in Program 2 with zero regression).

**Adjustments (why "with adjustments," carried to Phase B):**
- **A-OI-1 Adopt-and-align:** adopt the certified-shadow OFFERING-UNDERSTANDING-001 domain design
  (discovery→resolution→understanding→projection, category resolver, capability assigner, offering_type)
  but **reconcile its bespoke `Facet<T>`** (`evidence: string[]`) onto the shared `Facet`/`EvidenceRef` —
  no fork.
- **A-OI-2 Graph widening:** additively add offering node/edge types.
- **A-OI-3 Boundary:** make the Offering entity the sole owner of offering semantics; Company's
  `offerings` facet **references** it (no duplicate ownership).

## 10. OI-A110 — Engineering Roadmap

| Phase | Objective | Depends | Cert criteria |
|---|---|---|---|
| **B — Foundation & Adoption** | Offering Understanding on the shared spine (reuse Facet/Evidence/Reasoning/scoring/projection/graph); adopt-and-align the shadow Offering design; additive graph widening; `offering_type` + core facets; one builder + projection + shadow + persistence + flags | Programs 1&2 spine | one builder/Facet/projection; shadow-only; **no new foundational abstraction**; graph widening non-breaking; Programs 1&2 unchanged |
| **C — Analyst-Grade Pipeline** | Feature/pricing/packaging/differentiation/positioning/market-fit/ICP/adoption/usage/lifecycle/roadmap/integration/compliance engines + category/capability (adopted) + cross-engine reasoning + assembly (sole owner) + shadow validation | B | every engine a contributor; no engine owns Understanding; grounded; deterministic |
| **D — Completion & Adoption** | Advanced enrichment + fusion (reuse) + explainability (reuse) + consumer adoption seam (Company/GTM/Content read the Offering projection) + authoritative readiness + resolve the Company-offerings boundary | B,C | one projection consumed; parity; rollback preserved; boundary resolved |
| **Final — Production Certification** | Independent re-audit (like Programs 1&2) | B–D | all invariants hold in-code; permanent platform |

All additive, shadow-first, flag-dark, zero drift, backward-compatible — the Company cadence.

## 11. Validation Requirements — verdict

| ✓ | Verdict |
|---|---|
| Offering can reuse shared canonical contracts | ✅ (§9) |
| No new foundational abstractions required | ✅ — only additive domain semantics + non-breaking graph widening |
| No duplicate builders/evidence/reasoning/projections/persistence | ✅ target (Phase B adopt-and-align; the worktree's forked Facet is reconciled, not shipped) |
| No duplicate graph ownership | ✅ target (A-OI-3 boundary) |
| Compatibility with Programs 1 & 2 | ✅ shared spine; graph widening non-breaking |
| Future engines become contributors, not owners | ✅ (Company pattern) |

The only "invariant currently unmet" is that the **uncommitted worktree Offering forks `Facet`** — but
that is the *seed to adopt-and-align*, not a platform insufficiency; the shared spine fully supports
Offering. Precisely: **the platform does not require a new abstraction; the existing shadow seed has
simply not yet adopted the shared one.**

---

## 12. Certification

# ✅ CERTIFIED WITH ADJUSTMENTS

The repository is fully audited (verified in-code, not assumed). The canonical Offering architecture is
defined as the **third Understanding entity on the shared spine**, and the **falsification audit
confirms the existing Product-Intelligence Platform is sufficient — no new foundational abstractions are
required** (only additive domain semantics + a non-breaking graph-node widening). The roadmap (B→D→Final)
mirrors the certified Company cadence.

**Adjustments carried into Phase B:** A-OI-1 (adopt-and-align the certified-shadow Offering design onto
the shared `Facet`/`EvidenceRef`, reconciling its forked Facet — no rebuild), A-OI-2 (additive
`GraphNodeType`/`GraphEdgeType` widening), A-OI-3 (Offering is the sole owner of offering semantics;
Company's `offerings` facet references it).

**Decision: ✅ CERTIFIED WITH ADJUSTMENTS. Authorize Phase B — Canonical Offering Foundation, Adoption &
Convergence** (carrying A-OI-1..3).

*Architecture/audit only — no code, no schema, no flag, no behaviour change; does not modify Programs 1
or 2 or introduce new canonical contracts. Beginning Phase B is your decision.*

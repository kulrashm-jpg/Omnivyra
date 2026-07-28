# COMPANY-INTELLIGENCE-PROGRAM-002 — Phase B

## Canonical Company Foundation, Adoption & Convergence — Certification

**Type:** Foundation implementation (adopt-not-rebuild; flag-dark, shadow-only, additive,
deterministic). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`, commit `d8cd60fc`.
**Authority:** Phase A (certified w/ adjustments); Program 1 (production-certified — defines the shared
spine). **Nature:** establishes the canonical Company runtime by adopting the certified ontology design
onto Program 1's shared contracts — no consumer migration, no engines, no production behaviour change.

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

The canonical Company foundation is established on the **shared** Product-Intelligence spine: one
`CompanyUnderstanding`, one builder, one Facet evidence model, one reasoning contract, one (shared,
dimension-generic) scoring contract, one projection, one graph model, one persistence contract, a shadow
runtime, and observability — **reusing Program 1's certified contracts, not forking them**, and
**adopting the certified COMPANY-PROFILE-ONTOLOGY-001 domain design rather than rebuilding it**. 100%
additive (Program 1 untouched; **53/53** tests incl. 44 Program-1 regression), both flags default OFF,
tsc-clean. Three genuine convergence adjustments remain (§9) — hence "with adjustments," not clean.

| Validation requirement | Verdict |
|---|---|
| Certified ontology adopted, not reimplemented | ✅ domain design adopted onto shared spine; ontology files remain reference |
| Exactly one CompanyUnderstanding | ✅ `companyIntelligence/types.ts` (canonical); see §CI-B202 for the name-collision adjustment |
| Exactly one canonical builder | ✅ `buildCompanyUnderstanding` (sole owner) |
| Program 1 contracts reused without drift | ✅ shared `intelligence/canonical` re-exports Facet/Evidence/Reasoning/Graph; Program 1 unmodified |
| One Facet / evidence / reasoning / projection / persistence / graph model | ✅ all from the shared spine + single company owners |
| One scoring contract | ⚠ **one algorithm**, but currently two implementations (shared generic + Lead's certified copy) — **Adjustment A1** |
| Zero duplicate ownership / evidence / reasoning systems | ✅ single owners; the 3 legacy evidence mechanisms are superseded by Facet (adoption bridge) |
| Shadow runtime operational | ✅ `computeCompanyUnderstandingShadow` (null when OFF), field-parity comparison |
| Existing production behaviour unchanged / rollback preserved | ✅ additive; flags OFF; nothing imports the runtime; O(1) flag-off |

---

## 1. CI-B201 — Canonical Branch Reconciliation Report

**Finding (verified):** the certified canonical Company work (COMPANY-PROFILE-ONTOLOGY-001) is
**uncommitted working-tree state** on the worktree `C:/tmp/company-ontology-001` (its branch's committed
HEAD is `3e941441` = main). Its files (`companyUnderstanding.ts`, `capabilityGraph.ts`,
`dynamicClassification.ts`, `profileProjection.ts`, `ontologies/`) use a **bespoke confidence band**
(`UnderstandingConfidence = low|medium|high`) — **not** Program 1's `Facet<T>` (0..1 + evidence).

**Reconciliation decision (no duplicate implementation):** adopting those files *verbatim* would fork
the contract model (two confidence systems), violating "one Facet model / reuse Program 1 / no drift".
Therefore this phase **adopts the ontology DOMAIN DESIGN** — single builder that *projects from the
AI-derived profile and never fabricates*, `FIELD_OWNERS`-style single-owner projection, `world_view`,
dynamic classification and capability-graph concepts, the `company-understanding[/-authoritative]` flag
keys — **expressed on the shared Program-1 contracts**. This also *resolves* the very evidence
fragmentation Phase A flagged (the ontology band + the 3 legacy mechanisms all converge to Facet). The
uncommitted worktree files remain the design reference and can be physically retired once this runtime
lands (no functionality is rebuilt that a certified equivalent already provides — the *design* is
reused; only its contract expression is upgraded to the shared spine).

## 2. CI-B202 — Canonical CompanyUnderstanding Runtime

`backend/services/companyIntelligence/` — `CompanyUnderstanding` with 23 facet domains + `worldView`,
built solely by `buildCompanyUnderstanding` (the one owner). `companyFromProfile` is the compatibility
bridge: the legacy `companyProfileService` output becomes an **evidence source**, not a second owner
(project-from-profile, abstain on absent fields). **Name-collision status:** the canonical type lives in
a distinct module (`companyIntelligence`), so there is no compile collision with the shipped
`context/companyUnderstandingService.ts` (a competitor-grounding string builder); the clarity rename of
that helper is **Adjustment A2** (a small, deferred follow-up — not edited here to keep Phase B additive).

## 3. CI-B203 — Shared Canonical Contract Adoption

`backend/services/intelligence/canonical/` is the shared import path. `contracts.ts` + `primitives.ts`
**re-export** Program 1's `Facet`, `EvidenceRef`, `SourceRef`, `ContradictionRef`, `ReasoningTrace`,
`GraphNodeRef`, `GraphEdge` + `facet`/`evidenceRef`/`reasoningTrace`/`detectEvidenceContradictions`/
`buildEntityGraph` — **single source, zero fork**, Program 1 unmodified. `scoring.ts` provides the
**dimension-generic** scoring (`ScoreContribution<D>`, `combineDimension<D>`, `combineScoresFor<D>`) —
the exact Program 1 blend algorithm, generalized so Company reuses it. (Program 1's `leadUnderstanding/
scoring.ts` is the certified specialization; re-pointing it to the generic is **Adjustment A1**.)

## 4. CI-B204 — Canonical Evidence Layer

The three legacy evidence mechanisms (`companyKnowledgeGraph` states/bands,
`companyProfileProvenanceService`, `enrichmentProvenance`/`ExtractedEvidence`) are **superseded by the
one Facet-based `EvidenceRef`** model (kinds, lifecycle, provenance, freshness, contradictions,
abstention). `companyFromProfile` produces canonical evidence from legacy fields; the legacy mechanisms
remain readable during adoption but are no longer the canonical evidence contract.

## 5. CI-B205 — Canonical Reasoning Runtime

The shared `ReasoningTrace` + `validateReasoning` are reused (conclusion/confidence/evidence/provenance/
assumptions/contradictions/unknowns/freshness; ungrounded conclusions rejected). Company reasoning
traces are produced by the builder/engines (engines are Phase C); Phase B wires the contract and proves
grounding.

## 6. CI-B206 — Canonical Company Projection

`projectCompany` is the **single projection owner** (adopts the `FIELD_OWNERS`/`projectCompanyFields`
design): a pure derived reshape of decided facet/score values (never recomputes). Versioned
(`COMPANY_MODEL_VERSION`), deterministic (`projectedAt` passed in). **Consumers are not migrated** (Phase
E) — the projection exists only.

## 7. CI-B207 — Canonical Persistence Layer

`toShadowRecord` (shadow record shape; stored at `report_settings.canonical_understanding` in a later
phase — continuous with the certified ontology location) + `toLegacyFields` compat adapter so the ~40
consumers can be served the legacy shape from the canonical understanding during adoption. Additive,
backward-compatible, rollback-preserved (nothing wired in Phase B).

## 8. CI-B208 — Company Intelligence Graph Foundation

`companyEdge`/`buildCompanyGraph` build company-owned edges to Lead/Offering/Competitor/Product/
Technology/Executive/Customer/Partner/Market/Campaign/Signal as **references only** (shared
`GraphNodeRef = {type,id}`) — one owner per relationship (the edge origin); no duplicate entity
ownership; self-loops rejected, deduped (reuses the shared graph builder).

## 9. CI-B209/B210 — Shadow Runtime + Observability

`computeCompanyUnderstandingShadow` returns null when `COMPANY_UNDERSTANDING_ENABLED` is unset
(default) — no work, no side effects. When ON it builds from a legacy profile and reports **field-parity**
(canonical projected fields vs the source profile). `summarizeCompanyRun` = pure observability (facets/
evidence/contradictions/scored-dimensions/graph/reasoning/shadow parity). No live telemetry emission
(keeps Phase B additive).

---

## 10. Adjustments (carry into Phase C entry)

- **A1 (scoring unification):** re-point Program 1's `leadUnderstanding/scoring.ts` to delegate to the
  shared `combineScoresFor` (behaviour-identical), in a dedicated change that re-runs Program 1's 44
  tests — collapsing the transient two-implementation duplication to one. (Kept separate to protect the
  production-certified Program 1.)
- **A2 (name-collision rename):** rename the shipped `context/companyUnderstandingService.ts` type/export
  (e.g. `CompetitorGroundingContext`/`buildCompetitorGrounding`) + its one consumer, reserving the
  `CompanyUnderstanding` name for the canonical runtime.
- **A3 (contract re-home, optional):** physically move the shared contracts into
  `intelligence/canonical` (they currently live in `leadUnderstanding` and are re-exported) — non-
  breaking; consumers of the barrel are unaffected.

None is a correctness defect; all are convergence hygiene.

---

## 11. Verification

- **Tests:** `companyUnderstanding.test.ts` (9) + Program-1 regression (44) = **53/53 green**,
  deterministic — covering shared-contract reuse, profile adoption + abstention, single builder +
  projection + determinism, references-only graph, persistence + compat, field-parity shadow (parity=1
  when projected from the profile), flag-gating, observability, flags-OFF.
- **Types:** new modules **tsc-clean** (0 errors) under `tsconfig.backend.json`.
- **Additivity:** `git diff` shows **no existing tracked file modified** — Program 1 byte-for-byte intact
  (its 44 tests pass unchanged).

---

## 12. Certification Statement

Company Intelligence now has a **canonical foundation on the same architectural spine as Lead
Intelligence**: one `CompanyUnderstanding`, one builder, unified Facet evidence, shared reasoning +
dimension-generic scoring, single projection, references-only graph, persistence + compat adapter, a
shadow runtime, and observability — the certified ontology **design adopted, not rebuilt**, and Program
1's contracts **reused, not forked**, with production behaviour unchanged and rollback preserved. Three
convergence adjustments (A1–A3) remain as hygiene before intelligence engines.

**Decision: ✅ CERTIFIED WITH ADJUSTMENTS. Authorize Phase C — Advanced Company Intelligence Engines**
(carrying A1–A3).

*Foundation only — flag-dark, shadow-only, additive; no engines, no consumer migration, no authoritative
mode, no deploy, no merge. Advancing to Phase C is your decision.*

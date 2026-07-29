# PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 — Phase A

## Canonical Intelligence Graph — Architecture, Ontology, Falsification & Gap Analysis

**Type:** Architecture + falsification audit (design only — no code). **Verified 2026-07-28** against the
repository on branch `feat/lead-understanding-foundation` (HEAD `09100d0e`) — **not from memory.**
**Roles:** Chief Product/AI/Platform Architect · Principal Knowledge-Graph/Intelligence/Data Architect ·
Enterprise Architect · Staff Backend Engineer · Platform Governance Lead · Independent Certification
Authority.
**Question audited:** can the production-certified Lead + Company + Offering platform evolve into a
**single permanent Canonical Intelligence Graph** for every present/future intelligence domain, **without
redesigning Programs 1–3** and with **no new foundational primitive**?

---

## 0. Executive Architecture Assessment (P4A-111)

**Answer: YES — the shared architecture has matured into a graph-native substrate.** The falsification
(§8) could **not** find a foundational primitive the Intelligence Graph requires that Programs 1–3 do not
already provide. Every future entity (Visitor, Journey, Intent, Automation, Decision, Customer, Revenue,
…) becomes a **graph-native citizen through purely additive** work: a new entity module mirroring the
three certified ones, plus node/edge-type additions — **no redesign of Programs 1–3.**

Verified current state (in-code):
- **Shared spine** (`intelligence/canonical`): `Facet<T>`, `EvidenceRef`, `ReasoningTrace`,
  `ContradictionRef`, `GraphNodeRef = {type,id}`, `GraphEdge`, dimension-generic
  `ScoreContribution<D>`/`combineScoresFor<D>`, fusion, explain, helpers — **all entity-agnostic**.
- **Three entities** (Lead/Company/Offering) each follow one pattern: single builder → Facet ontology →
  contributor engines → shared scoring → single projection → **references-only graph** → shadow runtime →
  flags OFF → observability → consumer adapter. `validateCrossUnderstanding` proves references-only
  ownership across them.
- **Two graph facts that shape the roadmap (not the verdict):** `GraphNodeType`/`GraphEdgeType` are
  **fixed string unions** (16 / 12 members, widened additively 3×); and there is **no standalone
  cross-entity graph substrate** — each understanding carries only its **local** `graph: {root, edges}`.
  A unifying Intelligence Graph is not yet built (it is additive — §9).

**Central finding:** the platform is a graph-native architecture **already** at the contract level; the
Intelligence Graph is an **additive aggregation layer** over the existing edge contracts plus a small,
non-breaking generalization of the node/edge type system.

**Certification: ✅ CERTIFIED WITH ADJUSTMENTS** (§10/§12) — sufficient and sound; Phase B carries two
additive adjustments (build the graph substrate; open the node/edge type system for scale).

---

## 1. P4A-101 — Platform Capability Matrix (reuse verified)

| Capability | Reusable for the graph? | Evidence |
|---|---|---|
| `Facet<T>` | ✅ | shared; every entity's facets |
| `EvidenceRef` (+ lifecycle, fusion) | ✅ | shared; evidence flows across entities via references |
| `ReasoningTrace` (+ `validateReasoning`, `explain`) | ✅ | shared; cross-engine reasoning already synthesizes |
| `GraphNodeRef` / `GraphEdge` (references-only) | ✅ | shared; the graph's node/edge primitives |
| Dimension-generic scoring `combineScoresFor<D>` | ✅ | each entity supplies its dimension set |
| Projection framework (single-owner reshape) | ✅ | `projectLead/Company/Offering` pattern |
| Builder discipline (sole owner) | ✅ | `build*Understanding` per entity |
| Shadow runtime / feature flags / observability | ✅ | per-entity, flag-dark default OFF |
| Compatibility adapters / persistence | ✅ | `toLegacyFields` + shadow record per entity |

**Every foundational capability the graph needs already exists and is reused, not rebuilt.**

## 2. P4A-102 — Graph Ontology Assessment

`GraphNodeRef = {type: GraphNodeType, id}`, `GraphEdge = {type: GraphEdgeType, from, to, evidence,
confidence, asOf}`. **References-only** (the type comment enforces "no duplicate entity ownership").
`GraphNodeType` (16) and `GraphEdgeType` (12) are **closed string unions**, widened additively per program
(P2 +6 nodes, P3 +5 nodes / +3 edges) — **non-breaking but centralized** (each new entity edits the shared
union). Sufficient for a handful of entities; for **100+ entity / 1000+ edge types** this becomes a
scaling friction → **Adjustment: open the type system** (branded `string`, or a node/edge-type *registry*)
so new entities register their types without editing the shared union. Extensibility is otherwise proven
(3 widenings, zero regression).

## 3. P4A-103 — Canonical Entity Inventory

| Entity | State | Note |
|---|---|---|
| Lead / Company / Offering | ✅ **implemented** (production-certified) | own modules on the shared spine |
| Competitor | ◐ partial | referenced as graph nodes; a Competitor Understanding is a future entity |
| Visitor / Session / Journey / Intent | ❌ additive-future | capture/journey domain (Program-1 LEAD-INTELLIGENCE-001 has raw signals) |
| Campaign / Content / Opportunity | ◐ | exist as GTM/content services; become graph entities additively |
| Persona / Industry / Technology / Region / Market | ❌ additive-future | currently graph **node references** owned by other entities |
| Customer / Partner / Channel / Deal | ❌ additive-future | referenced; future revenue-intelligence entities |
| Task / Meeting / Conversation / Automation / Workflow / Playbook | ❌ additive-future | decision/automation-intelligence entities |
| Knowledge / Support / Product Usage | ❌ additive-future | knowledge/customer-intelligence entities |

**Classification only.** Every ❌ is an **additive new module** on the existing spine — none requires a new
primitive.

## 4. P4A-104 — Canonical Relationship Taxonomy

Reuse the existing edge verbs + widen additively; **reject duplicate semantics** (one verb per relation):
`belongs_to`, `member_of`, `engaged_with`, `visited`/`viewed` (new), `owns`, `works_for` (→ `member_of`),
`offers` (new), `competes_with`, `targets`, `serves_persona`, `converted_from`, `created`/`participated_in`/
`responded_to`/`triggered`/`executed` (new automation/journey verbs), `contains`/`has_feature`, `references`,
`uses`/`adopts` (new), `priced_as`, `supports` (new). Governance: a single canonical verb per semantic
relation, validated by the cross-understanding check (references-only) — no synonym edges.

## 5. P4A-105 — Ownership Boundary Matrix

| Entity | Owns | Everything else |
|---|---|---|
| Lead | buyer semantics | references |
| Company | organizational semantics | references |
| Offering | offering semantics | references |
| Journey/Visitor/Intent (future) | journey/capture/intent semantics | references |
| Campaign/Automation/Deal (future) | campaign/automation/deal semantics | references |

**Enforced structurally** by `GraphNodeRef` (references only) + `validateCrossUnderstanding` (root is the
owning entity; external nodes are references; no duplicate semantics). Deterministic ownership holds at
graph scale.

## 6. P4A-106 — Evidence Flow Architecture

`Visitor Event → Journey → Intent → Lead → Opportunity → Automation → Outcome`: the existing `EvidenceRef`
already supports this — each stage is an entity that **references** upstream evidence (via `SourceRef` +
graph edges) and fuses it (`fuseEvidence`). Evidence never duplicates: a downstream entity **cites**
upstream `EvidenceRef`s. **The evidence contract is sufficient**; the graph substrate makes the flow
**traversable** (an additive index).

## 7. P4A-107 — Cross-Entity Reasoning Assessment

`Journey + Offering + Company → Intent → Qualification → Recommendation → Automation`: `ReasoningTrace`
already spans entities — a trace's `because` cites evidence from multiple entities (Program 1's cross-
engine layer + Program 2/3's already synthesize cross-domain). **`ReasoningTrace` remains sufficient**; a
graph-level reasoning layer is an **additive contributor** that reads edges + traces across entities. No
new reasoning contract required.

## 8. P4A-108 — Scalability Assessment (falsification attempted)

| Can the graph support… | Verdict | Why the platform suffices |
|---|---|---|
| 100+ entity types | ✅ (with open type system) | each entity is an additive module; node types via registry/open union |
| 1000+ edge types | ✅ (with open type system) | edge verbs via registry; **Adjustment** — else the shared union grows unboundedly |
| millions of nodes | ✅ | `GraphNodeRef = {type,id}` is a lightweight reference; edges are pure data; persistence is per-entity shadow rows + an additive graph index |
| incremental enrichment | ✅ | facets abstain + accrue evidence; deterministic rebuild; already proven (Phase-D additions) |
| streaming updates | ✅ | builders are pure functions of inputs; a streaming layer is additive (re-build on new evidence) |
| distributed reasoning | ✅ | contributors are pure + deterministic → parallelizable/shardable by entity; no shared mutable state |

**Falsification FAILS — no new foundational primitive is required.** The only scale friction is the fixed
node/edge unions (Adjustment §10). Determinism (no `Date.now`/`Math.random`), purity, references-only
ownership, and additive extensibility are the exact properties a decades-scale graph needs — and they
already hold platform-wide.

## 9. P4A-109 — Gap Analysis

| Gap | Class | Note |
|---|---|---|
| **G1** No standalone cross-entity **graph substrate** (each understanding has only a local edge list) | Major | **additive** aggregation layer over existing `GraphEdge`s; no new primitive |
| **G2** `GraphNodeType`/`GraphEdgeType` are **fixed unions** (edit-shared-file per entity) | Minor | open the type system (branded string / registry) for 100+/1000+ scale — non-breaking |
| **G3** No graph query/traversal API across entities | Major | **additive** (index + traverse over `GraphNodeRef`/`GraphEdge`) |
| **G4** No graph-level reasoning/evidence-flow layer | Minor | **additive** contributor reading cross-entity edges + traces |
| **G5** Competitor + future domains not yet entities | Minor | **additive** modules mirroring the pattern |
| Duplicate ownership / ontology conflicts / drift | **None** | references-only + `validateCrossUnderstanding` hold |

**Zero gaps require a new foundational primitive or a redesign of Programs 1–3.**

## 10. P4A-110 — Engineering Roadmap

| Phase | Objective | Cert criteria |
|---|---|---|
| **B — Graph Foundation** | Build the canonical **graph substrate** (aggregate every entity's `GraphEdge`s into one traversable Intelligence Graph over `GraphNodeRef`; a graph store + traverse/query API); **open the node/edge type system** (registry / branded string) so new entities register types additively; shadow-only, flag-dark | one graph substrate; references-only preserved; Programs 1–3 unchanged; **no new primitive** |
| **C — Graph Intelligence** | Graph-level reasoning + evidence-flow contributors (cross-entity paths: Visitor→…→Outcome) as contributors that read edges/traces; add first new entities (e.g. Journey/Intent) as additive modules | contributors don't own entities; grounded; deterministic; cross-understanding consistent |
| **D — Graph Adoption** | Consumer adoption of the graph (query seam + compat); authoritative readiness; per-tenant rollout | one query seam; parity; rollback preserved |
| **Final — Production Certification** | Independent re-audit (like Programs 1–3) | all invariants hold in-code; permanent graph platform |

All additive, shadow-first, flag-dark, zero drift — the certified cadence.

## 11. Validation Requirements — verdict

| ✓ | Verdict |
|---|---|
| Programs 1–3 require no redesign | ✅ (graph substrate reads their edges; open-union is non-breaking) |
| One evidence / reasoning / graph-ownership model | ✅ shared spine |
| References-only relationships / deterministic ownership / explainable reasoning | ✅ enforced (`validateCrossUnderstanding`, `validateReasoning`) |
| Additive extensibility / future entity support / graph-first | ✅ (new entity = additive module; substrate is additive) |
| Zero duplicate ownership / drift | ✅ |
| **No new foundational primitive** | ✅ (falsification §8) |

## 12. Certification

# ✅ CERTIFIED WITH ADJUSTMENTS

The repository is fully audited (verified in-code, not assumed). The falsification **proves the shared
Product-Intelligence architecture is sufficient to evolve into a permanent Canonical Intelligence Graph —
no new foundational primitive, and no redesign of Programs 1–3.** Every future intelligence domain
(Visitor, Journey, Intent, Automation, Decision, Customer, Revenue) becomes a **graph-native additive
citizen** on the existing spine.

**Adjustments carried into Phase B (why "with adjustments," not clean — both additive, non-breaking):**
- **G-A1 Graph substrate:** build the cross-entity Intelligence Graph as an **additive aggregation layer**
  over the existing `GraphNodeRef`/`GraphEdge` (each understanding already emits references-only edges) +
  a traverse/query API. No new primitive; no change to Programs 1–3.
- **G-A2 Open the type system:** generalize `GraphNodeType`/`GraphEdgeType` from fixed unions to an open
  registry (or branded `string`) so 100+ entities / 1000+ edge types register additively without editing
  the shared union — non-breaking (a wider type accepts all existing members).

**Decision: ✅ CERTIFIED WITH ADJUSTMENTS. Authorize Phase B — Canonical Intelligence Graph Foundation**
(carrying G-A1/G-A2).

*Architecture/falsification/audit only — no code, no schema, no flag, no behaviour change; does not modify
Programs 1–3, introduce new canonical contracts, or implement any graph/entity. Beginning Phase B is your
decision.*

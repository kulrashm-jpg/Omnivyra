# PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 — Phase C

## Cross-Entity Intelligence Foundation — Certification

**Type:** Intelligence layer over infrastructure (consumes the Phase-B graph + canonical evidence;
deterministic, additive, flag-dark, shadow-only). **Verified 2026-07-28.** Branch
`feat/lead-understanding-foundation`. **Authority:** Programs 1–3 (production-certified); Program 4 Phase
B (certified). **Nature:** builds `backend/services/crossEntityIntelligence/` — a deterministic layer that
**reasons across** Lead/Company/Offering by **consuming** the Canonical Intelligence Graph while every
Understanding stays authoritative for its own semantics. **No ownership moved; graph stays
infrastructure-only.**

---

## 0. Certification Decision

# ✅ PHASE C CERTIFIED

Cross-Entity Intelligence is implemented as a **pure consumer** of the graph and the entities' canonical
evidence. It **produces only derived evidence + derived reasoning** (grounded in canonical `EvidenceRef`,
abstaining when insufficient), **reusing the shared evidence / reasoning / fusion / explain contracts (no
new primitive)**. It **owns no entities, mutates no graph topology, re-scores nothing, re-projects
nothing, persists nothing.** Programs 1–3 and Phase B are **byte-for-byte unchanged**; **96/96** tests
(11 cross-entity + Program 1–4 regression); flag default OFF; tsc-clean.

| Validation requirement | Result |
|---|---|
| Graph remains infrastructure only | ✅ layer only **reads** the `MaterializedGraph`; topology untouched (immutability test) |
| Entities remain authoritative | ✅ consumes a read-only `CanonicalEntityUnderstanding` surface; never writes back |
| Evidence reused | ✅ shared `EvidenceRef` + `fuseEvidence`; **no new evidence primitive** |
| Reasoning reused | ✅ shared `ReasoningTrace` + `reasoningTrace`/`validateReasoning`; every trace valid |
| One graph substrate | ✅ materializes via the **Phase-B** runtime only; no second graph |
| Deterministic traversal | ✅ sorted frontiers, cycle-safe resolver; determinism test |
| Deterministic reasoning | ✅ no `Date.now`/`Math.random`; `builtAt` passed in; repeat-equal test |
| References-only ownership | ✅ derived evidence is `kind:'inferred'`; entity roots keep ownership |
| Zero duplicate semantics | ✅ reasons **about** relationships; re-owns no facet/score |
| Zero duplicate projections | ✅ context projections are cross-entity summaries, **not** entity projections |
| Zero duplicate persistence | ✅ no persistence layer exists in this module |
| Backward compatibility | ✅ `git diff` shows no existing file changed; flag OFF ⇒ null |
| Programs 1–3 unchanged | ✅ byte-for-byte; regression green |
| Program 4 Phase B unchanged | ✅ byte-for-byte; graph tests green |

---

## 1. Deliverables

**G-C301 Cross-Entity Context Assembler** (`contextAssembler.ts`) — `assembleCrossEntityContext(us, builtAt,
opts)` materializes the Phase-B graph from the entities, resolves the focus neighborhood, identifies the
participating entities, and gathers their **canonical** evidence (from reasoning traces + graph edges). Owns
no semantics; never mutates.

**G-C302 Multi-Hop Context Resolver** (`multiHopResolver.ts`) — `resolveNeighborhood(g, root, {depth})`:
configurable depth, deterministic (sorted) ordering, provenance preservation, duplicate elimination, cycle
protection (visited set). **Read-only over the graph.**

**G-C303 Cross-Entity Evidence Fusion** (`evidenceFusion.ts`) — `fuseCrossEntityEvidence(context)` fuses
multi-entity evidence by **reusing the shared `fuseEvidence`** (dedup / source-weighting / conflict), and
emits `derived` inferred evidence summarizing each entity's contribution. No new evidence primitive.

**G-C304 Cross-Entity Reasoning Engine** (`reasoningEngine.ts`) — `reasonAcrossEntities(context)` produces
canonical `ReasoningTrace`s for `qualification` (lead+company), `portfolio` (company+offering), `interest`
(lead+offering), `buying_context` (lead+company+offering) — **always grounded in canonical evidence,
abstaining (conclusion null + unknown) when absent**; every trace passes `validateReasoning`.

**G-C305 Relationship Intelligence Engine** (`relationshipIntelligence.ts`) — `assessRelationships(context)`
derives strength / confidence / recency / freshness / association / dependency from graph edges. **Derived
only — the graph is unchanged** (verified: input edges unmodified).

**G-C306 Context Projection Framework** (`contextProjection.ts`) — `projectContext(...)` emits
buying / account / offering / relationship **context** projections for downstream programs. These are
cross-entity summaries — **not** entity projections; Programs 1–3 keep their single canonical projection.

**G-C307 Cross-Entity Explainability** (`explainability.ts`) — `explainInsight`/`explainAll` answer Why /
which entities / which evidence / which relationships / which traversal / which confidence / assumptions /
uncertainty, derived entirely from the canonical trace + context.

**G-C308 Compatibility** — read-only over Lead / Company / Offering Intelligence + the Canonical Graph;
`git diff` confirms zero existing files changed; flag defaults OFF (O(1) rollback).

**G-C309 Validation** — §0 matrix, all verified in-code.

`runtime.ts` orchestrates (assemble → fuse → reason → relate → project → explain); `flags.ts` gates
(`CROSS_ENTITY_INTELLIGENCE_ENABLED`, default OFF ⇒ `computeCrossEntitySnapshot` returns null);
`index.ts` barrels. 11 source files + 1 test.

---

## 2. Executive Architecture Assessment

Phase C establishes the platform's **reasoning tier** cleanly above the infrastructure tier without eroding
the ownership model that makes the platform sound. The layer depends only on two stable surfaces — the
Phase-B `MaterializedGraph` and a minimal read-only `CanonicalEntityUnderstanding` (`{graph, reasoning,
contradictions, builtAt}`, which all three entities satisfy structurally) — so it neither forks contracts
nor reaches into entity internals. Because it produces **derived** evidence and reasoning grounded in
canonical evidence, cross-entity conclusions are as explainable and falsifiable as the single-entity ones,
and they **abstain** rather than fabricate. This is exactly the substrate the future intelligence programs
(**Visitor, Journey, Intent, Decision, Customer, Revenue, Automation**) will consume: each becomes a graph
citizen (Phase B) whose evidence this layer reasons across — **no redesign of Programs 1–3, no new
primitive, no ownership migration.** The one deliberate boundary held: those downstream programs are **out
of scope** here and were not implemented.

---

## 3. Verification

- **Tests:** `crossEntityIntelligence.test.ts` (11) + Program 1–4 regression = **96/96 green across 9
  suites**, deterministic — connected multi-entity context over the **real** Lead/Company/Offering
  understandings, multi-hop resolution (depth/cycle/provenance), fusion, grounded + **abstaining** reasoning
  (all traces valid), relationship intelligence with **graph-immutability assertion**, projections,
  explainability, determinism, and flag-gating.
- **Types:** cross-entity module **tsc-clean** (0 errors).
- **Additivity:** `git diff` shows **no existing tracked file modified** — Programs 1–3 and Phase B graph
  byte-for-byte intact; the layer reads their understandings and writes nothing back.

---

## 4. Certification Statement

Cross-Entity Intelligence is implemented exactly to scope: a deterministic, references-only, ownership-
preserving reasoning layer that consumes the Canonical Intelligence Graph and canonical evidence to produce
derived cross-entity evidence, reasoning, relationship intelligence, context projections, and explanations —
reusing the shared canonical contracts with **no new foundational primitive, no graph mutation, no semantic
duplication, and no redesign of Programs 1–3 or Phase B** (verified byte-unchanged). It is the reasoning
foundation on which future Visitor / Journey / Intent / Decision / Customer / Revenue / Automation programs
will build.

**Decision: ✅ PHASE C CERTIFIED. Authorize Phase D — Graph Adoption & Platform Integration** (query seam +
authoritative-readiness for cross-entity context, operator-gated).

*Intelligence layer only — flag-dark, shadow-only, additive; no downstream intelligence programs
implemented, no authoritative mode, no deploy, no merge, no ownership moved. Advancing to Phase D is your
decision.*

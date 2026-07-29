# JOURNEY-INTELLIGENCE-PROGRAM-006 — Phase A

## Journey Architecture, Ontology & Platform Falsification — Certification

**Type:** Architecture / ontology / falsification — **design ONLY, no implementation.** **Verified
2026-07-28.** Branch `feat/lead-understanding-foundation` @ `2c404509`. **Authority:** Programs 1–5
(production-certified: Lead / Company / Offering / Visitor + Graph + Cross-Entity + Platform). **Method:**
assume the platform is already sufficient for Journey; attempt to falsify that from the actual code.
Grounded in a repository inventory (grep of the real contracts), not memory.

---

## 0. Certification Decision

# ✅ PHASE A CERTIFIED

The falsification **fails**: Journey Intelligence requires **no new foundational primitive, no new
ownership model, no new platform capability, no new graph capability, and no new semantic abstraction.**
Journey is the **fifth canonical Understanding entity** — an additive platform citizen (mirroring Visitor)
that **owns sequence/ordering/stage/milestone/transition/continuity/completion/abandonment/branching/merging
semantics**, **references** Visitor/Lead/Company/Offering (owning none of them), and **reuses** the shared
Facet / EvidenceRef / ReasoningTrace / scoring / explainability / graph publication / platform API. The only
additive requirement is **node/edge type registration** (`journey`/`touchpoint`/`stage`/`milestone` nodes +
ordered `transitioned_to`/`has_touchpoint`/`reached_stage` edges) via the **sanctioned union-widening
mechanism** Programs 2/3/5 already used — additive, not a new primitive.

**Preferred outcome achieved: Journey is another additive platform consumer + a canonical Understanding.**

| Validation requirement | Result |
|---|---|
| Visitor remains canonical owner of visitor semantics | ✅ Journey references the visitor; never re-owns it |
| Graph remains relationship infrastructure | ✅ sequence is a Journey facet; graph carries only references |
| Cross-Entity remains reasoning infra / Platform remains consumption infra | ✅ Journey consumed via them unchanged |
| No duplicate ownership / evidence / scoring / explainability / persistence / projections / graph / platform | ✅ Journey owns only journey semantics; reuses all shared machinery |
| Programs 1–5 remain unchanged | ✅ design-only; the only future touch is additive union widening (sanctioned) |

---

## 1. Journey Ontology (J-A101)

**A Journey IS** the ordered, evidence-backed progression of a single actor (a Visitor — and, once
identified, a Lead) across touchpoints toward stages/milestones — the *sequence and its progression
semantics*. It owns the ordering, not the things ordered.

**A Journey is NOT** a visitor, lead, company, offering, session, touchpoint, campaign, or content — those
are **referenced**. It is not the graph (which carries the references) nor a reasoning layer (Cross-Entity).

| Concept | What it is | Owner |
|---|---|---|
| **Journey** | ordered progression of an actor's touchpoints → stages/milestones | **Journey (new)** |
| Touchpoint | a single interaction event (references content/offering/campaign/page) | Journey references it; the touched entity owns its own semantics |
| Milestone / Stage | a named progression marker reached with evidence | **Journey** |
| Transition | an ordered move between stages/touchpoints | **Journey** (as an ordered references-only edge + facet) |
| Checkpoint / Interaction | an observation feeding a touchpoint | **Evidence** (shared `EvidenceRef`) |
| Session | one visit window | **Visitor** (session facet) — Journey references |
| Visitor / Lead / Company / Offering | actor + context | **their own canonical Understandings** — referenced |

## 2. Ownership Matrix (J-A102)

**Journey owns** (nothing else can): sequence, ordering, transitions, stages, milestones, continuity,
completion, abandonment, branching, merging — expressed as Journey facets + ordered references-only edges.

**Remains owned elsewhere:** visitor identity/device/behavioral/session → **Visitor**; person/qualification
→ **Lead**; account → **Company**; product → **Offering**; the relationship substrate → **Graph**; cross-
entity reasoning → **Cross-Entity**; consumption → **Platform**. Journey references all of these; it re-owns
none. (Falsification: "Journey owns touchpoints" — rejected: a touchpoint's *content/offering/campaign* is
owned by those entities; Journey owns only the touchpoint's *position in the sequence*.)

## 3. Temporal Intelligence Assessment (J-A103) — **no new primitive**

Every temporal need is already served:

| Temporal need | Existing platform mechanism (verified in-code) |
|---|---|
| time / chronology | `EvidenceRef.observedAt` + `recordedAt` (ISO timestamps) — total order of observations |
| ordering / progression | directed, timestamped graph edges (`GraphEdge.asOf`) + deterministic traversal |
| continuity / history | the evidence set + the `builtAt` snapshot = a deterministic, replayable state |
| replay | re-materialization on new evidence (pure function of evidence + `builtAt`) |
| recency / decay | shared `decayFactor(observedAt, asOf, halfLife)` |

**Conclusion:** time is already carried by evidence timestamps and edge `asOf`; ordering is derivable and,
where it is *semantic* (stage sequence), it belongs to a **Journey facet** — not to a new time primitive.
**No temporal primitive is required.**

## 4. Platform Reuse Report (J-A104)

| Component | Reused as-is | How Journey uses it |
|---|---|---|
| Graph | ✅ | publishes references-only ordered edges; traverses touchpoint→stage |
| Cross-Entity Intelligence | ✅ | Journey participates as a `CanonicalEntityUnderstanding`; reasons across Journey+Visitor+Offering |
| Platform Consumption API | ✅ | downstream reads Journey via `openIntelligencePlatform` |
| Visitor Contract | ✅ | Journey references the frozen `VISITOR_CANONICAL_CONTRACT` (actor = visitor) |
| Evidence (`EvidenceRef` + `fuseEvidence`) | ✅ | touchpoint/stage evidence; timestamps = chronology |
| Reasoning (`ReasoningTrace`) | ✅ | progression/abandonment conclusions, grounded/abstaining |
| Explainability (`explainUnderstanding`) | ✅ | why-this-stage / why-abandoned |
| Scoring (`combineScoresFor`) | ✅ | journey dimensions (e.g. progression / momentum / completion / continuity) |

## 5. Graph Sufficiency Report (J-A105) — **sufficient**

The graph already provides directed, timestamped edges (`from`/`to`/`asOf`), `outgoing`/`incoming`
adjacency, and deterministic ordered traversal (`shortestPath` / `multiHop` / `descendants` / `neighbors`).
What it does **not** natively encode is an explicit *sequence index* on an edge — and it **should not**: an
explicit ordinal is a *semantic* the graph must not own (the graph is relationship infrastructure). Journey
owns the sequence (as an ordered facet); the graph carries the references and their `asOf`. **The graph is
sufficient; the missing piece is a Journey-owned facet, not a graph capability.** The only additive graph
touch is **type registration** (new `journey`/`touchpoint`/`stage`/`milestone` node types + ordered edge
types), via the open registries (runtime) + additive union widening (compile-time) — the sanctioned
mechanism, not a new graph model.

## 6. Journey Dependency Analysis (J-A106)

**Upstream (Journey consumes):** Visitor (actor, via the frozen contract), Lead (identified actor), Offering
(what a touchpoint touched), Company (account context), Graph (references), Cross-Entity (context).
**Downstream (consume Journey later):** Intent, Qualification, Opportunity, Decision, Automation, Revenue,
Customer — each via the Platform API against a future **frozen Journey contract** (mirroring Visitor Phase
D). No downstream is implemented or designed here; only the contract *direction* is fixed: they consume
Journey, they never re-own sequence.

## 7. Scalability Assessment (J-A107) — **scales without redesign**

`GraphNodeRef = {type,id}` references scale to millions of visitors / journeys; touchpoints are references,
so billions of events map to bounded references-only edges per journey (events fuse into evidence, not
node-per-event ownership). Long-running / parallel / multi-device / cross-session journeys are
representable: a Journey references multiple Visitor sessions/devices; pure deterministic assembly is
shardable; re-materialization gives replay. **No redesign required.**

## 8. Gap Analysis (J-A108)

- Missing **primitive**? **None** — Facet/Evidence/Reasoning/Graph/Score/Explain cover Journey.
- Missing **abstraction**? **None** — sequence = ordered facet + ordered references-only edges.
- Missing **ownership**? **None** — Journey is the new sole owner of sequence semantics.
- Missing **contract**? A future **frozen Journey contract** (Phase D), like Visitor's — planned, not a gap.
- Missing **governance / API**? **None** — governance rules + Platform API already generalize.
- **Only additive need:** node/edge **type registration** (sanctioned union widening) — additive, not a gap.

**Explicit conclusion: the platform is architecturally sufficient. Zero new primitives required.**

## 9. Executive Architecture Assessment (J-A109)

**Strengths.** The platform passes its fifth falsification cleanly: a genuinely temporal domain reduces to
"another canonical Understanding + consumer," because time was never missing — it lives in evidence
timestamps and edge `asOf`. Putting sequence *semantics* in Journey (not the graph) keeps the graph pure and
the ownership model intact.
**Weaknesses / risks.** The one real design tension is the temptation to make the graph own sequence
(ordinal edges) — rejected here; sequence stays a Journey facet. A second risk is touchpoint explosion
(billions of events) — mitigated by fusing events into evidence rather than a node per event.
**Trade-offs.** Sequence-as-facet (Journey-owned) vs sequence-as-graph (rejected): the former preserves the
"graph owns no semantics" invariant at the cost of Journey re-deriving order from evidence timestamps — the
correct trade.
**Recommendations / roadmap.** Phase B: Journey foundation (types + builder [sole owner] + fromRaw
ingestion + projection + persistence + references-only ordered graph publication + shadow runtime + flags +
explainability), reusing the shared spine, adding only `journey`/`touchpoint`/`stage`/`milestone` node
types + ordered edge types via union widening. Phase C: enrichment engines (progression / momentum /
completion / abandonment / continuity) as contributors. Phase D: freeze the Journey contract + governance.
FINAL: independent re-audit. **Mirror the certified Visitor cadence exactly.**
**Overall.** Architecture understood; ownership precise; reuse maximal; zero unnecessary primitives.

---

## 10. Certification Statement

Attempting to falsify platform sufficiency for Journey, the attempt fails on every axis: Journey is a
canonical Understanding + additive consumer that owns only sequence semantics, references everything else,
and reuses the entire shared spine and platform — introducing **no new foundational primitive, ownership
model, platform/graph capability, or semantic abstraction**, and requiring only the sanctioned additive
node/edge type registration. Programs 1–5 are unchanged (design-only).

**Decision: ✅ PHASE A CERTIFIED. Authorize Phase B — Journey Foundation.**

*Architecture only — no runtime, persistence, builder, graph publication, or intelligence implemented; no
Intent/Opportunity/Decision/Automation; nothing merged, deployed, or enabled. Advancing to Phase B is your
decision.*

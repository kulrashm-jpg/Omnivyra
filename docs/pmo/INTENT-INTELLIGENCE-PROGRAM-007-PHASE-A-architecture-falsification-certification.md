# INTENT-INTELLIGENCE-PROGRAM-007 — Phase A

## Intent Architecture, Inference Ontology & Platform Falsification — Certification

**Type:** Architecture / ontology / falsification — **design ONLY, no implementation.** **Verified
2026-07-28.** Branch `feat/lead-understanding-foundation` @ `670c92fc`. **Authority:** Programs 1–6
(production-certified: Lead / Company / Offering / Visitor / Journey + Graph + Cross-Entity + Platform).
**Method:** assume the platform is already sufficient for Intent; attempt to falsify that from the actual
code (grep of the real contracts), not memory.

---

## 0. Certification Decision

# ✅ PHASE A CERTIFIED

The falsification **fails**: Intent Intelligence requires **no new foundational primitive, no new ownership
model, no new inference framework, no new platform capability, no new graph capability, and no new semantic
abstraction.** Intent is the **sixth canonical Understanding entity** — an additive platform citizen
(mirroring Visitor/Journey) that **owns only the canonical interpretation of observed evidence** (inferred
objective + intent confidence/uncertainty + competing intents + abstention), **consumes** Visitor/Journey/
Lead/Company/Offering, and **reuses** the shared Facet / EvidenceRef / ReasoningTrace / fusion / scoring /
explainability. The only additive requirement is **node/edge type registration** (`intent` node + `intent_of`
/`intent_toward` edges) via the **sanctioned union-widening mechanism** Programs 2/3/5/6 already used —
additive, not a new primitive.

**Preferred outcome achieved: Intent is another additive canonical Understanding on the existing platform.**

| Validation requirement | Result |
|---|---|
| Visitor / Journey / Lead / Company / Offering ownership unchanged | ✅ Intent references them; owns none |
| Graph relationship infra / Cross-Entity reasoning infra / Platform consumption infra | ✅ Intent consumed via them unchanged |
| No duplicate ownership / evidence / chronology / scoring / explainability / persistence / graph | ✅ Intent owns only interpretation; reuses all shared machinery |
| Programs 1–6 unchanged | ✅ design-only; the only future touch is additive union widening (sanctioned) |

---

## 1. Intent Ontology (I-A101)

**Intent IS** the canonical, evidence-backed **interpretation** of *what objective the observed evidence
indicates* for an actor toward an object — a **descriptive inference over observed evidence**, not a forecast.

**Intent is NOT** a prediction, a recommendation, a next-best-action, the evidence itself, the journey, the
visitor, or a cross-entity reasoning pass. Interest/curiosity/evaluation/research/comparison/selection/
purchase/expansion/renewal/support/retention are **intent categories** (values of the inferred objective) —
Intent owns the *interpretation*; it does not own the entities the intent is about.

| Concept | What it is | Owner |
|---|---|---|
| **Intent** | inferred objective from observed evidence + confidence/uncertainty/competing/abstention | **Intent (new)** |
| Interest / Evaluation / Purchase / … | categories of the inferred objective | **Intent** (facet values) |
| Evidence / chronology | the observations + their timestamps | **Evidence** (`EvidenceRef.observedAt`) — referenced |
| Journey progression | ordered progression the intent draws on | **Journey** — referenced |
| Visitor / Lead / Company / Offering | actor + object | **their own canonical Understandings** — referenced |
| Recommendation / next-best-action / prediction | prescriptive/forecast | **out of scope** — Intent owns none |

## 2. Ownership Matrix (I-A102)

**Intent owns** (nothing else can): the evidence-backed interpretation, the inferred objective, intent
confidence, intent uncertainty, competing intents, and abstention — expressed as Intent facets + references-
only edges. **Remains owned elsewhere:** visitor identity → **Visitor**; progression → **Journey**;
person/account/product → **Lead/Company/Offering**; evidence + chronology → the shared **Evidence** model;
relationships → **Graph**; cross-entity reasoning → **Cross-Entity**; consumption → **Platform**.
(Falsification: "Intent duplicates Cross-Entity's `interest` insight" — **rejected**: Cross-Entity's
`interest` is an *ephemeral reasoning-layer output*; Intent is a *canonical owned entity* with identity/
persistence/projection/contract. Cross-Entity may **contribute** to Intent as an engine; it does not **own**
intent semantics. No duplication.)

## 3. Inference Architecture Assessment (I-A103) — **no new primitive**

Every "inference" need is already served, deterministically:

| Inference need | Existing platform mechanism (verified in-code) |
|---|---|
| deterministic inference + abstention | `ReasoningTrace` (`conclusion \| null` + `because` + `unknowns`); `validateReasoning` forbids opaque outputs — a non-null conclusion **must** cite evidence, and abstention **must** carry an unknown |
| confidence / uncertainty | `Facet<T>.confidence`; uncertainty = `1 − confidence` (already in `explainUnderstanding`) |
| conflicting evidence | `detectEvidenceContradictions` (source_conflict / stale_vs_fresh / confidence_divergence …) + `fuseEvidence` (resolution, never drops silently) |
| evidence fusion | shared `fuseEvidence` (dedup + source-weighting + conflict + freshness) |
| competing intents | a Facet holding ranked candidate objectives, each with confidence + contradictions — no new type |
| changing intent | re-materialization on new evidence (pure fn of evidence + `builtAt`); freshest wins via fusion/`decayFactor` |

**Conclusion:** deterministic, confidence-aware, abstaining, conflict-resolving inference **already exists** in
`ReasoningTrace` + `fuseEvidence` + `Facet`. **No new inference primitive or engine framework is required.**
The critical discipline: Intent infers the *interpretation of observed evidence* (grounded, abstaining) — it
does **not** predict; "purchase intent" means "the observed evidence indicates a purchase objective," never
"this actor will purchase."

## 4. Platform Reuse Report (I-A104)

| Component | Reused as-is | How Intent uses it |
|---|---|---|
| Graph | ✅ | publishes references-only edges: `intent_of`→actor, `intent_toward`→offering/company |
| Cross-Entity Intelligence | ✅ | Intent participates as a `CanonicalEntityUnderstanding`; Cross-Entity may contribute |
| Platform Consumption API | ✅ | downstream reads Intent via `openIntelligencePlatform` |
| Visitor Contract | ✅ | references the frozen `VISITOR_CANONICAL_CONTRACT` (actor) |
| Journey Contract | ✅ | references the frozen `JOURNEY_CANONICAL_CONTRACT` (progression evidence) |
| EvidenceRef / `fuseEvidence` | ✅ | intent evidence + conflict resolution |
| ReasoningTrace | ✅ | the inferred objective, grounded/abstaining |
| Explainability (`explainUnderstanding`) | ✅ | why-this-intent / why-abstained / uncertainty |
| Scoring (`combineScoresFor`) | ✅ | intent dimensions (e.g. strength / confidence / breadth) |

## 5. Graph Sufficiency Report (I-A105) — **sufficient**

Evidence traversal, cross-entity reasoning, chronology (`observedAt`), confidence propagation (`Facet`/
`ReasoningTrace` confidence + `decayFactor`), and deterministic resolution (`fuseEvidence`) all exist. Intent
adds **no graph capability** — it publishes references-only edges from an `intent` root; the interpretation
lives in Intent facets, not the graph. The only additive graph touch is **type registration** (`intent` node
+ `intent_of`/`intent_toward` edges) via the open registries (runtime) + additive union widening (compile-
time) — the sanctioned mechanism, not a new graph model. **The graph is sufficient.**

## 6. Intent Dependency Analysis (I-A106)

**Upstream (Intent consumes):** Visitor (actor), Journey (progression evidence), Lead (identified actor),
Offering/Company (the object of intent), Evidence (observations), Graph/Cross-Entity (context).
**Downstream (consume Intent later):** Qualification, Opportunity, Decision, Customer, Revenue, Automation —
each via the Platform API against a future **frozen Intent contract** (mirroring Visitor/Journey). No
downstream is implemented or designed here; only the contract *direction* is fixed: they consume Intent, they
never re-own the interpretation.

## 7. Scalability Assessment (I-A107) — **scales without redesign**

`GraphNodeRef = {type,id}` references scale to millions of intents; multi-intent actors = multiple intent
entities (or ranked candidates in one facet); conflicting evidence → `fuseEvidence`; changing intent →
re-materialization; cross-session/cross-device intent → references to multiple Visitor sessions/Journeys.
Pure deterministic assembly is shardable. **No redesign required.**

## 8. Gap Analysis (I-A108)

- Missing **primitive**? **None** — Facet/Evidence/Reasoning/Fusion/Graph/Score/Explain cover Intent.
- Missing **inference framework**? **None** — `ReasoningTrace` + `fuseEvidence` are deterministic inference.
- Missing **abstraction / ownership**? **None** — Intent is the new sole owner of interpretation.
- Missing **contract**? A future **frozen Intent contract** (Phase D), like Visitor/Journey — planned, not a gap.
- Missing **governance / API / temporal infra**? **None** — governance + Platform API + evidence timestamps generalize.
- **Only additive need:** node/edge **type registration** (sanctioned union widening) — additive, not a gap.

**Explicit conclusion: the platform is architecturally sufficient. Zero new primitives required.**

## 9. Executive Architecture Assessment (I-A109)

**Strengths.** The platform passes its seventh falsification cleanly, and on the axis that looked most likely
to require new machinery — *inference*. It doesn't: `ReasoningTrace` is already deterministic, grounded,
abstaining inference with confidence, and `fuseEvidence` already resolves conflicting evidence. The sharp
architectural line is Intent-vs-prediction: Intent interprets *observed* evidence (descriptive, abstaining)
and never forecasts, which keeps it evidence-first and reuses the certified reasoning contract wholesale.
**Weaknesses / risks.** The one real risk is scope creep from "intent" into prediction/next-best-action —
explicitly fenced out here; Intent owns interpretation only. A second is confusing Cross-Entity's `interest`
insight with Intent ownership — resolved: Cross-Entity contributes, Intent owns.
**Trade-offs.** Intent-as-owned-entity (with contract/persistence) vs Intent-as-cross-entity-insight
(ephemeral): the former is correct because downstream programs need a stable, governed, versioned intent
contract to consume — an insight can't be frozen.
**Recommendations / roadmap.** Phase B: Intent foundation (types + builder [sole owner] + fromEvidence
ingestion + projection + persistence + references-only graph publication + shadow runtime + flags +
explainability), reusing the shared spine, adding only `intent` node + `intent_of`/`intent_toward` edges via
union widening. Phase C: enrichment engines (per-category inference: interest/evaluation/purchase/… as
deterministic contributors) — descriptive, abstaining. Phase D: freeze the Intent contract + governance.
FINAL: independent re-audit. **Mirror the certified Visitor/Journey cadence exactly.**
**Overall.** Architecture understood; ownership precise; reuse maximal; zero unnecessary primitives.

---

## 10. Certification Statement

Attempting to falsify platform sufficiency for Intent, the attempt fails on every axis — including inference,
temporal infrastructure, scoring, explainability, and graph: Intent is a canonical Understanding + additive
consumer that owns only the interpretation of observed evidence, references everything else, and reuses the
entire shared spine and platform — introducing **no new foundational primitive, inference framework,
ownership model, platform/graph capability, or semantic abstraction**, and requiring only the sanctioned
additive node/edge type registration. Programs 1–6 are unchanged (design-only).

**Decision: ✅ PHASE A CERTIFIED. Authorize Phase B — Intent Understanding Foundation.**

*Architecture only — no runtime, persistence, builder, graph publication, inference, or intelligence
implemented; no Qualification/Opportunity/Decision/Customer/Revenue/Automation; nothing merged, deployed, or
enabled. Advancing to Phase B is your decision.*

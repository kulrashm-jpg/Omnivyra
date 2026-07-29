# QUALIFICATION-INTELLIGENCE-PROGRAM-008 — Phase A

## Qualification Architecture, Policy Ontology & Platform Falsification — Certification

**Type:** Architecture / ontology / falsification — **design ONLY, no implementation.** **Verified
2026-07-28.** Branch `feat/lead-understanding-foundation` @ `169491cc`. **Authority:** Programs 1–7
(production-certified: Lead / Company / Offering / Visitor / Journey / Intent + Graph + Cross-Entity +
Platform). **Method:** assume the platform is already sufficient for Qualification; attempt to falsify that
from the actual code (grep of the real contracts), not memory.

---

## 0. Certification Decision

# ✅ PHASE A CERTIFIED

The falsification **fails**: Qualification Intelligence requires **no new foundational primitive, no new
ownership model, no new policy framework, no new platform capability, no new graph capability, and no new
semantic abstraction.** Qualification is the **seventh canonical Understanding entity** — an additive platform
citizen (mirroring Intent/Journey/Visitor) that **owns only the canonical evaluation of qualification policy**
(qualification state + rationale + policy-evaluation + confidence/uncertainty/abstention), **consumes**
Visitor/Journey/Intent/Lead/Company/Offering, and **reuses** the shared Facet / EvidenceRef / ReasoningTrace /
scoring / explainability. Crucially, the **policy-driven vs evidence-driven** distinction is *already*
supported: a **policy is typed DATA** (an input to canonical evaluation), exactly like the platform's existing
`ContradictionResolution` / `ScoringMethod` policy enums — not new infrastructure. The only additive
requirement is **node/edge type registration** (`qualification` node + `qualifies`/`qualified_for` edges) via
the sanctioned union-widening mechanism Programs 2/3/5/6/7 already used.

**Preferred outcome achieved: Qualification is the 7th additive canonical Understanding on the existing
platform.**

| Validation requirement | Result |
|---|---|
| Visitor / Journey / Intent / Lead / Company / Offering ownership unchanged | ✅ Qualification references them; owns none |
| Graph relationship infra / Cross-Entity reasoning infra / Platform consumption infra | ✅ consumed unchanged |
| No duplicate ownership / evidence / chronology / reasoning / scoring / explainability / persistence / graph | ✅ owns only policy evaluation; reuses all shared machinery |
| Programs 1–7 unchanged | ✅ design-only; the only future touch is additive union widening (sanctioned) |

---

## 1. Qualification Ontology (Q-A101)

**Qualification IS** the canonical, deterministic **evaluation of a qualification policy** against the
accumulated understandings — "does this actor/account meet the policy's criteria, and why?" — yielding a
qualification **state** (e.g. `qualified` / `disqualified` / `nurture` / `review` / `unqualified`) + rationale.

**Qualification is NOT** the policy *definition* (that is versioned DATA input), a workflow/state machine, a
recommendation, a decision, an opportunity, or any upstream understanding. It reads Intent's interpretation,
Journey's progression, Visitor's behavior, and Lead/Company/Offering facts as **inputs**; it re-owns none.

| Concept | What it is | Owner |
|---|---|---|
| **Qualification** | policy-evaluation result: state + rationale + confidence/uncertainty/abstention | **Qualification (new)** |
| Qualification policy | the criteria/thresholds (typed data, versioned) | **an input** (data) — not an owned semantic |
| Intent / Journey / Visitor | interpretation / progression / behavior consumed as criteria inputs | **their own Understandings** — referenced |
| Lead / Company / Offering | actor / account / object facts | **their own Understandings** — referenced |
| Opportunity / Decision / Customer | downstream lifecycles | **out of scope** — consume Qualification later |
| Recommendation / next-best-action | prescriptive | **out of scope** — Qualification owns none |

## 2. Ownership Matrix (Q-A102)

**Qualification owns** (nothing else can): qualification state, qualification rationale, the policy-evaluation
result, qualification confidence, qualification uncertainty, qualification abstention — as Qualification facets
+ references-only edges. **Remains owned elsewhere:** interpretation → **Intent**; progression → **Journey**;
visitor identity → **Visitor**; person/account/product → **Lead/Company/Offering**; evidence + chronology → the
shared **Evidence** model; relationships → **Graph**; cross-entity reasoning → **Cross-Entity**; consumption →
**Platform**. **The policy definition is a versioned DATA input** (like source-weights or a resolution enum),
**not** a new owned primitive — Qualification owns the *evaluation*, not the *policy*. (Falsification:
"Qualification needs a policy-registry primitive" — **rejected**: policy is passed to the builder as
versioned config; its provenance is recorded in the evaluation's `ReasoningTrace`, exactly as
`ContradictionResolution` is data, not code.)

## 3. Policy Architecture Assessment (Q-A103) — **no new primitive**

Every policy-evaluation need is already served, deterministically:

| Policy need | Existing platform mechanism (verified in-code) |
|---|---|
| deterministic evaluation + abstention | a policy evaluation **is** a grounded `ReasoningTrace` (`conclusion \| null` + `because` + `method` + `unknowns`); `validateReasoning` forbids opaque outputs |
| policy-as-data (not hardcoded) | typed-enum precedent: `ContradictionResolution`, `ScoringMethod` — criteria/thresholds are config, not `if`-ladders |
| policy composition | deterministic AND/OR over facet values in plain code — no engine |
| policy versioning | a `policyVersion` field on the config + recorded in the trace provenance — mirrors `*_CONTRACT_VERSION`/`*_MODEL_VERSION` |
| confidence / uncertainty | `Facet<T>.confidence`; uncertainty = `1 − confidence`; `combineScoresFor` blends criteria contributions |
| abstention | `Facet.value = null` / scoring `abstained: true` when criteria unevaluable |

**Conclusion:** policies are **inputs to canonical interpretation**, not new infrastructure. The platform
already models "typed policy data + deterministic evaluation" (`ContradictionResolution`/`ScoringMethod`).
**No new policy framework, evaluation engine, or versioning system is required.** Discipline: Qualification is
descriptive evaluation of *current* facts against a policy — it does **not** recommend, decide, or predict.

## 4. Platform Reuse Report (Q-A104)

| Component | Reused as-is | How Qualification uses it |
|---|---|---|
| Graph | ✅ | publishes references-only edges: `qualifies`→actor, `qualified_for`→offering/company |
| Cross-Entity Intelligence | ✅ | participates as a `CanonicalEntityUnderstanding`; may reason across Qualification+Intent+Journey |
| Platform Consumption API | ✅ | downstream reads Qualification via `openIntelligencePlatform` |
| Visitor / Journey / Intent contracts | ✅ | consumes the frozen `*_CANONICAL_CONTRACT`s as policy inputs |
| Lead / Company / Offering | ✅ | account/actor/object facts as criteria inputs |
| EvidenceRef | ✅ | criteria satisfaction is evidence-backed |
| ReasoningTrace + validateReasoning | ✅ | the policy-evaluation conclusion, grounded/abstaining |
| Explainability (`explainUnderstanding`) | ✅ | why-qualified / why-disqualified / why-abstained |
| Scoring (`combineScoresFor`) | ✅ | qualification dimensions (e.g. fit / readiness / completeness) |

## 5. Graph Sufficiency Report (Q-A105) — **sufficient; relationship-only preserved**

Policy evaluation lives in Qualification facets, never the graph. The graph already provides references +
deterministic traversal; Qualification adds **no graph capability** — it publishes references-only edges from a
`qualification` root and evaluates in facets. **Graph semantics remain relationship-only.** The only additive
graph touch is **type registration** (`qualification` node + `qualifies`/`qualified_for` edges) via the open
registries (runtime) + additive union widening (compile-time) — the sanctioned mechanism, not a new graph
model.

## 6. Qualification Dependency Analysis (Q-A106)

**Upstream (Qualification consumes):** Visitor, Journey, Intent (all via frozen contracts), Lead, Company,
Offering, Evidence, Graph/Cross-Entity. **Downstream (consume Qualification later):** Opportunity, Decision,
Customer, Revenue, Automation — each via the Platform API against a future **frozen Qualification contract**
(mirroring Intent/Journey/Visitor). No downstream is designed here; only the contract *direction* is fixed:
they consume Qualification, they never re-own the evaluation.

## 7. Scalability Assessment (Q-A107) — **scales without redesign**

References scale to millions of qualifications; **multiple policy profiles** = the same deterministic evaluator
run per policy (policy is a data input); **policy evolution** = a bumped `policyVersion` recorded in the trace
(old evaluations remain reproducible); changing intent / cross-session / cross-device → re-materialization
against the latest upstream understandings. Pure deterministic evaluation is shardable. **No redesign.**

## 8. Gap Analysis (Q-A108)

- Missing **primitive**? **None** — Facet/Evidence/Reasoning/Scoring/Explain/Graph cover Qualification.
- Missing **policy framework**? **None** — policy = typed data input; evaluation = `ReasoningTrace`.
- Missing **abstraction / ownership**? **None** — Qualification is the new sole owner of policy *evaluation*.
- Missing **contract**? A future **frozen Qualification contract** (Phase D), like Intent/Journey — planned.
- Missing **governance / API / workflow / recommendation infra**? **None / not needed** — stateless snapshot,
  descriptive, consumed via the Platform API.
- **Only additive need:** node/edge **type registration** (sanctioned union widening) — additive, not a gap.

**Explicit conclusion: the platform is architecturally sufficient. Zero new primitives required.**

## 9. Executive Architecture Assessment (Q-A109)

**Strengths.** The platform passes its eighth falsification cleanly, on the axis that looked most likely to
force new machinery — *policy*. It doesn't: the platform already treats policy as typed data
(`ContradictionResolution`, `ScoringMethod`) and evaluation as a deterministic `ReasoningTrace`, so
"policy-driven" reduces to "criteria-as-data feeding canonical reasoning." The sharp line is
Qualification-vs-workflow-vs-recommendation: Qualification is a **stateless deterministic evaluation snapshot**
(built at `builtAt`, like every Understanding) that yields a **state + rationale** — not a workflow, not a
next-best-action, not a decision. That keeps it descriptive and reuses the certified contracts wholesale.
**Weaknesses / risks.** Two: (1) scope creep from "qualification state" into decisioning/recommendation —
fenced out here; (2) the temptation to build a "policy engine/registry" — rejected: policy is versioned data,
not a primitive.
**Trade-offs.** Policy-as-data-input (versioned config) vs policy-as-owned-entity: the former is correct —
policies change often and must be swappable/versioned without new ownership, and evaluation provenance already
records which policy version applied.
**Recommendations / roadmap.** Phase B: Qualification foundation (types + builder [sole owner] + fromPolicy
evaluation [policy config + upstream understandings → state/rationale/confidence] + projection + persistence +
references-only graph publication + shadow runtime + flags + explainability), reusing the shared spine, adding
only `qualification` node + `qualifies`/`qualified_for` edges via union widening. Phase C: enrichment engines
(per-criterion evaluators as deterministic contributors). Phase D: freeze the Qualification contract +
governance. FINAL: independent re-audit. **Mirror the certified Intent/Journey/Visitor cadence exactly.**
**Overall.** Architecture understood; ownership precise; reuse maximal; zero unnecessary primitives.

---

## 10. Certification Statement

Attempting to falsify platform sufficiency for Qualification, the attempt fails on every axis — including
policy, workflow, recommendation, prediction, and graph: Qualification is a canonical Understanding + additive
consumer that owns only the evaluation of qualification policy, references everything else, and reuses the
entire shared spine and platform — introducing **no new foundational primitive, policy framework, ownership
model, platform/graph capability, or semantic abstraction**, and requiring only the sanctioned additive
node/edge type registration. Policy is versioned data input, not infrastructure. Programs 1–7 are unchanged
(design-only).

**Decision: ✅ PHASE A CERTIFIED. Authorize Phase B — Qualification Understanding Foundation.**

*Architecture only — no runtime, persistence, builder, graph publication, policy execution, or intelligence
implemented; no Opportunity/Decision/Customer/Revenue/Automation; nothing merged, deployed, or enabled.
Advancing to Phase B is your decision.*

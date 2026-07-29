# VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 — Phase A

## Canonical Visitor Understanding Foundation — Certification

**Type:** New canonical entity on the existing platform (4th Understanding; deterministic, additive,
flag-dark, shadow-only). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`.
**Authority:** Programs 1–4 (production-certified: Lead/Company/Offering + Graph + Cross-Entity +
Platform API). **Nature:** builds `backend/services/visitorIntelligence/` — Visitor Intelligence owning
**only visitor semantics**, consuming the Semantic Platform, Canonical Graph, Cross-Entity Intelligence,
and Platform Consumption API **without modifying them**. This is the first downstream program, proving new
domains add **no new infrastructure**.

---

## 0. Certification Decision

# ✅ PHASE A CERTIFIED

Visitor Understanding is the **fourth canonical Understanding entity**, built on the shared spine exactly
as Lead/Company/Offering are: one builder (sole owner), one projection, one persistence contract, one graph
publication (references-only), a shadow runtime, and shared explainability. It **owns only visitor
semantics** (identity/device/geo/referral/acquisition/session/behavioral/engagement/lifecycle), **reuses**
the shared `Facet`/`EvidenceRef`/`ReasoningTrace`/scoring/explainability primitives (**no new primitive**),
**publishes references-only edges** (visitor is its only owned node), and **integrates natively through the
UNMODIFIED Program-4 graph + cross-entity + platform APIs** (proven: a `VisitorUnderstanding` flows into
`openIntelligencePlatform` and becomes a first-class graph citizen). Descriptive only — no identity
resolution, no attribution modelling, no intent inference. **109/109** tests across 11 suites; flags default
OFF; tsc-clean.

| Validation requirement | Result |
|---|---|
| Visitor owns visitor semantics only | ✅ facets cover visitor domains; no Lead/Company/Offering/Journey/Intent semantics |
| Graph unchanged | ✅ `intelligenceGraph/` byte-unchanged; visitor reuses it, publishes references only |
| Cross-Entity unchanged | ✅ `crossEntityIntelligence/` byte-unchanged; consumes the visitor via its read-only surface |
| Platform unchanged | ✅ `intelligencePlatform/` byte-unchanged; `openIntelligencePlatform` accepts the visitor as-is |
| Shared EvidenceRef reused | ✅ `evidenceRef`/`facet`; no visitor evidence type |
| Shared ReasoningTrace reused | ✅ shared reasoning contract; no visitor reasoning type |
| Shared Explainability reused | ✅ `explainVisitor*` wrap `explainUnderstanding` |
| Shared Graph publication reused | ✅ `node`/`edge`/`buildEntityGraph` from the spine |
| Shared Platform API reused | ✅ integration test drives the Phase-D session unchanged |
| Deterministic | ✅ no `Date.now`/`Math.random`; `asOf`/`builtAt` passed in; repeat-equal test |
| References-only | ✅ every edge originates from `visitor`; no edge terminates at a visitor-owned node |
| No duplicate primitives | ✅ reuses spine primitives; only visitor value-shapes are new |
| No duplicate persistence | ✅ one shadow-record + compat adapter; no writer wired |
| Programs 1–4 unchanged | ✅ behavior byte-unchanged; **one additive union widening** (see §3) — the sanctioned P2/P3 mechanism |

---

## 1. Deliverables

**1. Visitor Understanding** (`types.ts`) — `VisitorUnderstanding` on the shared spine: 10 facets
(identity/device/geo/referral/acquisition/session/behavioral/engagement/lifecycle/evidenceSummary), 4
behavioral score dimensions (engagement/recency/loyalty/reach), reasoning/contradictions/graph. Identity
(`anonymous|known|identified|merged`) and lifecycle (`new|returning|active|inactive|re_engaged|converted`)
are descriptive enums.

**2. Visitor Builder** (`builder.ts`) — `buildVisitorUnderstanding` is THE sole producer (mirrors Program
1/2/3 builders); reuses shared facet/scoring/contradiction/graph primitives; deterministic; abstains until
contributors exist. `assembly.ts` is the one Phase-A caller (`assembleVisitorUnderstanding`), ingesting via
`visitorFromRaw` (`fromRaw.ts`) — identity descriptive, UTM captured as evidence, behavioral evidence-first,
absent fields abstain.

**3. Visitor Projection** (`projection.ts`) — `projectVisitor` is the single projection owner; pure derived
reshape of decided facet/score values (status + lifecycle surfaced), deterministic.

**4. Visitor Persistence** (`persistence.ts`) — `toShadowRecord` + `toLegacyFields` compat adapter; pure
shape builders, no writer wired in Phase A.

**5. Visitor Graph Publication** (`graph.ts`) — `visitorEdge`/`buildVisitorGraph` publish references-only
edges: `identified_as`→lead, `belongs_to`→company, `acquired_via`→campaign, `engaged_with`→offering/content.
Visitor's only owned node is its `visitor` root.

**6. Visitor Explainability** (`explainability.ts`) — `explainVisitor`/`explainVisitorAll` thin-wrap the
shared `explainUnderstanding`; no opaque conclusions.

**7. Compatibility Layer** — `shadowRuntime.ts` (`computeVisitorUnderstandingShadow`, flag-gated,
field-parity vs raw) + the persistence compat adapter + native consumption by the Phase-D platform session.

**8. Validation Report** — §0 matrix + §3, all verified in-code.

**9. Executive Architecture Assessment** — §2.

---

## 2. Executive Architecture Assessment

Visitor Intelligence is the platform's first proof-of-thesis: a new intelligence domain added as a **pure
additive citizen** with **zero new infrastructure**. It mirrors the certified entity pattern one-for-one
(builder = sole owner, ingestion projects evidence, references-only graph publication, shadow runtime,
shared explainability), so its correctness properties are inherited rather than re-argued. The decisive
evidence is the platform-compatibility test: a `VisitorUnderstanding` — structurally a
`CanonicalEntityUnderstanding` — flows into the **unmodified** `openIntelligencePlatform`, becomes a
first-class graph citizen, and its `visitor→lead` reference is traversable through the Phase-D session. That
is exactly the adoption path Program 4 Phase D mandated: publish references, reuse the shared contracts,
consume the platform. The scope boundary held precisely: Visitor owns only visitor semantics, and **no
Journey/Intent/Qualification/Opportunity/Decision/Automation/Campaign/Customer** logic was implemented — those
remain out of scope. The sole cross-program touch is one **additive union widening** (`visitor` node +
`identified_as`/`acquired_via` edges), the identical non-breaking mechanism Programs 2 and 3 used on the same
file — behavior byte-unchanged, all 109 tests green.

---

## 3. Compatibility & Additivity

- **New module:** `backend/services/visitorIntelligence/` (11 files) + `visitorIntelligence.test.ts` — all new.
- **One additive shared edit:** `leadUnderstanding/types.ts` — `GraphNodeType` gains `'visitor'`;
  `GraphEdgeType` gains `'identified_as' | 'acquired_via'`. Purely additive union widening (no member
  removed or changed) — the **same sanctioned mechanism** Program 2 (+6 nodes) and Program 3 (+5 nodes/+3
  edges) used. `git diff` confirms these are the only changed lines; **all Programs 1–4 behavior is
  byte-unchanged** (109/109 regression green, including the graph/cross-entity/platform suites).
- **No writer, no schema, no flag flip, no consumer migration** — flags `VISITOR_UNDERSTANDING_ENABLED` /
  `VISITOR_UNDERSTANDING_AUTHORITATIVE` default OFF; O(1) rollback (delete module + revert the union block).

---

## 4. Verification

- **Tests:** `visitorIntelligence.test.ts` (6) + Programs 1–4 regression = **109/109 green across 11
  suites**, deterministic — foundation assembly (abstaining score), anonymous-visitor abstention,
  references-only graph publication, **native consumption by the unmodified platform** (visitor as graph
  citizen + traversal), explainability/persistence/shadow, flag-gating, determinism, deterministic id
  resolution, and sole-builder parity.
- **Types:** visitor module + shared-union consumers **tsc-clean** (0 errors).
- **Additivity:** the only existing-file change is the additive union widening (§3); the graph, cross-entity,
  and platform modules are byte-unchanged.

---

## 5. Certification Statement

Visitor Understanding is implemented exactly to scope: a deterministic, references-only, single-owner
canonical entity that owns only visitor semantics and integrates natively with the existing platform via
shared evidence, shared reasoning, shared explainability, shared graph publication, and the unmodified
Platform Consumption API — introducing **no new foundational infrastructure and no architectural drift**
(the one cross-program touch is a sanctioned additive union widening, behavior byte-unchanged). It proves
new intelligence domains can now be added additively on a single coherent platform.

**Decision: ✅ PHASE A CERTIFIED. Authorize Phase B — Visitor Intelligence Enrichment** (deterministic
visitor engines emitting contributions/facets/reasoning as contributors; scoring activation).

*Foundation only — flag-dark, shadow-only, additive; no enrichment engines, no Journey/Intent/other
downstream domain, no authoritative mode, no deploy, no merge, no consumer migration. Advancing to Phase B
is your decision.*

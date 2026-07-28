# JOURNEY-INTELLIGENCE-PROGRAM-006 — Phase B

## Journey Understanding Foundation — Certification

**Type:** New canonical entity on the existing platform (5th Understanding; deterministic, additive,
flag-dark, shadow-only). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`.
**Authority:** Programs 1–5 (production-certified) + Program 6 Phase A (architecture certified). **Nature:**
builds `backend/services/journeyIntelligence/` — Journey Intelligence owning **only temporal progression
semantics**, consuming Visitor/Lead/Company/Offering + the Graph/Cross-Entity/Platform APIs **without
modifying them**. Ordering derives from **evidence chronology**, never the graph.

---

## 0. Certification Decision

# ✅ PHASE B CERTIFIED

Journey Understanding is the **fifth canonical Understanding entity**, built on the shared spine exactly as
Lead/Company/Offering/Visitor are: one builder (sole owner), one projection, one persistence contract, one
references-only graph publication, a shadow runtime, and shared explainability. It **owns only progression
semantics** (ordered touchpoints/stages/milestones/transitions/continuity/state), **orders deterministically
from evidence chronology** (`observedAt`), **reuses** the shared `Facet`/`EvidenceRef`/`ReasoningTrace`/
scoring/explainability primitives (**no new primitive, no temporal infrastructure, no event/timeline engine,
no state machine**), **publishes references-only edges** (journey is its only owned node), and **integrates
natively through the UNMODIFIED Programs 1–5 graph + cross-entity + platform APIs**. Descriptive only — no
prediction, no intent. **135/135** tests across 15 suites; flags default OFF; tsc-clean.

| Validation requirement | Result |
|---|---|
| Journey owns only progression semantics | ✅ facets = touchpoints/stages/milestones/transitions/continuity/state; no visitor/lead/company/offering semantics |
| Visitor remains canonical visitor owner | ✅ Journey references the visitor (`journey_of`), never re-owns it |
| Graph / Cross-Entity / Platform unchanged | ✅ those modules byte-unchanged; Journey consumed as-is |
| Shared EvidenceRef / ReasoningTrace / Facet / scoring / explainability reused | ✅ no journey-specific primitive |
| Chronology derives from evidence | ✅ ordering = sort by `EvidenceRef.observedAt` (id tie-break); tested with out-of-order input |
| Graph remains relationship infra / references-only | ✅ every edge `from = journey`; **no `transitioned_to` published** — order stays in facets |
| Deterministic ordering | ✅ repeat-equal; chronological regardless of input order |
| No duplicate primitives / persistence | ✅ one builder/projection/persistence; shared spine |
| Programs 1–5 unchanged | ✅ byte-unchanged except **one additive union widening** (§3) — sanctioned P2/P3/P5 mechanism |

---

## 1. Deliverables

**1. Journey Understanding** (`types.ts`) — `JourneyUnderstanding` on the shared spine: 8 facets
(identity/touchpoints/stages/milestones/transitions/continuity/state/evidenceSummary), 4 progression score
dimensions (progression/momentum/completion/continuity), reasoning/contradictions/graph. `JourneyStatus`
(`active|completed|abandoned|paused|branching|merged`) and `JourneyActorType` (`visitor|lead`) are
descriptive enums.

**2. Journey Builder** (`builder.ts`) — `buildJourneyUnderstanding` is THE sole producer (mirrors Programs
1/2/3/5 builders); reuses shared facet/scoring/contradiction/graph primitives; deterministic; abstains until
contributors exist. `assembly.ts` is the one Phase-B caller (`assembleJourneyUnderstanding`), ingesting via
`journeyFromRaw` (`fromRaw.ts`).

**2b. Progression Model** (J-B202, `fromRaw.ts`) — touchpoints sorted **by `observedAt`** (id tie-break) →
the single source of ordering; `resolveJourneyId` deterministic. **Stage Intelligence** (J-B203):
current/previous/completed (distinct-consecutive, chronological)/pending. **Milestone Intelligence**
(J-B204): achievements with timestamps + evidence. **Transition Intelligence** (J-B205): consecutive
distinct stage changes with chronology. **Journey Summary** (J-B206): descriptive `state.status` +
continuity (span/gaps).

**3. Journey Projection** (`projection.ts`) — `projectJourney` is the single projection owner; pure derived
reshape (status + currentStage + touchpointCount surfaced), deterministic.

**4. Journey Persistence** (`persistence.ts`) — `toShadowRecord` + `toLegacyFields` compat adapter; pure
shape builders, no writer wired.

**5. Journey Graph Publication** (`graph.ts`, J-B208) — `journeyEdge`/`buildJourneyGraph` publish
references-only edges: `journey_of`→actor, `belongs_to`→company, `has_touchpoint`→touchpoint,
`reached_stage`→stage, `achieved_milestone`→milestone, `engaged_with`→touched offering/content. Journey's
only owned node is its `journey` root; **ordering is not published** (it lives in facets).

**6. Journey Explainability** (`explainability.ts`, J-B207) — `explainJourney*` thin-wrap the shared
`explainUnderstanding`; no opaque conclusions, no journey-specific explainer.

**7. Compatibility Layer** — `shadowRuntime.ts` (`computeJourneyUnderstandingShadow`, flag-gated,
field-parity vs raw) + the persistence compat adapter + native consumption by the Phase-D platform session.

**8. Validation Report** — §0 matrix + §3, verified in-code.

**9. Executive Architecture Assessment** — §2.

---

## 2. Executive Architecture Assessment

Phase B proves the Phase-A thesis in code: a genuinely *temporal* domain became "another canonical
Understanding" with **zero new infrastructure**. The decisive design choice — validated by the test that
feeds touchpoints **out of order** and gets them back **chronologically** — is that ordering derives from
`EvidenceRef.observedAt`, not from the graph. Transitions and the stage sequence live in Journey *facets*;
the graph carries only references (`from = journey`), and **no `transitioned_to` edge is published**, so the
"graph owns no semantics / graph carries no order" invariant holds exactly. Journey references the visitor as
its actor and the offering/content it touched, re-owning none of them. The platform-compatibility test closes
the loop: a `JourneyUnderstanding` — structurally a `CanonicalEntityUnderstanding` — flows into the
**unmodified** `openIntelligencePlatform` and its `journey→visitor` reference is traversable. Scope held:
**no Intent/Qualification/Opportunity/Decision/Automation/Revenue, no journey scoring/prediction/
optimization** — those are Phase C and later. The one cross-program touch is a disclosed additive union
widening (§3).

## 3. Compatibility & Additivity

- **New module:** `backend/services/journeyIntelligence/` (10 files) + `journeyIntelligence.test.ts` — all new.
- **One additive shared edit:** `leadUnderstanding/types.ts` — `GraphNodeType` gains
  `'journey' | 'touchpoint' | 'stage' | 'milestone'`; `GraphEdgeType` gains `'journey_of' | 'has_touchpoint'
  | 'reached_stage' | 'achieved_milestone' | 'transitioned_to'`. Purely additive (no member removed/changed)
  — the **same sanctioned mechanism** Programs 2/3/5 used. `git diff` confirms these are the only changed
  lines in Programs 1–5; all Programs 1–5 behavior is byte-unchanged (135/135 regression green).
- **No writer, no schema, no flag flip, no consumer migration** — flags `JOURNEY_UNDERSTANDING_ENABLED` /
  `_AUTHORITATIVE` default OFF; O(1) rollback.

## 4. Verification

- **Tests:** `journeyIntelligence.test.ts` (8) + Programs 1–5 regression = **135/135 green across 15
  suites**, deterministic — chronological ordering (out-of-order input → ordered output), stages/milestones/
  transitions/continuity/state, references-only publication (no graph order), **native consumption by the
  unmodified platform** (journey→visitor traversal), explainability/persistence/shadow, flag-gating,
  determinism, and sole-builder parity.
- **Types:** journey module + shared-union consumers **tsc-clean** (0 errors).
- **Additivity:** the only existing-file change is the additive union widening (§3); the graph, cross-entity,
  platform, and Programs 1–5 entity modules are byte-unchanged.

## 5. Certification Statement

Journey Understanding is implemented exactly to scope: a deterministic, references-only, single-owner
canonical entity that owns only temporal progression semantics, derives ordering from evidence chronology
(not the graph), and integrates natively with the existing platform via shared evidence/reasoning/
explainability/graph publication and the unmodified Platform Consumption API — introducing **no new
foundational infrastructure, no temporal primitive, and no architectural drift** (the one cross-program touch
is a sanctioned additive union widening, behavior byte-unchanged).

**Decision: ✅ PHASE B CERTIFIED. Authorize Phase C — Journey Intelligence Enrichment** (deterministic
progression/momentum/completion/abandonment/continuity engines as contributors; scoring activation).

*Foundation only — flag-dark, shadow-only, additive; no enrichment engines, no Intent/Opportunity/Decision/
Automation, no journey scoring/prediction, no authoritative mode, no deploy, no merge, no consumer migration.
Advancing to Phase C is your decision.*

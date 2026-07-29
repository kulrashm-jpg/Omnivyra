# INTENT-INTELLIGENCE-PROGRAM-007 — Phase B

## Intent Understanding Foundation — Certification

**Type:** New canonical entity on the existing platform (6th Understanding; deterministic, additive,
flag-dark, shadow-only). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`.
**Authority:** Programs 1–6 (production-certified) + Program 7 Phase A (architecture certified). **Nature:**
builds `backend/services/intentIntelligence/` — Intent Intelligence owning **only the canonical
interpretation of observed evidence**, consuming Visitor/Journey/Lead/Company/Offering + the
Graph/Cross-Entity/Platform APIs **without modifying them**. Descriptive interpretation — never prediction.

---

## 0. Certification Decision

# ✅ PHASE B CERTIFIED

Intent Understanding is the **sixth canonical Understanding entity**, built on the shared spine exactly as
Lead/Company/Offering/Visitor/Journey are: one builder (sole owner), one projection, one persistence
contract, one references-only graph publication, a shadow runtime, and shared explainability. It **owns only
interpretation semantics** (primary intent + competing intents + confidence + uncertainty + abstention +
evidence summary), **interprets observed evidence deterministically** (freshness-weighted, chronology from
`observedAt`), **reuses** the shared `Facet`/`EvidenceRef`/`ReasoningTrace`/`validateReasoning`/`fuseEvidence`/
`detectEvidenceContradictions`/scoring/explainability primitives (**no new primitive, no inference framework,
no prediction/recommendation engine**), **publishes references-only edges** (intent is its only owned node;
**no reasoning edges**), **abstains** when evidence is insufficient, and **integrates natively through the
UNMODIFIED Programs 1–6 graph + cross-entity + platform APIs**. **156/156** tests across 18 suites; flags
default OFF; tsc-clean.

## Independent Falsification (documented)

| Attack | Method | Result |
|---|---|---|
| Ownership leakage / evidence ownership | Intent references actor/object; owns no visitor/journey/lead/company/offering/evidence | ✅ owns only interpretation |
| Chronology correctness | freshness-weighted by `observedAt` via `decayFactor`; old signal decays | ✅ `evaluation` (fresh) beats `research` (old) |
| Deterministic interpretation | repeat-build deep-equal; total-order ranking (aggregate/count/freshest/name) | ✅ deterministic |
| Abstention handling | no signals → primary `null` + unknown; `validateReasoning` valid | ✅ honest abstain, no fabrication |
| Competing intents | multiple objectives simultaneously represented, primary excluded | ✅ evaluation primary; comparison competes |
| Graph compatibility | every edge `from = intent`; only `intent_of`/`intent_toward`; **no reasoning edge** | ✅ references-only |
| Reasoning reuse | `reasoningTrace` + `validateReasoning`; no forked reasoner | ✅ reused |
| Platform compatibility | intent → `openIntelligencePlatform`; `intent→visitor` traversal | ✅ first-class citizen |

**0 Critical / 0 Major / 1 Minor** (standing note: two builder entry points once Phase-C adds an enriched
assembly — currently one; the note is pre-recorded for consistency with Programs 1–6).

| Validation requirement | Result |
|---|---|
| Intent owns only interpretation semantics | ✅ facets = primaryIntent/competingIntents/confidence/identity/evidenceSummary |
| Visitor/Journey/Lead/Company/Offering ownership unchanged | ✅ referenced, never re-owned |
| Graph / Cross-Entity / Platform unchanged | ✅ those modules byte-unchanged; Intent consumed as-is |
| Shared EvidenceRef/Facet/ReasoningTrace/validateReasoning/fuseEvidence/detectEvidenceContradictions/scoring/explainability reused | ✅ no intent-specific primitive |
| Chronology derived from evidence | ✅ `observedAt` + `decayFactor` (tested with an old signal) |
| References-only publication / deterministic / abstention / competing intents | ✅ all tested |
| Programs 1–6 unchanged | ✅ byte-unchanged except **one additive union widening** (§3) |

---

## 1. Deliverables

**1. Intent Understanding** (`types.ts`) — `IntentUnderstanding` on the shared spine: 5 facets (identity/
primaryIntent/competingIntents/confidence/evidenceSummary), 4 interpretation score dimensions
(strength/clarity/recency/breadth), reasoning/contradictions/graph. Open `IntentObjective`
(research/evaluation/comparison/purchase/onboarding/adoption/renewal/expansion/support/retention).

**2. Intent Builder** (`builder.ts`) — `buildIntentUnderstanding` is THE sole producer (mirrors Programs
1/2/3/5/6); reuses shared facet/scoring/contradiction/graph primitives; deterministic; abstains until
contributors exist. `assembly.ts` is the one Phase-B caller (`assembleIntentUnderstanding`), ingesting via
`intentFromEvidence` (`fromEvidence.ts`).

**2b. Intent / Objective / Competing / Confidence / Reasoning Representation** (I-B202..206, `fromEvidence.ts`)
— aggregates signals per objective (freshness-weighted), ranks by a **total order**
(aggregate → count → freshest → name), sets **primary intent**, represents **competing intents** (all
evidence-supported candidates, primary excluded), computes **confidence/uncertainty** via
`facetConfidenceFromEvidence`, and emits a grounded (or **abstaining**) `ReasoningTrace`. Descriptive — no
probability estimation, no forecast.

**3. Intent Projection** (`projection.ts`) — `projectIntent` is the single projection owner; pure derived
reshape (primaryObjective + competingObjectives + abstained + confidence/uncertainty surfaced).

**4. Intent Persistence** (`persistence.ts`) — `toShadowRecord` + `toLegacyFields` compat adapter; pure shape
builders, no writer wired.

**5. Intent Graph Publication** (`graph.ts`, I-B208) — `intentEdge`/`buildIntentGraph` publish references-only
edges: `intent_of`→actor, `intent_toward`→object (offering/company). Intent's only owned node is its `intent`
root; **no reasoning edges** (interpretation lives in facets).

**6. Intent Explainability** (`explainability.ts`, I-B207) — `explainIntent*` thin-wrap the shared
`explainUnderstanding`; abstention reason surfaces via the trace's unknown.

**7. Compatibility Layer** — `shadowRuntime.ts` (`computeIntentUnderstandingShadow`, flag-gated) + persistence
compat adapter + native platform-session consumption.

**8. Validation Report** — §0 matrices + §3. **9. Executive Architecture Assessment** — §2.

---

## 2. Executive Architecture Assessment

Phase B proves the Phase-A thesis in code: a genuinely *inferential* domain became "another canonical
Understanding" with **zero new inference machinery**. The interpretation is a deterministic aggregation over
evidence — freshness-weighted by `decayFactor`, ranked by a total order for reproducibility — expressed as a
grounded `ReasoningTrace` that **abstains** (null conclusion + unknown) rather than guess. The two hardest
lines from Phase A held under test: (1) Intent is descriptive interpretation of *observed* evidence, not
prediction — "evaluation intent" means the evidence indicates an evaluation objective, and the confidence is
`facetConfidenceFromEvidence`, never a forecast probability; (2) competing intents are *represented, not
chosen* — evaluation is primary while comparison is carried as a competing candidate, so the entity never
collapses a multi-objective situation into a false single answer. The platform-compatibility test closes the
loop: an `IntentUnderstanding` flows into the unmodified `openIntelligencePlatform` and its `intent→visitor`
reference is traversable. Scope held: **no inference engine, classification logic, qualification/opportunity/
decision, or next-best-action** — those are Phase C and later. The one cross-program touch is a disclosed
additive union widening (§3).

## 3. Compatibility & Additivity

- **New module:** `backend/services/intentIntelligence/` (10 files) + `intentIntelligence.test.ts` — all new.
- **One additive shared edit:** `leadUnderstanding/types.ts` — `GraphNodeType` gains `'intent'`;
  `GraphEdgeType` gains `'intent_of' | 'intent_toward'`. Purely additive (no member removed/changed) — the
  **same sanctioned mechanism** Programs 2/3/5/6 used. `git diff` confirms these are the only changed lines in
  Programs 1–6; all Programs 1–6 behavior is byte-unchanged (156/156 regression green).
- **No writer, no schema, no flag flip, no consumer migration** — flags `INTENT_UNDERSTANDING_ENABLED` /
  `_AUTHORITATIVE` default OFF; O(1) rollback.

## 4. Verification

- **Tests:** `intentIntelligence.test.ts` (9) + Programs 1–6 regression = **156/156 green across 18 suites**,
  deterministic — deterministic interpretation (freshness-weighted primary), competing intents represented,
  confidence/uncertainty via shared primitives, **abstention** (null + unknown, valid reasoning),
  references-only publication (no reasoning edges), **native platform consumption** (intent→visitor
  traversal), explainability/persistence/shadow, flag-gating, and determinism.
- **Types:** intent module + shared-union consumers **tsc-clean** (0 errors).
- **Additivity:** the only existing-file change is the additive union widening (§3); the graph, cross-entity,
  platform, and Programs 1–6 entity modules are byte-unchanged.

## 5. Certification Statement

Intent Understanding is implemented exactly to scope: a deterministic, references-only, single-owner
canonical entity that owns only the interpretation of observed evidence, derives chronology from evidence,
abstains honestly, represents competing intents without choosing, and integrates natively with the existing
platform via shared evidence/reasoning/explainability/graph publication and the unmodified Platform
Consumption API — introducing **no new foundational infrastructure, inference framework, predictive
capability, or architectural drift** (the one cross-program touch is a sanctioned additive union widening,
behavior byte-unchanged).

**Decision: ✅ PHASE B CERTIFIED. Authorize Phase C — Intent Intelligence Enrichment** (deterministic per-
category interpretation engines as contributors; scoring activation).

*Foundation only — flag-dark, shadow-only, additive; no inference/classification engines, no Qualification/
Opportunity/Decision/Customer/Revenue/Automation, no prediction/recommendation/next-best-action, no
authoritative mode, no deploy, no merge, no consumer migration. Advancing to Phase C is your decision.*

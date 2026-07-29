# LEAD-INTELLIGENCE-PROGRAM-001 — Phase B

## Canonical Lead Intelligence Foundation — Certification

**Type:** Foundation implementation (flag-dark, shadow-only, additive). **Verified 2026-07-28.**
**Branch:** `feat/lead-understanding-foundation` (off `main` `3e941441`), committed `8935bb9d`.
**Authority:** Phase A canonical architecture (certified). **Nature:** contracts + machinery only —
**no engine algorithms** (those are Phase C), no production behavior change.

---

## 0. Certification Decision

# ✅ PHASE B CERTIFIED

The canonical foundation is implemented exactly to scope: **one ontology of facets, one evidence
model, one scoring contract, one reasoning contract, one persistence contract, one projection**, plus
graph, contradiction handling, shadow runtime, and observability — all pure, deterministic,
evidence-first, and dormant. It is **100% additive** (13 new module files + 1 test + 1 migration; **zero
existing files modified**), both flags default **OFF**, and it introduces **no duplicate intelligence**
(existing engines become contributors into this one platform). **21/21 tests; module tsc-clean.**

| Requirement | Result |
|---|---|
| Canonical foundation implemented | ✅ facets/evidence/scoring/reasoning/projection/graph/contradiction/persistence/shadow/observability |
| Existing platform preserved | ✅ zero existing files modified; nothing consumes the module |
| Shadow runtime operational | ✅ `computeLeadUnderstandingShadow` (null when OFF), `compareToLegacy` parity |
| No duplicate intelligence remains | ✅ ONE scoring contract; engines are contributors, no engine owns the final score |
| Rollout remains flag-dark | ✅ `LEAD_UNDERSTANDING_ENABLED` + `LEAD_UNDERSTANDING_AUTHORITATIVE` both OFF |
| Existing consumers continue functioning | ✅ additive; legacy read layer untouched; compat adapter provided |

---

## 1. Deliverables

**LI-B101 Canonical Lead Facet Framework** — `Facet<T> = {value, confidence, evidence[], provenance[],
asOf, contradictions[], unknowns[], assumptions[]}` over **12 domains** (identity, professional,
organization, buying, intent, engagement, opportunity, relationship, risk, qualification,
evidenceSummary, recommendations). `facet()`/`nullFacet()`; confidence derived deterministically from
evidence breadth + distinct sources; **unresolved contradictions lower confidence**. Abstains (null)
when evidence absent — never fabricates. *(`types.ts`, `facets.ts`)*

**LI-B102 Canonical Evidence Layer** — one `EvidenceRef` with 5 kinds (structured/observed/inferred/
external/ai_generated) and the full lifecycle (created → refreshed → superseded → expired). Never
deletes; `activeEvidence`, `normalizeEvidence`, `countByKind`, `applyExpiry`. *(`evidence.ts`)*

**LI-B103 Unified Scoring Framework** — ONE `combineScores` over `ScoreContribution[]`. Supports
deterministic/probabilistic/ai_reasoned methods, confidence, **calibration** (agreement across
contributors), and **abstention** (null when no contributor has evidence). Method precedence
(deterministic > probabilistic > ai) is encoded in the confidence-weighted blend — **no engine owns
the final score, and no low-confidence source overwrites a high-confidence one.** *(`scoring.ts`)*

**LI-B104 Canonical Reasoning Runtime** — one `ReasoningTrace {claim, conclusion, because[], confidence,
contradictions[], unknowns[], assumptions[], freshness, provenance[], method}`. `validateReasoning`
rejects **ungrounded conclusions** and abstention-without-unknown — no opaque outputs. *(`reasoning.ts`)*

**LI-B105 Canonical Lead Projection** — `buildLeadUnderstanding` is the **single semantic producer**;
`projectLead` is a pure **derived reshape** that never recomputes. Versioned (`LEAD_MODEL_VERSION`);
deterministic (`builtAt`/`projectedAt` passed in). *(`projection.ts`)*

**LI-B106 Intelligence Graph Foundation** — nodes are **references only** (type+id) across Lead,
Company, Offering, Competitor, Campaign, Content, Signal, Opportunity, Team, Organization — **no
duplicate entity ownership**. `buildLeadGraph` rejects self-loops, dedupes, deterministic order.
*(`graph.ts`)*

**LI-B107 Contradiction Framework** — `detectEvidenceContradictions` (source_conflict / stale_vs_fresh /
stated_vs_observed / ai_conflict) + `detectScoreContradictions` (confidence_divergence). Contradictions
are explicit objects that **lower confidence**; `resolveContradiction` returns a winner but **never
deletes the loser** (audit-safe). *(`contradiction.ts`)*

**LI-B108 Canonical Persistence Layer** — `LeadUnderstandingShadowRecord` + `toShadowRecord` +
`legacyScoresAdapter` (compat for existing consumers). Additive, idempotent, RLS-service-role
migration `20260728000000_lead_understanding_shadow.sql` — **dormant** (no writer wired in Phase B).
*(`persistence.ts`)*

**LI-B109 Shadow Runtime Validation** — `compareToLegacy` measures parity/divergence vs the legacy
`CanonicalLeadScores` (abstain-vs-abstain counts as agreement); `computeLeadUnderstandingShadow` is the
flag-gated entry (returns null when OFF — no work, no side effects). Shadow-first only. *(`shadowRuntime.ts`)*

**LI-B110 Observability** — pure `summarizeLeadUnderstandingRun` (facet generation, evidence lifecycle,
contradiction detection, score generation, projection, graph, reasoning, shadow divergence). No global
state, **no live telemetry emission** (keeps Phase B additive — no telemetry-registry change). *(`metrics.ts`)*

---

## 2. Architectural Guarantees

| Principle | Evidence |
|---|---|
| Reuse-first / zero duplication | ONE facet spine, ONE scoring contract, ONE reasoning contract; legacy `CanonicalLeadScores` reused for shadow parity |
| Additive evolution | 13 new files + test + migration; **zero existing files modified** (verified via `git diff`) |
| Flag-dark rollout | both flags default OFF; shadow returns null when OFF |
| Evidence-first / provenance / contradiction / confidence-aware | every facet + trace carries evidence, provenance, confidence, contradictions, unknowns |
| Deterministic | no `Date.now`/`Math.random`; timestamps passed in; determinism test asserts identical output |
| Tenant-safe | `LeadIdentityKey {leadKey, companyId}`; migration RLS service-role |
| Observable | pure run summary; shadow parity/divergence |
| No architectural drift | self-contained module; imported by nothing (only its test); no engine, no consumer rewire |

---

## 3. Verification

- **Tests:** `backend/tests/unit/leadUnderstanding.test.ts` — **21/21 green**, deterministic, covering
  all ten deliverables (facets, evidence lifecycle, scoring blend + abstention, reasoning validity,
  contradiction detect + non-deletion, projection single-owner + determinism, graph dedup/self-loop,
  persistence + compat, shadow parity + flag gating, observability + flags-OFF).
- **Types:** module is **tsc-clean** under `tsconfig.backend.json` (0 `leadUnderstanding` errors).
- **Additivity:** `git status` shows only new files; no existing tracked file modified.
- **Dormancy:** nothing in production imports the module; flags OFF ⇒ byte-identical behavior;
  migration unapplied + dormant.

---

## 4. Scope Discipline (explicitly NOT built — Phase C)

Buying-signal algorithms, advanced qualification, recommendation/persona/ICP/ranking/influence engines,
LLM reasoning, authoritative-mode flip, consumer migration, live telemetry wiring, and shadow
write-back are all **deferred to Phase C+**. Phase B ships the **contracts + machinery + shadow
harness** only; facet values abstain until Phase C engines populate them as contributors.

---

## 5. Certification Statement

The canonical Lead Intelligence foundation is implemented exactly to Phase B scope — one facet
ontology, one evidence model, one scoring contract, one reasoning contract, one persistence contract,
one projection, plus graph, contradiction handling, a shadow runtime, and observability — deterministic,
evidence-first, contradiction-aware, additive, reversible, and dormant, with **no duplicate intelligence
and no production behavior change**. Every subsequent engine now extends **one coherent platform**.

**Decision: ✅ PHASE B CERTIFIED. Authorize Phase C — Advanced Lead Intelligence Engines.**

*Implementation is committed on an isolated branch (`feat/lead-understanding-foundation`), flag-dark and
shadow-only; not merged, not deployed, no flag enabled. Advancing to Phase C is your decision.*

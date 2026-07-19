# IMPLEMENTATION-002H — Learning Loop & Adaptive Intelligence Implementation Program v1.0

**Status:** Authoritative program for the Learning Loop (WS-L, Phase 8; terminal). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2G]. Distinguishing invariant: **Learning recommends, never applies; no production behavior changes automatically; every learned adjustment is reproducible and provenance-tracked** (P14/P12).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Closes the terminal certified gap: every learning signal is already collected and none used [A4 §1]. Establishes one Learning Runtime ingesting every Learning Signal (corrections, confirmations, reviews, validation/generation failures, abandonment, bench outcomes, downstream performance), aggregating into calibration and recommendation outputs, and feeding them into the owning contexts' governance. The measurement half was hoisted to Phase 0 (correction-rate baseline); the capture half landed in Trust [I2B]; this completes the loop. **Learning recommends; it never applies** (P14) — the defining safety property. Its completion brings the full constitution into force.

## 2. Repository Inventory

company_profile_refinements (persisted, never analyzed) → correction/lineage source; company_context_review_events → review-outcome source; user_locked_fields → correction-signal source; offline judge bench → productionized evaluation feedback; Phase-1 quality gates → Preserve (out of scope); capabilityValidation → Retire as source; confidence updates → Preserve (Trust owns; Learning recommends); workflow/retry/AI metrics → workflow-learning source; analytics → downstream-validity source; Learning Signal capture (Trust T8) → Preserve (ingestion feed); Phase-0 baseline → comparison baseline. No prior consolidated learning runtime — net-new over emitted signals.

## 3. Learning Boundary (frozen)

**Owns:** Learning Runtime, Registry, Learning Signals, calibration computation, recommendation signals, improvement decisions (recommendations), evaluation feedback, learning metrics (correction-rate). **Does NOT own:** Facts (P14), Evidence, Grounding (recommends weights), Validation (recommends tuning), Generation (flags prompts/models/packs), Conversation (recommends ranking), Projections, **Confidence computation** (Trust computes; Learning recommends parameters). A pure recommendation engine; every output flows to the owning context's governance for gated adoption. Adjusts declared-policy parameters only (P12).

## 4. Learning Registry

Per-source: producer, signal type, aggregation policy, weighting, decay policy, consumers, retention, versioning. Registered sources: user edits/corrections, confirmations, accept/reject, conversation corrections/rephrasing, content/campaign/engagement performance, analytics drift, review outcomes, bench results. Zero unmanaged learning (census).

## 5. Learning Runtime

Signal ingestion (immutable capture) → aggregation → normalization → weighting → decay → prioritization → recommendation generation (never applied) → publication → replay → recovery. One runtime processes every signal.

## 6. Feedback Pipeline

User corrections (highest weight → correction-rate metric, lowers generation-confidence calibration, flags prompt/pack); confirmations; reviews (precision → demote rejected rules); validation/workflow/prompt/model failures (clustering → triggers); retry outcomes; abandonment (question-value re-ranking); performance (freshness/confidence pressure). Correction-rate computed per field family / pack / prompt version.

## 7. Calibration Engine

Learning recommends; the owning context applies: confidence calibration → Trust (governed calculator-version bump); workflow → Generation; prompt → Generation prompt governance + bench; model → Generation; projection → Projection config; grounding → Grounding config; recommendation → recommendation domain. **Never directly modifies any context** (P14) — takes effect only on governed, versioned adoption (reproducible P12, revertible).

## 8–9. Prompt/Workflow/Pack Learning & Evaluation Integration

Prompt/workflow quality metrics, retry optimization, failure clustering, benchmark evolution, recommendations → Generation governance (no auto-application). Packs remain governed assets [I2F §8]. Evaluation: dataset recommendations, bench results as high-weight signals, regression gate, promotion recommendations (bench + governance decide, Learning never promotes).

## 10. Knowledge/Trust Integration

May recommend confidence recalibration, review thresholds, validation tuning, evidence weighting; never performs them (P14); never touches Facts (corrections are signals about facts, not mutations).

## 11. Event Integration

LearningSignalReceived/Aggregated, CalibrationRecommended, Prompt/Workflow/IndustryPackRecommendationGenerated, EvaluationCompleted. Idempotent by signal id; replayable from history + policy versions; observable (correction-rate trends, adoption rates); audited. Recommendation events advisory; adoption events emitted by the owning context.

## 12. Legacy Migration

Activation of analysis over persisted sources: (1) runtime + registry (shadow, nothing applied); (2) correction/review/lock sources → correction-rate metric; (3) validation/workflow/retry → recommendations; (4) bench productionization; (5) calibration recommendations to governance; (6) pack/prompt/question recommendations. Proof: CI census — zero feedback-driven adjustments outside the runtime; recommend-only.

## 13–14. Shadow & Rollback

Dual learning (recommendations recorded, not published) + comparison vs Phase-0 baseline + bench; promotion when recommendations track ground truth + bench improvement + reproducibility. **Enforce = activating the recommendation surface** (no auto-apply). Rollback: stop publication (zero production effect); adopted calibrations revert through the owning context; nothing auto-applied — **no production behavior changes automatically** (structural).

## 15. Testing

Signal, aggregation (weighting/decay), calibration (tracks ground truth, reproducible), recommendation (no auto-application), benchmark (regression), replay, tenancy, performance, rollback, boundary (never writes Facts/confidence/prompts/packs directly, P14).

## 16. Certification Gates

(1) one runtime; (2) one registry; (3) zero unmanaged learning (no auto-change, P14); (4) calibration correctness (tracks ground truth, reproducible); (5) recommendation correctness (targets weak fields); (6) benchmark correctness; (7) replay correctness; (8) **correction-rate metric live** (closes [A4 §1]); (9) event correctness; (10) rollback verified; (11) production safety — **full constitution in force**.

## 17. Implementation Sequence

L0 (requires **all prior gates**; Phase-0 baseline + Trust capture) → L1 runtime + registry → L2 aggregation + correction-rate → L3 feedback pipeline → L4 calibration engine → L5 prompt/workflow/pack learning → L6 evaluation integration → L7 governance publication → L8 shadow → L9 enforcement (activation) → L10 certification (full-constitution) → L11 retirement.

## 18–19. Certification

**Ready for Development.** Complete scope; the missing measurement loop [A4 §1] maps to a named runtime with a first-class correction-rate metric and governed recommendations — the terminal gap of the entire baseline closed. Clean, safety-preserving boundary (recommends never applies, P14; determinism preserved P12; no production behavior changes automatically). Not "Production Implementation Ready" — Learning consumes all prior contexts' event history, so it is definitionally terminal; awaits Phases 1–7; on those gates, upgrades automatically, and its own certification brings the full DESIGN-002 constitution into force.

---
**Related:** [IMPLEMENTATION-002G](IMPLEMENTATION-002G.md) · [IMPLEMENTATION-003](IMPLEMENTATION-003.md) · **Depends on:** I1, I2A–G · **Related ADRs:** [ADR-009](../adr/ADR-009-learning-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002H-FULL.md`](../full/IMPLEMENTATION-002H-FULL.md) · **Certification:** Ready for Development · GATE-8 (constitution in force). See [`../appendices/relationships.md`](../appendices/relationships.md).

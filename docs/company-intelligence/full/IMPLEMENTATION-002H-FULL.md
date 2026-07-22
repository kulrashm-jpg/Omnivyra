# IMPLEMENTATION-002H — Learning Loop & Adaptive Intelligence (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002H.md`](../implementation/IMPLEMENTATION-002H.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-L, Phase 8 (terminal). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2G]. Distinguishing invariant: **Learning recommends, never applies; no production behavior changes automatically; every learned adjustment is reproducible and provenance-tracked** (P14/P12). **Classification: Ready for Development.**

---

## 1. Executive Summary

This program closes the platform's terminal certified gap: every learning signal the platform needs is already collected and none is used — user corrections, confirmations, and enrichment accept/reject events are persisted in `company_profile_refinements`, `company_context_review_events`, and `user_locked_fields`, but nothing analyzes them; the only factual-quality judge exists offline; and there is no correction-rate metric or ground-truth comparison in production. The Learning Loop makes the platform self-measuring and self-improving under governance. It establishes one Learning Runtime that ingests every Learning Signal the prior seven contexts emit — KnowledgeConfirmed/Corrected, review dispositions and correction signals, validation-failure taxonomies, generation-run and bench outcomes, abandoned conversations, and downstream content/campaign/engagement performance — aggregates them into calibration and recommendation outputs, and feeds those back into the contexts that own the corresponding assets. The measurement half of this loop was deliberately hoisted to Phase 0 (the correction-rate baseline); the signal-capture half landed in Trust; this program completes the loop. The defining constitutional boundary — and the defining safety property — is that Learning recommends; it never applies (P14). Learning computes a recommended confidence calibration, but Trust's versioned calculator consumes it as a parameter through Trust's own governance; Learning flags a prompt for revision, but Generation's approval + bench gate decides it; Learning proposes a pack vocabulary update, but the pack remains a governed asset. Learning adjusts *parameters of declared policies*, never behavior paths, so determinism is preserved (P12). No production behavior changes automatically. Its completion brings the full DESIGN-002 constitution into force.

## 2. Repository Inventory

`company_profile_refinements` (persisted, never analyzed) → correction/lineage learning source; `company_context_review_events` (accept/reject/snooze + quality_payload) → review-outcome source; `user_locked_fields` (corrections as authoritative state, not measured) → correction-signal source; the offline LLM-judge bench → productionized evaluation feedback (the gate already stood up in Generation); the Phase-1 quality gates → Preserve (content-publishing gates; out of scope; not a profile-learning source); `capabilityValidation` (presence-check) → Retire as a source (subsumed by the Validation taxonomy); confidence updates → Preserve (Trust owns; Learning recommends calibration); workflow/retry/AI-quality metrics → workflow-learning source; analytics → downstream-validity source; the Learning Signal capture (Trust T8) → Preserve (the ingestion feed); the Phase-0 correction-rate baseline → the comparison baseline. No prior consolidated learning runtime exists — this is a net-new context assembled over already-emitted signals.

## 3. Learning Boundary (frozen)

**Owns:** the Learning Runtime, the Registry, Learning Signals (ingestion/aggregation), calibration *computation*, recommendation signals, improvement decisions (recommendations), evaluation feedback, learning metrics (correction-rate). **Does NOT own:** Facts (P14 — never changes them), Evidence, Grounding (recommends selection-policy weights; Grounding applies), Validation (recommends tuning; the pipeline applies), Generation (flags prompts/models/packs; Generation governance decides), Conversation (recommends question-value re-ranking; the engine applies), Projections, **Confidence computation** (Trust computes; Learning recommends calibration parameters that Trust's versioned calculator consumes). A pure recommendation engine; every output flows to the owning context's governance for gated adoption (P14). Adjusts declared-policy parameters only, preserving determinism (P12).

## 4. Learning Registry

Every learning source is a registered entry: producer, signal type (correction / confirmation / acceptance / rejection / validation-failure / workflow-failure / retry-outcome / abandonment / bench-result / performance-outcome / drift), aggregation policy (per field family / industry pack / prompt version / workflow), weighting (a user correction outweighs an acceptance), decay policy (half-life in the calibration window; stale signals archive), consumers (the recommendation surfaces it feeds), retention, versioning. Zero unmanaged learning — no ad-hoc feedback path adjusts platform behavior outside the runtime (census).

## 5. Learning Runtime

Signal ingestion (immutable capture) → aggregation (per policy) → normalization (uniform representation across heterogeneous producers) → weighting → decay → prioritization (by aggregated signal strength × impact) → recommendation generation (never applied) → publication (to the owning context's governance) → replay (re-derives deterministically from signal history + policy versions) → recovery (rebuild aggregations from history — no authoritative state lost). One runtime processes every signal.

## 6. Feedback Pipeline

User corrections (highest weight → the first-class correction-rate metric; lowers generation-confidence calibration for that field class; flags prompt/pack revision). Confirmations (raise review-confidence calibration input). Reviews (precision measurement per inference-rule/generator; persistently-rejected rules demoted). Validation/workflow/prompt/model failures (cluster into prompt-revision triggers, retry/routing recommendations). Retry outcomes (retry-policy recommendations). Abandoned conversations (question-value re-ranking — frequent rephrasing = a bad question). Accepted recommendations / content-campaign-engagement performance (downstream validity: intelligence grounding underperforming output flagged → freshness/confidence pressure recommendation). The correction-rate metric is computed per field family / pack / prompt version — the standing answer to "is the intelligence getting better?"

## 7. Calibration Engine

Learning recommends; the owning context applies through its governance: confidence calibration → Trust (a governed calculator-version bump); workflow calibration → Generation governance; prompt calibration → Generation prompt governance + bench; model calibration → Generation model governance; projection calibration → Projection config; grounding calibration → Grounding config; recommendation calibration → the recommendation domain. Calibration law: Learning computes and publishes; it never directly modifies any other context (P14). A calibration takes effect only when the owning context adopts it through its versioned governance — making every adaptive change reproducible (P12), attributable (provenance-tracked), and revertible (version re-point).

## 8–9. Prompt/Workflow/Pack Learning & Evaluation Integration

Prompt quality metrics (per prompt version: correction rate, validation-failure taxonomy, bench score); workflow quality metrics (success/retry/cost/bench trends); retry optimization; failure clustering (named improvement opportunities); benchmark evolution (recommend dataset additions from production lineage — the "completeness critic"); prompt/workflow recommendations → Generation governance decides. Industry Pack learning: vocabulary/terminology evolution from per-industry correction patterns; new-industry detection (frequent generic fallback / low completeness); specialization/inheritance refinements; version-bump recommendations — packs remain governed assets. Evaluation integration: dataset recommendations; benchmark results as high-weight signals (regressions trigger recommendations); regression testing on any adopted calibration is mandatory; promotion recommendations (the bench gate + governance decides; Learning never promotes). Learning does not bypass governance.

## 10. Knowledge/Trust Integration

Learning may recommend: confidence recalibration, review thresholds, validation tuning, evidence weighting. Learning never performs those changes directly (P14) — each flows to the owning context (Trust, Validation, Grounding) for governed, versioned adoption. Learning never touches Facts (P14) — corrections are *signals about* facts (feeding calibration), never fact mutations; the fact was already corrected by the user through the Knowledge write authority.

## 11. Event Integration

LearningSignalReceived/Aggregated, CalibrationRecommended, Prompt/Workflow/IndustryPackRecommendationGenerated, EvaluationCompleted. Idempotent by signal id; replayable from history + policy versions; observable (per-signal-type volume + correction-rate trends + recommendation/adoption rates); audited. Recommendation events are advisory; adoption events are emitted by the *owning* context when it applies through governance — keeping the recommend-only boundary auditable.

## 12. Legacy Migration

Activation of analysis over already-persisted sources: (1) runtime + registry (shadow, nothing applied); (2) correction/review/lock sources → the correction-rate metric; (3) validation/workflow/retry signals → recommendations; (4) bench productionization; (5) calibration recommendations → Trust/Generation/Grounding governance surfaces; (6) pack/prompt/question recommendations → owning governance. Proof: a CI census confirms zero feedback-driven adjustments to platform behavior outside the runtime — recommend-only.

## 13. Shadow & Rollback

Dual learning (recommendations recorded, not published). Recommendation comparison (against the Phase-0 correction-rate baseline + expert review — do they target the genuinely weak fields?). Benchmark comparison (a recommended confidence calibration must improve bench-measured calibration error). Calibration comparison (shadow-recommended vs current parameters). Promotion (per recommendation class per tenant): recommendations track ground truth; bench improvement on adoption; reproducibility (same signals + policy version → same recommendation); rollback exercised. **Enforce (special meaning here):** because Learning never auto-applies, "enforce" = activating the recommendation surface for governed adoption — the owning contexts begin *receiving* recommendations; adoption remains their governed, gated decision. Rollback: stop publication (zero production behavior effect); adopted calibrations revert through the *owning* context; because Learning only recommends and every adoption is a separate governed, versioned action, rolling back Learning changes no production behavior (structural).

## 14. Testing Framework

Signal (ingestion of every registered source; immutable capture; normalization); aggregation (per-policy; weighting; decay/half-life; archival); calibration (recommended calibrations track ground truth; reproducibility, P12); recommendation (from clustered signals; no auto-application); benchmark (integration; regression on adopted calibration; dataset recommendations); replay (deterministic re-derivation); tenancy (cross-tenant isolation); performance (ingestion/aggregation throughput); rollback (stop-publication + owning-context revert; no-production-change proof); boundary (Learning never writes Facts/confidence/prompts/packs directly, P14 — static + runtime).

## 15. Certification Gates

(1) one Learning Runtime (all signals processed by the runtime; census); (2) one Learning Registry (all sources registered; zero unregistered feedback paths); (3) zero unmanaged learning (no feedback-driven behavior change outside the runtime; no production behavior changes automatically, P14); (4) calibration correctness (tracks ground truth; bench improvement on adoption; reproducible); (5) recommendation correctness (targets the weak fields; adoption governed, never automatic); (6) benchmark correctness (regression gate on adopted calibrations); (7) replay correctness; (8) **correction-rate metric live** (per field family/pack/prompt version — the terminal certified gap closed); (9) event correctness; (10) rollback verified (stop-publication + owning-context revert with no-production-change proof); (11) production safety — **the full constitution in force**.

## 16. Implementation Sequence

L0 (requires all prior phase gates; the Phase-0 baseline + Trust signal capture) → L1 runtime + registry (signal ingestion, dark) → L2 aggregation/normalization/weighting/decay + correction-rate metric → L3 feedback pipeline → L4 calibration engine (compute-only) → L5 prompt/workflow/pack learning → L6 evaluation integration (bench productionized; regression gate) → L7 governance publication (recommend-only surfaces) → L8 shadow → L9 enforcement (activation; no auto-application) → L10 certification (full-constitution; all [I1] §15 gates green) → L11 retirement staging.

## 17–18. Certification

**Ready for Development.** Complete scope; the missing measurement loop maps to a named runtime with a first-class correction-rate metric and governed recommendations — the terminal gap of the entire baseline closed. Clean, safety-preserving boundary (recommends never applies, P14; determinism preserved, P12; no production behavior changes automatically). Not "Production Implementation Ready" — Learning consumes all prior contexts' event history, so it is definitionally terminal; awaits Phases 1–7; on those gates it upgrades automatically, and its own certification brings the full DESIGN-002 constitution into force.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002H.md`](../implementation/IMPLEMENTATION-002H.md) · [`IMPLEMENTATION-002G-FULL.md`](IMPLEMENTATION-002G-FULL.md) · [`IMPLEMENTATION-003-FULL.md`](IMPLEMENTATION-003-FULL.md) · **Related ADRs:** [ADR-009](../adr/ADR-009-learning-runtime.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-8 (constitution in force).

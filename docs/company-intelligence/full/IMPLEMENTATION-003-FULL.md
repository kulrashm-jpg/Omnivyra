# IMPLEMENTATION-003 — Production Execution Roadmap (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-003.md`](../implementation/IMPLEMENTATION-003.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

Executable engineering plan; the bridge from planning (002A–H) to delivery. Adds no architecture; converts the context programs into a dependency-sequenced, gate-driven plan with rollback checkpoints and release criteria. No timelines or effort estimates.

---

## 1. Purpose

The context programs each specify *how a context is built*. This document specifies *the order in which the whole program executes*: what runs first, what runs in parallel, what blocks what, which gates must pass before the next phase begins, where the rollback checkpoints are, and what "done" means at each level. It is the operational companion to IMPLEMENTATION-001 — [I1] decides strategy; [I3] sequences delivery.

## 2. The dependency spine

Phase 0 Fabric (unblocks all) → GATE-0 → Phase 1 Writes (critical path; nothing enforces before this) → GATE-1 → Phase 2 Trust ∥ Phase 3 Evidence → GATE-2/GATE-3 → Phase 4 Grounding+Validation (convergence; needs 1,2,3) → GATE-4 → Phase 5 Conversation ∥ Phase 6 Generation → GATE-5/GATE-6 → Phase 7 Projections+Consumers (needs 1,2; grounding done in 4) → GATE-7 → Phase 8 Learning (terminal) → GATE-8 → constitution in force. **The three hard ordering laws:** writes before everything (WS-K is the first strangler seam; no context may enforce before it); Trust and Evidence are independent and parallelize after GATE-1; grounding is the convergence — it cannot assemble a context until Facts, Confidence, and Evidence are each authoritative.

## 3. Per-phase execution

Each phase's internal step sequence lives in its program's Implementation Sequence section. The phase table sequences the phases themselves: entry condition, exit gate (must pass to advance), and rollback checkpoint. GATE-1 is the master gate; GATE-4 is the convergence gate; GATE-8 requires every prior gate plus the full [I1] §15 production-gate set.

## 4. Parallelization plan

Safe concurrent development (no shared write seam, no contract dependency): WS-T ∥ WS-E after GATE-1; WS-G ∥ WS-V co-developed in Phase 4; WS-C ∥ WS-GEN after Phase 4; projection families and frontend sections within Phase 7. Blocking dependencies (hard): nothing before WS-0; nothing writes-adjacent before WS-K; WS-G blocked on WS-T + WS-E; WS-V blocked on WS-T; WS-CM blocked on WS-P; WS-L blocked on all emitting. Synchronization points: end of Phase 1, Phase 4, Phase 7. Merge checkpoints: the CI conformance counters — a branch cannot merge work that raises any census. Shared-file discipline: the service barrel and frontend god hook are dissolution zones.

## 5. Rollback checkpoints

Every phase is revertible by flag re-point; no phase performs a destructive data operation while its predecessor's path is within the rollback window. Per-checkpoint revert actions and guarantees are enumerated (write cutover → re-activate dormant legacy writer atomically; confidence flip → calculator-version re-point; evidence source → legacy collection flag revert; grounding consumer → per-consumer revert to legacy serialization; conversation mode → per-mode revert; workflow → prompt/model/pack version re-point; consumer/frontend section → per-section flag revert; learning → stop-publication). Each critical phase (1, 2, 4, 7) must *demonstrate* an exercised rollback in a pre-production tenant before enforcement.

## 6. Production release milestones

Enforcement within every phase is per-tenant (internal → beta → cohorts → all); protected production tenants move last, after a demonstrated rollback. Milestones: M0 Fabric live (GATE-0), M1 Writes owned (GATE-1), M2 Trust+Evidence owned (GATE-2 ∧ GATE-3), M3 Grounding+Validation owned (GATE-4), M4 Interaction plane owned (GATE-5 ∧ GATE-6), M5 Read plane owned (GATE-7), M6 Constitution in force (GATE-8).

## 7. Feature-complete vs production-ready

**Feature-complete** = the new runtime exists, all its steps are built, and it passes its own suites in shadow (computing alongside legacy, serving nothing authoritative); no production behavior has changed. **Production-ready** = the runtime is enforced per-tenant with its certification gate green in production, its rollback demonstrated, its observability live, and its legacy path dormant-with-sunset. The gap is the shadow → compare → enforce ladder; a workstream is never production-ready on the strength of tests alone.

## 8. Certification-gate sequencing

No phase begins enforcement until its upstream gates are closed. GATE-1 is the master gate (no other phase may enforce before it). GATE-4 is the convergence gate (Phases 5, 6, 7 depend on grounding+validation). GATE-8 ratifies the constitution (requires every prior gate plus the full [I1] §15 set). Development of a downstream phase may proceed in parallel (feature-complete in shadow); only enforcement is gate-blocked.

## 9. Risk-driven sequencing adjustments

From the [I1] §12 register: R1 (unknown 11th writer) — the Phase-0 static writer census runs before any Phase-1 cutover; R4 (frontend destabilization) — the frontend is deliberately last, per-section, beta-first; R10 (schema/environment drift) — the Phase-0 schema-lineage audit runs before write-authority work, and the silent column-drop retry is instrumented to error-visibility immediately in Phase 1.

## 10. Definition of done (three levels)

Workstream done: its program's §5 criteria; conformance counters at target; flags at legacy-retired or documented sunset; suites green. Phase done: its certification gate passed in production for all rollout tenants; rollback demonstrated; dashboards live. Platform done: all [D2] §12 conformance areas pass continuously; all P1–P30 hold; all [I1] §15 gates green; all legacy retired or in sunset; the Learning Loop reports correction-rate trends per field family (the terminal certified gap closed).

## 11. Execution summary

Phase 0 stands up measurement, events, flags, schema lineage, and the writer census (nothing moves until green). Phase 1 owns the writes — the master gate; two early critical fixes land here. Phases 2 & 3 run in parallel. Phase 4 converges them into one grounding authority and one validation pipeline. Phases 5 & 6 run in parallel on top of Phase 4. Phase 7 builds projections and migrates every consumer, frontend last and per-section. Phase 8 closes the loop. Every step is flag-gated, shadow-validated, per-tenant enforced, and demonstrably revertible; milestones M0–M6 mark the release path.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-003.md`](../implementation/IMPLEMENTATION-003.md) · [`IMPLEMENTATION-001-FULL.md`](IMPLEMENTATION-001-FULL.md) · **Related ADRs:** [ADR-010](../adr/ADR-010-constitutional-governance.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** operational roadmap.

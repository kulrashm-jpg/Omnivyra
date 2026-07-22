# IMPLEMENTATION-003 — Production Execution Roadmap v1.0

**Status:** Executable engineering plan. The bridge from planning (IMPLEMENTATION-002A–H) to delivery. Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2H]. This document adds **no architecture**; it converts the context programs into a dependency-sequenced, gate-driven execution plan with rollback checkpoints and release criteria. No timelines or effort estimates (per constraints) — sequencing and gates only.

---

## 1. Purpose

The context programs (002A–H) each specify *how a context is built*. This document specifies *the order in which the whole program executes*: what runs first, what runs in parallel, what blocks what, which gates must pass before the next phase begins, where the rollback checkpoints are, and what "done" means at each level. It is the operational companion to IMPLEMENTATION-001 (the blueprint) — [I1] decides strategy; [I3] sequences delivery.

---

## 2. The dependency spine (authoritative execution order)

```
Phase 0  FABRIC            WS-0, WS-I start        (unblocks everything)
   │  ▼ GATE-0
Phase 1  WRITES            WS-K                    (critical path; nothing enforces before this)
   │  ▼ GATE-1
Phase 2  TRUST  ─────┐     WS-T          ┌──── Phase 3  EVIDENCE   WS-E
   │  ▼ GATE-2       └─────(parallel)────┘        │  ▼ GATE-3
   └───────────────┬──────────────────────────────┘
                   ▼
Phase 4  GROUNDING+VALIDATION   WS-G + WS-V        (convergence; needs 1,2,3)
   │  ▼ GATE-4
Phase 5  CONVERSATION ──┐  WS-C        ┌── Phase 6  GENERATION   WS-GEN
   │  ▼ GATE-5          └──(parallel)──┘   │  ▼ GATE-6
   └──────────────┬───────────────────────┘
                  ▼
Phase 7  PROJECTIONS+CONSUMERS   WS-P + WS-CM      (needs stable 1,2; grounding done in 4)
   │  ▼ GATE-7
Phase 8  LEARNING          WS-L                    (terminal consumer; blocks nothing)
   │  ▼ GATE-8  →  CONSTITUTION IN FORCE
```

**The three hard ordering laws** (from [I1] §3):
1. **Writes before everything.** WS-K is the first strangler seam; no context may enforce before the write authority exists.
2. **Trust and Evidence are independent** and parallelize after GATE-1.
3. **Grounding is the convergence** — it cannot assemble a context until Facts (WS-K), Confidence (WS-T), and Evidence (WS-E) are each authoritative.

---

## 3. Per-phase execution: objective, entry, exit, rollback checkpoint

Each phase's internal step sequence lives in its program's "Implementation Sequence" section (K0–K9, T0–T11, E0–E11, G0–G10, C0–C12, GEN0–GEN12, P0–P10, L0–L11). This table sequences the phases themselves.

| Phase | Entry condition | Exit gate (must pass to advance) | Rollback checkpoint |
|---|---|---|---|
| **0 Fabric** | none | GATE-0: event bus verified; correction-rate baseline live; schema lineage ratified; writer-census CI rule installed | Additive-only; trivial revert |
| **1 Writes** | GATE-0 | GATE-1 = **I2A §14** (writer census = 1; shadow overwrite = 0; chat-save validation blocking) | Per-writer flag; legacy writers dormant until GATE-2 |
| **2 Trust** | GATE-1 | GATE-2 = **I2B §16** (one confidence engine; drift = 0; reproducible; complete lineage/provenance) | Per-consumer flag; legacy bands dormant until GATE-2 close |
| **3 Evidence** | GATE-1 (∥ Phase 2) | GATE-3 = **I2C §15** (one evidence layer; immutable; complete routing; SSRF non-regression) | Per-source flag; legacy collection dormant |
| **4 Grounding+Validation** | GATE-1 ∧ GATE-2 ∧ GATE-3 | GATE-4 = **I2D §17** (one grounding authority; one validation pipeline; bypass = 0; deterministic; explainable) | Per-consumer flag; five legacy mechanisms dormant |
| **5 Conversation** | GATE-4 | GATE-5 = **I2E §15** (one engine; zero duplicate questioning; no unvalidated persistence) | Per-mode flag; six legacy endpoints dormant |
| **6 Generation** | GATE-4 (∥ Phase 5) | GATE-6 = **I2F §16** (one runtime; zero inline prompts/direct model calls/unregistered workflows; bench-gated) | Per-workflow flag; prompt/model/pack version re-point |
| **7 Projections+Consumers** | GATE-1 ∧ GATE-2 (grounding-reads done in 4) | GATE-7 = **I2G §16** (one projection runtime; direct-read census = 0; frontend dissolved) | Per-consumer + per-frontend-section flag |
| **8 Learning** | GATE-1..7 all closed | GATE-8 = **I2H §16** (one learning runtime; zero unmanaged learning; correction-rate live) + **all [I1] §15 gates green** | Stop-publication (no production effect); owning-context calibration revert |

---

## 4. Parallelization plan (which PRs can develop simultaneously)

**Safe concurrent development** (no shared write seam, no contract dependency):

| Concurrent set | When | Why safe |
|---|---|---|
| WS-T ∥ WS-E | after GATE-1 | Trust and Evidence share no files; both depend only on Knowledge |
| WS-G ∥ WS-V (co-developed) | Phase 4 | Grounding and Validation are one pair; V1 co-develops with G1 |
| WS-C ∥ WS-GEN | Phase 5/6 | Conversation invokes Generation workflows but they develop against a stub contract; synchronize at conversational-workflow migration |
| Projections P2 ∥ P3 | Phase 7 | independent projection families |
| Frontend sections (P7) | Phase 7 | god-hook dissolution is per-section, sections parallelize |
| Within a context: T3∥T4∥T5, E5 during E2–E4, GEN3∥GEN4, L4∥L5 | per program | independent sub-steps |

**Blocking dependencies (cannot parallelize):**
- Nothing before WS-0 (fabric).
- Nothing writes-adjacent before WS-K.
- WS-G blocked on WS-T + WS-E (convergence).
- WS-V blocked on WS-T (validation assigns confidence).
- WS-CM blocked on WS-P (consumers need projections).
- WS-L blocked on all emitting (terminal).

**Synchronization points** (all branches re-baseline):
1. End of Phase 1 — everything re-baselines on the write authority.
2. End of Phase 4 — all generation-adjacent work re-baselines on grounding+validation.
3. End of Phase 7 — constitution in force for consumers.

**Merge checkpoints:** the CI conformance counters (GOVERNANCE §3) are the continuous merge gate — a branch cannot merge work that raises any census. **Shared-file discipline:** the service barrel and the frontend god hook are *dissolution zones* — parallel work may only delete from them by moving responsibilities into context homes, never edit in place concurrently.

---

## 5. Rollback checkpoints (the safe-revert map)

Every phase is revertible by flag re-point; no phase performs a destructive data operation while its predecessor's path is within the rollback window ([I1] §11).

| Checkpoint | Revert action | Guarantee |
|---|---|---|
| Any write cutover (Phase 1) | re-activate dormant legacy writer per tenant, atomically | append-only history is rollback-proof; no data loss |
| Any confidence flip (Phase 2) | calculator-version re-point; legacy bands dormant | trust history append-only; no loss |
| Any evidence source (Phase 3) | legacy collection flag revert | evidence immutable/additive; no loss |
| Any grounding consumer (Phase 4) | per-consumer revert to legacy serialization | grounding deterministic/recomputable; no interruption |
| Any conversation mode (Phase 5) | per-mode revert to legacy endpoint | transcripts append-only; resumable; no loss |
| Any workflow (Phase 6) | prompt/model/pack version re-point | runs idempotent; no interruption |
| Any consumer/frontend section (Phase 7) | per-consumer / per-section flag revert | projections rebuildable; no interruption |
| Learning (Phase 8) | stop-publication + owning-context calibration revert | nothing auto-applied; zero production effect |

**Rule:** each critical phase (1, 2, 4, 7) must **demonstrate** an exercised rollback in a pre-production tenant before enforcement — rollback is proven, not assumed ([I1] §14).

---

## 6. Production release milestones (sequencing, not dates)

Enforcement within every phase is **per-tenant**: internal → beta → cohorts → all. The protected production tenants move last, always after a demonstrated rollback. Release milestones:

| Milestone | Meaning |
|---|---|
| **M0 — Fabric live** | GATE-0 passed; the platform can measure itself and route events |
| **M1 — Writes owned** | GATE-1; the ten-writer surface replaced; the unvalidated chat-save path closed |
| **M2 — Trust+Evidence owned** | GATE-2 ∧ GATE-3; confidence reproducible, evidence routed |
| **M3 — Grounding+Validation owned** | GATE-4; five grounding mechanisms → one; validation universal |
| **M4 — Interaction plane owned** | GATE-5 ∧ GATE-6; conversations unified, generation governed |
| **M5 — Read plane owned** | GATE-7; zero direct reads; frontend consolidated |
| **M6 — Constitution in force** | GATE-8; platform self-measuring; all [I1] §15 gates green |

Each milestone is reached tenant-cohort by tenant-cohort; a milestone is "complete" only when all rollout tenants are enforced and the prior legacy path is in declared sunset.

---

## 7. Feature-complete vs. production-ready (the two-line definition)

For every workstream, phase, and the platform:

- **Feature-complete** = the new runtime exists, all its steps are built, and it passes its own suites in **shadow** (computing alongside legacy, serving nothing authoritative). No production behavior has changed.
- **Production-ready** = the runtime is **enforced** per-tenant with its certification gate green in production, its rollback demonstrated, its observability live, and its legacy path dormant-with-sunset. Production behavior now flows through it.

The gap between the two is the shadow → compare → enforce ladder. A workstream is never "production-ready" on the strength of tests alone — it requires a clean shadow window against real traffic and a demonstrated revert.

---

## 8. Certification-gate sequencing (what must pass before the next phase starts)

No phase begins enforcement until its **upstream** gates are closed:

```
GATE-0 ─┬─▶ GATE-1 ─┬─▶ GATE-2 ─┐
        │           └─▶ GATE-3 ─┼─▶ GATE-4 ─┬─▶ GATE-5 ─┐
        │                       │            └─▶ GATE-6 ─┼─▶ GATE-7 ─▶ GATE-8
        └───────────────────────┘ (7 also needs 1,2) ────┘
```

- **GATE-1 is the master gate** — no other phase may *enforce* before it (all depend on the write authority).
- **GATE-4 is the convergence gate** — Phases 5, 6, 7 all depend on grounding+validation being authoritative.
- **GATE-8 ratifies the constitution** — it requires every prior gate plus the full [I1] §15 production-gate set (Architecture, Contract, Consumer, Performance, Security, AI Quality, Confidence, Explainability, Data Integrity, Rollback).

Development of a downstream phase may proceed in parallel (feature-complete in shadow); only *enforcement* is gate-blocked.

## 9. Risk-driven sequencing adjustments

From the [I1] §12 risk register, three risks shape the sequence:

- **R1 (unknown 11th writer, Critical):** the Phase-0 static writer census runs *before* any Phase-1 cutover — detection precedes action.
- **R4 (frontend destabilization, High):** the frontend (Phase 7) is deliberately last, per-section, beta-first — the highest-uncertainty UI surface never leads.
- **R10 (schema/environment drift, High):** the Phase-0 schema-lineage audit runs before write-authority work, and the silent column-drop retry is instrumented to error-visibility immediately in Phase 1.

## 10. Definition of done (the three levels)

- **Workstream done:** §5 criteria of its program; conformance counters at target; flags at legacy-retired or documented sunset; suites green.
- **Phase done:** its certification gate passed in production for all rollout tenants; rollback demonstrated; dashboards live.
- **Platform done:** all [D2] §12 conformance areas pass continuously; all P1–P30 hold; all [I1] §15 gates green; all legacy retired or in sunset; the Learning Loop reports correction-rate trends per field family (the terminal certified gap, A4 §1, closed).

---

## 11. Execution summary (one screen)

1. **Phase 0** stands up measurement, events, flags, schema lineage, and the writer census. *Nothing moves until this is green.*
2. **Phase 1** owns the writes — the master gate; everything downstream depends on it. Two early critical fixes land here (chat-save validation; confidence key registry groundwork).
3. **Phases 2 & 3** run in parallel — Trust makes confidence reproducible, Evidence routes all evidence.
4. **Phase 4** converges them into one grounding authority and one validation pipeline.
5. **Phases 5 & 6** run in parallel on top of Phase 4 — unified conversations, governed generation.
6. **Phase 7** builds projections and migrates every consumer, frontend last and per-section.
7. **Phase 8** closes the loop — the platform measures its own correction rate, and the constitution is in force.

Every step is flag-gated, shadow-validated, per-tenant enforced, and demonstrably revertible. Delivery is governed continuously by the CI census rules and the [`CONFORMANCE-CHECKLIST`](../CONFORMANCE-CHECKLIST.md); milestones M0–M6 mark the release path.

---
**Related:** [IMPLEMENTATION-001](IMPLEMENTATION-001.md) · [IMPLEMENTATION-002A..H](IMPLEMENTATION-002A.md) · [`../diagrams/dependency-graph.md`](../diagrams/dependency-graph.md) · [`../diagrams/migration-roadmap.md`](../diagrams/migration-roadmap.md) · **Depends on:** I1, I2A–H · **Related ADRs:** [ADR-010](../adr/ADR-010-constitutional-governance.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-003-FULL.md`](../full/IMPLEMENTATION-003-FULL.md) · **Certification:** operational roadmap. See [`../appendices/relationships.md`](../appendices/relationships.md) · [`../dependency-manifest.yaml`](../dependency-manifest.yaml).

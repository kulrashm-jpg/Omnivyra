# Governance Runtime v1.0.0 — Architecture Reference

**Release:** `GOV-EXEC-RELEASE-v1.0.0-4903e8fb` · **Status:** Engineering Complete · **Frozen**

This is the official engineering reference for the Governance Runtime. It documents the frozen v1.0.0 baseline; it introduces no behavior. Runtime source lives at `docs/company-intelligence/governance-automation/runtime/`.

## 1. Complete Runtime Architecture

Twenty-five single-responsibility runtime modules (all < 500 LOC) over two shared libraries, arranged as an acyclic dependency graph (25 nodes / 15 edges / 0 cycles):

- **Discovery layer** — `lib/repository-model.mjs` performs the single filesystem traversal + parse-once document model, consumed by exactly **WP-02** (documentation validation) and **WP-03** (constitutional census).
- **Invocation seam** — `lib/runtime-invoke.mjs` is the single point through which a runtime obtains another runtime's output. Standalone it spawns; under the orchestrator (`GOV_ORCH_CACHE` set) it reads a pre-populated cache — so no runtime spawns another for a static dependency. Consumed by WP-04–11 and WP-12.
- **Governance runtimes (WP-04–11)** — health, freeze, dependency graph, drift, evidence, release, enforcement, certification.
- **Platform layer (WP-12–17)** — orchestrator, optimizer, activation, assurance, final certification, independent audit.
- **Constitutional layer (WP-18–26)** — lockdown, evolution, succession, active constitution, enforcement, admission gateway, execution authority, supervision, closure.

Each runtime is deterministic (emits a digest excluding timing), dependency-free (Node built-ins only), and reads the constitution as read-only.

## 2. Constitutional Lifecycle

`Gen0 baseline (WP-18) → evolution proposals (WP-19) → certified successors (WP-20) → active constitution (WP-21) → universal enforcement (WP-22) → mandatory admission (WP-23)`. The Gen0 baseline (`BASELINE-Immutable-005975e3-ae8cdfdf`) is sealed permanently; successor generations (Gen1→GenN) are additive; historical generations are never modified. Exactly one Active Constitution governs at any time; activation is reversible by selecting another certified generation, never by rewriting history.

## 3. Execution Lifecycle

`admission (WP-23) → execution authorization (WP-24) → lifecycle dispatch → terminal state`. Every workload passes the mandatory admission gateway (which runs WP-22 enforcement) before execution. The WP-24 authority is the sole executor: only admitted workloads execute, each has exactly one immutable orchestration lifecycle, and duplicate execution is impossible. Lifecycle states: Admitted → Scheduled → Dispatched → Running → {Completed | Failed | Cancelled}; retries preserve execution identity.

## 4. Supervision Lifecycle

`execution (WP-24) → continuous supervision (WP-25)`. Every executing workload is supervised: health evaluation (Healthy / Degraded / Failed / Cancelled), progress tracking, deterministic anomaly detection, and recovery recommendation. No executing workload exists outside supervision; completed/failed/cancelled executions retain complete supervision history.

## 5. Closure Lifecycle

`supervision (WP-25) → constitutional closure (WP-26)`. Every terminal supervised execution is finalized exactly once and receives one immutable governance seal (execution identity + generation + lifecycle completion + supervision completion + verification digest → seal digest). Duplicate closure is impossible; no completed execution remains unsealed.

## 6. Registry Model

Every stateful runtime maintains an **immutable, additive registry** whose active/historical views are *derived* — no record is ever mutated. Registries: census (WP-03), evidence (WP-08), version graph (WP-19), constitutional (WP-20), active-constitution (WP-21), execution (WP-22, WP-24), admission (WP-23), supervision (WP-25), closure (WP-26). Every registry declares `additiveOnly: true` and `immutable: true`.

## 7. Ledger Model

Every decision-producing runtime maintains an **append-only JSONL ledger**; prior entries are never modified. Ledgers: mutation (WP-05), evidence history (WP-08), release (WP-09), enforcement (WP-10), certification (WP-11), deployment (WP-16), audit (WP-17), baseline (WP-18), evolution (WP-19), succession (WP-20), activation (WP-21), constitutional enforcement (WP-22), gateway (WP-23), orchestration (WP-24), supervision (WP-25), closure (WP-26). Ledger directories are gitignored operational evidence.

## 8. Provenance Model

Provenance is immutable and chained: each lifecycle stage records the prior stage's identity + verification digest. `admission → execution → supervision → closure` forms an unbroken immutable chain terminating in the governance seal. Every provenance record declares `immutable: true`; identical inputs reproduce identical provenance (verified by deterministic replay at every stage).

## 9. Determinism & Reproducibility

Every runtime is deterministic: repeated invocation reproduces its digest exactly (timing excluded). The release digest `4903e8fb` is reproducible from the ordered per-runtime digests in `MANIFEST.json`. Business logic is frozen — the base digests (WP-02 `005975e3`, WP-03 `9f16e998`, orchestrator `a1531f8d`) are unchanged since first build.

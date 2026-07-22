# Release Notes — Company Intelligence Constitution v1.0.0

**Effective 2026-07-18.** The first ratified constitutional baseline for the Company Intelligence Platform. See [`RATIFICATION.md`](RATIFICATION.md) and [`VERSION.md`](VERSION.md).

---

## Overview

v1.0.0 establishes the complete, frozen constitutional source of truth: the platform's architecture, implementation program, and governance system, backed by four certified audits and enforced by a measurable conformance regime. The repository can now serve as the long-term authoritative reference for both engineers and governance processes **without requiring conversation history**.

## Major achievements

- **Architecture completed** — the Company Profile subsystem re-architected into six bounded contexts (Identity, Evidence, Knowledge, Trust, Generation, Distribution) with four permanent singleton authorities. Intelligence becomes a projection of knowledge; knowledge a derivation of evidence.
- **Implementation completed (as specification)** — an eight-phase, dependency-sequenced migration program (IMPLEMENTATION-001 + 002A–H + 003), each context program **Ready for Development**, with a machine-readable dependency manifest.
- **Governance completed** — a Production Constitution (DESIGN-002) with 30 invariants, a per-PR Conformance Checklist, nine CI census rules, ten ADRs, an amendment framework, and full lifecycle/history/maintainer policies.
- **Certification completed** — every audit finding traced to its closure; documentation validated with zero broken links; the repository classified **Constitutional Repository v1.0.0 Ready**.

## Closed audit findings

Every certified defect maps to a structural closure (full trace in [`appendices/traceability-matrix.md`](appendices/traceability-matrix.md)):

- 10 write authorities → one write authority (P3, census).
- 5 grounding mechanisms → one Grounding Authority (P11, census).
- Unvalidated chat-save path → universal validation (P19, census).
- Confidence contract drift (key mismatches, `'Needs Review'`, monotonic-max, dup columns) → one confidence vocabulary (P12).
- Evidence mis-routing (KG/Wikidata/blogs/BFS/JSON-LD each one workflow) → one immutable, routed evidence layer.
- Consistency vacuum → single-graph grounding + consistency-tier validation.
- No production correction-rate loop → the Learning Loop's first-class metric (P14).
- Deterministic fabrication (PT boilerplate injector) → prohibited (P20).
- Tenancy by discipline → structural tenancy (P21).
- Dual notification stacks → one event bus + ProjectionUpdated (P23).

## Constitutional milestones

- 24 first-class objects with lifecycles and eight state machines.
- Field-level production contracts with determinability and authority axes.
- A closed domain-event vocabulary (the only cross-context signal).
- 30 platform invariants (P1–P30), four non-waivable singletons.
- Measurable conformance (DESIGN-002 §12) wired to CI census rules.

## Implementation milestones

- Eight phases with a fixed dependency spine: Fabric → Writes → Trust ∥ Evidence → Grounding+Validation → Conversation ∥ Generation → Projections+Consumers → Learning.
- Release milestones M0–M6; per-tenant enforcement via the off/shadow/compare/enforce/legacy-retired flag ladder.
- Feature-complete vs. production-ready defined; rollback checkpoints per phase.

## Governance milestones

- Dual-document strategy complete: every constitutional document has a maintained Reference Edition and a frozen Full Edition.
- START-HERE onboarding entry point; ADR-001..010; amendment framework; dependency manifest (YAML + JSON); traceability matrix.
- Nine CI census rules make the four singletons and the key invariants machine-enforceable.

## Known limitations

- The implementation programs are **specifications**, not code — classified "Ready for Development." No platform code has been changed by this documentation work; the migration itself begins with Phase 0.
- Anchor-level (`#section`) links follow GitHub slug conventions and are not deep-validated; document-level links are all verified (zero broken).
- Full Editions are frozen archival snapshots; the Reference Editions are the maintained versions (this is by design — "never duplicate maintenance effort").

## Future amendment policy

After v1.0.0, constitutional documents are **immutable**. Changes occur only through:

- **Amendments** (for any change to a ratified decision — see [`amendments/README.md`](amendments/README.md)),
- **ADRs** (recording new major decisions),
- **new implementation programs** (extending the eight-phase program), and
- **new releases** (bumping the constitution version per [`VERSION.md`](VERSION.md)).

Ratified documents are never modified directly. The four singletons and non-waivable invariants cannot be amended away.

---
**Related:** [`VERSION.md`](VERSION.md) · [`RATIFICATION.md`](RATIFICATION.md) · [`HISTORY.md`](HISTORY.md) · [`LIFECYCLE.md`](LIFECYCLE.md) · [`appendices/traceability-matrix.md`](appendices/traceability-matrix.md) · **Related ADRs:** [ADR-010](adr/ADR-010-constitutional-governance.md).

# Constitutional Version

## Current Version

**Company Intelligence Constitution — Version 1.0.0**

| Field | Value |
|---|---|
| Version | 1.0.0 |
| Status | **Ratified** (see [`RATIFICATION.md`](RATIFICATION.md)) |
| Ratification date | 2026-07-18 |
| Constitutional baseline | DESIGN-002 (Production Constitution Complete) |
| Architecture baseline | DESIGN-001 (six bounded contexts, four singletons) |
| Certified facts baseline | AUDIT-001 → AUDIT-004 |
| Supported implementation programs | IMPLEMENTATION-001, IMPLEMENTATION-002A → 002H, IMPLEMENTATION-003 |
| Supported amendment generation | AMENDMENT-001 onward (framework: [`amendments/`](amendments/)) |
| Release notes | [`RELEASE-NOTES-v1.0.0.md`](RELEASE-NOTES-v1.0.0.md) |

Version 1.0.0 is the first ratified constitutional baseline. All implementation, review, and governance work is evaluated against it.

## What is versioned

The constitution version covers the ratified document set as a whole: the four audits, DESIGN-001/002, IMPLEMENTATION-001/002A–H/003, the ten ADRs, and the governance framework. Individual artifacts also carry their own SemVer where noted (prompts, models, grounding, projections, consumer contracts, etc., per DESIGN-002 §10); the constitution version is the umbrella baseline those artifacts target.

## Semantic versioning (no ambiguity)

The constitution follows SemVer `MAJOR.MINOR.PATCH`:

| Bump | Meaning | Examples | How it happens |
|---|---|---|---|
| **MAJOR** (x.0.0) | A **constitutional change** — a modification to an invariant (P1–P30), a context boundary, an ownership assignment, a certification gate, a state machine, a field/consumer/event contract, or the removal/addition of a bounded context or singleton authority. | Changing a confidence dimension; redefining a write-authority boundary; altering GATE-4 criteria. | **Only** via a ratified [amendment](amendments/README.md) classed MAJOR. Never by direct edit. |
| **MINOR** (1.x.0) | An **additive constitutional capability** — a new contract, event, consumer profile, industry pack family, ADR for a *new* decision, or a new appendix/tooling that extends governance without changing any existing decision. | Adding a new consumer contract; a new domain event; a new ADR. | Via a ratified amendment classed MINOR, or additive governance work that touches no ratified decision. |
| **PATCH** (1.0.x) | An **editorial or documentation improvement** — clarifications, typo fixes, navigation/cross-link updates, new diagrams, expanded rationale in Full Editions — that changes **no** decision, contract, gate, or invariant. | Fixing a broken link; clarifying wording; adding a glossary term. | Ordinary additive documentation work; no amendment required. |

**Rule of thumb:** if it changes what an implementation must do to be conformant → MAJOR. If it adds a new conformant capability without changing the old → MINOR. If it only makes the documents clearer → PATCH.

## The non-negotiable line

No MAJOR or MINOR change may remove a **singleton authority** (P4) or weaken a **non-waivable invariant** (P3, P8, P14, P19, P21, P30). Such a change is rejected at proposal (see [`amendments/README.md`](amendments/README.md)).

## Version history

| Version | Date | Change | Notes |
|---|---|---|---|
| 1.0.0 | 2026-07-18 | Initial ratification | Full constitutional baseline; see [RELEASE-NOTES-v1.0.0](RELEASE-NOTES-v1.0.0.md) |

---
**Related:** [`RATIFICATION.md`](RATIFICATION.md) · [`RELEASE-NOTES-v1.0.0.md`](RELEASE-NOTES-v1.0.0.md) · [`amendments/README.md`](amendments/README.md) · [`HISTORY.md`](HISTORY.md) · **Related ADRs:** [ADR-010](adr/ADR-010-constitutional-governance.md).

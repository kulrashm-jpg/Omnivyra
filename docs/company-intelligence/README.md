# Company Intelligence Platform — Canonical Specification Set

This directory is the **authoritative engineering reference** for the Company Intelligence Platform. It supersedes any architecture implied by the current implementation. Every implementation, code review, pull request, and future feature is evaluated for conformance against these documents.

> **Status:** Constitutional. The specification is complete and frozen at v1.0. Implementation work derives from the implementation programs; it does not make independent architectural decisions.
>
> **New here? Start with [`START-HERE.md`](START-HERE.md)** — the ten-minute engineer entry point.

---

## What this is

The platform's Company Profile subsystem was audited end-to-end, redesigned as a canonical Company Intelligence Platform, frozen into a Production Constitution, and decomposed into an eight-phase implementation program. This directory persists all of that work so it lives in the repository rather than in a conversation.

The set answers four questions, in order:

1. **What exists today?** — the four audits (`architecture/AUDIT-001..004`)
2. **What should it become?** — the architecture and constitution (`architecture/DESIGN-001..002`)
3. **How is it built?** — the migration blueprint and eight context programs (`implementation/IMPLEMENTATION-001`, `002A..H`)
4. **How is conformance enforced?** — the checklist and execution roadmap (`CONFORMANCE-CHECKLIST.md`, `implementation/IMPLEMENTATION-003.md`)

---

## How to use this directory

| If you are… | Start with |
|---|---|
| New to the platform | [`START-HERE.md`](START-HERE.md) → [`architecture/DESIGN-001.md`](architecture/DESIGN-001.md) |
| Reviewing a PR | [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md) |
| Implementing a context | the matching `implementation/IMPLEMENTATION-002*.md`, then its [`adr/`](adr/) + [`GOVERNANCE.md`](GOVERNANCE.md) |
| Planning execution / sequencing | [`implementation/IMPLEMENTATION-003.md`](implementation/IMPLEMENTATION-003.md) + [`dependency-manifest.yaml`](dependency-manifest.yaml) |
| Understanding *why* a decision was made | the [`adr/`](adr/) (ten Architecture Decision Records) |
| Proposing a constitutional change | [`amendments/`](amendments/) |
| Looking up a term, invariant, event, gate, or trace | the [`appendices/`](appendices/) |
| Understanding the shape at a glance | the [`diagrams/`](diagrams/) |

## Document editions

Each constitutional document has a concise, maintained **Reference Edition** (in `architecture/` and `implementation/` — the files you edit and PRs cite) and may have an archival **Full Edition** in [`full/`](full/) preserving the complete original rationale, frozen at ratification. Only the Reference Edition is maintained; changes to a ratified decision go through an [amendment](amendments/), never an in-place edit. See [`full/README.md`](full/README.md) for the convention.

---

## The one-paragraph summary

The platform is re-architected into **six bounded contexts** — Identity, Evidence, Knowledge, Trust, Generation, Distribution — with **exactly one write authority, one grounding authority, one confidence vocabulary, and one conversation engine** (the four singleton invariants). Company intelligence becomes a *projection of knowledge*, knowledge a *derivation of evidence*. Every AI workflow grounds through one authority and validates through one pipeline; every fact carries confidence and provenance; every value is explainable; and the platform measures its own correction rate. The migration is a strangler pattern executed writes-first, measured-before-moved, behind proven off/shadow/enforce flag machinery, in eight dependency-ordered phases.

---

## Conformance rule (the governing test)

An implementation is **conformant** if and only if it:

1. writes through the single Knowledge write authority,
2. grounds through the Grounding Authority,
3. validates through the Validation Pipeline,
4. uses the canonical confidence vocabulary,
5. leaves every persisted fact explainable, **and**
6. violates none of the invariants P1–P30 (see [`appendices/invariants.md`](appendices/invariants.md)).

Any change that adds a second writer, grounding path, confidence vocabulary, or conversation stack is **non-conformant regardless of local merit**.

---

## Document lineage

```
AUDIT-001..004   (certified facts — what exists)
      ↓
DESIGN-001       (target architecture — what it becomes)
      ↓
DESIGN-002       (Production Constitution — frozen contracts)
      ↓
IMPLEMENTATION-001   (migration blueprint — how, sequenced)
      ↓
IMPLEMENTATION-002A..H   (eight context programs — one per phase)
      ↓
IMPLEMENTATION-003   (execution roadmap — the executable plan)
      +
CONFORMANCE-CHECKLIST   (the per-PR enforcement gate)

Governance layer (additive, DOCS-GOVERNANCE-001):
  START-HERE.md            engineer entry point
  adr/ADR-001..010         why each major decision was made
  amendments/              the only way to change a ratified decision
  dependency-manifest.*    machine-readable graph (yaml + json)
  appendices/traceability-matrix.md   finding → closure trace
  full/                    archival full editions (all documents)

Ratification & preservation layer (DOCS-GOVERNANCE-002):
  VERSION.md               constitutional version (v1.0.0) + SemVer rules
  RATIFICATION.md          ratification record + frozen document list
  RELEASE-NOTES-v1.0.0.md  what shipped in v1.0.0
  LIFECYCLE.md             Draft→Review→Ratified→Superseded→Archived
  HISTORY.md               never delete / never overwrite / never rewrite
  MAINTAINERS.md           roles & responsibilities
  FINAL-VALIDATION.md      evidence-based repository consistency audit
```

**Constitution status:** ratified at **v1.0.0** (2026-07-18). Ratified documents are frozen — change only via [amendments](amendments/). See [`VERSION.md`](VERSION.md) and [`RATIFICATION.md`](RATIFICATION.md).

**Governance automation:** the [`governance-automation/`](governance-automation/) tree specifies how this constitution is automatically enforced (audit → runtimes → realization → certification → execution). It is additive and references the constitution; it never modifies it. Implementation status: [Partially Implemented](governance-automation/execution/IMPLEMENT-GOV-001.md).

See [`INDEX.md`](INDEX.md) for the full document map, [`appendices/relationships.md`](appendices/relationships.md) for the cross-reference, and [`appendices/certification-history.md`](appendices/certification-history.md) for each document's classification.

---
**Related:** [`START-HERE.md`](START-HERE.md) · [`INDEX.md`](INDEX.md) · [`GOVERNANCE.md`](GOVERNANCE.md) · [`adr/`](adr/) · [`amendments/`](amendments/) · [`appendices/relationships.md`](appendices/relationships.md)

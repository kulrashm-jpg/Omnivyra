# Constitutional Amendment Framework

Ratified documents — DESIGN-001, DESIGN-002, IMPLEMENTATION-001, IMPLEMENTATION-002A–H, IMPLEMENTATION-003, and the ADRs — are **frozen**. They are never overwritten. Any change to a constitutional decision occurs **only** through an amendment recorded here.

This preserves the decision trail: the original stands as history; the amendment supersedes it going forward.

## Why amendments (not edits)

Editing a ratified document in place destroys the record of *why the decision was what it was* and invites silent divergence — exactly the drift the constitution exists to prevent (ADR-010). An amendment is an additive, versioned, evidence-backed change with an explicit supersession link.

## What requires an amendment

- Changing any invariant P1–P30, or any field/consumer/state-machine/event contract in DESIGN-002.
- Changing a context boundary, ownership assignment, or the target architecture in DESIGN-001.
- Changing implementation sequencing, a workstream's scope, or a certification gate in IMPLEMENTATION-001/002*/003.
- Changing an ADR decision.
- Adding a new bounded context, singleton authority, or census rule.

Routine additive documentation (new appendices, diagrams, ADRs for already-ratified decisions, tooling) does **not** require an amendment — it is ordinary additive work.

## What cannot be amended away

The four singletons (P4 — one write authority, one grounding authority, one confidence vocabulary, one conversation engine) and the other non-waivable invariants (P3, P8, P14, P19, P21, P30 — see [`../appendices/invariants.md`](../appendices/invariants.md)). An amendment proposing to remove a singleton or non-waivable invariant is rejected at proposal.

## Amendment lifecycle

```
DRAFT ──▶ PROPOSED ──▶ UNDER REVIEW ──▶ { RATIFIED | REJECTED }
                                              │
                                     RATIFIED ▼
                              supersedes target section(s);
                              original preserved as history
```

| Stage | Meaning | Owner |
|---|---|---|
| **Draft** | Authoring; not yet circulated | Proposer |
| **Proposed** | Circulated with evidence + impact analysis | Proposer |
| **Under Review** | Affected-context owners + a ratifier evaluate | Reviewers |
| **Ratified** | Accepted; supersedes the target; version bumped (SemVer) | Ratifier |
| **Rejected** | Declined; retained as history with rationale | Ratifier |
| **Superseded** | A later amendment replaces this one | (automatic on the later ratification) |

## Rules

1. **The prior constitution stands until ratification.** Work continues against the current version; an in-flight amendment does not change conformance.
2. **Evidence-driven.** Every amendment states the audit finding, production incident, or operational evidence motivating it. Preference is not evidence.
3. **Impact-complete.** An amendment identifies every affected invariant, gate, ADR, program, census rule, and consumer contract, and updates the [Conformance Checklist](../CONFORMANCE-CHECKLIST.md) and [dependency manifest](../dependency-manifest.yaml) in the same change.
4. **Supersession, not deletion.** Ratified and rejected amendments are permanent history. A ratified amendment links to the exact section(s) it supersedes; the target document gains a "Superseded By" note pointing here (the only edit permitted to a ratified doc — a forward pointer, never a content change).
5. **SemVer.** MAJOR = breaking contract change, MINOR = additive, PATCH = corrective. The constitution version advances on ratification.
6. **Non-waivable guard.** Amendments touching the four singletons or non-waivable invariants are rejected at proposal.

## Numbering & files

- Amendments are numbered sequentially: `AMENDMENT-001-<slug>.md`, `AMENDMENT-002-<slug>.md`, …
- Use [`AMENDMENT-001-template.md`](AMENDMENT-001-template.md) as the starting point (copy, renumber, fill in).
- This directory is the amendment ledger; its history is the constitution's change log.

## Ledger

| # | Title | Status | Supersedes | Ratified version |
|---|---|---|---|---|
| — | (no amendments yet — the constitution is at v1.0) | — | — | — |

**Related:** [`../GOVERNANCE.md`](../GOVERNANCE.md) §4 (amendment process) · [`../adr/ADR-010-constitutional-governance.md`](../adr/ADR-010-constitutional-governance.md) · [`../appendices/invariants.md`](../appendices/invariants.md).

# Repository Lifecycle

Defines the lifecycle stages a constitutional document moves through, with entry/exit criteria, required approvals, amendment interactions, and retirement. This governs how documents are created, ratified, superseded, and archived — it does not change any ratified decision.

## Stages

```
Draft ──▶ Review ──▶ Ratified ──▶ Superseded ──▶ Archived
  │                     │
  └──────▶ Withdrawn ◀──┘
```

## Stage definitions

### Draft
- **Entry:** a new document is authored (a new ADR, appendix, diagram, or a proposed amendment).
- **Exit:** submitted for review with its cross-links and, if it changes a decision, an amendment attached.
- **Approvals:** none required to draft.
- **Amendment interaction:** a draft that would change a ratified decision must be a Draft **amendment**, not a direct edit.

### Review
- **Entry:** a Draft is circulated with evidence and impact analysis.
- **Exit:** affected-context owners and a ratifier reach a decision (→ Ratified or → Withdrawn/Rejected).
- **Approvals:** the relevant context owner(s) + a ratifier (see [`MAINTAINERS.md`](MAINTAINERS.md)).
- **Amendment interaction:** amendments in review follow the [amendment lifecycle](amendments/README.md); the prior constitution stands until ratification.

### Ratified
- **Entry:** accepted in Review; version bumped per [`VERSION.md`](VERSION.md); recorded in [`RATIFICATION.md`](RATIFICATION.md) / [`HISTORY.md`](HISTORY.md).
- **State:** **frozen** — never overwritten, rewritten, or deleted. Editorial/PATCH updates to Reference Editions are permitted (they change no decision).
- **Exit:** only by being Superseded (via a later ratified amendment) — never by deletion.
- **Approvals:** the ratifier.
- **Amendment interaction:** changes require a ratified amendment; the document gains a forward "Superseded By" pointer (the only content edit permitted to a ratified doc).

### Superseded
- **Entry:** a later ratified amendment replaces some or all of a Ratified document's decisions.
- **State:** retained in place as history; carries a "Superseded By" pointer to the amendment.
- **Exit:** → Archived when no longer part of the active navigation surface.
- **Approvals:** automatic on the superseding ratification.
- **Amendment interaction:** the superseding amendment is the record of what changed and why.

### Archived
- **Entry:** a Superseded (or obsolete additive) document is moved out of the active surface but preserved.
- **State:** read-only historical record; never deleted (see [`HISTORY.md`](HISTORY.md)).
- **Exit:** none — archival is terminal preservation, not deletion.
- **Approvals:** the governance maintainer.

### Withdrawn
- **Entry:** a Draft or Reviewed proposal is declined before ratification (or a proposer retracts it).
- **State:** retained as history with the rationale for withdrawal/rejection.
- **Exit:** none.
- **Approvals:** the ratifier (for rejection) or the proposer (for retraction).
- **Amendment interaction:** a withdrawn amendment remains in the [amendments ledger](amendments/README.md) as history.

## Required approvals (summary)

| Transition | Approver(s) |
|---|---|
| Draft → Review | proposer submits |
| Review → Ratified | affected context owner(s) + ratifier |
| Review → Withdrawn | ratifier (reject) or proposer (retract) |
| Ratified → Superseded | automatic on superseding amendment's ratification |
| Superseded → Archived | governance maintainer |

## Retirement

Retirement means **archival, never deletion**. A retired document is moved to a read-only historical state and preserved permanently. Legacy code paths retire per the migration flag ladder (off → … → legacy-retired), but the *documents* describing decisions are never removed — even superseded decisions remain as the record of how the platform reasoned.

## Interaction with the migration program

Document lifecycle is distinct from the implementation phase gates. A document can be Ratified while its implementation program has not yet been executed (all 002 programs are Ratified specifications at v1.0.0, awaiting their phase gates). Executing a phase does not change a document's lifecycle stage; only an amendment does.

---
**Related:** [`HISTORY.md`](HISTORY.md) · [`amendments/README.md`](amendments/README.md) · [`VERSION.md`](VERSION.md) · [`MAINTAINERS.md`](MAINTAINERS.md) · [`GOVERNANCE.md`](GOVERNANCE.md) · **Related ADRs:** [ADR-010](adr/ADR-010-constitutional-governance.md).

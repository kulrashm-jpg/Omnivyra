# Historical Preservation Policy

The Company Intelligence repository is an **append-only historical record**. This mirrors, at the documentation layer, the platform's own core invariant that knowledge is append-only (P15): reasoning is never lost.

## The three prohibitions

1. **Never delete.** No ratified document, Full Edition, ADR, amendment, or release record is ever deleted. Obsolete documents are archived (moved to a read-only historical state), never removed.
2. **Never overwrite.** A ratified decision is never overwritten in place. Changes are made by *superseding* amendments that leave the original intact.
3. **Never rewrite ratified documents.** The content of a ratified document is frozen. The only permitted edit to a ratified document is a forward "Superseded By" pointer added when an amendment supersedes it. Reference Editions accept editorial/PATCH updates (typos, links, clarifications) that change no decision.

## Why

The audits proved the platform decayed through silent divergence — capabilities existed but adoption drifted and ownership eroded. Preserving the full reasoning trail (why each decision was made, what it superseded, what evidence motivated it) is what lets future engineers and governance processes reconstruct intent without conversation history. A lost rationale is a future re-litigation.

## What is preserved, and how

| Artifact class | Preservation rule |
|---|---|
| **Reference Editions** (`architecture/`, `implementation/`) | Maintained (editorial/PATCH); decisions frozen; superseded only via amendment. |
| **Full Editions** (`full/`) | Frozen archival snapshots of the complete rationale at ratification. Never edited. |
| **Amendments** (`amendments/`) | Every amendment — Draft, Proposed, Ratified, **Rejected**, Superseded — is retained permanently in the ledger. Rejections are history too. |
| **ADRs** (`adr/`) | Ratified decision records. Superseded ADRs are marked, not deleted; a new ADR or amendment records the change. |
| **Release history** (`RELEASE-NOTES-v*.md`) | One release-notes file per version, retained permanently. New versions add files; they do not replace old ones. |
| **Certification history** (`appendices/certification-history.md`, `RATIFICATION.md`, `VALIDATION-REPORT.md`, `FINAL-VALIDATION.md`) | Retained permanently as the certification trail. |
| **Version records** (`VERSION.md`) | The version-history table is append-only; each version is a permanent row. |

## Supersession, not replacement

When a decision changes:
- a ratified **amendment** is added to `amendments/`;
- the superseded document gains a forward "Superseded By" pointer;
- the document's lifecycle stage advances to **Superseded** (then eventually **Archived**);
- the original content **stays** — readable, cited, and preserved.

At no point is the prior reasoning removed. A reader can always trace: current decision → the amendment that set it → the decision it superseded → the original rationale (Reference + Full Edition) → the audit finding that motivated the whole chain.

## Release history

| Version | Date | Record |
|---|---|---|
| 1.0.0 | 2026-07-18 | [`RELEASE-NOTES-v1.0.0.md`](RELEASE-NOTES-v1.0.0.md) · [`RATIFICATION.md`](RATIFICATION.md) |

## Certification history

The certification trail is preserved across: [`appendices/certification-history.md`](appendices/certification-history.md) (per-document verdicts + defect-closure ledger), [`appendices/traceability-matrix.md`](appendices/traceability-matrix.md) (finding → closure), [`VALIDATION-REPORT.md`](VALIDATION-REPORT.md) and [`FINAL-VALIDATION.md`](FINAL-VALIDATION.md) (evidence-based validation), and [`RATIFICATION.md`](RATIFICATION.md) (the ratification record).

---
**Related:** [`LIFECYCLE.md`](LIFECYCLE.md) · [`amendments/README.md`](amendments/README.md) · [`VERSION.md`](VERSION.md) · [`RATIFICATION.md`](RATIFICATION.md) · **Related ADRs:** [ADR-010](adr/ADR-010-constitutional-governance.md).

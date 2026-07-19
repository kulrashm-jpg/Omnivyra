# Full Editions — Archival Long-Form

This directory holds the **Full Editions** of constitutional documents. It is the second half of the platform's **dual-document strategy**.

## The dual-document strategy

Every constitutional document exists in up to two editions:

| Edition | Location | Role | Maintained? |
|---|---|---|---|
| **Reference Edition** | `architecture/`, `implementation/` | Navigation-friendly, certification-ready, concise. The working document engineers read and PRs cite. | **Yes — authoritative for maintenance.** |
| **Full Edition** | `full/` | Preserves the complete original rationale, historical discussion, full matrices, implementation reasoning, and constitutional explanations. Frozen archival record. | No — frozen at ratification. |

**Why two.** The Reference Edition keeps day-to-day navigation and PR review fast. The Full Edition preserves the complete reasoning so no rationale is lost as documents are maintained. To honor "never duplicate maintenance effort," **only the Reference Edition is maintained**; the Full Edition is a frozen snapshot. If a decision changes, it changes through an [amendment](../amendments/README.md) against the Reference Edition — the Full Edition remains as history.

**Linkage.** Each Reference Edition that has a Full Edition carries a footer pointing here; each Full Edition points back to its Reference Edition. Where a Full Edition has not yet been generated, the Reference Edition is complete and authoritative on its own — no broken link is created (pending full editions are noted in plain text, not linked).

## Contents

**As of constitution v1.0.0, the dual-document strategy is complete — every constitutional document has both editions.**

| Full Edition | Reference Edition |
|---|---|
| [`AUDIT-001-FULL.md`](AUDIT-001-FULL.md) | [`../architecture/AUDIT-001.md`](../architecture/AUDIT-001.md) |
| [`AUDIT-002-FULL.md`](AUDIT-002-FULL.md) | [`../architecture/AUDIT-002.md`](../architecture/AUDIT-002.md) |
| [`AUDIT-003-FULL.md`](AUDIT-003-FULL.md) | [`../architecture/AUDIT-003.md`](../architecture/AUDIT-003.md) |
| [`AUDIT-004-FULL.md`](AUDIT-004-FULL.md) | [`../architecture/AUDIT-004.md`](../architecture/AUDIT-004.md) |
| [`DESIGN-001-FULL.md`](DESIGN-001-FULL.md) | [`../architecture/DESIGN-001.md`](../architecture/DESIGN-001.md) |
| [`DESIGN-002-FULL.md`](DESIGN-002-FULL.md) | [`../architecture/DESIGN-002.md`](../architecture/DESIGN-002.md) |
| [`IMPLEMENTATION-001-FULL.md`](IMPLEMENTATION-001-FULL.md) | [`../implementation/IMPLEMENTATION-001.md`](../implementation/IMPLEMENTATION-001.md) |
| [`IMPLEMENTATION-002A-FULL.md`](IMPLEMENTATION-002A-FULL.md) | [`../implementation/IMPLEMENTATION-002A.md`](../implementation/IMPLEMENTATION-002A.md) |
| [`IMPLEMENTATION-002B-FULL.md`](IMPLEMENTATION-002B-FULL.md) | [`../implementation/IMPLEMENTATION-002B.md`](../implementation/IMPLEMENTATION-002B.md) |
| [`IMPLEMENTATION-002C-FULL.md`](IMPLEMENTATION-002C-FULL.md) | [`../implementation/IMPLEMENTATION-002C.md`](../implementation/IMPLEMENTATION-002C.md) |
| [`IMPLEMENTATION-002D-FULL.md`](IMPLEMENTATION-002D-FULL.md) | [`../implementation/IMPLEMENTATION-002D.md`](../implementation/IMPLEMENTATION-002D.md) |
| [`IMPLEMENTATION-002E-FULL.md`](IMPLEMENTATION-002E-FULL.md) | [`../implementation/IMPLEMENTATION-002E.md`](../implementation/IMPLEMENTATION-002E.md) |
| [`IMPLEMENTATION-002F-FULL.md`](IMPLEMENTATION-002F-FULL.md) | [`../implementation/IMPLEMENTATION-002F.md`](../implementation/IMPLEMENTATION-002F.md) |
| [`IMPLEMENTATION-002G-FULL.md`](IMPLEMENTATION-002G-FULL.md) | [`../implementation/IMPLEMENTATION-002G.md`](../implementation/IMPLEMENTATION-002G.md) |
| [`IMPLEMENTATION-002H-FULL.md`](IMPLEMENTATION-002H-FULL.md) | [`../implementation/IMPLEMENTATION-002H.md`](../implementation/IMPLEMENTATION-002H.md) |
| [`IMPLEMENTATION-003-FULL.md`](IMPLEMENTATION-003-FULL.md) | [`../implementation/IMPLEMENTATION-003.md`](../implementation/IMPLEMENTATION-003.md) |

Every Reference Edition links to its Full Edition and vice versa; the authoritative map is [`../appendices/relationships.md`](../appendices/relationships.md).

**Related:** [`../START-HERE.md`](../START-HERE.md#document-editions) · [`../README.md`](../README.md#document-editions) · [`../appendices/relationships.md`](../appendices/relationships.md).

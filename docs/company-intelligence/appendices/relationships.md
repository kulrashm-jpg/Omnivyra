# Appendix — Document Relationships (Master Cross-Reference)

The single maintained source for how every document relates to the others. Each document carries a short "Related Documents" footer pointing here; this table is the authoritative map, so relationships are maintained in **one place** (honoring "never duplicate maintenance effort").

Columns: **Depends on** (what it builds on) · **Supersedes / Superseded by** (edition or amendment lineage) · **Related ADRs** · **Related Amendments** · **Certification reference** (its verdict/gate).

## Architecture

| Document | Depends on | Supersedes / Superseded by | Related ADRs | Amendments | Certification |
|---|---|---|---|---|---|
| AUDIT-001 | — | Reference; Full: [`full/AUDIT-001-FULL.md`](../full/AUDIT-001-FULL.md) | — | none | Highly Coupled ([cert-history](certification-history.md)) |
| AUDIT-002 | AUDIT-001 | Reference; Full: [`full/AUDIT-002-FULL.md`](../full/AUDIT-002-FULL.md) | ADR-001 | none | Partially Owned |
| AUDIT-003 | AUDIT-001/002 | Reference; Full: [`full/AUDIT-003-FULL.md`](../full/AUDIT-003-FULL.md) | ADR-002,004,005,007 | none | Hybrid |
| AUDIT-004 | AUDIT-001..003 | Reference; Full: [`full/AUDIT-004-FULL.md`](../full/AUDIT-004-FULL.md) | ADR-003,005,009 | none | Moderate |
| DESIGN-001 | AUDIT-001..004 | Reference; Full: [`full/DESIGN-001-FULL.md`](../full/DESIGN-001-FULL.md) | ADR-001..010 | none | target architecture |
| DESIGN-002 | DESIGN-001 | Reference; Full: [`full/DESIGN-002-FULL.md`](../full/DESIGN-002-FULL.md) | ADR-001..010 | none | Constitution Complete |

## Implementation

All implementation Reference Editions have a Full Edition in [`../full/`](../full/) (e.g. `IMPLEMENTATION-002A-FULL.md`), linked bidirectionally.

| Document | Depends on | Related ADRs | Amendments | Certification |
|---|---|---|---|---|
| IMPLEMENTATION-001 | DESIGN-001/002 | ADR-010 | none | Ready |
| IMPLEMENTATION-002A | I1 | ADR-001 | none | Ready for Development · GATE-1 |
| IMPLEMENTATION-002B | I1, I2A | ADR-002 | none | Ready for Development · GATE-2 |
| IMPLEMENTATION-002C | I1, I2A, I2B | ADR-003 | none | Ready for Development · GATE-3 |
| IMPLEMENTATION-002D | I1, I2A, I2B, I2C | ADR-004, ADR-005 | none | Ready for Development · GATE-4 |
| IMPLEMENTATION-002E | I1, I2A–D | ADR-006 | none | Ready for Development · GATE-5 |
| IMPLEMENTATION-002F | I1, I2A–E | ADR-007 | none | Ready for Development · GATE-6 |
| IMPLEMENTATION-002G | I1, I2A–F | ADR-008 | none | Ready for Development · GATE-7 |
| IMPLEMENTATION-002H | I1, I2A–G | ADR-009 | none | Ready for Development · GATE-8 |
| IMPLEMENTATION-003 | I1, I2A–H | ADR-010 | none | operational roadmap |

## Governance & navigation

| Document | Depends on | Related ADRs | Certification reference |
|---|---|---|---|
| START-HERE | all | all | entry point |
| README | all | ADR-010 | — |
| INDEX | all | — | — |
| GOVERNANCE | DESIGN-002, IMPLEMENTATION-001 | ADR-010 | conformance rules |
| CONFORMANCE-CHECKLIST | DESIGN-002, all 002 | all | per-PR gate |
| dependency-manifest.(yaml\|json) | IMPLEMENTATION-001/003 | all | census rules |
| adr/ADR-001..010 | DESIGN-001/002 | each other | Accepted (ratified) |
| amendments/ | DESIGN-002, ADR-010 | ADR-010 | amendment framework |

## Appendices

| Document | Purpose | Depends on |
|---|---|---|
| glossary | canonical terms | all |
| invariants | P1–P30 | DESIGN-002 §11 |
| event-catalog | domain events | all 002 §-Event |
| consumer-catalog | consumers + read paths | AUDIT-002 §5, DESIGN-002 §6 |
| workflow-catalog | AI workflows | AUDIT-003 §4, IMPLEMENTATION-002F |
| certification-history | verdicts + closure ledger | all |
| traceability-matrix | finding → closure trace | audits + 002 gates |
| relationships (this file) | master cross-reference | all |

## Cross-linking convention

Every document ends with a **Related Documents** footer of the form:

```
**Related:** <peer docs> · **Depends on:** <prerequisites> · **Related ADRs:** <ADRs> ·
**Amendments:** <none | AMENDMENT-NNN> · **Editions:** Reference (this) | Full (full/…) · **Certification:** <gate/verdict>
```

The authoritative values are this table. If a footer and this table disagree, **this table wins** and the footer is corrected. Supersession ("Superseded By") is populated only when an amendment ratifies against a document; until then it is "none."

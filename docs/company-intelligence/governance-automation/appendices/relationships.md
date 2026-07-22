# Appendix — Governance-Automation Relationships (Master Cross-Reference)

The single maintained source for how every governance program relates to the others, to existing repository tooling (reuse), and to the constitution. Per-document footers point here; **this table is authoritative** — if a footer disagrees, this table wins.

## Program cross-reference

| Program | Depends on | Reuses (existing tooling) | Constitution refs | Migration gate | Owner | Classification |
|---|---|---|---|---|---|---|
| [AUDIT-005](../audit/AUDIT-005.md) | — | semantic-engine, check:ssrf/authz, boundary-rules.warn | invariants, manifest | informs GATE-0 | Architecture Steward | Ready for Automation |
| [GOV-AUTO-001](../programs/GOV-AUTO-001.md) | ratified docs | manual link/orphan checks | P30 | immediate | Maintainer | Documentation Automation Ready |
| [GOV-AUTO-002](../programs/GOV-AUTO-002.md) | 004, manifest | semantic-engine, check_lead_signal_write_boundaries.js, check-outbound-ssrf.js | P3/P11/P12/P14/P16/P17/P26, manifest | GATE-1..8 | Architecture Steward | Census Automation Ready |
| [GOV-AUTO-003](../programs/GOV-AUTO-003.md) | 004 | enforce-incremental-boundaries.mjs, dependency-cruiser.warn, eslint-boundaries.warn, boundary-rules.warn | P4 | per-context | Architecture Steward | Boundary Enforcement Ready |
| [GOV-AUTO-004](../programs/GOV-AUTO-004.md) | code-model tooling; existing analyzers | semantic-engine, ownership-risk-audit, runtime-shadow, check-outbound-ssrf.js, check-tenant-authz.js, direct-db-writes.json | invariants | per-seam | Architecture Steward | Seam Analyzer Ready |
| [GOV-AUTO-005](../programs/GOV-AUTO-005.md) | 001–004,006 | pull_request_template, check:ssrf/authz, semantic/runtime enforce | P30, GOVERNANCE §3, HISTORY | immediate + per-gate | Governance maintainer | Repository Governance Ready |
| [GOV-AUTO-006](../programs/GOV-AUTO-006.md) | 001, catalogs | check-schema-drift.js, frozen-schemas, dependency-cycles, deprecated-routes | P23/P30 | immediate/GATE-4/6/7 | Architecture Steward | Drift Detection Ready |
| [GOV-AUTO-007](../programs/GOV-AUTO-007.md) | 001–006 | VERSION/RELEASE-NOTES/RATIFICATION/HISTORY/LIFECYCLE, semantic/schema/mutation/runtime | VERSION, HISTORY | immediate + per-gate | Certification owner | Release Governance Ready |
| [GOV-AUTO-008](../programs/GOV-AUTO-008.md) | shared schema (001–007) | architecture-migration/reports/*, check-file-lengths.js | manifest | reflects GATE-0..8 | Architecture Steward | Repository Health Ready |
| [GOV-IMPL-001](../realization/GOV-IMPL-001.md) | GOV-AUTO-001..008 | all analyzers; migration-order.md (platform) | manifest, invariants | couples GATE-0..8 | Architecture Steward | Implementation Ready |
| [GOV-CERT-001](../realization/GOV-CERT-001.md) | 001..008, IMPL | RATIFICATION model, analyzer pass/fail, 007 bundle, 008 snapshots | RATIFICATION, P30 | recert per GATE | Certification owner | Certification Ready |
| [IMPLEMENT-GOV-001](../execution/IMPLEMENT-GOV-001.md) | all specs | — (audit) | invariants | informs all | Architecture Steward | Partially Implemented |
| [EXEC-GOV-001](../execution/EXEC-GOV-001.md) | IMPLEMENT-GOV-001 | the T1–T15 backlog | invariants | couples GATE-0..8 | Architecture Steward | Engineering Ready |
| [GOV-EXEC-WP01](../execution/work-packages/GOV-EXEC-WP01.md) | EXEC-GOV-001 | GOV-AUTO-001 validation; ratified conventions | HISTORY, LIFECYCLE, amendments | none (bootstrap) | Maintainer | Bootstrap Ready |

## Cross-linking convention

Every document ends with a **Related** footer: `Related · Depends on · Reuses · Constitution refs · Migration gate · Classification`. The authoritative values are this table. Supersession ("Superseded By") is populated only when an amendment ratifies against a program; until then, "none."

## Constitution boundary

The governance-automation layer **references** the constitution (`../../` — invariants, gates, manifest, VERSION/HISTORY/LIFECYCLE/RATIFICATION) and **never duplicates or modifies** it. WP-01 added only additive pointer lines to the parent `INDEX.md`/`README.md`; no ratified content was changed.

**Related:** [INDEX](../INDEX.md) · [README](../README.md) · [glossary](glossary.md) · [dependency-graph](../diagrams/governance-dependency-graph.md) · [constitution relationships](../../appendices/relationships.md).

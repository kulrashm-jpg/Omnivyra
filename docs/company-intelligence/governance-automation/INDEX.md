# Governance Automation — Index

Complete map of the governance-automation program set. Citation keys and full cross-reference: [appendices/relationships](appendices/relationships.md).

## Audit

| Doc | Purpose | Classification |
|---|---|---|
| [AUDIT-005](audit/AUDIT-005.md) | What should be automatically enforced; the GOV-AUTO roadmap | Ready for Automation |

## Programs (the eight runtimes)

| Doc | Runtime | Classification |
|---|---|---|
| [GOV-AUTO-001](programs/GOV-AUTO-001.md) | Documentation Validation | Documentation Automation Ready |
| [GOV-AUTO-002](programs/GOV-AUTO-002.md) | Constitutional Census | Census Automation Ready |
| [GOV-AUTO-003](programs/GOV-AUTO-003.md) | Boundary Enforcement | Boundary Enforcement Ready |
| [GOV-AUTO-004](programs/GOV-AUTO-004.md) | Seam Analyzers | Seam Analyzer Ready |
| [GOV-AUTO-005](programs/GOV-AUTO-005.md) | PR / Merge Governance | Repository Governance Ready |
| [GOV-AUTO-006](programs/GOV-AUTO-006.md) | Drift Detection | Drift Detection Ready |
| [GOV-AUTO-007](programs/GOV-AUTO-007.md) | Release Governance | Release Governance Ready |
| [GOV-AUTO-008](programs/GOV-AUTO-008.md) | Repository Health | Repository Health Ready |

## Realization

| Doc | Purpose | Classification |
|---|---|---|
| [GOV-IMPL-001](realization/GOV-IMPL-001.md) | Realization & migration (build order + platform-paced hardening) | Implementation Ready |
| [GOV-CERT-001](realization/GOV-CERT-001.md) | Implementation certification authority | Certification Ready |

## Execution

| Doc | Purpose | Classification |
|---|---|---|
| [IMPLEMENT-GOV-001](execution/IMPLEMENT-GOV-001.md) | Implementation audit + backlog (T1–T15) | Partially Implemented |
| [EXEC-GOV-001](execution/EXEC-GOV-001.md) | Engineering execution program (WP-01..15) | Engineering Ready |
| [GOV-EXEC-WP01](execution/work-packages/GOV-EXEC-WP01.md) | Repository bootstrap specification (this persist) | Bootstrap Ready |

## Diagrams

| Doc | Shows |
|---|---|
| [governance-dependency-graph](diagrams/governance-dependency-graph.md) | The GOV-AUTO build DAG (004 critical path) |
| [program-to-migration-gate-map](diagrams/program-to-migration-gate-map.md) | The two-migration coupling (governance ↔ platform GATE-0..8) |

## Appendices

| Doc | Contents |
|---|---|
| [glossary](appendices/glossary.md) | Governance-automation terms |
| [relationships](appendices/relationships.md) | Master cross-reference (program ↔ program ↔ gate ↔ invariant) |

## Reading orders

- **Orientation:** [README](README.md) → AUDIT-005 → the eight programs.
- **Build order:** [dependency-graph](diagrams/governance-dependency-graph.md) → GOV-IMPL-001 → EXEC-GOV-001.
- **Certification:** GOV-CERT-001 → each program's certification gate → [program-to-gate map](diagrams/program-to-migration-gate-map.md).
- **Implementation status:** [IMPLEMENT-GOV-001](execution/IMPLEMENT-GOV-001.md).

---
**Related:** [README](README.md) · [appendices/relationships](appendices/relationships.md) · [constitution INDEX](../INDEX.md)

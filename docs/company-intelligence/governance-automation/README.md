# Governance Automation

**The automation layer that converts the ratified constitution into automatically-enforced governance.** This tree is additive to and subordinate under the [Constitutional Repository v1.0.0](../README.md); it describes *how the constitution is enforced by automation* and **references the constitution — it never duplicates or modifies it**.

> **Status:** specification set persisted per [GOV-EXEC-WP01](execution/work-packages/GOV-EXEC-WP01.md) (WP-01). The programs are specifications; the runtimes are **not yet built** — implementation status is audited in [IMPLEMENT-GOV-001](execution/IMPLEMENT-GOV-001.md) (**Partially Implemented ~12–15%**).

## What this is

A layered governance-automation system spanning audit → runtimes → realization → certification → execution:

| Program | Role | Classification |
|---|---|---|
| [AUDIT-005](audit/AUDIT-005.md) | audits what should be automatically enforced | Ready for Automation |
| [GOV-AUTO-001](programs/GOV-AUTO-001.md) | Documentation Validation | Documentation Automation Ready |
| [GOV-AUTO-002](programs/GOV-AUTO-002.md) | Constitutional Census | Census Automation Ready |
| [GOV-AUTO-003](programs/GOV-AUTO-003.md) | Boundary Enforcement | Boundary Enforcement Ready |
| [GOV-AUTO-004](programs/GOV-AUTO-004.md) | Seam Analyzers (detection foundation) | Seam Analyzer Ready |
| [GOV-AUTO-005](programs/GOV-AUTO-005.md) | PR / Merge Governance | Repository Governance Ready |
| [GOV-AUTO-006](programs/GOV-AUTO-006.md) | Drift Detection | Drift Detection Ready |
| [GOV-AUTO-007](programs/GOV-AUTO-007.md) | Release Governance | Release Governance Ready |
| [GOV-AUTO-008](programs/GOV-AUTO-008.md) | Repository Health | Repository Health Ready |
| [GOV-IMPL-001](realization/GOV-IMPL-001.md) | Realization & Migration | Implementation Ready |
| [GOV-CERT-001](realization/GOV-CERT-001.md) | Implementation Certification | Certification Ready |
| [IMPLEMENT-GOV-001](execution/IMPLEMENT-GOV-001.md) | implementation audit + backlog | Partially Implemented |
| [EXEC-GOV-001](execution/EXEC-GOV-001.md) | engineering execution program | Engineering Ready |
| [GOV-EXEC-WP01](execution/work-packages/GOV-EXEC-WP01.md) | repository bootstrap (this persist) | Bootstrap Ready |

## Layered architecture

```
detection (004) ─▶ counting (002) / promotion (003) / drift (006)
                                 │
                      merge gate (005) / release gate (007)
                                 │
                       health posture (008, derive-only)
                                 │
              realization (GOV-IMPL) ─▶ certification (GOV-CERT)
        + documentation validation (001) protecting the constitution itself
```

Every layer reuses the ones below it; each concern has exactly one runtime; all enforcement is phased and coupled to the platform migration (see [program-to-migration-gate-map](diagrams/program-to-migration-gate-map.md)); every value is evidence-derived and deterministic.

## Boundary law

This tree **references** the constitution (invariants, gates, manifest, VERSION/HISTORY/LIFECYCLE/RATIFICATION at `../`) and **never duplicates or modifies** it. Adding to this tree is additive-only; changing a ratified decision goes through the constitution's [amendment framework](../amendments/README.md).

## Start here

New here → [INDEX](INDEX.md) → [AUDIT-005](audit/AUDIT-005.md) → the eight programs → [GOV-IMPL-001](realization/GOV-IMPL-001.md). To understand build order → [dependency-graph](diagrams/governance-dependency-graph.md). To execute → [EXEC-GOV-001](execution/EXEC-GOV-001.md) (begin with WP-01).

---
**Related:** [INDEX](INDEX.md) · [appendices/relationships](appendices/relationships.md) · [appendices/glossary](appendices/glossary.md) · [constitution README](../README.md) · [constitution START-HERE](../START-HERE.md)

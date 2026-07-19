# GOV-EXEC-WP01 — Governance Repository Bootstrap Implementation Specification v1.0

**Status:** Authoritative implementation specification for WP-01 (Persist Governance Programs) from EXEC-GOV-001. **Inputs frozen:** Constitution v1.0.0, AUDIT-005, GOV-AUTO-001..008, GOV-IMPL-001, GOV-CERT-001, IMPLEMENT-GOV-001, EXEC-GOV-001. **Classification: Bootstrap Ready.**

> Repository-bootstrap spec only — no product code, runtime, CI, workflow, GitHub Action, or governance behavior.

---

## 0. Purpose & Scope

WP-01 is the universal gate of the execution program and the mitigation for IMPLEMENT-GOV-001's Critical risk (the twelve governance programs existed only in conversation). This specification defines how they are persisted — layout, naming, navigation, cross-links, standards, validation, extension rules. In scope: the `governance-automation/` documentation tree. Out of scope: any runtime, CI, or product change.

## 1. Repository Information Architecture

Additive subtree under the ratified constitution: `docs/company-intelligence/governance-automation/`. Documentation boundary law: the tree describes *how the constitution is enforced*; it references the constitution, never duplicates/modifies it. Hierarchy: `README.md`, `INDEX.md`, `audit/AUDIT-005.md`, `programs/GOV-AUTO-001..008.md`, `realization/GOV-IMPL-001.md`+`GOV-CERT-001.md`, `execution/IMPLEMENT-GOV-001.md`+`EXEC-GOV-001.md`+`work-packages/`, `diagrams/`, `appendices/`. Naming: filenames = identifiers (uppercase, unique); subdirs lowercase role-descriptive. Versioning: each program v1.0 frozen, stamped against Constitution v1.0.0. Ownership: per EXEC-GOV-001 §7 (recorded in relationships.md).

## 2. Governance Package Layout

README (purpose, boundary law, program map, layered architecture, start-here). INDEX (table per subtree + reading orders). Program documents (persisted as delivered — the Reference edition — with a standard header + footer). Cross references (relationships.md master). Migration map (program-to-migration-gate). Dependency map (the DAG).

## 3. Navigation Model

Entry (README → INDEX). Reading order (AUDIT-005 → GOV-AUTO-001..008 → GOV-IMPL-001 → GOV-CERT-001 → IMPLEMENT-GOV-001 → EXEC-GOV-001 → work-packages). Dependency navigation (dependency-graph). Certification navigation (GOV-CERT + gates). Realization navigation (GOV-IMPL → EXEC → work-packages). Up to the constitution (footers).

## 4. Cross-Link Specification

Relative links only; immutable references to ratified artifacts (read-only pointers, never copies); version references (identifier carries v1.0); dependency references (peer identifiers + existing repo tooling per IMPLEMENT-GOV-001 §5); bidirectional where meaningful; relationships.md is the authority.

## 5. Documentation Standards

GitHub Markdown; tables for matrices; mermaid + text table for diagrams; `#` title (identifier+version); numbered sections; uppercase unique identifiers; constitution glossary terms unchanged; governance-automation glossary defines only automation-specific terms.

## 6. Repository Validation (reuse GOV-AUTO-001)

Validated by the same rules GOV-AUTO-001 specifies: 0 broken links, 0 orphans, 0 duplicate identifiers, 0 unresolved references, 0 trapping cycles — across the whole `docs/company-intelligence/` tree. WP-01 not accepted until these pass.

## 7. Migration Compatibility

Additive-only future growth: amendments (via `../../amendments/` + forward pointer), future versions (new versioned edition), future runtimes (one file in `programs/` + cross-reference update). The four container subdirs absorb additions; growth is file-addition + cross-reference-update, never re-layout.

## 8. Acceptance Criteria

(1) all 13 programs + this WP-01 persisted in the hierarchy; (2) README+INDEX linking every program; (3) relationships.md covers every program; (4) dependency-graph + program-to-gate diagrams present; (5) validation 0/0/0/0/0 across the tree; (6) additive-only (constitution unchanged except additive pointers); (7) no governance behavior; (8) standards + header/footer present.

## 9. Future Extension Rules

New program → `programs/` + relationships row + DAG/gate-map. New WP → `work-packages/` + row. Amendment → `../../amendments/` + forward pointer + ledger. Implementation report → `execution/reports/` (additive container). Certification report → `realization/certifications/` (additive container). Every addition = new file + cross-reference update, never re-layout.

## 10. Final Classification

**Bootstrap Ready.** Not "Draft" (every section fully specified). Not "Repository Ready"/"Implementation Ready" as lower rungs (introduces no governance behavior/runtime/CI). "Bootstrap Ready" is exact: mechanical conformant persistence mirroring the ratified conventions, reusing GOV-AUTO-001 validation, additive-only, objective acceptance + extension rules. Next action: execute this specification.

---
**Related:** [EXEC-GOV-001](../EXEC-GOV-001.md) · [GOV-AUTO-001](../../programs/GOV-AUTO-001.md) · [GOV-EXEC-WP01A audit] (pending) · **Depends on:** EXEC-GOV-001 (WP-01 definition) · **Reuses:** GOV-AUTO-001 validation rules; the ratified repository conventions · **Constitution refs:** [HISTORY](../../../HISTORY.md), [LIFECYCLE](../../../LIFECYCLE.md), [amendments](../../../amendments/README.md) · **Migration gate:** none (bootstrap) · **Classification:** Bootstrap Ready. See [relationships](../../appendices/relationships.md).

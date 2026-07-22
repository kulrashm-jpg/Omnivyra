# Repository Governance Policy — Maintainers & Responsibilities

Defines the responsibilities that keep the Company Intelligence repository authoritative. Roles are described by **responsibility**, not by name — any qualified party may hold a role. This document assigns duties; it changes no architectural decision.

## Roles and responsibilities

### Maintainer
Owns the day-to-day health of the repository.
- Keeps the navigation spine (`START-HERE`, `README`, `INDEX`, `relationships`) accurate as documents are added.
- Applies editorial/PATCH updates to Reference Editions (never to decisions).
- Ensures every new document carries the required cross-link footer and appears in the master cross-reference.
- Runs the link/consistency validation before merging documentation changes (see [`VALIDATION-REPORT.md`](VALIDATION-REPORT.md)).

### Reviewer (PR)
Enforces conformance on every pull request touching platform code.
- Completes the [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md) for the change.
- Blocks on any unchecked applicable item and on any **CI census regression** (the nine census rules in [`GOVERNANCE.md`](GOVERNANCE.md) §3).
- Verifies the change derives from the relevant implementation program and does not make an independent architectural decision.

### Architecture Steward
Guards the constitution's integrity.
- Ensures no PR introduces a second write authority, grounding path, confidence vocabulary, or conversation stack (the four singletons, P4).
- Reviews any proposal that would touch a context boundary, ownership assignment, or invariant, and routes it to the amendment process.
- Confirms new work respects the dependency spine and phase gates (`dependency-manifest`, IMPLEMENTATION-003).

### Amendment owner
Shepherds constitutional change.
- Authors/receives amendments from the [`AMENDMENT-001-template.md`](amendments/AMENDMENT-001-template.md).
- Ensures each amendment is evidence-driven and impact-complete (updates all affected invariants, gates, ADRs, programs, census rules, checklist, and manifest in the same change).
- Confirms non-waivable invariants and singletons are not weakened.
- Records the outcome in the amendments ledger and (if ratified) bumps the version.

### Certification owner
Owns the truth of the certification state.
- Maintains [`appendices/certification-history.md`](appendices/certification-history.md) and [`appendices/traceability-matrix.md`](appendices/traceability-matrix.md) — every audit finding must remain traceable to a closure (no orphans).
- Verifies phase-gate criteria before a phase is allowed to enforce.
- Owns [`FINAL-VALIDATION.md`](FINAL-VALIDATION.md) and re-runs validation on structural documentation changes.

## Documentation ownership

| Area | Owned by | Maintenance rule |
|---|---|---|
| Reference Editions | Maintainer | Editorial/PATCH only; decisions frozen |
| Full Editions | (frozen) | Never edited after ratification |
| ADRs | Architecture Steward | New ADRs for new decisions; superseded via amendment |
| Amendments | Amendment owner | Append-only ledger |
| Navigation (START-HERE/README/INDEX/relationships) | Maintainer | Kept accurate as documents are added |
| Manifests (dependency-manifest.*) | Architecture Steward | Mirror IMPLEMENTATION-001/003 exactly |
| Certification (history, traceability, validation) | Certification owner | Append-only; no orphan findings |
| Version/Ratification/Release/Lifecycle/History | Governance maintainer | Append-only history |

## Review expectations

1. **Every documentation PR** passes link + consistency validation (zero broken links; single-source terminology, ownership, invariants).
2. **Every code PR** completes the Conformance Checklist and passes CI census.
3. **Every change to a ratified decision** goes through the amendment process — never a direct edit.
4. **Every new document** includes the cross-link footer (Related Documents / Related ADRs / Related Amendments / Related Version / Related Certification) and is registered in [`appendices/relationships.md`](appendices/relationships.md).
5. **Navigation must remain bidirectional** — Reference ↔ Full, document ↔ ADR, decision ↔ amendment.

## Escalation

A disagreement about whether a change is conformant, or whether it requires an amendment, escalates to the Architecture Steward; a disagreement about certification state escalates to the Certification owner; a proposed constitutional change escalates through the Amendment owner to ratification.

---
**Related:** [`GOVERNANCE.md`](GOVERNANCE.md) · [`LIFECYCLE.md`](LIFECYCLE.md) · [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md) · [`amendments/README.md`](amendments/README.md) · **Related ADRs:** [ADR-010](adr/ADR-010-constitutional-governance.md).

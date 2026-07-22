# AMENDMENT-XXX — <Title>

> Copy this file to `AMENDMENT-<NNN>-<slug>.md`, renumber, and fill in every section. Do not edit this template in place for a real amendment.

**Status:** Draft | Proposed | Under Review | Ratified | Rejected | Superseded
**Proposed by:** <name/role>
**Date proposed:** <YYYY-MM-DD> (use an absolute date)
**Constitution version before:** <e.g. 1.0.0>
**Constitution version after (if ratified):** <e.g. 1.1.0>
**Change class:** MAJOR (breaking contract) | MINOR (additive) | PATCH (corrective)

---

## 1. Summary

One paragraph: what this amendment changes and why, in plain language.

## 2. Target(s) superseded

The exact document(s) and section(s) this amendment supersedes. Be precise (document + section number). Example: `DESIGN-002 §6 (Consumer Contract for Reports)`.

- Target: <document §section>
- Target: <document §section>

## 3. Motivating evidence

Amendments are evidence-driven (GOVERNANCE §4, ADR-010). State the audit finding, production incident, metric, or operational evidence that requires this change. Link data where possible. "Preference" is not evidence.

## 4. Proposed change

The precise new contract/decision/text. Quote the current wording and the proposed wording side by side where practical.

**Current:**
> <current text>

**Proposed:**
> <new text>

## 5. Non-waivable check

Confirm this amendment does **not** remove or weaken a singleton (P4) or a non-waivable invariant (P3, P8, P14, P19, P21, P30). If it touches any invariant, name it and justify.

- [ ] Does not remove a singleton authority (P4)
- [ ] Does not weaken a non-waivable invariant
- [ ] If it touches P1–P30, the affected invariant(s) are named below with justification

Affected invariants: <list or "none">

## 6. Impact analysis (impact-complete)

Every downstream artifact this amendment affects, updated in the same change:

| Artifact | Affected? | Update required |
|---|---|---|
| Invariants (appendices/invariants.md) | | |
| Certification gate(s) | | |
| ADR(s) | | |
| Implementation program(s) | | |
| Census rule(s) (dependency-manifest) | | |
| Consumer contract(s) | | |
| CONFORMANCE-CHECKLIST | | |
| Traceability matrix | | |

## 7. Alternatives considered

What else was weighed, and why this change over them.

## 8. Consequences & trade-offs

What becomes true, what becomes harder, and what risk this introduces or removes.

## 9. Migration / transition

If ratified, how existing code/data/consumers move to the new contract. Reference the flag ladder and per-tenant enforcement if applicable. The prior constitution stands until ratification.

## 10. Review & ratification record

| Stage | Reviewer(s) | Date | Outcome / notes |
|---|---|---|---|
| Proposed | | | |
| Under Review | | | |
| Ratified / Rejected | | | |

---

**Related:** [`README.md`](README.md) (amendment framework) · [`../GOVERNANCE.md`](../GOVERNANCE.md) §4 · [`../CONFORMANCE-CHECKLIST.md`](../CONFORMANCE-CHECKLIST.md).

# ADR-010 — Constitutional Governance

**Status:** Accepted (ratified) · **Invariant:** P30 (+P4) · **Program:** DESIGN-002 / all

## Context

The audits certified that the platform's problems were problems of *multiplicity and drift*: capabilities existed (rollout machinery, refresh gate, KG, gateway) but adoption was incomplete and ownership was ungoverned. Fixing this structurally is not enough if future work can silently reintroduce a second writer, grounding path, confidence vocabulary, or conversation stack. The architecture needs a mechanism that binds future change.

## Decision

The specification set is a **Production Constitution** with 30 invariants (P1–P30) and four permanent singleton authorities (P4). Conformance is measurable (DESIGN-002 §12) and machine-checkable (CI census rules). Ratified documents are frozen; changes occur only through **amendments** (evidence-driven, versioned, superseding-not-overwriting). Every PR completes the [Conformance Checklist](../CONFORMANCE-CHECKLIST.md). Non-conformant work is rejected regardless of local merit (P30).

## Alternatives considered

1. **Guidelines + code review judgment.** Rejected — the audit proved discipline-based governance fails; the platform decayed exactly this way. Census rules make conformance structural.
2. **Freeze the code, not the decisions.** Rejected — code changes constantly; the *decisions* (invariants, boundaries, singletons) are what must be stable.
3. **Allow direct edits to ratified docs with review.** Rejected — loses history and invites silent divergence; amendments preserve the decision trail.

## Consequences

- The four singletons are permanent; adding a fifth of any is non-conformant by census.
- The framework becomes self-enforcing: checklist + census + phase gates.
- Constitutional evolution is possible but governed (amendments), never silent.
- Onboarding, traceability, and tooling (dependency manifest) build on a stable base.

## Trade-offs

- Amendments add ceremony to changing a decision (intended — constitutional change should be deliberate).
- Some invariants are non-waivable, constraining even well-intentioned exceptions (mitigated: waivers exist for the rest, time-boxed and audited).

## Future implications

The platform can grow indefinitely without re-fragmenting: extensions plug into contexts; they never add authorities. The governance system (this ADR set, the checklist, the manifest, the amendment framework) is the durable layer above the constitution.

## Related constitutional sections

DESIGN-002 §11 (P1–P30), §12 (conformance), §13 (compatibility); GOVERNANCE.md (all); IMPLEMENTATION-001 §17; the [amendment framework](../amendments/README.md).

---
**Related ADRs:** all (ADR-001..009 are the decisions this governs). **Amendments:** the [amendment framework](../amendments/README.md) is the mechanism for changing any ADR.

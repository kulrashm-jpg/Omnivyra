# ADR-009 — Learning Runtime (Recommends, Never Applies)

**Status:** Accepted (ratified) · **Invariant:** P14 (+P12) · **Program:** IMPLEMENTATION-002H

## Context

AUDIT-004 certified the terminal gap: every learning signal the platform needs is already collected — user corrections (`company_profile_refinements`), review outcomes (`company_context_review_events`), locks — and **none is analyzed**. The only factual-quality judge is offline; there is no production correction-rate metric or ground-truth loop. The platform cannot currently know whether its intelligence is correct.

## Decision

**One Learning Runtime** ingests every Learning Signal, computes a first-class correction-rate metric and calibration/recommendation outputs, and feeds them into the owning contexts' governance. Learning **recommends; it never applies** (P14) — it computes a recommended confidence calibration, but Trust's versioned calculator adopts it through governance; it flags a prompt, but Generation's approval + bench decides; it proposes pack data, but the pack governance versions it. Learning adjusts declared-policy parameters only, preserving determinism (P12). **No production behavior changes automatically.**

## Alternatives considered

1. **Auto-apply calibrations for speed.** Rejected — violates the safety boundary; a bad signal would silently change production behavior. Recommend-only keeps every change governed, reproducible, and revertible.
2. **Per-context learning.** Rejected — reintroduces multiplicity; one runtime with one registry is census-enforceable.
3. **Learning mutates facts on correction.** Rejected — the user already corrected the fact through the write authority; learning consumes the *signal*, never the fact (P14).

## Consequences

- The correction-rate metric closes the terminal certified gap; the platform measures itself.
- The offline judge bench is productionized as the standing evaluation feedback and promotion gate.
- An unmanaged-learning census (= 0) enforces "no feedback-driven change outside the runtime."
- Completing this brings the full constitution into force.

## Trade-offs

- Recommend-only means improvements require a governed adoption step (mitigated: that step is the safety property — nothing auto-changes).
- Aggregation over heterogeneous signals is complex (mitigated: registered sources with declared weighting/decay).

## Future implications

Every future adaptive behavior is a recommendation into governance, never a silent change. The platform becomes self-improving *under governance*, with reproducibility and rollback preserved.

## Related constitutional sections

DESIGN-001 §11 (learning); DESIGN-002 §9 (learning contract), §11 (P12/P14); IMPLEMENTATION-002H §4–7, §16.

---
**Related ADRs:** [ADR-002](ADR-002-one-trust-engine.md) (calibration target), [ADR-007](ADR-007-generation-runtime.md) (bench/prompt targets), [ADR-010](ADR-010-constitutional-governance.md). **Amendments:** none.

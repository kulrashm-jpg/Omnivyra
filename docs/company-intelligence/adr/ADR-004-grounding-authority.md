# ADR-004 — One Grounding Authority

**Status:** Accepted (ratified) · **Invariant:** P11 (+P4) · **Program:** IMPLEMENTATION-002D

## Context

AUDIT-003 certified five distinct grounding mechanisms: the canonical adapter, legacy `getProfile`, the KG grounding block (1-of-6 adoption), `buildCompanyUnderstanding`, and per-endpoint ad-hoc profile serializations. This caused inconsistent, self-referential grounding (AI grounded in prior AI), a hand-maintained 96-consumer registry, and an ungated intelligence channel to MarketPulse.

## Decision

**One Grounding Authority** assembles a versioned, deterministic **Grounding Context** (knowledge / evidence / constraint / gap sections) for every AI workflow. No workflow grounds any other way. Consumers register profiles (required knowledge, confidence floor, freshness, fallback); the per-field consumer list is derived from declarations. Grounding is read-only (never triggers generation) and rejects prohibited inputs (raw rows, AI-output-as-evidence, unlabeled inference, cross-tenant, unattributed).

## Alternatives considered

1. **Standardize on the canonical adapter as-is.** Rejected — it is a read wrapper, not a grounding assembler; doesn't unify the KG/understanding/ad-hoc paths.
2. **Per-domain grounding libraries.** Rejected — reintroduces multiplicity; consistency-by-construction requires one graph, one assembler.
3. **Let generation assemble its own grounding.** Rejected — that is exactly the ad-hoc serialization the audit flagged.

## Consequences

- Five mechanisms → one; cross-workflow consistency is inherited (all ground in the same graph), dissolving the consistency vacuum (A4 §6).
- The KG dedup/gap logic generalizes to every workflow and every conversation mode.
- A grounding-bypass census (= 0) enforces "no consumer bypasses the authority."
- The ungated MarketPulse channel routes through the authority.

## Trade-offs

- Assembly adds a hop vs. direct reads (mitigated: content-addressed caching, deterministic → correct-by-construction cache).
- Every consumer must register (mitigated: registration replaces the drift-prone hand-maintained list).

## Future implications

New agents and consumers onboard by declaring a grounding profile — inheriting consistency, explainability, and trust filtering for free. Grounding is the extensibility seam for future AI.

## Related constitutional sections

DESIGN-001 §5 (grounding); DESIGN-002 §6 (consumer contracts), §7 (grounding governance), §11 (P2/P4/P11); IMPLEMENTATION-002D §4–6, §17.

---
**Related ADRs:** [ADR-005](ADR-005-universal-validation.md) (co-runtime), [ADR-003](ADR-003-immutable-evidence.md), [ADR-008](ADR-008-projection-runtime.md) (sibling read model). **Amendments:** none.

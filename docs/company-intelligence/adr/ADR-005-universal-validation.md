# ADR-005 — Universal Validation

**Status:** Accepted (ratified) · **Invariant:** P19 (+P10, P20) · **Program:** IMPLEMENTATION-002D

## Context

AUDIT-003 certified the platform's #1 quality hole: the `define-*` chat → client → `POST /api/company-profile` path performed **zero server-side content validation** — seven commercial, seven marketing, and nine problem-transformation fields reached the database exactly as the LLM produced them, laundered as a "user save" that then *locked* them as user truth. Only extraction was zod-checked; only strategy had a cliché filter; a deterministic fallback fabricated identical boilerplate per company.

## Decision

**One Validation Pipeline** issues `ValidationPassed`/`ValidationFailed` tokens; no generated value persists without a token, on any path. Tiers: schema, semantic (cliché filter promoted platform-wide + evidence-discipline), consistency (contradiction + cross-field), boundary, ownership, confidence, freshness, completeness, explainability, consumer-contract. Observable fields extract-or-null; interpretive fields are inference-labeled; deterministic logic never fabricates.

## Alternatives considered

1. **Validate only at the save endpoint.** Rejected — the launder path *is* the save endpoint; validation must gate the value regardless of route (client-mediated included).
2. **Per-workflow validators.** Rejected — that is the certified state (extraction zod, strategy filter) that left most fields unguarded.
3. **Trust confidence as a proxy for validity.** Rejected — confidence measures certainty, not correctness or policy; validation is a distinct decision.

## Consequences

- The launder path closes permanently (enforced at the write authority, in conversation, and in generation).
- The reference cliché filter becomes a shared Sem-tier resource for all interpretive fields.
- A cross-field consistency tier closes the consistency vacuum together with single-graph grounding.
- The boilerplate fallback is deleted (P20).

## Trade-offs

- Validation-in-block can over-fire on legitimate content (mitigated: warn-mode window per workflow before block; calibration from warn data).
- A token requirement couples generation/conversation/knowledge to the pipeline (mitigated: it is a pure decision service — reads and verdicts, never writes).

## Future implications

Every new workflow inherits validation by declaring a validation profile. Validation failure taxonomies feed prompt governance and Learning. "No unvalidated persistence" is census-enforceable.

## Related constitutional sections

DESIGN-002 §3 (validation tiers), §7 (generation governance), §11 (P10/P19/P20); IMPLEMENTATION-002D §7, §17; IMPLEMENTATION-002A §8 (interim shim).

---
**Related ADRs:** [ADR-004](ADR-004-grounding-authority.md) (co-runtime), [ADR-001](ADR-001-one-write-authority.md) (token gates persistence), [ADR-007](ADR-007-generation-runtime.md). **Amendments:** none.

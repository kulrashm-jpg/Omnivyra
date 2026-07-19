# Architecture Decision Records (ADRs)

ADRs **summarize** the major constitutional decisions — the *why* behind the architecture — in a compact, comparable form. They do **not** replace the DESIGN documents (which specify) or the IMPLEMENTATION programs (which sequence). An ADR is the two-minute answer to "why did we decide X, and what did we give up?"

**Status of all ADRs below: Accepted (ratified).** Ratified ADRs are frozen; a decision changes only through an [amendment](../amendments/README.md), which supersedes the ADR without deleting it.

## Format

Every ADR contains: Context · Decision · Alternatives considered · Consequences · Trade-offs · Future implications · Related constitutional sections.

## Index

| ADR | Decision | Primary invariant | Program |
|---|---|---|---|
| [ADR-001](ADR-001-one-write-authority.md) | One Write Authority (Knowledge) | P3 | I2A |
| [ADR-002](ADR-002-one-trust-engine.md) | One Trust Engine (confidence + provenance) | P12 | I2B |
| [ADR-003](ADR-003-immutable-evidence.md) | Immutable Evidence | P1 | I2C |
| [ADR-004](ADR-004-grounding-authority.md) | One Grounding Authority | P11 | I2D |
| [ADR-005](ADR-005-universal-validation.md) | Universal Validation | P19 | I2D |
| [ADR-006](ADR-006-conversation-runtime.md) | One Conversation Runtime | P17 | I2E |
| [ADR-007](ADR-007-generation-runtime.md) | One Generation Runtime | P16 | I2F |
| [ADR-008](ADR-008-projection-runtime.md) | One Projection Runtime | P26 | I2G |
| [ADR-009](ADR-009-learning-runtime.md) | Learning Runtime (recommends, never applies) | P14 | I2H |
| [ADR-010](ADR-010-constitutional-governance.md) | Constitutional Governance | P30 | D2 / all |

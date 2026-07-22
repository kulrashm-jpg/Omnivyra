# ADR-006 — One Conversation Runtime

**Status:** Accepted (ratified) · **Invariant:** P17 (+P8, P10) · **Program:** IMPLEMENTATION-002E

## Context

AUDIT-003 certified six endpoint-specific conversations, each hand-rolling auth, AI calls, JSON parsing, and its own question loop. AUDIT-004 certified the consequences: the KG semantic dedup was adopted 1-of-6; cross-chat memory was asymmetric (only 3 of 7 commercial fields crossed); every chat laundered AI output through the client into locked user truth; one chat self-drove its loop (repetition); one injected hardcoded boilerplate.

## Decision

**One Conversation Engine** serves all conversational workflows as *modes* (question-domain configurations). It drives the ask→answer→extract→validate→persist loop by composing other contexts' contracts, owning only the dialogue. Every turn requests a Grounding Context (whose constraint/gap sections carry already-known and ranked questions), turns become Evidence, and extractions flow Inference → Validation → Knowledge mutation. No conversation writes a Fact directly; no satisfied node is re-asked.

## Alternatives considered

1. **Refactor each endpoint to share a library.** Rejected — libraries don't unify memory; the asymmetry recurs unless there is one runtime reading one graph.
2. **A conversation store separate from knowledge.** Rejected — a competing "what we know" store is exactly the fragmentation being removed; the engine reads the one knowledge graph via Grounding.
3. **Keep client-side staging.** Rejected — that is the launder path; persistence must go through validation.

## Consequences

- Shared memory and universal deduplication are *inherited* (all modes read one graph), not re-implemented per chat.
- The launder path closes; the boilerplate fallback is deleted.
- A census (zero conversation loops outside the engine) enforces the singleton.

## Trade-offs

- One runtime with mode configs is more abstract than six explicit endpoints (mitigated: modes are declarative; the reference mode proves the shape).
- Migration is per-mode with dual-conversation shadowing (mitigated: define-target-customer first — already KG-grounded).

## Future implications

New conversational surfaces (onboarding, planning, strategy) become modes, not codebases. Question governance and progressive profiling apply platform-wide.

## Related constitutional sections

DESIGN-001 §9 (unified engine); DESIGN-002 §2 (Conversation object), §4 (state machine), §11 (P8/P10/P17/P19); IMPLEMENTATION-002E §4–7, §15.

---
**Related ADRs:** [ADR-004](ADR-004-grounding-authority.md), [ADR-005](ADR-005-universal-validation.md), [ADR-007](ADR-007-generation-runtime.md) (invokes workflows), [ADR-001](ADR-001-one-write-authority.md). **Amendments:** none.

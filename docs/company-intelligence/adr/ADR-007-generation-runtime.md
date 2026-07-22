# ADR-007 — One Generation Runtime

**Status:** Accepted (ratified) · **Invariant:** P16 (+P24) · **Program:** IMPLEMENTATION-002F

## Context

AUDIT-003 certified 13 hand-rolled LLM call sites and 10 duplicated scaffolds (model/temp/JSON boilerplate, JSON.parse+default, strict-JSON retry ×2, PT prompt in 3 places, MI field list in 4, coercion helpers ×6). Prompts were inline with contradictory evidence stances; models were selected by per-call `OPENAI_MODEL` reads; there was no evaluation gate. The archetype system had one hardcoded creator/media peer pack and a `'business_operations'` fallback.

## Decision

**One Generation Runtime** executes every registered workflow. Prompts are registered, versioned, approval-gated governed assets (contradictory stances fail approval); models are a governed registry with routing/fallback/rollback; the offline judge bench is the standing evaluation gate for prompt/model promotion. **Industry Packs** replace the hardcoded pack with declarative, versioned per-industry data (content, not code). No LLM call exists outside a registered workflow.

## Alternatives considered

1. **A shared AI helper library, keep call sites.** Rejected — libraries don't govern prompts/models or prevent hidden calls; the census requires one runtime.
2. **Prompts as code constants.** Rejected — no versioning, approval, or bench-gating; the certified contradictory prompts would persist.
3. **Industry logic as branching code.** Rejected — adding an industry would require code changes; packs make it data authoring.

## Consequences

- 13 call sites + 10 scaffolds → one runtime; three censuses (zero unregistered calls, zero inline prompts, zero direct model reads).
- The contradictory/permissive prompts fail approval; the boilerplate injector is deleted; MI becomes Sem-validated.
- Cost policies govern every AI stage (P24), generalizing the refresh-gate budget model.

## Trade-offs

- Governance adds process to shipping a prompt (mitigated: bench-gated promotion is the quality guarantee that was missing).
- A model registry constrains ad-hoc model choice (mitigated: routing still selects per capability/tier/cost).

## Future implications

New models are a registry entry; new industries are a pack; new workflows register once and inherit grounding, validation, cost, and evaluation. No ungoverned AI call is possible.

## Related constitutional sections

DESIGN-001 §10 (industry packs), §17 (cost); DESIGN-002 §7 (AI governance), §11 (P16/P24); IMPLEMENTATION-002F §4–8, §16.

---
**Related ADRs:** [ADR-004](ADR-004-grounding-authority.md), [ADR-005](ADR-005-universal-validation.md), [ADR-006](ADR-006-conversation-runtime.md), [ADR-009](ADR-009-learning-runtime.md) (bench feedback). **Amendments:** none.

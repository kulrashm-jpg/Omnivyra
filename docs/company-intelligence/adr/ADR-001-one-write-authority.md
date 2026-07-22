# ADR-001 — One Write Authority

**Status:** Accepted (ratified) · **Invariant:** P3 (+P4) · **Program:** IMPLEMENTATION-002A

## Context

AUDIT-002 certified ten independent write paths to `company_profiles` across two conventions (guarded `ownedDbTable` and raw `supabase`), four of which bypass the invariant-bearing save path. This produced lost-update races on `report_settings` (C4), competitors null-then-overwrite (C5), classifier-overrides-user (C7), phantom locks (C8), and silent column-dropping (A1 §8). Persistence had **no owner** — the single most consequential finding of the ownership audit.

## Decision

All persistence to knowledge state flows through **one Knowledge write authority**. It is the only component with write access to the storage seam. Every write is a typed mutation carrying actor, actor-class, basis, target field key (registry-validated), expected version, and (for generated values) a validation token. Facts are append-only versions with provenance.

## Alternatives considered

1. **Repository-per-writer discipline** (keep multiple writers, add a shared library). Rejected — relies on every writer remembering the invariants; the audit proved this fails.
2. **Database-enforced constraints only** (triggers/RLS). Rejected — insufficient for lock semantics, contradiction handling, and provenance; and RLS is service-role-bypassed at runtime.
3. **Two authorities (user vs. system writes).** Rejected — reintroduces precedence ambiguity; the authority axis already resolves user-vs-system per field.

## Consequences

- The ten writers become clients of one seam, migrated writer-by-writer behind flags.
- Lock enforcement, contradiction creation, and provenance become guaranteed, not best-effort.
- A CI writer census (= 1) makes "no second writer" structurally enforceable, not policed.
- The unvalidated chat-save path (A3 §7) closes at this seam (interim validation shim → full pipeline in Phase 4).

## Trade-offs

- A single seam is a fan-in point — all writes funnel through it (mitigated: stateless, high-throughput, per-tenant flags).
- Migrating the main save path last concentrates risk late in Phase 1 (mitigated: writer-by-writer, lowest-risk-first, atomic legacy reactivation).

## Future implications

New write needs add a **mutation type**, never a new writer. Any PR introducing a second write path is non-conformant by census. Enables append-only history, lineage, and reproducible rollback platform-wide.

## Related constitutional sections

DESIGN-002 §2 (objects), §4 (Fact state machine), §11 (P3/P4/P8/P15/P25/P29); IMPLEMENTATION-002A §4–5, §14; GOVERNANCE §3.

---
**Related ADRs:** [ADR-005](ADR-005-universal-validation.md) (validation gates persistence), [ADR-002](ADR-002-one-trust-engine.md) (Trust attaches at this seam), [ADR-010](ADR-010-constitutional-governance.md). **Amendments:** none.

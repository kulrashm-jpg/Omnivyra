# ADR-008 — One Projection Runtime

**Status:** Accepted (ratified) · **Invariant:** P26 (+P27, P28) · **Program:** IMPLEMENTATION-002G

## Context

AUDIT-002 certified ~40 raw `company_profiles` reads across display, dashboard, analytics, ops, and reports, plus a 2,384-line frontend god hook drilling a ~230-key object through three layers, plus cross-feature signaling via localStorage and a `company-profile-updated` CustomEvent (the dual notification stack, C11). Consumers read the racing multi-writer row directly.

## Decision

Company intelligence that consumers see is a **derived Projection** — a materialized, versioned read model over Facts + Trust. Every display/report/analytics/UI consumer reads a Projection (AI consumers read Grounding Contexts). Projections are never hand-edited (P26), rebuild from Facts at any version, and publish `ProjectionUpdated` as the **sole** freshness signal. Reports draw only from Observed+ facts (P28); staleness is surfaced honestly (P27).

## Alternatives considered

1. **Cache the canonical read.** Rejected — caches a racing row; doesn't give internal consistency or state labels.
2. **Let each consumer shape its own read.** Rejected — that is the certified ~40 raw reads; no consistency, no census.
3. **Serve projections and grounding from one read model.** Rejected — grounding is task-scoped for prompts, projections consumer-scoped for display; sibling read models over one graph.

## Consequences

- The read-side of the report_settings race closes — projections are internally consistent (one graph).
- A direct-read census (= 0) completes table mediation: one writer, one grounding authority, one projection runtime.
- The god hook dissolves into a projection/event client; the dual notification stack retires.
- The Chrome extension is certified a non-consumer — no migration.

## Trade-offs

- Materialization adds build/refresh cost (mitigated: event-driven incremental refresh; rebuild is standard recovery).
- The frontend migration is the highest-uncertainty surface (mitigated: last, per-section, beta-first, instant revert).

## Future implications

New consumers register a read model; projections rebuild deterministically, making rollback a rebuild. Freshness is event-driven, not TTL-guessed.

## Related constitutional sections

DESIGN-001 §3 (intelligence as projection), §14 (data flow); DESIGN-002 §6 (consumer contracts), §11 (P26/P27/P28); IMPLEMENTATION-002G §4–6, §16.

---
**Related ADRs:** [ADR-004](ADR-004-grounding-authority.md) (sibling read model), [ADR-001](ADR-001-one-write-authority.md), [ADR-002](ADR-002-one-trust-engine.md). **Amendments:** none.

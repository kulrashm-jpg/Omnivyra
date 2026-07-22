# ADR-003 — Immutable Evidence

**Status:** Accepted (ratified) · **Invariant:** P1 (+P22) · **Program:** IMPLEMENTATION-002C

## Context

AUDIT-004 certified that intelligence quality degrades primarily because evidence is **unrouted**, not unavailable: the knowledge graph, Wikidata/Wikipedia, the blog/post corpus, the 250-page BFS crawl, and JSON-LD each reached exactly one workflow or none. Evidence was transient (crawl bundles discarded), structured data was parsed then hashed, and conversation answers mutated the profile with no record of *why*.

## Decision

Every observation from any source becomes one **immutable, attributed, versioned Evidence Object** in a single store, routed to every consumer. Evidence is superseded, never edited. JSON-LD becomes typed evidence; conversation turns and generation outputs become evidence; external knowledge is routed to all. Evidence-selection exclusions are recorded (no silent truncation).

## Alternatives considered

1. **Keep per-source stores, add routing adapters.** Rejected — preserves the siloing; each new consumer re-integrates each source.
2. **Mutable evidence with history table.** Rejected — immutability is the foundation of lineage and explainability; mutation reintroduces the ambiguity the platform is eliminating.
3. **Evidence as a Knowledge concern.** Rejected — evidence is pre-fact; conflating them loses the derivation boundary (knowledge derives from evidence).

## Consequences

- The certified one-workflow-per-source defect closes; all evidence is retrievable by any authorized consumer via Grounding.
- Lineage and traceability become possible (facts link to the evidence that supports them).
- The certified deterministic backbone (refresh gate, change detection, fingerprint, SSRF) is preserved and re-homed as the collection policy engine.

## Trade-offs

- One immutable store grows monotonically (mitigated: freshness/supersession/retention-archival; content-addressed dedup).
- Both crawlers feeding one store requires unifying two collection paths (mitigated: depth becomes a policy, not a fork).

## Future implications

New evidence sources, crawlers, connectors, and modalities plug in by emitting Evidence Objects — no pipeline change. Multimodal and enterprise sources become evidence types.

## Related constitutional sections

DESIGN-001 §4 (evidence layer); DESIGN-002 §2 (Evidence object), §4 (Evidence state machine), §11 (P1/P22); IMPLEMENTATION-002C §4–6, §15.

---
**Related ADRs:** [ADR-004](ADR-004-grounding-authority.md) (grounding selects evidence), [ADR-002](ADR-002-one-trust-engine.md) (evidence-class → confidence dimension). **Amendments:** none.

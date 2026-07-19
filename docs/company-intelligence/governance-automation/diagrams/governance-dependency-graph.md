# Diagram — Governance Dependency Graph

The GOV-AUTO build/runtime/enforcement dependency DAG, from GOV-IMPL-001 §3. Enforcement order is orthogonal (paced by platform GATE-0..8).

## Build-order DAG

```mermaid
graph TD
    A005[AUDIT-005]
    G001[GOV-AUTO-001 Docs]
    G004[GOV-AUTO-004 Seam — critical path]
    G002[GOV-AUTO-002 Census]
    G003[GOV-AUTO-003 Boundary]
    G006[GOV-AUTO-006 Drift]
    G005[GOV-AUTO-005 Merge]
    G007[GOV-AUTO-007 Release]
    G008[GOV-AUTO-008 Health]
    IMPL[GOV-IMPL-001 Realization]
    CERT[GOV-CERT-001 Certification]

    A005 --> G001
    A005 --> G004
    G004 --> G002
    G004 --> G003
    G001 --> G006
    G004 --> G006
    G001 --> G005
    G004 --> G005
    G002 --> G005
    G003 --> G005
    G006 --> G005
    G001 --> G007
    G002 --> G007
    G006 --> G007
    G001 --> G008
    G002 --> G008
    G007 --> G008
    G001 --> IMPL
    G008 --> IMPL
    IMPL --> CERT
    G008 --> CERT
```

## Dependency table

| Program | Build depends on | Feeds |
|---|---|---|
| GOV-AUTO-001 Docs | — (independent) | 005, 006, 007, 008, IMPL |
| GOV-AUTO-004 Seam | code-model tooling; existing analyzers | 002, 003, 006 (detection foundation) |
| GOV-AUTO-002 Census | 004 | 005, 007, 008 |
| GOV-AUTO-003 Boundary | 004 | 005 |
| GOV-AUTO-006 Drift | 001, 004 | 005, 007 |
| GOV-AUTO-005 Merge | 001, 004, 002, 003, 006 | IMPL/CERT (aggregation) |
| GOV-AUTO-007 Release | 001–006 | 008, CERT |
| GOV-AUTO-008 Health | shared schema (001–007) | IMPL, CERT |
| GOV-IMPL-001 | all runtimes | CERT |
| GOV-CERT-001 | 001–008, IMPL | terminal |

## The three ordering laws (GOV-IMPL-001 §3)

1. **{001, 004} lead** — no build prerequisites; 001 fully independent, 004 the detection foundation (critical path, ~35% pre-built per IMPLEMENT-GOV-001).
2. **002/003/006 depend on 004**; 006 also on 001.
3. **005/007 aggregate the layer below; 008 consumes all; CERT certifies all.** No cycles.

**Related:** [governance-dependency in GOV-IMPL-001](../realization/GOV-IMPL-001.md) · [program-to-migration-gate-map](program-to-migration-gate-map.md) · [relationships](../appendices/relationships.md).

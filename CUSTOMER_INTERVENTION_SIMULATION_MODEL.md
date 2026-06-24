# CUSTOMER_INTERVENTION_SIMULATION_MODEL.md

Phase 15C · Phase 2 — deterministic simulation model. **Observable operational impact only —
NO prediction, NO success-rate estimation, NO AI, NO forecasting.** UNKNOWN stays UNKNOWN.

## Per-intervention outputs

For each of the 10 intervention types:

| Output | Definition |
|---|---|
| `eligible_count` | companies where the intervention is ELIGIBLE (governance-passing, CUSTOMER) |
| `suppressed_count` | SUPPRESSED (population / confidence / state) |
| `blocked_count` | BLOCKED (no gap — already satisfied) |
| `unknown_count` | UNKNOWN (undeterminable signal) |
| `customer_count` | eligible companies that are CUSTOMER (= eligible, since non-customers can't be eligible) |
| `non_customer_count` | companies excluded by population integrity |
| `confidence_distribution` | confidence of the eligible companies (HIGH/MEDIUM/LOW/UNKNOWN) |

These are **counts of observable governance states** — not estimates of whether an
intervention *would succeed*.

## Collision model (Phase 4)

A **collision** = a CUSTOMER with ≥ 2 simultaneous eligible interventions. Per colliding
customer: `highest_priority_intervention` (highest severity, catalog-order tie-break) and the
`deferred` remainder. A `collision_matrix` counts co-occurring intervention pairs. **Deferral
is simulated, never persisted or executed** — its only purpose is to reveal future overload.

## Capacity model (Phase 5)

`eligible_customers`, `customers_with_1 / 2 / 3+_interventions`,
`total_eligible_interventions`, `interventions_per_eligible_customer`, `queue_pressure`
(= total eligible interventions awaiting action *if* activated).

## Executive views (Phase 6)

`TOP_INTERVENTIONS_BY_REACH` (eligible count), `TOP_INTERVENTIONS_BY_CONFIDENCE` (HIGH then
MEDIUM eligible), `TOP_CUSTOMERS_BY_ELIGIBILITY`, `TOP_CUSTOMERS_BY_COLLISION`. CUSTOMER only.

## Guarantees

Read-only, deterministic, simulation only. No execution, no delivery, no persisted state.
Governance suppression is inherited from 15A; non-customers never appear in any eligible /
collision / capacity figure.

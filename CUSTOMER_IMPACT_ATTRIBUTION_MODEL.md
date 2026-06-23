# CUSTOMER_IMPACT_ATTRIBUTION_MODEL.md

Phase 13D · Phase 1 — the attribution model. Measures whether a readiness improvement can
be attributed to an Omnivyra intervention, **deterministically** from
`customer_readiness_snapshots`. Read-only; no mutations, no intervention execution.

## Signal model

A readiness **area flipping to READY** between two consecutive snapshots is the dated,
traceable proxy for an intervention:

| Area → READY | Intervention |
|---|---|
| WEBSITE | DOMAIN_VERIFICATION |
| GOOGLE_ANALYTICS | GA_CONNECTION |
| GOOGLE_SEARCH_CONSOLE | GSC_CONNECTION |
| SOCIAL_INTEGRATIONS | SOCIAL_CONNECTION |
| COMPANY_PROFILE | PROFILE_COMPLETION |
| TEAM_MEMBERS | TEAM_EXPANSION |
| BILLING | BILLING_ACTIVATION |
| COMMUNITY | *(no intervention)* |

## Attribution record (`AttributionCandidate`)

| Field | Meaning |
|---|---|
| `company_id` / `company_name` | tenant |
| `event_date` | snapshot date the area became READY (the intervention) |
| `intervention_type` | mapped from the flipped area |
| `outcome_date` | snapshot date the outcome was observed (same window boundary) |
| `outcome_types` | READINESS_INCREASE · BUCKET_INCREASE · OPPORTUNITY_REDUCTION |
| `readiness_delta` | readiness score change in the window |
| `attribution_status` | ATTRIBUTED · POSSIBLY_ATTRIBUTED · NOT_ATTRIBUTED |

## Classification rules (deterministic)

For each consecutive snapshot pair, "positive outcome" = readiness ↑ **or** bucket ↑
**or** opportunities ↓.

| Window condition | Result |
|---|---|
| `< 2` snapshots (company) | **INSUFFICIENT_DATA** |
| 1 area flipped + positive outcome | **ATTRIBUTED** |
| ≥ 2 areas flipped + positive outcome | **POSSIBLY_ATTRIBUTED** (per area — can't isolate the driver) |
| area flipped + no positive outcome | **NOT_ATTRIBUTED** |
| positive outcome + no area flip | counted as an **unattributed improvement** |

Company `impact_status` = best of its candidates (ATTRIBUTED > POSSIBLY > NOT), or
INSUFFICIENT_DATA when < 2 snapshots.

## Portfolio (`PortfolioImpact`)

`attributed_improvements`, `possible_improvements`, `unattributed_improvements`,
`insufficient_data_companies`, `top_impact_drivers` (intervention ranked by attributed
then possible), `most_common_improvement_paths` (e.g. `DOMAIN_VERIFICATION → READINESS_INCREASE`).

## Honest limitation

Event and outcome are **co-observed at the same snapshot boundary** — daily granularity.
The engine cannot prove the flip preceded the readiness change *within* a day. Event-level
timestamps from the [intervention inventory](CUSTOMER_INTERVENTION_INVENTORY.md) would
enable finer causal ordering in a future phase.

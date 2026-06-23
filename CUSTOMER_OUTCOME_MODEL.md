# CUSTOMER_OUTCOME_MODEL.md

Phase 13C · Phase 1 — the outcome model. Measures whether customer health improves over
time, derived **deterministically** from `customer_readiness_snapshots`. Read-only; no
mutations (outcomes are computed live from snapshots — no outcome table is written).

## Per-company outcome (`CompanyOutcome`)

| Field | Meaning | Source |
|---|---|---|
| `company_id` / `company_name` | tenant | snapshot / cockpit |
| `snapshot_date` | date of the latest snapshot | latest snapshot |
| `readiness_score` / `priority_score` / `opportunity_count` | current values | latest snapshot |
| `previous_score` | readiness at the **earliest** snapshot in the window | earliest snapshot |
| `current_score` | readiness at the **latest** snapshot | latest snapshot |
| `net_change` | `current_score − previous_score` | computed |
| `opportunity_delta` | current − earliest opportunity count | computed |
| `bucket_movement` | e.g. `PARTIAL → READY` (or null) | computed |
| `area_improvements` / `area_regressions` | readiness areas that gained / lost READY-ness | computed |
| `outcome_classification` | IMPROVED · UNCHANGED · DECLINED · NO_HISTORY | computed |
| `snapshots_compared` | number of snapshots available | computed |

**Window:** earliest vs latest snapshot per company (cumulative movement over tracked
history). A windowed variant (e.g. last 30 days) is a future extension; the comparison
function is window-agnostic.

## Classification rules (deterministic)

Let `Δ = net_change`, band = **3**, and bucket order `AT_RISK < PARTIAL < READY`.

| Condition (first match wins) | Outcome |
|---|---|
| `< 2` snapshots | **NO_HISTORY** |
| `Δ > +3` **OR** bucket moved up | **IMPROVED** |
| `Δ < −3` **OR** bucket moved down | **DECLINED** |
| otherwise | **UNCHANGED** |

Bucket movement overrides a small score change (e.g. +2 score with `PARTIAL → READY`
classifies IMPROVED). No randomness, no AI — identical inputs always yield identical
outputs.

## Portfolio (`PortfolioOutcomes`)

`improved_companies`, `declined_companies`, `unchanged_companies`, `no_history_companies`,
`average_readiness_change` (over companies with history), `top_improvers`,
`top_decliners`, `most_improved_areas`, `most_regressed_areas`.

## Executive summary (deterministic templates, no AI)

Lines such as: *"N companies improved readiness."*, *"N companies declined."*,
*"Average readiness change: +X."*, *"GA adoption increased by N companies."*,
*"Website verification increased by N companies."*, and an insufficient-history note.

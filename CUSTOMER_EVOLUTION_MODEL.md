# CUSTOMER_EVOLUTION_MODEL.md

Phase 12G · Phases 1–2 — the evolution model + snapshot audit. **Read-only,
deterministic.** No notifications, automation, or delivery. Source of truth:
[backend/services/customerEvolutionService.ts](backend/services/customerEvolutionService.ts).

## What evolution tracks

Movement between two readiness **snapshots** of the same company over time:

| Movement | From / to | Examples |
|---|---|---|
| **Readiness movement** | `readiness_bucket` | `AT_RISK → PARTIAL`, `PARTIAL → READY` |
| **Status movement** | `tenant_status` | `ACTIVE → DORMANT`, `DORMANT → ACTIVE` |
| **Priority movement** | `priority_tier` | `MEDIUM → CRITICAL` |
| **Opportunity movement** | `opportunity_count` delta | `8 → 4` (−4) |
| **Area movement** | each readiness area state | `WEBSITE NOT_READY → READY` (improved) |

## Trajectory (deterministic)

`computeCompanyEvolution(snapshots)` compares the latest two snapshots:

- **UNKNOWN** — fewer than 2 snapshots (no guessing).
- **IMPROVING** — `Δscore > 3`, or bucket moved up, or more area improvements than regressions.
- **DECLINING** — `Δscore < −3`, or bucket moved down, or more regressions than improvements.
- **STABLE** — otherwise (within the ±3 band, no bucket move, balanced area changes).

Per company it also yields: `score_delta`, `readiness_movement`, `status_movement`,
`priority_movement`, `opportunity_delta`, **biggest_improvement** / **biggest_regression**
(strongest area state-jump, deterministic tiebreak by area order), and `evidence[]`.

State ranking for area direction: `NOT_READY(0) < UNKNOWN(1) < READY(2)`.

## Portfolio (Phase 5)

`most_improved` / `most_declined` (by `score_delta`), `most_improved_areas`,
`most_common_regressions`, and a `trajectory_distribution`.

## Snapshot audit (Phase 2)

**Does readiness-model history exist? No.** The readiness model (12A–F) is computed
live and **never persisted** — there is no snapshot of `readiness_bucket`,
`overall_readiness_score`, opportunity counts, priority tiers, or area states over time.

Adjacent historical tables exist but track **different** things (not the readiness
model), so they are NOT used (using them would be guessing):

| Table | Tracks | Why not used |
|---|---|---|
| `report_score_history`, `report_pillar_history` | per-report digital-authority scores | different metric (reports, not readiness) |
| `org_weekly_metrics` | weekly usage metrics | usage, not readiness areas |
| `maturity_snapshots` | platform/feature maturity | not per-tenant readiness |
| `analytics_intelligence_snapshots`, `company_context_snapshots` | analytics/context state | not the readiness model |
| `integration_activity_events` | timestamped integration events | event log, not readiness states |

**What must be added later (NOT in this phase):** a `customer_readiness_snapshots`
table (`company_id, taken_at, overall_readiness_score, readiness_bucket, tenant_status,
opportunity_count, priority_tier, areas jsonb`) populated by a daily read-only snapshot
job. The delta engine already reads this shape (`loadReadinessHistory`) and will light
up automatically once ≥ 2 snapshots accumulate. Until then, **every company's
trajectory is `UNKNOWN`**.

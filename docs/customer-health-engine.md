# Canonical Customer Health Engine (CSA-003)

ONE canonical Customer Health authority: a single deterministic score, state,
and risk classification per company, derived from the existing signals. Closes
**G18** (no canonical health score), **G19** (duplicate readiness-like concepts —
health now *consumes* readiness, never re-derives it), and **G20** (no risk
classification). No second health model; no AI; no readiness redesign.

## Health authority (§1)

- **Model (pure):** `lib/health/customerHealth.ts` — `computeCustomerHealth(inputs)`
  is the deterministic math. No IO, no AI.
- **Service (authority):** `backend/services/health/customerHealthService.ts` —
  gathers inputs from existing authorities, computes health, persists daily
  snapshots, and exposes the read authority (`getLatestCustomerHealth`,
  `getCustomerHealthHistory`). Every future Customer Success capability
  (Lifecycle, Risk, Renewal, Engagement, Automation) reads health here.

## Health model (§2)

Health is a deterministic weighted composite of components sourced **only** from
existing authorities:

| Component | Weight | Source (consumed, not recomputed) |
| --- | --- | --- |
| Setup readiness | 0.50 | `customerReadinessService` `overall_readiness_score` |
| Integration coverage | 0.20 | readiness area states (Website/GA/GSC/Social) |
| Recent activity | 0.30 | max(activity recency from readiness `last_activity_at`, CSA-001 usage active-days) |
| Evolution modifier | ±8 | `customerEvolutionService` trajectory |
| Platform Ready bonus | +4 | company-scoped Platform Ready (readiness bucket READY) |

Score is clamped 0–100. Activity takes the **max** of last-activity recency and
CSA-001 usage active-days, so it is meaningful today (readiness activity) and
richer once usage producers emit events.

## Health states (§3)

Deterministic thresholds on the composite score, with an INACTIVE override:

| Score | State |
| --- | --- |
| ≥ 85 | EXCELLENT |
| ≥ 70 | HEALTHY |
| ≥ 55 | STABLE |
| ≥ 40 | NEEDS_ATTENTION |
| < 40 | AT_RISK |

**INACTIVE** overrides the numeric state when `tenant_status = INACTIVE` or there
has been no activity for ≥ 30 days.

## Risk model (§4)

Risk is derived from state (NONE→CRITICAL), bumped one level on a DECLINING
trajectory (or a score delta below −3). Each result carries:

- **risk level** — NONE / LOW / MEDIUM / HIGH / CRITICAL;
- **reasons** — deterministic copy (low readiness, missing setup, few
  integrations, declining trend, low activity, inactivity);
- **missing prerequisites** — not-ready readiness areas (reused, not re-derived);
- **inactive duration** — whole days since last activity;
- **adoption gaps** — integrations not yet connected.

## Health explanation (§5)

Every result explains **why** (state summary), **major contributors** (components
≥ 70 + improving trajectory), **negative contributors** (components < 50 +
declining trajectory), and **recommended improvements** (complete missing setup,
increase activity, finish onboarding). All deterministic copy.

## Health history / snapshot lifecycle (§6)

`customer_health_snapshots` (migration `20260729_customer_health_snapshots.sql`)
stores one snapshot per company per UTC day. The daily job
`backend/jobs/healthSnapshotJob.ts` (`runHealthSnapshotJob`) is wired into the
**same** scheduler used by CSA-002 (`backend/scheduler/cron.ts`, job key
`healthSnapshot`) — no second scheduler. It builds health from the existing
authorities and persists idempotently. Historical health comes only from this
table via the read authority.

```
getCustomerReadiness → loadReadinessHistory → computeCompanyEvolution
                     ↘ getUsageSummary (CSA-001) ↘
   gatherHealthInputs → computeCustomerHealth → generateHealthSnapshots
                                                → customer_health_snapshots
```

## Idempotency (§7)

Duplicate/replay/retry/resume-safe: UNIQUE `(company_id, snapshot_date)` +
`ON CONFLICT DO NOTHING`. A same-day rerun inserts 0; a new UTC day adds one row.

## Observability (§8)

Reuses HARDEN-001: `csa.health_snapshot.generated` / `.duplicates` / `.failures`
/ `.duration_ms`, plus `csa.health.distribution{state}` and
`csa.health.risk_distribution{level}`. The job is fail-safe (records a failure
metric, returns `ok:false`, never throws).

## Consumers

The health authority is read by future Customer Success capabilities via
`getLatestCustomerHealth(companyId)` / `getCustomerHealthHistory(companyId)`.
There is exactly one health model — nothing else computes a customer health
score.

## Backward compatibility (§9)

No onboarding change, no readiness redesign, no API breaking change. Readiness,
evolution, and usage authorities are consumed unchanged. The health table and
job are additive; the job is fail-safe, so it is safe to ship ahead of the
migration.

## Files

- `lib/health/customerHealth.ts` — the pure health model.
- `backend/services/health/customerHealthService.ts` — the health authority.
- `backend/jobs/healthSnapshotJob.ts` — the daily snapshot job.
- `backend/scheduler/cron.ts` — daily `healthSnapshot` registration (same scheduler).
- `supabase/migrations/20260729_customer_health_snapshots.sql` — the time-series.

## Tests

- `backend/tests/unit/csa003CustomerHealthEngine.test.ts` — health scoring across
  states, INACTIVE overrides, evolution modifiers, determinism, risk
  classification (missing prerequisites / adoption gaps / reasons / inactive
  duration), explanation, `gatherHealthInputs` mapping (Platform Ready from
  readiness), idempotent daily snapshots, and the observable/fail-safe job.

## Deploy note

`customer_health_snapshots` must be applied (controlled migration process) before
the job persists. Until then the job runs fail-safe (failure metric, `ok:false`).

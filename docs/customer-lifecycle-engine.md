# Canonical Customer Lifecycle Engine (CSA-004)

ONE canonical Customer Lifecycle authority: a single deterministic lifecycle
**stage** and its **transition** per company, derived from the existing signals.
Closes **G21** (no canonical lifecycle stage), **G22** (no lifecycle transitions),
and **G23** (duplicate customer-maturity concepts — lifecycle now *consumes*
health/readiness/evolution instead of introducing a parallel maturity model). No
second lifecycle model, no AI.

## Lifecycle authority (§1)

- **Model (pure):** `lib/lifecycle/customerLifecycle.ts` —
  `computeCustomerLifecycle(inputs)` is the deterministic classification +
  transition math. No IO, no AI.
- **Service (authority):** `backend/services/lifecycle/customerLifecycleService.ts` —
  reuses the CSA-003 health authority, loads the prior stage, computes lifecycle,
  persists the daily time-series, and exposes the read authority
  (`getLatestCustomerLifecycle`, `getCustomerLifecycleHistory`). Every future
  Customer Success capability (Automation, Renewal, Expansion, Retention,
  Dashboard) reads lifecycle here.

## Lifecycle model (§2)

Lifecycle is derived **only** from existing authorities, none recomputed:

- **Platform Ready** — company-scoped onboarding completion;
- **CSA-003 Health** — score + state (itself a composite of readiness,
  integrations, usage, activity);
- **CSA-002 Evolution** — trajectory / score delta;
- **CSA-001 Usage** + **activity** — active days / users;
- **Integration coverage** — from readiness areas (via the health contributor).

Deterministic; no AI.

## Lifecycle stages (§3)

Seven canonical stages via deterministic, first-match classification:

| Stage | Condition (first match) |
| --- | --- |
| **Onboarding** | not Platform Ready |
| **Dormant** | health state INACTIVE |
| **Declining** | evolution trajectory DECLINING |
| **Mature** | health score ≥ 85 |
| **Growing** | health score ≥ 70, or (≥ 55 and IMPROVING) |
| **Adopting** | health score ≥ 50 |
| **Activated** | Platform Ready but minimal adoption |

## Transition model (§4)

Each result carries the transition, computed against the prior persisted stage
(never inferred randomly):

- **previous stage** / **current stage**;
- **direction** — INITIAL (first evaluation) / NONE (unchanged) / PROMOTION
  (advancing the ladder) / REGRESSION (falling back, incl. Declining/Dormant);
- **reason** — deterministic copy keyed by destination stage + direction;
- **timestamp** (`stage_since`) — set to `now` on a change, **carried forward**
  unchanged otherwise, so a same-day rerun never fabricates a transition;
- **trajectory** — from the Evolution engine.

Ladder rank: Onboarding < Activated < Adopting < Growing < Mature; Declining and
Dormant are off-ladder negatives.

## Lifecycle explanation (§5)

Every result explains **why** (stage summary), **major signals** (health, Platform
Ready, improving trajectory, active days, strong integrations), **blocking
factors** (setup incomplete, inactivity, declining, few integrations, no usage),
**next milestone**, and **recommended progression** — all deterministic copy.

## Lifecycle history / snapshot lifecycle (§6)

`customer_lifecycle_snapshots` (migration `20260730_customer_lifecycle_snapshots.sql`)
stores one snapshot per company per UTC day. The daily job
`backend/jobs/lifecycleSnapshotJob.ts` (`runLifecycleSnapshotJob`) is wired into
the **same** scheduler as CSA-002/CSA-003 (`backend/scheduler/cron.ts`, job key
`lifecycleSnapshot`) — no second scheduler. It builds health once and reuses it
for both classification and the snapshot rows.

```
buildAllCustomerHealth (CSA-003)  ──►  build once
        │  (reused)                     ▼
loadLatestLifecycleStages ──►  computeCustomerLifecycle ──► generateLifecycleSnapshots
   (prior stage for transition)                          → customer_lifecycle_snapshots
```

## Idempotency (§7)

Duplicate/replay/retry/resume-safe: UNIQUE `(company_id, snapshot_date)` +
`ON CONFLICT DO NOTHING`. A same-day rerun inserts 0; `stage_since` carries the
transition timestamp forward, so reruns never fabricate a new transition.

## Observability (§8)

Reuses HARDEN-001: `csa.lifecycle_snapshot.generated` / `.duplicates` /
`.failures` / `.duration_ms`, plus `csa.lifecycle.distribution{stage}` and
`csa.lifecycle.transitions{direction}`. The job is fail-safe (records a failure
metric, returns `ok:false`, never throws).

## Consumers

Read via `getLatestCustomerLifecycle(companyId)` /
`getCustomerLifecycleHistory(companyId)`. Exactly one lifecycle model exists —
nothing else classifies a customer lifecycle stage.

## Backward compatibility (§9)

No onboarding change, no readiness redesign, no health redesign, no API breaking
change. Health/evolution/usage/readiness authorities are consumed unchanged; the
lifecycle table and job are additive; the job is fail-safe.

## Files

- `lib/lifecycle/customerLifecycle.ts` — the pure lifecycle model.
- `backend/services/lifecycle/customerLifecycleService.ts` — the lifecycle authority.
- `backend/jobs/lifecycleSnapshotJob.ts` — the daily snapshot job.
- `backend/scheduler/cron.ts` — daily `lifecycleSnapshot` registration (same scheduler).
- `supabase/migrations/20260730_customer_lifecycle_snapshots.sql` — the time-series.

## Tests

- `backend/tests/unit/csa004CustomerLifecycleEngine.test.ts` — stage
  classification across all stages, deterministic transitions (INITIAL / NONE /
  PROMOTION / REGRESSION, carried `stage_since`), explanation, idempotent daily
  snapshots, and the observable/fail-safe job.

## Deploy note

`customer_lifecycle_snapshots` must be applied (controlled migration process)
before the job persists. Until then the job runs fail-safe (failure metric,
`ok:false`).

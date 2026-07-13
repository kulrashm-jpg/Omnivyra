# Customer Readiness History (CSA-002)

Activates the platform's existing but dormant readiness-history stack so
historical customer readiness becomes the canonical time-series and the Customer
Evolution engine becomes operational. Closes audit gaps **G27** (snapshots never
scheduled) and **G32** (Evolution always UNKNOWN because history was absent).

This is an **activation**, not a redesign: the readiness calculation, the
snapshot model, and the evolution math are all pre-existing and unchanged. CSA-002
only schedules the snapshot generator, adds observability, and points the manual
script at the same runner.

## Snapshot lifecycle

```
getCustomerReadiness({})            ← the ONE readiness authority (§3, unchanged)
      │  tenants: CompanyReadiness[]
      ▼
generateReadinessSnapshots(tenants, takenAt)   ← the ONE snapshot authority (§1, unchanged)
      │  buildSnapshotRow (pure) → upsert ON CONFLICT (company_id, snapshot_date) DO NOTHING
      ▼
customer_readiness_snapshots        ← the ONE historical-readiness table (§5)
      ▼
loadReadinessHistory + computeCompanyEvolution  ← Evolution engine (§4, unchanged)
```

`backend/jobs/readinessSnapshotJob.ts` (`runReadinessSnapshotJob`) is the thin
observability + orchestration wrapper that ties these together. It performs no
readiness calculation and no snapshot modelling of its own.

## Scheduling (§2)

The job is registered in the existing interval scheduler
`backend/scheduler/cron.ts` as a **once-per-day** job under the key
`readinessSnapshot`, alongside the other daily jobs (opportunity slots,
governance audit, auto-optimization). It inherits the scheduler's guarantees:

- **single-instance** via the `CronGuard` distributed lock (no concurrent runs);
- **admin/Redis-usage overridable** via `shouldRunCronJob('readinessSnapshot', …)`;
- **company-scoped, daily** — one pass computes readiness for every company and
  writes one snapshot per company per UTC day.

The manual entry point `scripts/customer-readiness-snapshot.ts` now delegates to
the same `runReadinessSnapshotJob`, so cron and hand-runs share one path.

## History (§3)

Snapshots populate `customer_readiness_snapshots` (migration
`20260723000000_customer_readiness_snapshots.sql`, pre-existing) using the
existing readiness authority. No readiness calculation is duplicated — the job
consumes `getCustomerReadiness` output verbatim through `buildSnapshotRow`.

## Evolution (§4)

`customerEvolutionService.computeCompanyEvolution` was already built to compute
IMPROVING / STABLE / DECLINING deltas from ≥2 snapshots and to return UNKNOWN
below that threshold. It is now **operational**: once the daily job has run on
≥2 days, `loadReadinessHistory` returns real history and the engine produces real
trajectories. The engine code is unchanged (only stale "table doesn't exist yet"
comments were corrected).

## Read authority (§5)

Historical readiness comes **only** from `customer_readiness_snapshots`, read via
`customerEvolutionService.loadReadinessHistory`. Future Customer Success
capabilities consume this authority — there is no second historical-readiness
source.

## Idempotency (§6)

Duplicate-, replay-, retry-, and resume-safe. The idempotency anchor is the
unique key `(company_id, snapshot_date)` on the snapshot table; persistence uses
`upsert(..., { onConflict: 'company_id,snapshot_date', ignoreDuplicates: true })`
→ `INSERT … ON CONFLICT DO NOTHING`. A same-day rerun inserts 0 (all skipped). A
new UTC day produces a new row.

## Observability (§7)

Reuses HARDEN-001 (`recordRawCounter`/`recordRawHistogram`):

- `csa.readiness_snapshot.generated` — snapshots written this run;
- `csa.readiness_snapshot.duplicates` — same-day snapshots skipped;
- `csa.readiness_snapshot.failures` — a failed run;
- `csa.readiness_snapshot.duration_ms` — run duration.

The job is fail-safe: on any error it records a failure metric and returns
`ok:false` rather than throwing.

## Backward compatibility (§8)

No API change, no readiness redesign, no onboarding change, no schema redesign.
The snapshot table already existed; the readiness/snapshot/evolution services are
unchanged. Evolution still returns UNKNOWN with <2 snapshots (preserved). The
only functional change is that the existing snapshot generator now runs on a
schedule.

## Files

- `backend/jobs/readinessSnapshotJob.ts` — the observable daily job runner (new).
- `backend/scheduler/cron.ts` — daily `readinessSnapshot` registration (wiring).
- `scripts/customer-readiness-snapshot.ts` — delegates to the shared runner.
- `backend/services/customerEvolutionService.ts` — stale comments corrected (no
  logic change).

## Tests

- `backend/tests/unit/csa002ReadinessHistory.test.ts` — daily generation,
  per-day duplicate prevention, new-day snapshots, `buildSnapshotRow`
  determinism, the job's idempotency/retry/observability/fail-safe behavior, and
  Evolution activation (UNKNOWN with 1 snapshot; IMPROVING/DECLINING with ≥2).

## Deploy note

`customer_readiness_snapshots` must be applied (controlled migration process)
before the job can persist. Until then the job runs fail-safe (failure metric,
`ok:false`) and nothing breaks; Evolution keeps returning UNKNOWN.

# Post-deploy fire check: worker platform sweeps

Three sweeps run on the Railway worker as `scheduleWorker` timers in
`backend/scheduler/cron.ts` (owner ruling 2026-11-12). Before this, each had an
`/api/cron/*` route and nothing calling it.

| Worker label          | Every  | Job                                   | Route kept for manual use          |
|-----------------------|--------|---------------------------------------|------------------------------------|
| `anomalySweep`        | 2 min  | `runAnomalySweep` (auth_audit_logs)   | `/api/cron/anomaly-sweep`          |
| `schedulerLockSweep`  | 15 min | `sweepStaleSchedulerLocks`            | `/api/cron/scheduler-lock-sweep`   |
| `recoverStaleReports` | 5 min  | `recoverStaleGeneratingReports` (releases credit holds) | `/api/cron/recover-stale-reports` |

They are timers, not intent-gated cycle jobs: they run on an idle platform and
need no `ALWAYS_RUN_JOBS` entry. A run that cannot do its work throws, which
the cron report counts as an error.

## When

After the worker deploy, wait **at least 15 minutes plus one scheduler cycle**
(`CRON_INTERVAL_SECONDS`, default 900 s). The cron report reaches Redis once
per cycle, so `cron-metrics` can lag the timers by up to one cycle.

## Check (super admin, read-only)

`GET /api/super-admin/cron-metrics` (super-admin session). In the body, read
`workers`:

| Label                 | PASS                                                    |
|-----------------------|---------------------------------------------------------|
| `anomalySweep`        | present, `executions` >= 5, `errors` = 0, `lastRunAt` within the last ~3 min of the report |
| `schedulerLockSweep`  | present, `executions` >= 1, `errors` = 0                |
| `recoverStaleReports` | present, `executions` >= 2, `errors` = 0                |

A 503 means the cron process has written no report yet: wait one more cycle.
A label that is **missing** means the timer never ran: FAIL, check that the
deployed worker image contains this commit.

## On FAIL (`errors` > 0)

Search the worker logs for `[<label>] worker error`; the message names the
cause. In particular:

- `anomaly sweep could not read auth_audit_logs: ...`: the worker's database
  credentials cannot read the audit log. The sweep has detected nothing.
- `scheduler_lock_sweeper_query_failed` / `_delete_failed`: the lock table.
- `Failed to scan stale reports` / `Failed to recover stale reports`: the
  reports table. No credit hold was released by that run.

Quiet runs log nothing. Activity logs only on work:
`[anomalySweep] anomalies_found=N` (see the note below), `[schedulerLockSweep] deleted=N`,
`[recoverStaleReports] recovered=N timeoutMinutes=... cutoff=... ids=...` then
`[recoverStaleReports] recovered=N` (each recovered report's credit hold is
released; e1 owns that path).

Note: `anomalies_found` is currently always 0 (`runAnomalySweep` never
increments it; `evaluateAnomalyCount` returns nothing). Crossings show up as
`system_anomalies` rows and CRITICAL Slack alerts, not in this log line.

## Not scheduled (owner, launch)

`report-automation`, `campaign-health-monitor`: KEEP OFF.
`autonomous-scheduler`, `learning-decay`, `leverage-optimizer`: parked with
Phase B. `backend/tests/unit/workerCronSweepsRunSet.test.ts` fails if the worker
reaches any of them.

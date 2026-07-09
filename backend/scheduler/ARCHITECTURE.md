# cron.ts — Architecture & Change-Safety Contract

_Audited 2026-07-09/10. Covers `backend/scheduler/cron.ts` (1,487 LOC) — the
scheduler process entrypoint (boot + 19 recurring workers + the publish cycle)._

## Classification

**Infrastructure / Stateful boot module.** Not an orchestrator in the
extractable sense: 42 module-level mutable `let` variables (last-run
timestamps, timers, guards) are written by `startCron` (boot) AND read/written
by `runSchedulerCycle` (jobs), with 29 shared across that boot↔jobs boundary.
Helper functions (`formatCaughtError` ×88 uses, `scheduleWorker` ×19) are used
on both sides.

## Why this file is parked (Phase 2/4 verdict, twice confirmed)

A decomposition attempt (cronDefs/cronJobs + cronRunState holder) was executed
and REVERTED (findings preserved in commit `6b8eff1e`): module-level `let`
state cannot cross module boundaries (TS2632 assign-to-import), and a
state-holder conversion requires a scope-aware rewrite of ~800 reference sites
plus live worker verification — risk far beyond any maintainability gain.
**Do not retry a mechanical split.** The safe evolution, if ever needed, is a
`cronRunState` object introduced incrementally per job WITH the schedule
contract test green and a Railway worker canary.

## Runtime shape

```
startCron: validate env → Redis readiness probe → cron-guard restore (30
last-run keys from Redis; survives restarts) → startup intelligence-polling
enqueue (only when Redis ready AND never run) → IMMEDIATE runSchedulerCycle()
→ base-tick setInterval (BASE_TICK_MS; cycle runs only when
shouldRunPublishCycle() — working-hours interval vs off-hours gap) → 19
scheduleWorker registrations (jittered self-rescheduling setTimeout chains —
no overlap per worker; errors contained + instrumented; admin-config cache
warmed per tick) → shutdown clears timers.
```

Boundaries: Redis (cron-guard persistence, BullMQ safety-net enqueues),
Supabase (via every job service), admin runtime config, ~40 job modules.

## Scheduling contract (locked in CI)

`backend/tests/unit/cronScheduleContractCharacterization.test.ts` extracts and
golden-masters from source: all timing-constant definitions (~40), the
worker registry (19 interval↔label pairs, no duplicate labels, count must
equal call sites), the cron-guard restore-key map, the base-tick wiring
(immediate startup cycle + gated interval), and scheduleWorker's tick
semantics (jitter, error containment, self-reschedule). Changing any schedule,
renaming a label, or dropping a guard key fails CI until the snapshot is
updated deliberately — "never change scheduler timing" is now enforced, not
just documented.

**Not covered (execution)**: runSchedulerCycle's publish pipeline, per-job
gating (shouldRunCronJob overrides), working-hours math, Redis-degraded
branches. Executing cron under jest is out of scope by design — see above.

## Governance verdict

Architecture 40/100 · Testability 35/100 (contract-locked; execution untestable
by construction) · Maintainability 45/100. Coupling: extreme afferent (every
job module) and shared mutable state. Cohesion: moderate (boot + registry +
cycle in one file). Runtime risk of decomposition: EXTREME (proven by the
reverted attempt; this schedules production publishing). **Verdict B: optimal
maintainable form under the behavior-preservation constraint** — the honest
statement is that this file's debt is real but not safely payable by
splitting; the schedule-contract test converts its most dangerous change class
(silent timing drift) into a CI failure.

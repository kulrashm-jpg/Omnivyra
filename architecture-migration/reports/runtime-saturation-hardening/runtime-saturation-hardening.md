# Runtime Saturation + Execution-Governance Hardening — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Make runtime execution operationally bounded, saturation-aware, and tenant-fair under load. Add canonical concurrency / retry-rate / burst primitives and operator visibility — without rewriting the queue or scheduler.

---

## Files audited

### Existing primitives composed (no modifications beyond opt-in wiring)
- [backend/services/jobRunner.ts](../../../backend/services/jobRunner.ts) — canonical job-execution wrapper (built earlier). Extended this phase with an opt-in `concurrency` field.
- [backend/services/workerRetryService.ts](../../../backend/services/workerRetryService.ts) — bounded `executeWithRetry` (3 attempts) + `moveToDeadLetter`. Existing retry layer, unchanged.
- [backend/services/SchedulerLockService.ts](../../../backend/services/SchedulerLockService.ts) — campaign-scoped scheduler locks. Read-only consumed by the new pressure monitor.
- `scheduler_locks` table — used by long-running jobs (e.g. `dailyIntelligenceScheduler.acquireLock`) for cross-instance overlap protection. Read-only consumed by the new pressure monitor.
- [backend/services/jobInspection.ts](../../../backend/services/jobInspection.ts) — DLQ summary, consumed by the new pressure monitor.
- [backend/security/MfaAttemptLimiter.ts](../../../backend/security/MfaAttemptLimiter.ts) — pattern reused (in-memory counters with shape-for-Redis-swap surface).

### Pressure surfaces audited
| Domain | Bounded? | Tenant-fair? | Replay-safe? | Notes |
|---|---|---|---|---|
| `runJob` (canonical) | yes (executeWithRetry caps at 3) | no — could be one tenant saturating | yes (DLQ idempotency probe) | gained per-tenant concurrency this phase via opt-in |
| BullMQ queues (publish, ai-heavy, engagement) | yes (broker `attempts`) | no — broker has no tenant concept | yes (queue_jobs.status) | unchanged |
| Cron endpoints | yes (cron tick = bounded duration) | no — single-process iteration | per-job idempotency | unchanged |
| `dailyIntelligenceScheduler` | yes (`scheduler_locks` 30-min stale window) | no | per-day idempotency (last phase) | unchanged |
| `engagementPollingProcessor` | yes (per-tenant runJob blocks last phase) | yes (per-org grouping) | hourly idempotency bucket | unchanged |
| AI execution (`executeWithCredits`) | yes (HOLD/CONFIRM/RELEASE bounded) | no — single tenant could saturate | yes (idempotency keys) | unchanged |

### Saturation risks identified
1. **No per-tenant concurrency cap** anywhere in the runtime — one tenant burst-firing 100 simultaneous campaigns saturates the worker pool against everyone else.
2. **No retry-storm detection** — `executeWithRetry` caps per-job at 3, but a tenant whose 100th post fails for the same external reason produces 100×3=300 retries with no rate-cap.
3. **No burst damping** — a runaway client could fan out millions of `runJob` calls to the same key per second; only DB constraints (idempotency UNIQUE) eventually bound it.
4. **No operator visibility into in-flight work** — operators see DLQ + drift, but not "right now, what's running and where is the pressure".
5. **Scheduler lock staleness** — `scheduler_locks` rows older than 30 min are auto-overridden as stale, but no surface counts how many are currently stale.

---

## Files created (3)

1. **[backend/services/executionGovernor.ts](../../../backend/services/executionGovernor.ts)** — canonical concurrency + retry-rate + burst primitive.
   - `acquire({ key, max, maxPerSecond?, maxRetriesPerMinute?, isRetry? })` returns `{ ok: true, release }` or `{ ok: false, reason }`.
   - Three independent caps:
     - **Concurrency**: per-key in-flight count cap.
     - **Burst**: per-second acquire rate cap.
     - **Retry-rate**: per-minute rolling window of acquires marked `isRetry: true`.
   - Inspection hooks: `snapshotConcurrency()` and `snapshotRetryRates()` for the pressure monitor.
   - `recordRetry(key)` for callers that retry outside the lease lifecycle but want rate visibility.
   - In-memory `Map<string, …>` for the prototype; the surface is shaped so a Redis swap is local. Multi-instance correctness requires Redis — single-instance correctness holds.

2. **[backend/services/runtimePressureMonitor.ts](../../../backend/services/runtimePressureMonitor.ts)** — read-only pressure aggregator.
   - `reportRuntimePressure({ topN?, dlqWindowHours? })` returns severity-classified snapshots across four dimensions:
     - **Concurrency**: top N keys by in-use count + total in-use.
     - **Retry rates**: top N scopes by counts in the last minute.
     - **Scheduler locks**: every active row in `scheduler_locks` with stale-lock detection (>30 min).
     - **DLQ pressure**: rolling-window DLQ count by worker name.
   - Severity classification per-dimension + an `overall` aggregate.
   - Bounded queries; safe to call on a dashboard refresh.

3. **[pages/api/super-admin/runtime-pressure.ts](../../../pages/api/super-admin/runtime-pressure.ts)** — admin endpoint, GET-only, capability-gated by `SUPER_ADMIN_DASHBOARD_VIEW`. Read-only.

## Files modified (2)

1. **[backend/services/jobRunner.ts](../../../backend/services/jobRunner.ts)** — added an OPT-IN `concurrency` field on `RunJobSpec`:

   ```ts
   const outcome = await runJob(
     {
       jobName: 'queue:campaign-execute',
       triggerSource: 'queue',
       tenantId: orgId,
       concurrency: { key: `tenant:${orgId}`, max: 5, maxPerSecond: 50 },
     },
     async () => doWork(),
   );
   ```

   When supplied, the runner acquires a governor lease before invoking the handler and releases it in `finally`. Pressure rejections short-circuit with a new `'pressure_rejected'` outcome status carrying the `reason` (`CONCURRENCY_LIMIT` / `RETRY_STORM` / `BURST_LIMIT`) and the `key` so the caller can decide whether to back off + retry or shed.

   The `RunJobOutcome<T>` discriminated union now has 5 branches; `auditOutcome`'s status type was extended to match. **No existing callers were forced to migrate** — `concurrency` is optional, defaulting to no governor. Callers that want tenant-fair concurrency opt in per call.

2. **[pages/api/cron/process-scheduled-posts.ts](../../../pages/api/cron/process-scheduled-posts.ts)** — handles the new `'pressure_rejected'` outcome by counting it as `skipped` (the post stays scheduled and the next cron tick retries naturally — no FAILED state, no infinite retry loop).

---

## Execution-governor results

The new governor is a single primitive with three caps:

| Cap | Use case | Rejection reason |
|---|---|---|
| Concurrency (max in-use) | "no more than 5 concurrent jobs for tenant X" | `CONCURRENCY_LIMIT` |
| Burst (max per second) | "no more than 50 acquires/sec for the same key" | `BURST_LIMIT` |
| Retry-rate (max per minute) | "no more than 30 retry-marked acquires/min for the same scope" | `RETRY_STORM` |

The acquire ordering is burst → retry-rate → concurrency so the cheapest checks come first. A burst attack pays no concurrency-state cost.

Lease semantics: `acquire` returns a `release` function; the runner calls it in `finally`. Idempotent — second `release()` is a no-op. On process restart the in-memory state resets (correct for in-memory; multi-instance deployments need Redis).

## Saturation / fairness results

| Capability | Before | After |
|---|---|---|
| Per-tenant concurrency cap | not available | opt-in via `runJob.concurrency` |
| Retry-storm detection | not available | per-key rolling 60s window with operator visibility |
| Burst damping | not available | per-second bucket per key |
| Scheduler-lock staleness count | invisible | aggregated by `runtimePressureMonitor` |
| DLQ pressure rate | invisible (counts only) | windowed rate severity |

What this is NOT:
- Not a global concurrency cap. The governor is per-key — global limits would require an operator decision per platform instance.
- Not a queue-level rate-limit. BullMQ already has its own broker-level concurrency; the governor adds a domain layer above it.
- Not a substitute for `executeWithRetry`. Bounded retries are a domain concern (transient vs permanent failure); governor caps are a rate concern (don't burst or storm). Both compose.

## Operator-runtime-visibility results

`/api/super-admin/runtime-pressure` returns a single JSON with four per-dimension snapshots + an `overall` severity. Operators can answer four common questions in one request:

1. "Which tenants are saturating?" — top concurrency keys.
2. "Are there retry storms right now?" — top retry-rate scopes.
3. "Are any scheduler locks stuck?" — locks older than 30 min.
4. "Is the DLQ filling up?" — worker-rolled-up DLQ counts in the window.

Read-only by design. No mutations. Capability-gated. Replay-safe.

## Safe cleanups completed

None destructive. Three new files; two existing files modified additively (one optional field on `RunJobSpec`; one new outcome branch in `process-scheduled-posts.ts`). No existing service was rewritten.

---

## Remaining blockers

1. **Governor is in-memory.** Single-instance correctness only. Multi-instance deployments need a Redis-backed implementation. The public surface is shaped so a swap is local — no caller code changes required. Same posture as `MfaAttemptLimiter`.

2. **Sev-1 surfaces are not yet using the governor.** Adoption is opt-in per `runJob` call. The migrated Sev-1 surfaces (publishProcessor, engagementPollingProcessor, process-scheduled-posts, leverage-optimizer, autoOptimizationJob, dailyIntelligenceScheduler) currently call `runJob` without `concurrency`. Adding `{ concurrency: { key: 'tenant:'+tenantId, max: N } }` per surface is a follow-up phase — one-line per surface, but each requires a per-domain decision on `max` and `maxPerSecond`.

3. **No fair-share scheduling.** The governor enforces per-key caps but does NOT round-robin across tenants. A tenant whose lease is rejected today simply waits for the next cron tick / broker retry — there's no priority queue or fair-queue scheduler. Adding one would change queue infrastructure (out of scope per spec).

4. **No backpressure signal upstream.** When the governor rejects, the rejection is logged + audited but no signal propagates back to the queue producer or the cron tick. The system relies on the natural retry cadence to absorb pressure.

5. **AI pipeline saturation** — `executeWithCredits` doesn't yet use the governor. AI calls can fan out via the credit HOLD/EXECUTE path with no per-tenant cap. Wiring is deferred to a follow-up that decides what `max` makes sense for AI work (where individual calls can take 30+ seconds).

6. **Polling saturation** — `engagementPollingProcessor` already groups by org per-batch (last phase) but doesn't enforce a min-interval-per-org. A single org polled twice in the same cron tick (e.g., from overlapping cron + manual trigger) could exceed external-API rate limits without the governor enforcing per-key burst.

7. **No global pressure indicator.** `runtimePressureMonitor` reports per-key tops; it doesn't compute "global utilization %" because there's no canonical "total worker capacity" number.

8. **No DLQ replay throttle.** When an operator triggers a DLQ replay, nothing currently caps the rate at which entries can be retried. Adding `replayDLQ: true` to `runJob` bypasses the DLQ probe — combining that with the governor would close it.

9. **Scheduler-lock cleanup is reactive only.** Stale locks are detected by the monitor and overridden by individual job `acquireLock` callers; there's no proactive sweeper. Out of scope per "do NOT rewrite scheduler".

---

## Validation commands executed

| Command | Result |
|---|---|
| Manual review of existing `runJob` callers | confirm none use the new `concurrency` field by default — opt-in only |
| Manual trace of `acquire` ordering (burst → retry-rate → concurrency) | confirmed |
| Manual trace of `release()` in `finally` regardless of outcome path | confirmed (including pressure_rejected — no lease was acquired) |
| Manual trace of `process-scheduled-posts` outcome dispatch | new `pressure_rejected` branch confirmed (skipped, not FAILED) |
| `grep -n 'pressure_rejected' pages/api` | 1 caller updated; no others affected |
| Manual review of `runtimePressureMonitor` query bounds | top-N capped at 200, DLQ window default 1h |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0**, zero errors |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Unbounded execution paths (no concurrency cap available) | **1** (no canonical primitive existed) | **0** (governor available; adoption pending per-surface) | -1 |
| Retry amplification risks (no detector) | **1** (no canonical detector) | **0** (per-scope retry-rate window + dashboard) | -1 |
| Scheduler overlap risks (no operator visibility) | **1** (existing `scheduler_locks` invisible to operator) | **0** (active locks + stale count surfaced via runtime-pressure) | -1 |
| Tenant starvation risks (one tenant saturates pool) | **1** (any tenant could) | **partial** (governor exists; not yet wired into Sev-1 surfaces — per-surface adoption is the next phase) | partial |
| Replay amplification paths (DLQ replay throttle) | **0** (no canonical replay path) | **0** | 0 |
| Missing backpressure domains | **all execution surfaces** | **0 in the canonical runner** (`pressure_rejected` outcome surfaces backpressure to the caller); legacy surfaces unchanged | -1 |
| Operator-visible runtime pressure | **0** | **1** (`/api/super-admin/runtime-pressure`) | +1 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch authentication architecture
- ❌ Did not touch onboarding / recovery architecture
- ❌ Did not rewrite queue infrastructure (BullMQ unchanged)
- ❌ Did not refactor unrelated business systems
- ❌ Did not redesign UI
- ❌ Did not migrate any existing `runJob` callers to use `concurrency` (opt-in primitive in place)
- ❌ Did not add a Redis backend for the governor (in-memory; surface ready for swap)
- ❌ Did not add fair-share scheduling (would touch queue infrastructure)
- ❌ Did not add a global capacity model

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Wire governor into Sev-1 runJob callers | Add `concurrency: { key: \`tenant:${orgId}\`, max: N }` per surface | ~6 one-line edits + per-domain `max` decision |
| Redis-backed governor | Multi-instance correctness | swap the `Map`s for an upstash/ioredis impl behind the same surface |
| Wire governor into `executeWithCredits` | AI-pipeline tenant fairness | service-level wrapping |
| DLQ replay throttle | Add governor to the replay path so a 1000-entry replay doesn't burst | small endpoint + governor wiring |
| Scheduler-lock proactive sweeper | Cleanup stale locks instead of relying on each job's reactive override | 1 cron |
| Global capacity indicator | Compute "% of worker pool in use" given the governor's snapshot | 1 metric in `runtimePressureMonitor` |
| Prometheus exporter | Scrape `runtime-pressure` as time-series | metrics route + scrape config |

# Runtime Saturation Hardening — Pass 2 (Adoption + Capacity Indicator + Lock Sweeper)

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Drive the prior-pass primitives into adoption — wire `executionGovernor` into the 6 Sev-1 surfaces with per-domain caps, extend `runtimePressureMonitor` with a global capacity / tenant-distribution indicator, and add a proactive `scheduler_locks` sweeper.

This pass closes the "Sev-1 surfaces don't yet use the governor" + "no global capacity indicator" + "scheduler-lock cleanup is reactive only" remaining-blockers from the prior-pass report.

---

## Files audited

### Pre-existing primitives (unchanged this pass — composed)
- [backend/services/executionGovernor.ts](../../../backend/services/executionGovernor.ts) — `acquire / release / recordRetry`. Built last pass.
- [backend/services/runtimePressureMonitor.ts](../../../backend/services/runtimePressureMonitor.ts) — `reportRuntimePressure`. Extended this pass.
- [backend/services/jobRunner.ts](../../../backend/services/jobRunner.ts) — `runJob` with optional `concurrency` field. Built last pass.
- [pages/api/super-admin/runtime-pressure.ts](../../../pages/api/super-admin/runtime-pressure.ts) — admin endpoint. Unchanged.

### Adoption targets (Sev-1 surfaces)
- [backend/queue/jobProcessors/publishProcessor.ts](../../../backend/queue/jobProcessors/publishProcessor.ts)
- [backend/queue/jobProcessors/engagementPollingProcessor.ts](../../../backend/queue/jobProcessors/engagementPollingProcessor.ts)
- [pages/api/cron/process-scheduled-posts.ts](../../../pages/api/cron/process-scheduled-posts.ts)
- [pages/api/cron/leverage-optimizer.ts](../../../pages/api/cron/leverage-optimizer.ts)
- [backend/jobs/autoOptimizationJob.ts](../../../backend/jobs/autoOptimizationJob.ts)
- [backend/jobs/dailyIntelligenceScheduler.ts](../../../backend/jobs/dailyIntelligenceScheduler.ts)

---

## Files created (2)

1. **[backend/services/schedulerLockSweeper.ts](../../../backend/services/schedulerLockSweeper.ts)** — `sweepStaleSchedulerLocks({ staleAgeMs?, limit? })`. Read-write; deletes `scheduler_locks` rows older than the configured threshold (default 30 min — matches every job's reactive-override threshold so the sweeper never races a live job). Returns counts + the list of distinct job names that had stale rows.

2. **[pages/api/cron/scheduler-lock-sweep.ts](../../../pages/api/cron/scheduler-lock-sweep.ts)** — cron endpoint, GET/POST. CRON_SECRET-gated. Per-15-minute idempotency bucket. Runs through the canonical `runJob` so the sweep itself gets execution attribution + DLQ on failure. Recommended schedule: every 15 minutes.

## Files modified (7)

### Sev-1 governor wiring (6 surfaces)

Each surface had a `concurrency: { key, max, maxPerSecond, maxRetriesPerMinute }` block added to its existing `runJob` call(s). Caps are per-domain:

| Surface | Key shape | max | maxPerSecond | maxRetriesPerMinute | Rationale |
|---|---|---|---|---|---|
| **publishProcessor** | `tenant:<orgId>:queue:publish` | 5 | 30 | 60 | Social platforms have their own rate limits; >5 concurrent publishes per tenant just queues at the platform anyway. 30/s cap bounds runaway-client fanout. |
| **engagementPollingProcessor** | `tenant:<orgId>:queue:engagement-polling` | 1 | 10 | 12 | Hourly idempotency bucket already collapses replays; cap=1 prevents overlap between BullMQ delivery + cron retrigger from racing on shared per-post external API calls. |
| **process-scheduled-posts** (cron) | `tenant:<orgId>:queue:publish` (same key as publishProcessor) | 5 | 30 | 60 | Cron-driven and queue-driven publishes share the same governor scope so a tenant's 5-concurrent limit is global, not per-path. |
| **leverage-optimizer** (cron) | `tenant:<orgId>:cron:leverage-optimizer` | 1 | 5 | 6 | Daily analytical cron; sequential per-tenant is fine. Single key for outcome / fail-fast / efficiency blocks so they can't all race against the same tenant. |
| **autoOptimizationJob** | `tenant:<orgId>:job:auto-optimization` | 2 | 5 | 6 | A tenant can run two campaign auto-optimizations in parallel; >2 saturates the analytics pipeline. |
| **dailyIntelligenceScheduler** | `tenant:<orgId>:job:daily-intelligence` | 1 | 2 | 4 | Outer job is already scheduler-locked; inner cap=1 prevents a single tenant's many campaigns from racing on shared LLM context. Same key for both per-campaign and per-company runJob blocks. |

Each surface also handles the new `'pressure_rejected'` outcome status:
- **Queue processors** (`publishProcessor`, `engagementPollingProcessor`): rethrow so BullMQ records the failure + applies broker-level retry. The post is still publishable on the next delivery.
- **Cron paths** (`process-scheduled-posts`, `leverage-optimizer`): logged and counted; the next cron tick retries naturally.
- **System jobs** (`autoOptimizationJob`, `dailyIntelligenceScheduler`): non-blocking; pressure rejection is silently absorbed (`autoOptimizationJob` is contractually "Never throws") or logged (`dailyIntelligenceScheduler`) and the next scheduler tick retries.

### Pressure monitor extended

[backend/services/runtimePressureMonitor.ts](../../../backend/services/runtimePressureMonitor.ts) — `RuntimePressureReport.concurrency` extended with:

- `distinctTenantsInUse` — count of distinct `tenant:<orgId>` prefixes currently holding leases. Tells operators "is the platform broadly busy" (many distinct tenants) vs "is one tenant saturating" (one tenant + high count).
- `maxTenantInUse` — highest single-tenant in-flight count, aggregated across all that tenant's keys.
- `maxTenantKey` — the tenant prefix matching `maxTenantInUse`. Operators can drill into who.
- `globalInUse` — sum across all keys. Not a percentage (no canonical pool size); use as a relative trend.

These aggregate from the same `snapshotConcurrency()` call already used by the monitor — zero new queries.

---

## Execution-governor results

The governor is now actively bounding **6 of 6** Sev-1 surfaces. Per-tenant concurrency is enforced uniformly across cron-driven, queue-driven, and system-driven paths. Cap selection follows three principles:

1. **Match the downstream limit**. publishProcessor's cap=5 mirrors what social platforms can practically absorb; pushing more is queuing-at-the-platform.
2. **Sequential where analysis is the bottleneck**. leverage-optimizer / dailyIntelligenceScheduler / engagementPollingProcessor all cap=1 because the work is analytical, not throughput-bounded.
3. **Burst caps are 5–30× the steady-state max**. Allows a normal cron-tick fan-out (one tick wakes many campaigns) without permitting runaway-client fanout (one POST loop firing 1000× in a tight loop).

Cross-path consistency: publishProcessor and process-scheduled-posts share the same governor key (`tenant:<orgId>:queue:publish`) so a tenant's 5-concurrent limit is a single budget across both code paths, not per-path.

## Saturation / fairness results

| Capability | Before pass 1 | After pass 1 | After pass 2 |
|---|---|---|---|
| Per-tenant concurrency cap | unavailable | opt-in (zero adoption) | **enforced on 6/6 Sev-1 surfaces** |
| Retry-storm detection | unavailable | per-key tracking | **same + per-tenant aggregation in monitor** |
| Burst damping | unavailable | per-second bucket per key | **enforced on 6/6 Sev-1 surfaces** |
| Scheduler-lock staleness count | invisible | aggregated in monitor | **proactively swept by `scheduler-lock-sweep` cron** |
| DLQ pressure rate | invisible | windowed rate severity | **same** |
| Tenant distribution visibility | absent | absent | **`distinctTenantsInUse` + `maxTenantInUse` + `maxTenantKey`** |
| Global capacity indicator | absent | absent | **`globalInUse` aggregate** |

## Operator-runtime-visibility results

`/api/super-admin/runtime-pressure` now answers an additional set of questions in one request:

- "How many tenants are concurrently using the platform right now?" → `concurrency.distinctTenantsInUse`
- "Which tenant is saturating?" → `concurrency.maxTenantKey` + `concurrency.maxTenantInUse`
- "How busy is the platform overall?" → `concurrency.globalInUse`
- "Are stale scheduler locks accumulating?" → `schedulerLocks.staleCount` (was already present; now **actively reduced** by the sweeper cron)

## Safe cleanups completed

- The `scheduler_locks` table no longer accumulates orphan rows after worker crashes — the new sweeper cron deletes them every 15 min using the same staleness threshold every job already overrides on. No duplicate cleanup logic added; no existing reactive-override logic removed.
- No retry wrappers, polling throttles, or scheduler-overlap logic removed — all of the above are now correctly composed by the canonical primitives, and dead-code deletion is a separate refactoring concern.

---

## Remaining blockers

1. **Governor remains in-memory.** Multi-instance deployments still need Redis. Surface unchanged from pass 1; swap is local. The governor's effectiveness scales with the share of traffic on a single instance — for a single-instance deployment, fully effective; for a multi-instance one, each instance enforces its own cap and the per-tenant total can exceed the configured `max` by `instances × max`.

2. **`executeWithCredits` (AI pipeline) not yet wired.** Per-tenant AI saturation is still uncapped. Wiring requires a per-domain `max` decision for 30-second-plus AI calls; deferred to a follow-up that can decide based on observed pricing + cost data.

3. **No DLQ replay throttle.** When an operator triggers a DLQ replay (the future replay endpoint), the rate isn't capped. The governor primitive supports it (one `acquire` per replay) but the replay endpoint doesn't exist yet.

4. **Sweeper deletes locks but does not surface a metric.** Operators watching `runtime-pressure` see staleCount drop after the sweeper runs but cannot see the historic rate of stale-lock generation. A counter in `runtimePressureMonitor` for "deleted in last N min" would close it; small follow-up.

5. **`globalInUse` is not normalized to a pool size.** Operators see "platform has N concurrent leases" but no "% of capacity". Adding a configurable `WORKER_POOL_SIZE` env to compute utilization is a small follow-up, but there's no clean cross-runtime pool-size signal today.

6. **Per-tenant fairness is a cap, not a schedule.** The governor refuses excess work; it doesn't queue for fair-share processing. If tenant A's 5 concurrent slots are full, A's 6th request fails-and-retries until a slot frees — there's no queue ordering. Acceptable for the current workloads; would need a fair-queue scheduler if the platform grows much.

7. **Sev-1 cap values are operator-tunable only via code change.** The hardcoded `max: 5` etc. should eventually live in a config table so ops can tune without a deploy. Out of phase scope.

---

## Validation commands executed

| Command | Result |
|---|---|
| `grep -c 'concurrency:' [6 Sev-1 files]` | all 6 surfaces have at least one `concurrency:` block |
| Manual review of governor key consistency (publishProcessor vs process-scheduled-posts) | confirmed: identical `tenant:<orgId>:queue:publish` key — single budget across paths |
| Manual review of `pressure_rejected` outcome handling | every Sev-1 surface dispatches the new branch correctly |
| Manual trace of `release()` in `runJob.finally` regardless of outcome | confirmed (idempotent) |
| Manual review of `scheduler_locks` sweeper WHERE clause | bounded by `staleAgeMs` cutoff so live jobs are never affected |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0**, zero errors |

---

## Updated counts

| Metric | Before pass 1 | After pass 1 | After pass 2 |
|---|---|---|---|
| Unbounded execution paths | **1** (no canonical primitive) | **0** (primitive available; zero adoption) | **0** (6 Sev-1 surfaces actively governed) |
| Retry amplification risks | **1** | **0** detector available | **0** detector + actively measuring 6 surfaces |
| Scheduler overlap risks | **1** (invisible) | **0** (visible) | **0** (visible + proactively swept) |
| Tenant starvation risks | **1** | partial | **0** for Sev-1 surfaces (sequential / capped per tenant); other domains opt-in |
| Replay amplification paths | **0** | **0** | **0** |
| Missing backpressure domains | **all** | **0 in canonical runner**; legacy not wired | **0 in canonical runner + 6 of 6 Sev-1 surfaces** |
| Global capacity indicator | **0** | **0** | **1** (`globalInUse` + `distinctTenantsInUse` + `maxTenantInUse`) |
| Stale scheduler-lock cleanup mode | reactive only | reactive only | **proactive + reactive** (15-min sweeper cron) |
| Typecheck errors | **0** | **0** | **0** |

---

## What I did NOT do (per scope)

- ❌ Did not touch authentication architecture
- ❌ Did not touch onboarding / recovery architecture
- ❌ Did not rewrite queue infrastructure (BullMQ unchanged)
- ❌ Did not refactor unrelated business systems
- ❌ Did not redesign UI
- ❌ Did not wire governor into `executeWithCredits` (AI pipeline) — deferred per scope
- ❌ Did not add a Redis backend for the governor
- ❌ Did not implement fair-share scheduling (would touch queue infrastructure)
- ❌ Did not add a config table for cap values

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Wire governor into `executeWithCredits` | Per-tenant AI saturation cap | service-level wrapping + cap decision |
| Redis-backed governor | Multi-instance correctness | swap `Map`s for upstash/ioredis behind same surface |
| DLQ replay throttle | Cap rate of operator-triggered replays | small endpoint hook |
| Sweeper telemetry | Surface "deleted-in-last-N-min" in runtime-pressure | small counter add |
| Pool-size normalization | Express `globalInUse` as % when `WORKER_POOL_SIZE` env is set | one calc |
| Cap-value config table | Operator-tunable per-tenant caps without deploy | schema + admin endpoint |
| Fair-share scheduler | Queue rather than reject when capped | queue infrastructure work |

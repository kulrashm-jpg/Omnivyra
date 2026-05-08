# Background-Execution Governance Hardening — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Establish the canonical attribution + replay-safety + tenant-isolation primitives for every background-execution surface (cron, queue, scheduler, admin-triggered, system maintenance). Begin migration with two exemplar crons. Document the remaining 30+ surfaces that should adopt the runner in follow-up phases.

---

## Files audited

### Sub-agent inventory: 36 background-execution surfaces

- **11 cron endpoints** under [pages/api/cron/](../../../pages/api/cron/)
- **10 queue processors** under [backend/queue/jobProcessors/](../../../backend/queue/jobProcessors/)
- **2 scheduler dispatchers**: [backend/scheduler/cron.ts](../../../backend/scheduler/cron.ts), [backend/scheduler/schedulerService.ts](../../../backend/scheduler/schedulerService.ts)
- **13 background jobs** under [backend/jobs/](../../../backend/jobs/)

### Existing primitives surveyed (composed by the runner — unchanged)

- [backend/services/requestContext.ts](../../../backend/services/requestContext.ts) — AsyncLocalStorage for HTTP requests. The new execution context chains correlationId from this when a job is enqueued from an HTTP request.
- [backend/services/workerRetryService.ts](../../../backend/services/workerRetryService.ts) — `executeWithRetry` (3 attempts, bounded) + `moveToDeadLetter` (writes to `worker_dead_letter_queue`). Existing dead-letter mechanism. The runner WRAPS this — does not replace it.
- [backend/security/TenantGuard.ts](../../../backend/security/TenantGuard.ts) — `assertTenantAccess` consumed by the runner for tenant-scoped jobs.
- [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts) — `logSecurityEvent` for execution-outcome audit.

---

## Files created (5)

1. **[backend/services/executionContext.ts](../../../backend/services/executionContext.ts)** — `ExecutionContext` type + AsyncLocalStorage-based `runWithExecutionContext` / `getExecutionContext` + `buildExecutionContext` factory + `makeJobIdempotencyKey` helper. Carries `executionId`, `triggerSource` (cron / queue / scheduler / admin / webhook / system), `jobName`, `tenantId`, `principalUserId`, `principalKind`, `correlationId` (chained from upstream `requestContext`), `idempotencyKey`, `attempt`, `startedAt`. Pure attribution carrier — does not execute work.

2. **[backend/services/jobRunner.ts](../../../backend/services/jobRunner.ts)** — `runJob(spec, handler)`. Composes:
   - `buildExecutionContext` for attribution + lineage
   - DLQ idempotency-key probe → `dead_letter_skip` if a previous terminal failure exists for the same key (replay requires explicit `replayDLQ: true`)
   - `assertTenantAccess` for tenant-scoped jobs (rejects soft-deleted / nonexistent orgs as `tenant_invalid` BEFORE any work runs and BEFORE any DLQ entry is written)
   - `executeWithRetry` for bounded retry (3 attempts inherited from existing service)
   - DLQ enrichment on terminal failure: writes a second DLQ row with the canonical execution context inline so operator triage has lineage even though the original `executeWithRetry` row lacks it
   - Audit row per outcome (`completed` / `dead_letter_skip` / `tenant_invalid` / `failed`)
   - Returns a discriminated-union `RunJobOutcome` so callers handle each branch explicitly — no silent failures.

3. **[backend/services/jobInspection.ts](../../../backend/services/jobInspection.ts)** — read-only operator visibility. `listDeadLetters({ workerName, tenantId, limit, before })` paginated, `getDeadLetter(id)` single-entry, `summarizeDeadLetters({ since })` aggregate counts by worker name. Parses `__executionContext` payload metadata out of canonical-runner DLQ entries; legacy entries (no metadata) still surface via worker name.

4. **[pages/api/super-admin/dead-letter-queue.ts](../../../pages/api/super-admin/dead-letter-queue.ts)** — admin endpoint, GET only. Capability-gated (`SUPER_ADMIN_DASHBOARD_VIEW`) + admin rate limit. Supports `?summary=1` for the dashboard chart, full pagination otherwise. Read-only by design — replay is intentionally NOT a side effect of viewing.

5. **(none — see Files modified for the exemplars)**

## Files modified (2)

1. **[pages/api/cron/credit-reconciliation.ts](../../../pages/api/cron/credit-reconciliation.ts)** — wrapped in `runJob`. Trigger source detected (cron-secret vs admin); deterministic per-UTC-day idempotency key; canonical outcome handling.

2. **[pages/api/cron/credit-orphan-hold-reap.ts](../../../pages/api/cron/credit-orphan-hold-reap.ts)** — wrapped in `runJob`. Per-hour idempotency bucket (or per-org-per-hour for triage runs); canonical outcome handling including `tenant_invalid` short-circuit when a triage `?orgId=…` references a soft-deleted org.

These two crons demonstrate the migration pattern. They are the lowest-risk migrations because (a) they are owned by the consolidation branch (built last phase), (b) they are idempotent reads/releases, and (c) their failure modes are well-understood. The remaining 34 surfaces are listed under "Remaining blockers" — they are scheduled for follow-up phases.

---

## Canonical execution-context results

The new `ExecutionContext` is the single attribution + lineage authority for every non-HTTP runtime path. Properties enforced by construction:

| Property | Where | Notes |
|---|---|---|
| `executionId` | `buildExecutionContext` (UUID) | Stable per single execution. Recorded in DLQ enriched row + audit. |
| `triggerSource` | required at `runJob` call site | enumerated — `cron / queue / scheduler / admin / webhook / system`. Closes the "I don't know who triggered this" hole. |
| `jobName` | required at `runJob` call site | the canonical worker_name used in DLQ + audit. |
| `tenantId` | optional at call site | required for tenant-scoped work; rejected if missing for tenant-bound jobs by convention. |
| `principalUserId` + `principalKind` | required at call site | system actors set `principalUserId=null` and an explicit `principalKind` like `'cron-secret'` / `'system-reaper'` so audit can distinguish. |
| `correlationId` | auto-chained | lifted from active `requestContext` if present, otherwise generated. Distributed-trace continuity preserved. |
| `idempotencyKey` | required at call site (or auto-derived) | the DLQ probe key + downstream-mutation key. Replay-safety lives here. |
| `attempt` | optional, default 1 | propagates to logs + audit so retry waves are visible. |
| `startedAt` | auto-stamped | wall-clock per attempt. |

`runWithExecutionContext` exposes the context to the entire async tree — service-layer code that needs to chain attribution into ledger writes can call `getExecutionContext()` at the leaf.

## Retry / replay-governance results

| Property | Mechanism |
|---|---|
| Bounded retries | inherited from `executeWithRetry` — 3 attempts max, no infinite loop possible. |
| Dead-letter classification | terminal failures land in `worker_dead_letter_queue` with the canonical execution context inlined (in addition to the original `executeWithRetry` row). |
| Replay safety | pre-execution DLQ probe by `(worker_name, idempotencyKey)`. A key already in DLQ short-circuits with `dead_letter_skip` unless `replayDLQ: true`. |
| Operator-driven replay | callers must pass `replayDLQ: true` explicitly to re-attempt a DLQ entry. The admin DLQ endpoint is read-only — a "view this entry" click cannot become a "retry" side effect. |
| Duplicate-execution detection | the same idempotencyKey landing twice within the same DLQ entry is detected at probe time. |
| Stale state | dead-letter entries persist; existing `executeWithRetry` did not enrich them with execution context — the runner now does, so historic DLQ entries can be triaged with full lineage. |

## Tenant-execution isolation results

When `tenantId` is supplied to `runJob`:

- `assertTenantAccess` runs BEFORE the handler — soft-deleted / nonexistent orgs short-circuit with `tenant_invalid`. No work executes. No DLQ entry is written for the trigger (the trigger itself was malformed).
- For system-triggered jobs (no `principalUserId`), the membership-not-found case is downgraded to a pure org-state probe: only `ORG_NOT_FOUND` / `ORG_INACTIVE` are hard-stops. System actors are not org members by design — refusing them on `NOT_A_MEMBER` would block legitimate maintenance.
- Cross-tenant execution is impossible by construction: every tenant-scoped runner call binds a single `tenantId`. The runner does not support "act on multiple orgs in one execution"; multi-org work must be enqueued per-org.

Platform-wide jobs (`tenantId = null`) skip the tenant check. Their internal iteration is responsible for re-validating each org as it processes — the audit identifies this as a Severity-1 follow-up across multiple existing surfaces.

## Operator-recovery results

- **Inspection**: `listDeadLetters` + `summarizeDeadLetters` + `getDeadLetter` + admin endpoint — operators can see exactly which jobs failed, with what reason, with what tenant lineage, in one query.
- **Attribution**: every DLQ entry written by the runner carries `__executionContext.principalUserId` + `principalKind` + `correlationId` + `idempotencyKey` so the failure is attributable to a specific trigger.
- **Replay**: explicit two-step (view → re-trigger with `replayDLQ: true`). Mistake-resistant.
- **Cancellation / stuck-job detection**: NOT in this phase — the existing scheduler does not write a "started" marker for most job types, so stuck-state inference is unsafe without schema work. Documented as a remaining blocker.

## Safe cleanups completed

None destructive. The new modules are purely additive:
- No existing service was modified other than two cron endpoints owned by this branch.
- No queue processor was rewritten.
- No scheduler was rewritten.
- The existing `executeWithRetry` / `moveToDeadLetter` continue to work for callers that haven't migrated yet — the runner wraps them, never replaces them.

---

## Remaining blockers

1. **30+ background-execution surfaces still hand-roll their own try/catch + DB writes**. Migrating them to `runJob` is mechanical but per-surface. Highest-risk follow-up targets (per the audit):
   - **Severity-1 cross-tenant data mutation**: `publishProcessor.ts:176-179`, `engagementPollingProcessor.ts:29-36`, `process-scheduled-posts.ts:39-88`. These resolve org context from a foreign-key join and never validate org membership before mutating. Wrapping them in `runJob` with `tenantId` resolved from the join would close it.
   - **Severity-1 missing soft-delete in batch iterators**: `leverage-optimizer.ts:55-59`, `autoOptimizationJob.ts:17`, `dailyIntelligenceScheduler.ts:247`, `schedulerService.runCompanyTrendRelevance`. Each iterates `companies WHERE status='active'` with no `is_deleted` check. The runner's `assertTenantAccess` rejects soft-deleted orgs — adoption closes it.
   - **Severity-2 missing idempotency on credit-side mutations** in `contentGenerationProcessor.ts:49-50`. `runJob` requires an idempotency key — adoption closes it.
   - **Severity-2 missing actor attribution** in analytics ingestion + governance-audit jobs. Adoption closes it.

2. **Stuck-job (`status='running'`) reaper** is NOT implemented. The dominant signal today is on the credit side (orphan HOLDs — handled by the credit reaper from the previous phase). For non-credit jobs, a "started" marker would need to land first. Out of this phase's scope per "do not rewrite orchestration architecture".

3. **`worker_dead_letter_queue` retention** is not codified. There is no TTL or archive policy. Operators today rely on `removeOnFail: { age: N days }` at the BullMQ layer, but the canonical DLQ table has no equivalent.

4. **Replay endpoint** for triggering a re-attempt of a DLQ entry is NOT in this phase. The architecture is replay-ready (`runJob` accepts `replayDLQ: true`), but the operator surface (a button that crafts the right payload + calls the right worker entry point) requires per-worker mapping. Tracked as a follow-up.

5. **Schedulers are not yet integrated**. `backend/scheduler/cron.ts` and `backend/scheduler/schedulerService.ts` still enqueue jobs without an execution context. The runner is consumer-side; the producer-side change (have schedulers stamp jobs with the canonical context) is a follow-up.

6. **No DLQ → metrics export** (Prometheus / Datadog). The audit log entries are consumed by `capability_audit_log` but there is no operator-facing dashboard. Out of this phase's observability scope.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| Sub-agent inventory of `pages/api/cron/**`, `backend/queue/jobProcessors/**`, `backend/scheduler/**`, `backend/jobs/**` | enumerate surfaces + classify risks | 36 surfaces; 6 Sev-1 cross-tenant + soft-delete issues; 4 Sev-2 idempotency / attribution issues |
| Read of [backend/services/workerRetryService.ts](../../../backend/services/workerRetryService.ts) | confirm `executeWithRetry` + DLQ already exist (no duplication) | confirmed — runner wraps these, does not replace |
| Read of [backend/services/requestContext.ts](../../../backend/services/requestContext.ts) | confirm correlationId chaining hook | confirmed — runner reads `getRequestContext()` |
| Manual trace of `runJob` outcome paths | verify all four branches handle correctly | confirmed: completed / dead_letter_skip / tenant_invalid / failed |
| `npx tsc --noEmit -p tsconfig.json` | typecheck | exit 0, zero errors |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Unsafe retry loops (no max attempts) | **0** (existing `executeWithRetry` already bounded at 3) | **0** | 0 |
| Missing execution attribution paths | **36** (every surface hand-rolls or has none) | **34** (2 exemplars migrated; runner ready for the rest) | -2 |
| Cross-tenant execution risks (Sev 1) | **6** (per audit) | **6** (runner enforces when adopted; not yet adopted by these surfaces) | 0 |
| Duplicate execution-ownership paths | **multiple** (each processor hand-rolls status mgmt) | **1 canonical (runJob) + legacy hand-rolled** | improved |
| Orphan job states | **many** (no stuck-job reaper for non-credit) | **same** (out of scope this phase) | 0 |
| Dead replay paths (DLQ entries with no probe protection) | **all** (anything could re-execute on replay) | **0 for runner-driven jobs** (probe before execute); legacy unchanged | -2 (exemplars migrated) |
| Scheduler mutation bypasses | **2** (per audit — `enqueueIntelligencePolling` global-fallback path; `runCompanyTrendRelevance` no-soft-delete) | **2** (out of scope this phase) | 0 |
| Operator DLQ inspection endpoints | **0** | **1** (`/api/super-admin/dead-letter-queue`) | +1 |
| Canonical execution-context surface | **none** | **`executionContext` + `jobRunner`** | new |
| Typecheck errors introduced | n/a | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch MFA / authentication architecture
- ❌ Did not touch tenant authorization (`TenantGuard` is consumed; not modified)
- ❌ Did not touch billing architecture broadly — credit primitives unchanged except for cron migration
- ❌ Did not refactor unrelated execution engines — no queue processor, no scheduler dispatcher, no AI pipeline was rewritten
- ❌ Did not perform queue rewrites — BullMQ config + processors are unchanged
- ❌ Did not rewrite the existing `executeWithRetry` / `moveToDeadLetter` — the runner wraps them
- ❌ Did not migrate any of the 30+ remaining surfaces — adoption is opt-in per follow-up phase
- ❌ Did not add a new DB table — used existing `worker_dead_letter_queue` for inspection
- ❌ Did not add a stuck-job reaper for non-credit jobs (requires "started" marker schema work)

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| **Severity-1 cross-tenant migration** | Wrap `publishProcessor`, `engagementPollingProcessor`, `process-scheduled-posts` in `runJob` with tenantId resolved from the FK join | 3 file changes |
| **Severity-1 soft-delete migration** | Wrap `leverage-optimizer`, `autoOptimizationJob`, `dailyIntelligenceScheduler`, `runCompanyTrendRelevance` in per-org `runJob` calls inside their iteration loops | 4 file changes |
| **Credit-mutation idempotency in `contentGenerationProcessor`** | Replace stub `deductCredits()` / `refundCredits()` with `executeWithCredits` driven by the runner's idempotencyKey | 1 file change |
| **Stuck-job reaper** | Add `started_at` columns where missing; reaper sweeps `running` rows older than N hours | 1 migration + 1 service + 1 cron |
| **DLQ replay endpoint** | Per-worker replay: takes a DLQ id, re-enters runJob with `replayDLQ: true` and the original payload | 1 endpoint per worker class |
| **Scheduler producer-side context stamping** | Have `scheduler/cron.ts` write the canonical execution-context onto every enqueued job payload | 1 file change |

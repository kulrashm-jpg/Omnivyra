# SEC-C — Workers / queues / runtime fail-closed (STEP 3AH-91)

**Base:** `main @ f44b13875a8ce60da575197c516fa75bca946d4b` · **Branch:** `sec/3ah91-c-workers-runtime` (worktree `C:/tmp/sec91-c`) · not pushed, not merged.

No production system was contacted. Every production fact below comes from the brief or from the repository.

## 1. Inventory

| ID | Sev | Finding | Current status on base (evidence) | Classification | Files | Fix | Tests | Conflict risk |
|---|---|---|---|---|---|---|---|---|
| C1 | P2 | Worker triggers fail open | `publishing/worker/run.ts:16-19`, `publishing/reconcile/run.ts:16-19` and `website-analytics/aggregate.ts:16-19` answer 503 when the secret is unset and use `timingSafeEqual` (PR #245) | **ALREADY FIXED** | — | — | covered by #245 `routeAuth001PluginWorkers` | none |
| C1-b | P2 | Other fail-open shapes that R4 accepts | `internal/process-reminders.ts:53-65` and `internal/metrics.ts:35-42` checked only when the secret was set and fell open when `NODE_ENV !== 'production'`. R4 accepts that shape because the `else` rejects in production. Dev processes run on prod DB/Redis, and `next dev` listens on every interface. Swept for others and found none: all other cron/internal routes, `observability/metrics` (404 when unset), `platform/history/run` (`!secret \|\|`), `render-worker`/`render-health` (503), the webhook handoffs (503 + HMAC), the worker `/metrics` (404 when unset), `opportunities/refresh-slots` (`secret &&` allow, otherwise super-admin); no backend HTTP helper compares header secrets | **FIX** | `pages/api/internal/{process-reminders,metrics}.ts` | fail closed in every environment | `sec91CInternalEndpointsFailClosed` | low |
| C2 | P2 | BullMQ prefix shared across environments | `bullmqClient.ts:68-119`: `'bull'` unless `OMNIVYRA_QUEUE_PREFIX_ENABLED=true`, so a laptop on `.env.local` consumed and produced production jobs | **FIX** (production prefix unchanged) | `backend/queue/queueNamespace.ts` (new), `bullmqClient.ts`, `workers/main.ts` | env-scoped prefix outside production, plus a consumer-bootstrap seatbelt | `sec91CQueueNamespaceIsolation` | medium (`bullmqClient.ts`, `main.ts`) |
| C3 | P2 | cronGuard lock fails open | `backend/utils/cronGuard.ts:54-62` (the brief's `backend/services/cronGuard*` path does not exist). Two cases: (a) a client still **connecting** was treated as "no Redis", which also skipped `load()`; (b) genuine unavailability or an error returned `true` | (a) **FIX**; (b) **INTENTIONALLY ACCEPTED** for one replica, now observable, with an opt-in to fail closed | `backend/utils/cronGuard.ts` | bounded wait for the initial connect; `cron_lock_fail_open` log; `CRON_LOCK_FAIL_CLOSED=1` | `sec91CCronGuardLockPolicy` | low |
| C4 | P3 | Non-constant-time secret compares | `===`/`!==` in 31 `pages/api/cron/*` routes, `internal/{metrics,process-reminders,render-worker,render-health}`, `observability/metrics.ts:46`, `platform/history/run.ts:14`, `opportunities/refresh-slots.ts:31`, `workers/healthServer.ts:61` | **FIX** | `backend/security/constantTimeEqual.ts` (new) + 38 endpoint files | SHA-256 digest + `timingSafeEqual`, exact-match semantics, fails closed | `sec91CConstantTimeSecrets` (57 tests) | low to medium (many route files, 1–6 lines each) |
| C5 | P2/P3 | Processors trust tenant ids from job payloads | `campaignPlanningProcessor.ts:276`: with no org it skipped billing, and it persisted `campaign_week_plan` by `campaign_id` (`:254`, `:487`). `creatorContentProcessor.ts:176,405` read `campaign_versions` without a company predicate; `:701,746` updated `daily_content_plans` by `id` only. `main.ts:199-207` `interactive-plan` passed `args` straight through. `automationTaskProcessor.ts:63,98`: dormant, no DB access | **FIX** (planning, interactive-plan, creator); automation **INTENTIONALLY ACCEPTED** (unreachable, no side effects) | `backend/queue/jobProcessors/jobTenantBinding.ts` (new), `campaignPlanningProcessor.ts`, `creatorContentProcessor.ts`, `workers/main.ts` | re-prove campaign↔company (the same `campaignOwnershipService` as ROUTE-AUTH-001) and row↔campaign before billing or writes | `sec91CJobTenantBinding` (14) | medium (processors) |
| C6a | P2 | Deploy without CI wait | Railway deploys about 5 s after a merge (brief); this is a dashboard-only setting | **MANUAL OPERATION REQUIRED** | — | §7 | — | — |
| C6b | P2 | SIGTERM drain cut short | `cron.ts:830-844`: the scheduler's own SIGTERM handler called `process.exit(0)` synchronously, pre-empting `main.ts:501-557` (bounded drain, BOLT claim release, `closeConnections`) on every redeploy | **FIX** | `backend/scheduler/cron.ts`, `backend/workers/main.ts` | `startCron({ hostOwnsShutdown: true })` + a hard-exit backstop | `sec91CWorkerShutdownDrain` | **high** with the unmerged WS-1 `fix/worker-shutdown-safety` (977e8aed, a different clone; §6) |
| C6c | P3 | Boot-time cron cycle | `cron.ts:536` runs a full cycle at boot. `confidenceCalibration` is saved (`:922`) but never restored (`:487-517`), so it re-ran on every deploy. Nine other tasks are never persisted | **FIX** (the restore); the unpersisted tasks are **INTENTIONALLY ACCEPTED** (changing boot semantics of safety sweeps is a behaviour decision) | `cron.ts` | restore `confidenceCalibration` | `sec91CWorkerShutdownDrain` (restore-map invariant) | low |
| C6d | P3 | `railway.json`: no healthcheck, watchPatterns or draining | `railway.json` has builder/restart/replicas only | **MANUAL** (recommendations only) | — | §7 | — | — |
| C7 | P2 | Supabase: open network, SSL off, leaked-password protection off, 98 mutable `search_path` functions | Live evidence from the brief | **MANUAL OPERATION REQUIRED** for all four. `search_path`: I could not derive the flagged set reliably from the repo (127 function names across 417 migrations, the prod ledger is desynced, and prod-only functions exist), so no migration was written | — | §7 | — | — |
| C8 | P3 | Queue controls | Retries/backoff, DLQ, idempotency and tracing are present (§5). There is no publish-specific kill switch | **INTENTIONALLY ACCEPTED** (documented; a kill switch is not trivial) | — | — | — | — |
| C9 | P3 | `Dockerfile.cron` unpinned, `npm install` | `Dockerfile.cron:8,15,22,28`. **Not deployed**: `railway.json` builds only `Dockerfile.worker`, and the worker runs cron co-located | **FIX** | `Dockerfile.cron` | digest-pinned `node:22-bookworm-slim` (engines 22.x), `npm ci`, and the alias-rewrite step it was missing | `sec91CDockerfilePinning` | low |

## 2. Fixes — before and after

**C1-b (internal endpoints).**
- Before: with the secret unset and `NODE_ENV` set to development or test, anyone who could reach the dev server could send domain-reminder emails to real users and mark rows sent, or read production queue depths.
- After: an unset secret gives 401 in every environment. With the secret set, the request needs the exact credential (checked in constant time).
- Tests (`sec91CInternalEndpointsFailClosed`, 8): unset secret × {development, test, production} gives 401 and the sink is never touched; a wrong, absent or array credential gives 401; the exact credential passes.
- Mutation check: restoring the base files fails 4 of 8 (the development and test cases). Restored afterwards.

**C4 (constant time).**
- `constantTimeEqual(presented, expected)`: false unless both are non-empty strings, then `timingSafeEqual(sha256(a), sha256(b))`. The length is not leaked, and an unset env can never satisfy `undefined === undefined`.
- `bearerTokenMatches(header, secret)` is equivalent to `secret && header === \`Bearer ${secret}\``.
- Every call site keeps its previous shaping: trimming in `observability`/`healthServer`/`render-*`, and the raw-or-Bearer acceptance in `recover-stale-reports`/`monetization-reservation-reconcile`, where both shapes are now evaluated.
- Tests (`sec91CConstantTimeSecrets`, 57): helper semantics; a repository scan of 44 in-scope files for timing-unsafe compares, each of which must import the helper; behavioural tests through a spy on the helper for the worker `/metrics`, `observability/metrics`, `platform/history/run` and `recover-stale-reports`.
- Before: 44 of 57 tests failed on base. After: 57/57.
- `emailJobsCronSchedule.test.ts` was updated. It pinned the literal string ``req.headers['authorization'] !== `Bearer ${cronSecret}` ``, which this fix legitimately replaces; the new assertion pins `!bearerTokenMatches(...)`.

**C2 (queue isolation).** `resolveQueueNamespace(env)` rules:
1. `OMNIVYRA_QUEUE_PREFIX_ENABLED=true` gives `omnivyra:<env>:` (unchanged).
2. `NODE_ENV=production` gives `bull` (unchanged). This deliberately does not depend on platform markers, so a platform that stopped exposing `VERCEL_ENV` could never silently move production onto another keyspace.
3. Any other process gives `omnivyra:<env>:` (`local`, `test`, `development`, …) unless `OMNIVYRA_ALLOW_SHARED_QUEUES=1` is set (explicit and logged).

Seatbelt: `assertQueueConsumerRuntimeAllowed(context)` throws when a production-mode process has no `RAILWAY_*`/`VERCEL*` marker and a non-local Redis (for example the docker-compose worker pointed at Upstash), unless opted in.
- It runs in `main.ts` before the import-time `Worker` constructions and inside `verifyRedisReadyForBackgroundRuntime` (the `startWorkers` and cron bootstraps).
- It never runs for producers, so a web runtime is unaffected.
- It is a no-op on Railway: the production boot log records `RAILWAY_GIT_COMMIT_SHA` (memory evidence).

Tests (`sec91CQueueNamespaceIsolation`, 30):
- Production shapes still resolve to `bull`.
- Laptop, ts-node, jest and `vercel dev` shapes resolve to isolated prefixes.
- The opt-in, the local/compose Redis classification, and the seatbelt refuse/allow matrix. The refusal message never echoes the Redis URL.
- The real `getQueuePrefix()`, `getQueue`, `getWorker` and `createQueue` hand BullMQ the isolated prefix in development and `bull` in production (bullmq faked).
- Source pins: `main.ts` runs the seatbelt before its first `Worker` and before loading `bullmqClient`.
- Before: 4 failures on base (the prefix received was `"bull"`; the seatbelt was absent). After: 30/30.

**C3 (cycle lock).**
- `ready()` waits up to 3 s only while the client is in `wait`/`connecting`/`connect`. During an outage (`reconnecting`/`end`) it does not wait.
- The lock SET is then attempted, so a new deployment's boot cycle honours the old container's lock, and `load()` restores timestamps instead of returning `{}`.
- Unavailability or an error still runs the cycle by default, but logs a structured `cron_lock_fail_open` event. `CRON_LOCK_FAIL_CLOSED=1` returns false and logs `cron_lock_fail_closed`.
- Tests (`sec91CCronGuardLockPolicy`, 7): 5 failed on base; 7/7 after.
- **ACCEPTED rationale** for the default:
  - Production runs one replica; a second cycle exists only during deploy overlap or from a rogue process.
  - The side effects that must not duplicate carry Redis-independent claims: post-level publish claim, `token_refresh_locks` (single-use X refresh tokens), BOLT run claims.
  - Failing closed would stop token refresh for the whole of a Redis outage (the Upstash quota-exhaustion outage has happened), and would break local development without Redis.
  - `CRON_LOCK_FAIL_CLOSED=1` is required before `numReplicas > 1`.

**C5 (payload tenant binding).** `assertJobCampaignBinding` outcomes:
- `owned`: proceed.
- `foreign`: `JobTenantBindingError`.
- `not_found`: an error when the producer guarantees the campaign exists; otherwise proceed.
- `lookup_error`: a plain error so BullMQ retries.
- Rejections log `queue_job_tenant_binding_rejected` and are dead-lettered on exhaustion by the existing handlers.

Applied:
- **Campaign planning** (before billing): the campaign must be owned by `companyId`. A job without `companyId` is now refused; it used to run unattributed.
- **`interactive-plan`**: the same check in `main.ts`, before `runCampaignAiPlan`.
- **Creator BOLT rows**: the billed `company_id` must equal `bolt_payload.company_id`; that company must own the campaign; the `daily_content_plans` row must belong to the campaign. Both row updates also carry `.eq('campaign_id', …)`.
- **Activity-workspace jobs**: a campaign owned by another company is refused; a non-campaign workspace id still works. Both `campaign_versions` snapshot reads are company-scoped.

Every check holds for legitimate producers:
- plan-v2 and plan.ts derive `companyId` from `requireCampaignAccess` (`campaign_versions`), which gives `owned`.
- The BOLT bridge enqueues rows it loaded by `campaign_id`.

Tests (`sec91CJobTenantBinding`, 14; fake DB, real ownership authority, billing replaced by a `PAST_BINDING` sentinel):
- Before: 10 failures on base. After: 14/14.
- Mutation check: removing the two processor calls fails 8 tests. Restored afterwards.

**C6b/C6c (worker restart).**
- Before: on SIGTERM the co-hosted scheduler's handler exited the process synchronously, so `main.ts`'s drain (`worker.close()`, BOLT claim release, `closeConnections`) never ran. `confidenceCalibration` re-ran on every boot.
- After:
  - `main.ts` calls `startCron({ hostOwnsShutdown: true })`. The scheduler still stops its timers and clients but no longer exits.
  - `main.ts` drains and then exits, with an unref'd hard-exit backstop at drain budget + 10 s so a hanging close cannot keep the process alive.
  - Standalone `cron.ts` and the Next.js instrumentation still exit as before.
- Tests (`sec91CWorkerShutdownDrain`, 35 source pins, because the modules are too heavy to boot in a unit test): 4 failures on base; 35/35 after.
- The characterization snapshot `cronScheduleContractCharacterization` restore-key list was hand-updated to add `confidenceCalibration`; that is the behaviour this fix changes. I deliberately did **not** run `-u`, because that would also have accepted the unrelated pre-existing drift below.

**C9 (Dockerfile.cron).**
- Now mirrors `Dockerfile.worker`: base pinned by digest, `npm ci` in both stages, `fix-worker-aliases` (without it the compiled `@/…` imports cannot resolve), and `templates/`.
- Test `sec91CDockerfilePinning`: every `Dockerfile.*` FROM must be digest-pinned and every install must be `npm ci`. It failed 2 of 4 against the base file and passes 4/4 now.
- The image build was **not** executed (no network or Docker allowed, and starting Docker locally is a known hazard).

## 3. Commands run and results

| Command | Result |
|---|---|
| jest: `sec91CConstantTimeSecrets` | 57/57 pass (44 failed on base) |
| jest: `sec91CInternalEndpointsFailClosed` | 8/8 (4 fail against base files) |
| jest: `sec91CQueueNamespaceIsolation` | 30/30 (4 failed before wiring) |
| jest: `sec91CJobTenantBinding` | 14/14 (10 failed on base) |
| jest: `sec91CCronGuardLockPolicy` | 7/7 (5 failed on base) |
| jest: `sec91CWorkerShutdownDrain` | 35/35 (4 failed on base) |
| jest: `sec91CDockerfilePinning` | 4/4 (2 fail against the base file) |
| jest: affected suites — `emailJobsCronSchedule`, `internalMetricsSecretNoDefault`, `workerMetricsEndpoint`, and 27 queue/scheduler/creator suites (`a3QuotaMalformedTenant` … `ws3Milestone6Observability`, incl. `workerTopologyParity`, `creatorWorkerBootstrapParity`, `routeAuth001CampaignBinding2Planner`, `schedulerEnqueueDuplicateGuardFailClosed`, `queueConcurrencyLock`, `platformWave2/3/4/6`, `traceContinuityAdoption`, `creatorMixedModeRuntimeValidation`) | all pass except the 2 pre-existing failures below |
| jest: cron suites (`a7RetryJob`, `certificationRemediation`, `piA4aEnrichmentAttempts`, `queueBackpressureAdoption`, `platformWave6`, `cronScheduleContractCharacterization`) | pass except the pre-existing snapshot drift below |
| jest final combined run: 7 `sec91C*` suites + `routeAuth001Scanner`, `routeAuth001PluginWorkers`, `emailJobsCronSchedule`, `internalMetricsSecretNoDefault`, `workerMetricsEndpoint` | 12 suites, 235/235 pass |
| `node scripts/check-route-auth.js` | PASS (1322 routes) |
| `node scripts/check-tenant-authz.js` | PASS |
| `npm run -s check:ssrf` | PASS |
| `node scripts/check-migration-quality.js` | OK (no migration added by SEC-C) |
| `node scripts/check-withrbac-binding.js` / `check-orgaccess-binding.js` | PASS / PASS |
| `tsc -p tsconfig.backend-tests.json --noEmit --incremental false` (filtered to SEC-C files) | see §3a |

**Pre-existing failures (identical on base; files untouched by SEC-C):**
- `leadDeadLetterProducer` flags `services/boltExecutionRecovery.ts`. Its secondary `failed` handler has no `deadLetterOnExhaustion(` call; the bolt worker itself is built through `getWorker`, which does dead-letter. This is a test-exemption gap.
- `cronScheduleContractCharacterization › timing-constants` is missing `PROSPECT_RETRY_INTERVAL_MS`: the base `cron.ts` already declares it and the snapshot predates it.

### 3a. TypeScript
- `tsc -p tsconfig.backend-tests.json --noEmit --incremental false` (the full surface, about 17 min): **0 errors in any SEC-C file**. The surface has 260 pre-existing errors, all in unrelated test files (for example `reconciliationRunner.test.ts` and `runTemplateBlogGenerationCharacterization.test.ts`).
- Scoped check of all 48 changed non-test `.ts` files (a scratch tsconfig extending the root `tsconfig.json` with `files` = the changed sources, `noEmit`): **exit 0, 0 errors**.

## 4. Commits (branch `sec/3ah91-c-workers-runtime`)
- `f61d840` fix(security): constant-time machine-secret checks; internal endpoints fail closed everywhere (SEC-C1/C4)
- `7d8d5ea` fix(queue): non-production processes cannot use the production BullMQ keyspace (SEC-C2)
- `d1b4c62` fix(queue): processors re-verify payload tenant ids before billing or writes (SEC-C5)
- `3150978` fix(scheduler): cycle lock waits for the initial Redis connect; explicit fail mode (SEC-C3)
- `3c80daf` fix(worker): scheduler no longer exits under the worker's SIGTERM drain; restore confidenceCalibration (SEC-C6)
- `d394a34` build(cron): pin Dockerfile.cron base by digest and install from the lockfile (SEC-C9)
- `1584980` fix(queue): company-scope the fan-out billing snapshot read too (SEC-C5)
- (this report) docs(security): SEC-C report

## 5. Files changed
- New: `backend/security/constantTimeEqual.ts`, `backend/queue/queueNamespace.ts`, `backend/queue/jobProcessors/jobTenantBinding.ts`, seven `backend/tests/unit/sec91C*.test.ts`, this doc.
- Owned: `pages/api/cron/*` (31), `pages/api/internal/{metrics,process-reminders,render-worker,render-health}.ts`, `backend/queue/bullmqClient.ts`, `backend/queue/jobProcessors/{campaignPlanningProcessor,creatorContentProcessor}.ts`, `backend/workers/{main,healthServer}.ts`, `backend/scheduler/cron.ts`, `Dockerfile.cron`.
- **Outside the ownership list, but local to the findings (flagged):**
  - `backend/utils/cronGuard.ts`: the real C3 file; the brief's `backend/services/cronGuard*` does not exist.
  - `pages/api/observability/metrics.ts` and `pages/api/platform/history/run.ts`: named in the C4 registry.
  - `pages/api/opportunities/refresh-slots.ts`: same C4 shape; no other workstream owns it.
  - `backend/tests/unit/emailJobsCronSchedule.test.ts` and `backend/tests/unit/__snapshots__/cronScheduleContractCharacterization.test.ts.snap`: pinned behaviour this work changes.
- No allowlist entries changed. Every `machine-secret` entry still references its env var (the gate passes).

**C8 evidence (queue controls, verified):**
- **Retries/backoff:** `bullmqClient.ts` publish 3×exp 60 s, posting 3×5 s, ai-heavy 2×30 s, engagement 3×30 s, `createQueue` 3×60 s; `contentGenerationQueues.ts:36-200` per-queue attempts 1–5; `intelligencePollingQueue.ts:44`; `automationTaskQueue.ts:29`; creator-render 3×5 s. bolt-execution runs 1 attempt with stalled recovery plus run-row reconciliation.
- **DLQ:** `deadLetterOnExhaustion` in `getWorker`, `createWorker` and the engagement worker, and in the raw `main.ts` workers; lead DLQ (`leadQueueHardening`); creator-render DLQ queue. 25 `on('failed')` sites.
- **Idempotency:** `makeStableJobId`; the publish processor's `queue_jobs.status` guard; BOLT run claims; `token_refresh_locks`.
- **Tracing:** `runWithJobTraceContext` wraps every factory and every raw worker.
- **Kill switches:** `ROLLOUT_*_KILL`, `DISTRIBUTED_LOCKS_KILL`, `AUTONOMOUS_CRON_ENABLED`, `RECONCILIATION_CRON_ENABLED`, and cron admin per-job overrides (`shouldRunCronJob`).
- **No publish-specific kill switch.** Publishing has at least five paths across two runtimes:
  - the BullMQ `publish` worker;
  - the `publishing_jobs` DB poll loop in `main.ts`;
  - the cron safety net `findDuePostsAndEnqueue`;
  - Vercel `/api/cron/process-scheduled-posts` (calls `publishNow` inline);
  - user-initiated `publishNowService` on Vercel.

  A switch covering one path would be misleading, so none was added. Proposed design: a single `isPublishingHalted()` check (env `PUBLISHING_HALT=1` or an admin runtime flag) evaluated in `publishNow()` itself, the one sink every path reaches. When halted it returns a retryable "halted" outcome so posts stay due rather than failed, and the BullMQ publish worker starts paused (`autorun: false`).

## 6. Cross-workstream proposals (not applied)
1. **SEC-F (gates):**
   - (a) Extend R4 to flag `if (secret) {…} else if (NODE_ENV === 'production') reject` (fail-open outside production), the C1-b shape R4 currently accepts.
   - (b) Promote `sec91CConstantTimeSecrets`' scan into a gate for `pages/api/**`: no `===`/`!==` against `*SECRET`/`*TOKEN` values or `` `Bearer ${…}` ``.
   - (c) Migration quality: new or replaced SECURITY DEFINER functions must `SET search_path`. A later `CREATE OR REPLACE` without it silently re-opens C7.
   - (d) Add `services/boltExecutionRecovery.ts` to `leadDeadLetterProducer`'s exemption list; its worker is already covered by `getWorker`.
   - (e) Refresh the `cronScheduleContractCharacterization` timing-constant snapshot for `PROSPECT_RETRY_INTERVAL_MS` after review.
2. **SEC-B:** `backend/auth/oauthState.ts:127` compares the state HMAC with `===`. Use `timingSafeEqual` or `constantTimeEqual`.
3. **Unowned (SEC-A or SEC-B to pick up):**
   - `backend/security/SessionAuthorityService.ts:232` (`signature !== expected`);
   - `backend/services/leadService.ts:240` (`cfg.secret !== webhookSecret`);
   - `backend/services/plannerSecurityGovernance.ts:293` (`f.hmac !== expected`).

   The same one-line change applies to each: `!constantTimeEqual(a, b)`.
4. **WS-1 (`fix/worker-shutdown-safety` @977e8aed, separate clone, unmerged):**
   - It rewrites the same cron/main shutdown lines (`startEmbeddedCron`/`stopCron`, closing 6 consumer groups, duplicate re-check).
   - If WS-1 lands first, drop the C6b hunk here; its behaviour is a subset.
   - If this lands first, WS-1 must keep `hostOwnsShutdown` semantics, meaning the embedded scheduler never calls `process.exit`.
5. **`scripts/redis-stability-probe.js`** reads raw `bull:*` keys. It still sees the production keyspace; it will not see a developer's isolated `omnivyra:local:*` jobs.
6. **SEC-F migration rules (coordination note):** SEC-C added no migration. If the C7 `search_path` remediation later becomes a migration, rule (3) ("alters SECURITY DEFINER ⇒ REVOKE EXECUTE FROM PUBLIC, anon, authenticated") must not be applied blindly. Many of these are PostgREST RPCs the app calls; revoking EXECUTE would break them. Use the `-- grant-ok:` annotation after review instead.

## 7. MANUAL OPERATION REQUIRED

**M1 — Railway: wait for CI before deploying (C6a).**
- Where: Railway → project `authentic-nature` → service `Omnivyra` → Settings → Source/Deploy → enable **"Wait for CI"** (deploy only after GitHub check suites pass on the commit).
- Why: a merge to `main` currently deploys the worker about 5 s later, before CI finishes.
- Verify: the next merge's deployment shows "Waiting for CI" and starts only after the checks are green. The GitHub deployment timestamp is later than the CI completion timestamp.

**M2 — Railway teardown and draining (C6b follow-up).**
- Where: service Settings → Deploy/Teardown. Set the draining time (the time between SIGTERM and SIGKILL; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) to at least 30 s. Keep the overlap short.
- Why: the worker's drain now actually runs (C6b) and needs up to 15 s (`WORKER_DRAIN_TIMEOUT_MS`) plus claim release.
- Verify: on the next deploy, the old deployment's log shows `[main] SIGTERM received` followed by `[main] shutdown complete`, with no `forcing exit`.
- Caveat: confirm the exact setting names in the Railway dashboard; this was not verifiable offline.

**M3 — Railway watch paths (optional, C6d).**
- If desired, set Watch Paths in the dashboard so docs-only pushes do not restart the worker.
- It was deliberately **not** put in `railway.json`. The worker compiles from `backend/**`, `lib/**`, `config/**`, `types/**`, `templates/**`, `package*.json`, `tsconfig*.json`, `Dockerfile.worker` and `scripts/fix-worker-aliases.js`; a pattern set that is too narrow leaves a stale worker on `main`, and Railway's glob and negation semantics could not be verified offline.
- A healthcheck is not recommended until `/health` reflects readiness: it returns 200 before the Redis preflight (`healthServer.ts:78-92`).

**M4 — Supabase network restrictions (C7).**
- Where: Dashboard → Project Settings → Database → Network Restrictions. Replace `0.0.0.0/0` and `::/0` with the operator egress CIDR(s) (/32 or /128). CLI alternative: `supabase network-restrictions update --project-ref <ref> --db-allow-cidr <cidr> --experimental`.
- Why: direct Postgres and pooler access is open to the Internet.
- No production runtime uses the direct DB password (earlier audit, per the brief); in-repo direct-DB users are operator scripts only (`scripts/operator/**`, `scripts/audit/**`, `scripts/security/verify-anon-exposure.js`). No workflow does. REST/PostgREST traffic is unaffected.
- Verify: `supabase network-restrictions get --project-ref <ref> --experimental` lists only the allowed CIDRs. A `psql` connection from a non-allowed IP times out; one from the allowed IP succeeds.

**M5 — Supabase SSL enforcement (C7).**
- Where: Dashboard → Database settings → SSL Configuration → **Enforce SSL on incoming connections**. CLI: `supabase ssl-enforcement update --project-ref <ref> --enable-db-ssl-enforcement --experimental`.
- Toggling may briefly reset connections, so do it in a quiet window.
- Verify: `supabase ssl-enforcement get …` reports enforced. `psql "host=… sslmode=disable"` is rejected.

**M6 — Auth leaked-password protection (C7).**
- Where: Dashboard → Authentication → Providers/Settings → Password security → **Prevent use of leaked passwords** (HaveIBeenPwned; requires the Pro plan). Management API: `PATCH /v1/projects/{ref}/config/auth` with `{"password_hibp_enabled": true}`; confirm the field name in the current API reference.
- Verify: the security advisor lint `auth_leaked_password_protection` clears.

**M7 — Functions with a mutable search_path (C7).**
1. Run this read-only listing in the SQL editor and export the result; it is also the rollback list:

   ```sql
   SELECT n.nspname AS schema, p.proname AS name,
          pg_get_function_identity_arguments(p.oid) AS args,
          p.prokind, p.prosecdef AS security_definer, l.lanname AS language
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   JOIN pg_language  l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f','p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                     WHERE d.objid = p.oid AND d.deptype = 'e')      -- skip extension-owned
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                     WHERE c LIKE 'search_path=%')
   ORDER BY p.prosecdef DESC, p.proname;
   ```
2. Review each body (`pg_get_functiondef(oid)`) for unqualified references to objects outside `public`/`extensions`/`pg_catalog`.
3. Apply through a reviewed migration. The version must sort after `20261026000000`, per SEC-F's rule. Use a catalog-driven `DO` block over the same predicate that runs `EXECUTE format('ALTER ROUTINE %I.%I(%s) SET search_path = public, extensions, pg_temp', schema, name, args)`.
   - This matches the precedent in `20260404_security_function_rls_ext_fixes.sql` (which used `public, extensions`), plus an explicit trailing `pg_temp` for SECURITY DEFINER safety.
4. Rollback: `ALTER ROUTINE … RESET search_path` for exactly the exported list.
5. Verify: the listing query returns 0 rows and advisor lint `function_search_path_mutable` clears.

**M8 — Worker triggers (from #245, unchanged).** `PUBLISHING_WORKER_SECRET` and `ANALYTICS_WORKER_SECRET` remain unset in Vercel, so those triggers answer 503. This is intentional; there are no in-repo callers.

## 8. Remaining limitations
- **C2:**
  - A production-mode process with no platform marker still *produces* on `bull` (for example a local `next start` against Upstash). Only consumers are refused, by design, so a web runtime can never be broken by a missing marker.
  - Vercel preview (`NODE_ENV=production`) still shares `bull` if it uses the production Redis (unchanged behaviour).
  - Operators who deliberately drive production queues from a laptop must now set `OMNIVYRA_ALLOW_SHARED_QUEUES=1`.
- **C3:** fail-open during a genuine Redis outage remains the production default (accepted, §2). A laptop cron against the production DB with no reachable Redis still runs unlocked; the prod-DB/local-Redis fatal guard in `lib/env/namespace.ts` only catches an explicit localhost `REDIS_URL`.
- **C5:** the checks cover the three processors in scope. Other processors that take ids from payloads (content-generation family, engine-jobs `jobId`, whatsapp, analytics-ingestion) were not audited here. The queue remains an authorisation boundary only to the extent that Redis credentials stay secret.
- **C6b:** verified by source pins only. Railway's actual SIGTERM→SIGKILL window is unverified (M2).
- **C9:** the image build was not executed.
- **C7:** no migration was prepared (M7). The 98-function set is only knowable from production.

# Closure-014C — remediation of the six Closure-014B findings

**Local and offline only.**
- Nothing was staged or committed.
- No push, PR, merge, deploy, production access, production query, migration or schema change took place.
- No external provider was called.

## 0. Summary

| Finding | Classification | One line |
|---|---|---|
| A: concurrent retry strands a post | **FIXED** | A claim fence is written before any cancel. Unit: 9/14 new tests fail before the fix, all pass after. Real stack: 13/13 runs with one 200 and one live job (014B on HEAD: stranded in 1 of 3). |
| B: concurrent reschedules corrupt the plan | **FIXED** | A RESCHEDULING fence serializes reschedules, the plan write is compare-and-set, and the undo is fenced. Unit: 8/13 new tests fail before, all pass after. Real stack: 8/8 runs fully consistent (014B on HEAD: divergent in 2 of 3). |
| C: cert launcher cannot start a worker | **FIXED** | tsconfig-paths base override; `--check` now resolves the real import graph. 2/2 new tests fail before, pass after; a real start is proven. |
| D: rate-limit saves fail but show "saved" | **FIXED** | Idempotency-Key, confirmed-2xx-only state and explicit failure display. 5/5 fail before, pass after. |
| E: intelligence-control never loads for a real super admin | **FIXED** | The page is gated by the server's own read authority. 6/6 fail before, pass after, plus a real-browser PASS. |
| F: blog create writes `primary_keyword` | **BLOCKED** (owner data-model decision) | The columns are absent from baseline, migrations and generated types, with no equivalent column. The contract is pinned by a test, and a migration contract is proposed (§F). |

Mutation testing: **17/17 killed**. One mutant (B4) survived the first pass and was killed after a missing test case was added (§9).

## 1. Starting state, ending state and preservation

| | Start | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `77760314c6af4d41b72f4b13ccc8322d97474e3a` | unchanged (no commit) |
| Closure-014B report | untracked, present | untracked, unchanged |
| Closure-014A committed files (3) | hashes match the manifest | unchanged |
| `closure014a_validator_evidence.sha256`, `closure014b_evidence.sha256` | verify (0 failures) | not rewritten |
| `next-env.d.ts` | committed | rewritten by `next dev`, restored with `git restore` |
| `.env.cert` (local, gitignored) | absent | composed for the run, deleted afterwards |

### Files changed (uncommitted)

**Source:**
- `pages/api/scheduler/retry.ts` (A)
- `backend/queue/publishOutcome.ts` (A, B: fence markers and helpers)
- `pages/api/activity-workspace/[id]/reschedule.ts` (B)
- `scripts/cert/publish-worker-cert.cjs`, `scripts/cert/publish-worker-cert.ts` (C)
- `components/super-admin/RedisEfficiencyPanelMain.tsx`, `components/super-admin/RedisEfficiencyPanelTabs.tsx` (D)
- `hooks/useIntelControl.tsx`, `components/admin/intelligenceControlMain.tsx` (E)

**Tests changed:**
- `backend/tests/unit/schedulerRetryTenantAuthority.test.ts`: the source pin "exactly 2 user pins" became "one user pin per `scheduled_posts` statement (5)". This is stronger, not weaker.
- `backend/tests/unit/closure014aCertPublishWorkerLauncher.test.ts`: non-secret placeholder config. `--check` now imports the worker modules, which validate config at import.

**Tests added:**

| Finding | File |
|---|---|
| A | `closure014cRetryConcurrency.test.ts` |
| B | `closure014cRescheduleConcurrency.test.ts` |
| C | `closure014cCertLauncherStartup.test.ts` |
| D | `closure014cRateLimitConfigSave.dom.test.tsx` |
| E | `closure014cIntelControlAccess.dom.test.tsx` |
| F | `closure014cBlogCreateSchemaContract.test.ts` |

## 2. Finding A — concurrent retries could strand a post

**Root cause** (`pages/api/scheduler/retry.ts`, HEAD lines 116–147):
- The route ran `cancelScheduledPostQueueEntry` **before** its compare-and-set on `failed`.
- Every concurrent retry read `failed`.
- A loser that reached its cancel after the winner had queued retired the winner's job, then failed its own compare-and-set (409).
- The post was left `scheduled` with no live job.

**Correction:**
1. **Claim first.** A compare-and-set on the read state (`failed`, no published identity, the exact `error_code` read) writes `RETRY_PREPARING:<epochMs>:<uuid>` into `error_code`.
   - The post stays `failed`, so no publisher can claim it while its prior job is retired.
   - A losing retry matches nothing and is refused before it can cancel anything.
2. A live claim held by another request is refused with **409 `RETRY_IN_PROGRESS`**.
   - A claim older than 15 minutes, beyond Vercel's maximum function duration, may be taken over for crash recovery.
   - Taking over a *live* claim was rejected: a slow claimant's cancel could still select the new job.
3. Only the claim holder **cancels**. A cancel DB error releases the claim (compare-and-set on it) and returns 503 `PRIOR_JOB_CANCEL_FAILED`.
4. The **reset** is a compare-and-set on the holder's own claim. Interleavings (an uncertain outcome or a published identity recorded meanwhile) make it match nothing.
5. **Enqueue:**
   - On a throw, the post is restored to its exact read state (status, `error_code`, `error_message`, `scheduled_for`) with a compare-and-set on the reset this retry wrote. The response is 502 with `post_restored`.
   - `'past'` (nothing queued) now does the same and answers **503 `RETRY_NOT_QUEUED`**, never 200. **This is a behaviour change:** it used to be 200 and rely on the safety-net cron.
6. The values read are snapshotted at read time and never taken from a client row object.

**Unchanged:** tenant scoping (every `scheduled_posts` statement still pins `user_id = session user`, enforced by the source pin), the refusals before anything is touched (published, in flight, uncertain, thread child, no account), and the no-platform-authority policy.

**Evidence:**

| | Before (HEAD route) | After |
|---|---|---|
| `closure014cRetryConcurrency` (14 tests, barrier-driven) | **9 failed** / 5 passed, including the reported race: live jobs 0, two cancels | 14/14 |
| With the 3 existing retry suites | — | **177/177** |
| Real stack: app → Kong → PostgREST pool (10) → Postgres, 20 and 60 parallel retries | 014B: stranded post in 1 of 3 runs at 60 | **13/13 runs**: exactly one 200 and exactly one live job at both fan-outs; losers 409 `RETRY_IN_PROGRESS` / `NOT_RETRYABLE` |

The barrier tests prove the route's ordering in-memory. The real-stack runs exercise Postgres and PostgREST but not every interleaving. **Exactly-once external publishing is not claimed.** What is shown: no stranded post, one live job, and no cancel by a loser.

## 3. Finding B — concurrent reschedules could corrupt the plan

**Root cause** (`pages/api/activity-workspace/[id]/reschedule.ts`):
- Only the post write was compare-and-set.
- The plan write (HEAD line 741), the incomplete marker (HEAD line 808, a whole-content rewrite) and the queue step all ran unconditionally afterwards.
- A request that won the post compare-and-set earlier but finished later could overwrite newer state. That includes the observed stale plan with a "repeat" marker, and a stale queue step re-queuing its own time.
- **Second defect:** `scheduled_posts` has a `BEFORE UPDATE` trigger (`updated_at = CURRENT_TIMESTAMP`, confirmed in the cert DB). The compensating undo pinned on the app's own timestamp could never match in Postgres.

**First correction attempt — superseded by the fence.**
- **Design:** plan compare-and-set, an undo pinned on the DB version, and supersession detection with queue repair.
- **Unit result:** it passed all unit tests.
- **Real-stack result:** it **failed on the real stack** in 1 of 5 runs. Final state: post 10:00, job 10:00, plan 11:00, and every request answered 409.
- **Cause:** several losers wrote the post transiently, then undid it by restoring "the values they read", which were themselves another loser's transient write. Compensation chains are not linearizable.
- The design was replaced. This is why the real-stack run is part of the evidence.

**Final correction (fence):**
1. The post compare-and-set writes the new time **and** `RESCHEDULING:<epochMs>:<uuid>` in one statement.
2. A reschedule that reads a live fence is refused with **409 `RESCHEDULE_IN_PROGRESS`** before writing anything. Reschedules of one post now serialize. A fence older than 15 minutes may be taken over.
3. The plan write is a **compare-and-set on the plan version read** (`updated_at`, snapshotted; unique microsecond-suffixed write versions).
4. The **undo** is pinned on this request's fence **and** on what it wrote (`status`, `scheduled_for`, `platform`, `social_account_id`). It never clobbers another writer, and it restores the `error_code` read.
5. The incomplete marker lands only on **this request's own plan version**.
6. The fence is **released last**: on success, on queue failure and on lock contention. If a publisher claimed the post meanwhile, its claim already replaced the fence and the release changes nothing.

**Publisher behaviour is unchanged:** a publisher's claim pins the `error_code` it read, exactly as before.

**Evidence:**

| | Before (HEAD route) | After |
|---|---|---|
| `closure014cRescheduleConcurrency` (14 tests) | **8 of 13 failed** (stale queue step, interleaved queue steps, stale plan write, fence written/cleared, stale-fence takeover, live fence refused, undo under the trigger, marker on a foreign version). The 14th test (status-only writer) was added later for mutant B4 and passes after. | 14/14 |
| With the 7 existing reschedule suites | — | **171/171** |
| Real stack, B6 with 2 and 6 concurrent reschedules | 014B: plan/post divergence in 2 of 3 runs at 6 | **8/8 runs**: exactly one 200; post = plan = single live job = the winner's time. 0 leftover `RESCHEDULING`/`RETRY_PREPARING` markers on all 52 test posts. |

As for A, unit tests prove ordering and real-stack runs sample real interleavings; neither proves every Postgres interleaving.

**Rollback note.** The two new markers are `RETRY_PREPARING:` (on `failed` posts) and `RESCHEDULING:` (on `scheduled` posts). Older code treats them as ordinary error codes:
- the old retry route resets a `failed` post whatever its code;
- old publishers' claims pin the code read.

A crash-left marker is therefore harmless to older code. Add both prefixes to the 014B rollback reconciliation list for completeness.

## 4. Finding C — the cert launcher could not start a worker

**Root cause:**
- The root tsconfig declares `paths` (`"@/*": ["./*"]`) but no `baseUrl`, so the runner's bare `require('tsconfig-paths/register')` skipped itself ("Missing baseUrl").
- Every `@/…` import in the worker graph therefore failed at a real start (`lib/redis/instrumentation.ts` → `@/lib/runtime/guard`).
- `--check` returned before importing that graph.

**Correction:**
- `scripts/cert/publish-worker-cert.cjs` sets tsconfig-paths' **supported** overrides before registering: `TS_NODE_PROJECT` (an absolute path to the root tsconfig, so resolution does not depend on the cwd) and `TS_NODE_BASEURL='.'`.
- The scratchpad fix was **not** copied. It was reviewed, and its absolute-baseUrl assumption was found wrong for tsconfig-paths 3.15, which `path.join`s the base to the config directory. That produced `C:\tmp\closure-014a\C:\tmp\closure-014a` and was verified.
- `scripts/cert/publish-worker-cert.ts` now imports `bullmqClient` and `publishProcessor` **before** the `--check` exit. Check mode exercises exactly the module resolution a real start uses, and both stay lazy: no Worker, no Redis connection.
- Production is unaffected: `Dockerfile.worker` compiles with `tsc` and rewrites aliases.

**Evidence:**

| | Before | After |
|---|---|---|
| `closure014cCertLauncherStartup`: `--check` resolves the worker modules; a **real start** (Redis = closed loopback port, killed after construction) builds exactly one publish consumer and nothing else | **2/2 failed** (`Cannot find module '@/lib/runtime/guard'`) | 2/2 |
| `closure014aCertPublishWorkerLauncher` (5) | — | 5/5 |

## 5. Finding D — rate-limit writes failed while the UI showed "saved"

**Affected writers (inventory):** all through `saveRlConfig` in `RedisEfficiencyPanelMain.tsx`.
- the Rate Limiter tab's per-endpoint **Save**;
- the per-endpoint **Reset**;
- **Auto Optimize → Apply Optimizations** (its rate-limit step).

**Route:** `POST /api/admin/rate-limit-config`.
- `withIdempotency` (Idempotency-Key required) and `requireAdminRateLimit` (`rl:admin:rate-limit-config`, 20/60 s).
- `requireSuperAdminUser`: an authenticated user who is an exact, active platform SUPER_ADMIN (`isPlatformSuperAdmin`).
- **No** capability guard, **no** step-up and **no** capability audit.

**Root cause.** The writers used a bare `fetch` with no Idempotency-Key, so the route always answered 400 `IDEMPOTENCY_KEY_REQUIRED`. The response was ignored, local config was replaced and the tab showed "Saved" unconditionally.

**Correction (transport and response handling only):**
- `saveRlConfig` uses `performSuperAdminWrite` with `freshIdempotencyHeaders()`, the same contract as the sibling queue/cron saves.
- Local config changes only on a confirmed 2xx. Every refusal (429 with its `Retry-After`, other 4xx/5xx, network) reaches the existing "Not saved: …" banner.
- `RateLimiterTab` shows its saved mark only when the save returned `ok`, and the user's draft is kept.
- Auto Optimize stops on a refused rate-limit step, like its cron/queue steps.
- **The route's authorization is unchanged.**

**Evidence** (`closure014cRateLimitConfigSave.dom.test.tsx`, the real panel and real helper, fetch faked by URL):

| | Before | After |
|---|---|---|
| 2xx / 429 + Retry-After / 500 / network / local config unchanged on failure | **5/5 failed** | 5/5, plus `closure014SuperAdminWrite` and `platformWave5` (33/33) |

**Separate authorization decision (owner, not taken here).** Whether `rate-limit-config` becomes a platform-tier write capability with step-up and capability audit, like the 73 routes in the Closure-014 matrix.

## 6. Finding E — /admin/intelligence-control never loaded for a real super admin

**Root cause** (confirmed before changing code):
- `useIntelControl` gated the page on the **client** role.
- `CompanyContext.normalizeCompanyRole` deliberately downgrades a `SUPER_ADMIN` membership to `COMPANY_ADMIN` under a normal Supabase session.
- The page therefore rendered "Loading intelligence control…" forever, and neither success nor error was ever shown.

**Correction.**
- The **server** decides, through the page's own data read: `GET /api/admin/intelligence/scheduler-config`, guarded by `super_admin.dashboard.view`.

  | Response | Page |
  |---|---|
  | 200 | renders |
  | 401 | "Sign in again…" |
  | 403 | "does not have access" |
  | 5xx / network | an error with **Retry**; never the endless loader |

- No new endpoint; `CompanyContext` is not changed.
- **No write authority is added.** Every write on the page stays behind `intelligence.override.manage`, the central platform-write guard and passkey step-up on the server.

**Evidence:**

| | Before | After |
|---|---|---|
| `closure014cIntelControlAccess.dom.test.tsx`: SUPER_ADMIN with a downgraded client role; tenant 403; signed-out 401; 500 with Retry; network; no write on render | **6/6 failed** | 6/6 |

**Real browser** (Chromium with a CDP virtual authenticator, loopback cert app, synthetic identities):

| Identity | Page | Write: Account Boost (`POST scheduler-boost`) |
|---|---|---|
| canonical SUPER_ADMIN | renders, no loader | 401 `STEP_UP_REQUIRED` → passkey step-up 201 → trust 201 → retry **200**; audited `step_up_required` → `allowed`/`elevated_route_accessed` with webauthn and a trusted device |
| tenant COMPANY_ADMIN, no grants | "Your account does not have access to intelligence control." | — |
| VIEW_ONLY holding a direct `super_admin.dashboard.view` grant | renders (delegated **read**, by design of that capability) | **403 `PLATFORM_SUPER_ADMIN_REQUIRED`**, shown in the UI ("Only an active platform super-admin can make this change.") |

**Separate finding, not fixed (owner).** `/api/admin/check-super-admin`, used by 10 other UI surfaces, matches `role = 'SUPER_ADMIN'` **without** checking `status = 'active'`. It was not used for this gate. Tightening it changes those surfaces, so it is outside this task's scope.

## 7. Finding F — blog create writes `primary_keyword`

**Evidence (local only, no production inspection):**
- `POST /api/admin/blog` inserts `primary_keyword` and `secondary_keywords` on **every** create (null when not supplied), since `0465edcc` (on main).
- Five editors send them: `/admin/blog/new`, articles, case studies, guides, and the managed-suggestions flow.
- Neither column is defined by `supabase/_schema/baseline.sql` (the schema-only production dump at ledger max `20260916`), by any migration, or by generated types.
- The cert DB's 24 `public_blogs` columns equal the baseline definition exactly.
- **No semantically equivalent column exists.** `tags` is a display taxonomy, and folding SEO keywords into it would change user-visible meaning.

**Classification: BLOCKED.** This is a data-model decision that requires either a schema change or dropping a product field. Per the brief, no column was invented and no migration was added or applied.

**Proposed migration contract** (owner review; not created):
```sql
-- up
ALTER TABLE public.public_blogs
  ADD COLUMN IF NOT EXISTS primary_keyword text,
  ADD COLUMN IF NOT EXISTS secondary_keywords text[];
ALTER TABLE public.public_blogs
  ADD CONSTRAINT public_blogs_secondary_keywords_max5
  CHECK (secondary_keywords IS NULL OR cardinality(secondary_keywords) <= 5) NOT VALID;
-- down
ALTER TABLE public.public_blogs DROP CONSTRAINT IF EXISTS public_blogs_secondary_keywords_max5;
ALTER TABLE public.public_blogs DROP COLUMN IF EXISTS secondary_keywords, DROP COLUMN IF EXISTS primary_keyword;
```
Additive and nullable, so no backfill. It matches the route's normalization (trimmed primary, at most 5 string secondaries).

The alternative is a code-only change that stops writing the fields, which drops the SEO keywords the editors collect.

**Production question (authorized operator only):** does `public_blogs` have these columns? If not, blog creation has failed in production since `0465edcc`.

**Regression test** (`closure014cBlogCreateSchemaContract`, 3/3). The real handler's insert payload is checked against the columns derived from baseline and every migration. The gap is pinned to **exactly** `{primary_keyword, secondary_keywords}`. The test fails if any other undefined column appears, or once a migration defines these two.

## 8. Network isolation and loopback binding

| Control | Evidence |
|---|---|
| Next.js 16.2.6 dev update check | Code-verified: `hot-reloader-webpack.js` calls `getVersionInfo()` (a `fetch` to `registry.npmjs.org`) **unconditionally**, with no env switch. `NEXT_TELEMETRY_DISABLED` covers telemetry only. |
| Outbound guard | Test-harness preload `--require egress-preload.cjs` in every Node process of the app tree and the cert worker. Verified **before** startup: the exact update-check URL, Google Fonts and TEST-NET were all refused before DNS. |
| Outbound attempts during the task | App: **1**, `registry.npmjs.org:443` (Next's update check), **refused**. Nothing else. Worker (launcher test): loopback only. |
| Loopback binding | Harness launcher (`c14c/app-launch.cjs`): same cert env path as `start-all --app-only` (certAwareEnv + isolation guard, `ENABLE_AUTO_WORKERS=0`), plus `next dev -H 127.0.0.1`. `netstat`: **127.0.0.1:3000 only**; Next printed "Network: http://127.0.0.1:3000". |
| Redis | Dedicated loopback Memurai on `127.0.0.1:6390` (no persistence), stopped afterwards. Shared Memurai `:6379` DB 0: 197 keys before and after. |
| DB | `cert-supabase` Postgres `127.0.0.1:54322` (loopback-verified) only. `certAwareEnv` and `assert-cert-isolation`: PASS. |
| Identities | `@c14cval.invalid` only |
| Cleanup | All ledgered synthetic rows removed, including the 16 boost rows in `intelligence_company_overrides` (that table holds 0 rows again). Retained by design: append-only `capability_audit_log` (42 exported rows) and `creator_audit_log`. The cert-supabase containers' published ports (`0.0.0.0`) are unchanged (014B note). |

## 9. Tests, typecheck, certification, migrations, validator, mutation

| Gate | Command | Result |
|---|---|---|
| Gate suites | `node node_modules/jest/bin/jest.js --runInBand --forceExit --json <175 suites>` (the 014A 168-suite gate + the 6 new + related retry/reschedule/UI suites) | exit 0; **175/175 suites, 4355 passed, 0 failed, 2 skipped** (the same 2 pre-existing `focused` skips as 014A) |
| Whole-repo jest | `node node_modules/jest/bin/jest.js --runInBand --forceExit`, failing set vs 014A's 29 suites | exit 1: **30 failed suites / 107 failed tests** (1959 passed, 6 skipped suites; 31220 passed tests). Against 014A's 29-suite set: **0 fixed, 1 new**, `sec91FSecretsGate` (see §9a). It is NOT caused by 014C. |
| Typecheck | `npm run typecheck` | exit 0; **3/3 projects clean** |
| Backend certification | `node scripts/typecheck-certification.js` | exit 0; **PASS, 259/259, 0 uncovered** |
| Migration check | `node scripts/check-migration-quality.js` | exit 0; 70 new valid; no migration added |
| Grant-impact validator (014A, unchanged) | `CERT_DB_URL=<loopback 127.0.0.1:54322> node scripts/cert/validate-grant-impact-query.cjs` | exit 0; **VALIDATION PASS** (4 result sets, 25006, fixture matrix PASS, 0 synthetic rows) |
| Mutation (`c14c/mutants.js`, anchored mutants, byte-verified restore) | targeted suites per mutant | **17/17 killed** |

### 9a. New whole-repo failure: `sec91FSecretsGate` — pre-existing at HEAD, outside the six findings

`scripts/check-secrets.js` (run by that suite over **tracked** files) reports 3 `postgres-url-with-password` matches.
- Where: lines 71 and 74 of `backend/tests/unit/closure014aGrantImpactValidator.test.ts`.
- What they are: test placeholder DSNs (user `u` with a one-letter password) for the loopback-guard tests. They are not real credentials, and the hosts are loopback or test hosts.
- Why it is pre-existing: that file was committed in Closure-014A `77760314` (2026-10-14 20:14). It is byte-identical to HEAD, and this task did not modify it.
- Why 014A's baseline did not show it: the 014A whole-repo baseline ran on 2026-10-13 12:00, before the file existed.
- Why 014C cannot cause it: the scanner reads tracked files only, and every 014C change is uncommitted.

**HEAD itself therefore fails this gate.** Per the brief (stop on a defect outside the bounded scope; do not alter 014A's committed files without authorization), it is **not fixed here**.

**Proposed correction (verified in memory only, nothing written):** replace that file's placeholder passwords with the gate-recognised `u:placeholder@` form, which clears all 3 findings. That is 7 lines in that one test file, with no behaviour change. Add no allowlist entry.

**Mutants:**
- **A1–A6 (retry):** a live claim stolen; claim not pinned; reset not fenced; claim kept on cancel failure; no restore; `'past'` → 200.
- **B1–B6 (reschedule):** fence ignored; plan write not compare-and-set; marker not version-fenced; undo pinned on the fence only; fence never released; post write without the fence.
- **C1:** no baseUrl override.
- **D1, D2:** success reported unconditionally; no Idempotency-Key.
- **E1, E2:** client-role gate restored; a refusal rendered as the page.

**B4 survived the first pass.** No test covered a status-only concurrent writer, such as an unschedule. That test was added and B4 is killed.

**Concurrency evidence, by kind:**
- **Deterministic in-memory:** barrier-forced interleavings against the routeAuthHarness fake (the trigger simulated for B). These prove ordering and fencing.
- **Real Postgres/PostgREST/BullMQ-producer:** the 13 (A) and 8 (B) runs above, through the 10-connection PostgREST pool. These sample real interleavings but cannot enumerate them.
- No worker consumed jobs during A/B. BullMQ queue state was observed through `queue_jobs` rows.

## 10. Remaining decisions and production-only checks

1. **F**: add the two `public_blogs` columns (migration contract above) or drop the fields. An authorized operator checks the production columns.
2. **D**: whether `rate-limit-config` becomes a platform-tier write capability with step-up and audit.
3. `check-super-admin` ignores `status` (10 consumers): owner decision.
4. **Retry `'past'` semantics changed** (503 `RETRY_NOT_QUEUED` instead of a 200 that left a `scheduled` post without a job): product acceptance.
5. Add `RETRY_PREPARING:` and `RESCHEDULING:` to the rollback reconciliation list.
6. **Authorize the §9a placeholder fix** in the Closure-014A test file, which restores the secrets gate on HEAD.
7. All production-only items from the Closure-014B report are unchanged.

## 11. Incomplete work

None of the six findings is left partially done. F is BLOCKED by design (owner decision). No real-provider, production or schema step was attempted.

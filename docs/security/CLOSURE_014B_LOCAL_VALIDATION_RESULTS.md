# Closure-014B — local validation results (B9, C4, C7, 22 UI writers, release prerequisites)

**Local and offline only.**
- This is not release authorization.
- No push, PR, merge, deploy or production access took place.
- No migration was applied. No production query was run.
- No real provider was called. No real account or real content was used.

## 0. Summary

| | Count |
|---|---|
| Checks in scope | 25 (B9, C4, C7 and 22 UI writers) |
| PASS | **15** (C4 and 14 UI writers) |
| PARTIAL | **2** (B9, W16) |
| FAIL | **2** (W1, W9b) |
| BLOCKED | **6** (C7, W9, W11, W12, W13, W14) |

**Six defects or findings** came out of this run (§7). None was fixed. Each has a proposed, narrowly scoped correction.
- Two concurrency defects, found under B9 load:
  - concurrent tenant retries can strand a post with no live job;
  - concurrent reschedules can leave the plan row contradicting the post.
- The committed Closure-014A cert launcher cannot start a worker. `--check` passes, but a real start fails on the `@/` path aliases.
- The rate-limit UI saves always fail but are shown as saved.
- The intelligence-control page never renders for a canonical SUPER_ADMIN.
- Blog create writes two columns that no migration or baseline defines.

## 1. Starting state, ending state and preservation

| Item | Start | End |
|---|---|---|
| Branch | `integration/closure-014a` | `integration/closure-014a` |
| HEAD | `77760314c6af4d41b72f4b13ccc8322d97474e3a` (parent `7c24c5b6…`) | unchanged |
| `git status --short` | empty | empty, except this new report (untracked) |
| Closure-014A committed files (3) | match `closure014a_validator_evidence.sha256` | still match |
| Evidence manifests | `closure014a_validator_evidence.sha256`: all OK | not rewritten |

**Manifest notes:**
- The superseded `.v1` manifest still lists the pre-hardening blobs. Its three source entries fail, as they already did after 014A.
- `closure014a_evidence.sha256` keeps one entry for the pre-hardening validator, which fails for the same reason.
- Neither was modified.

**Worktree side effects, all reverted:**
- `next dev` rewrote `next-env.d.ts`, a Next 16 dev-mode behaviour (the main checkout shows the same edit). Restored to the committed content with `git restore -- next-env.d.ts`.
- The local-only `.env.cert` composed for this run (gitignored) was deleted afterwards.
- `.next/` (gitignored build cache) remains.

Nothing was staged or committed. No other worktree, branch, container, volume or database was touched.

## 2. Resource isolation evidence

| Resource | Identity | Isolation evidence |
|---|---|---|
| Postgres | `supabase_db_cert-supabase`, project label `cert-supabase`, PostgreSQL 17.6, host port 54322 | Every connection was made to `127.0.0.1:54322` after a loopback check; the label was checked before reading the container's local config. |
| PostgREST / GoTrue | Kong `localhost:54321` → PostgREST 16.2, default pool size (10) | Local keys were minted from the local JWT secret and never printed. |
| Redis (app + worker) | **dedicated** Memurai process on `127.0.0.1:6390`, `--save "" --appendonly no`, DB 3; empty at start | Shared Memurai `127.0.0.1:6379` DB 0 was 197 keys before and after the run (never written). The dedicated process was stopped at the end; it had no persistence. |
| App | `next dev` in `--app-only` mode, `ENABLE_AUTO_WORKERS=0`, `CERT_ENV=1` | `certAwareEnv` and `assert-cert-isolation` both PASS. Every URL is loopback and no production marker is present. |
| Server egress | test-harness preload `--require egress-preload.cjs` (same rule as `backend/cert/loopbackEgressGuard.ts`) on the app tree and the worker | App refusals: 8× `fonts.googleapis.com:443` (next/font) and 1× `registry.npmjs.org:443` (Next update check). Worker refusals: **0**. |
| Worker | the repo launcher via a scratchpad runner (§5) | one consumer, queue `publish`, prefix `omnivyra:local:`, provider `cert-fake` |
| Identities | `@c14bval.invalid` only, and companies `C14BVAL …` | No real operator or customer account was used. |
| pg_cron / pg_net | libraries loaded, extensions **not installed** in any database | no scheduled jobs, no HTTP queue |

**Isolation findings to note:**
- **Unguarded first start.** The first app start (15:06 UTC) ran without the egress preload, and `NEXT_TELEMETRY_DISABLED` does not stop Next's update check. That start probably made one metadata request to `registry.npmjs.org`, which carries no project data. Every later start was guarded. Closure-012's runs probably made the same request.
- **Non-loopback listeners.** `next dev` listens on all interfaces (it printed a LAN address). The `cert-supabase` ports 54321–54324 and 54327 are published on `0.0.0.0`. Both are local stacks with no production connection, but they are reachable from the LAN while running.

## 3. Status matrix

| Check | Status | Evidence (summary) |
|---|---|---|
| **B9** pooled connections | **PARTIAL** | §4 |
| **C4** uncertain outcome via real worker and DB | **PASS** (behaviour) | §5. The committed launcher itself cannot start (defect D-14B-3). |
| **C7** mixed old/new worker | **BLOCKED** (live) | §6. Three code-confirmed hazards against the real old revision. |
| W1–W19 (22 entry points) | 14 PASS / 1 PARTIAL / 2 FAIL / 5 BLOCKED | §8 |

## 4. B9 — connection-pool and concurrency

**Actual connection path.** The B2/B6 routes never hold a Postgres connection:

app → supabase-js (HTTP) → Kong → **PostgREST 16.2 connection pool** → Postgres

- `SUPABASE_POOLER_URL`, when set, is passed to supabase-js as the **HTTP base URL** ([supabaseClient.ts:92-95](../../backend/db/supabaseClient.ts)). It is not a Postgres pooler DSN.
- A PgBouncer/Supavisor endpoint is therefore not on these routes' path.
- **BLOCKED part:** `.cert-supabase/supabase/config.toml` has `[db.pooler] enabled = false`. Enabling it needs a config change and a stack restart, which were not authorized.
- **Operator check:** whether production sets `SUPABASE_POOLER_URL`, and what it points to.

**Measured.** A sampler read `pg_stat_activity` (`usename = authenticator`) every 20 ms during each burst. Pooled backend sessions never exceeded **11** (10 pool connections plus the listener).

| Run (×3) | Result | Verdict |
|---|---|---|
| B2, 20 parallel retries | 1 × 200 `enqueued` + 19 × 409 `NOT_RETRYABLE`; exactly 1 live job (3/3 runs) | PASS (same outcome as Closure-012 B2) |
| B6, 2 concurrent reschedules | 200 + 409 `SCHEDULED_POST_CHANGED_CONCURRENTLY`; post, plan and the single live job carry the winner's time (3/3) | PASS (same as Closure-012 B6) |
| B2, **60** parallel retries | 1 × 200 + 59 × 409, but in 1 of 3 runs the winner's job ended `cancelled` (`superseded_by_manual_retry`). The post was left `scheduled` with **no live job**. | **FAIL**: defect D-14B-1 |
| B6, **6** concurrent reschedules | post and live job always consistent. In 2 of 3 runs the plan row contradicted itself: `scheduled_time` 15:00 (the post's time) but `content.scheduled_at` 12:00, plus a `reschedule_incomplete` marker telling the user to repeat a superseded reschedule. | **FAIL**: defect D-14B-2 |

Neither defect is specific to pooling: both are application-level races that the 10-connection pool exposes at higher fan-out. The 17 focused unit suites pass with both defects present, so concurrency is a test gap.

**20260657 (queue lock RPC):**
- Re-verified against PostgreSQL 17.6 in a read-only transaction that was rolled back: `pg_try_advisory_lock(bigint, bigint)` → **42883, function does not exist**. The only overloads are `(bigint)` and `(integer, integer)`.
- The migration would apply (a plpgsql body is not validated at `CREATE`) but every call would fail. It is also a session-scoped lock taken over pooled per-request connections.
- The cert DB does not have it, and the code's fallback path ran during B6. **Do not apply as written.**

## 5. C4 — uncertain provider outcome through the real worker and database

**Launcher inspection:**
- `scripts/cert/publish-worker-cert.ts` imports only the egress guard, the fake provider, the worker plan, the queue namespace, `bullmqClient` and `publishProcessor`.
- No cron, OAuth refresh, polling, `startWorkers` or `workers/main` is imported. The direct import chain has no module-level timers or consumers.
- `--check` PASS: `plan: queue=publish prefix=omnivyra:local: consumers=1 provider=cert-fake egress=loopback-only`.

**Defect D-14B-3: the committed runner cannot start a worker.**
- `scripts/cert/publish-worker-cert.cjs` calls `require('tsconfig-paths/register')`. The root tsconfig has `paths` but no `baseUrl`, so tsconfig-paths is skipped ("Missing baseUrl").
- A real start therefore fails with `Cannot find module '@/lib/runtime/guard'` (from `lib/redis/instrumentation.ts`) before any Worker is constructed.
- `--check` never imports `bullmqClient`, which is why it passes.
- **Production is not affected:** `Dockerfile.worker` compiles with `tsc` and rewrites aliases (`scripts/fix-worker-aliases.js`).

**Harness.** A scratchpad runner loads the **unchanged** repo launcher. It differs from the repo runner in two ways:
- it registers tsconfig-paths with `baseUrl` = worktree root and the root tsconfig's own `paths` (the proposed fix);
- it prints the in-process cert-fake call ledger (`certFakePublisherCalls()`), so provider calls can be counted.

**Flow.** Each post (synthetic, tenant A, account token never read) went through:
1. the real tenant retry route → enqueue;
2. the real worker;
3. the cert DB.

An earlier attempt ran with no consumer because of D-14B-3. It was discarded, and its 8 queued BullMQ keys were removed.

| Step | Observed | Verdict |
|---|---|---|
| `[cert-fake:ambiguous]`: provider 5xx after the call left | exactly **1** provider call. The post is `failed` / `PUBLISH_OUTCOME_UNCERTAIN`. The `queue_jobs` row is `failed` with `metadata.platform_call.started_at`, and its error text tells the operator to reconcile. | PASS |
| no automatic republish | 75 s later: still 1 provider call; no new job; post unchanged | PASS |
| tenant retry of the uncertain post | **409 `PUBLISH_OUTCOME_UNCERTAIN`**; nothing cancelled or reset; still 1 call | PASS |
| super-admin reconcile, no step-up | 401 `STEP_UP_REQUIRED` | PASS |
| reconcile with a real passkey step-up and trusted device | 200 `not_published`; post → `PUBLISH_RECONCILED_NOT_PUBLISHED` | PASS |
| tenant retry after reconciliation | 200 `enqueued`; exactly **one** deliberate second call; outcome uncertain again; the old row is `cancelled` and the new one `failed` | PASS |
| control: success | `published`, `platform_post_id = cert_fake_<id>`, job `completed`, 1 call | PASS |
| control: `[cert-fake:reject]` (`retryable:false`, `delivery: not_sent`) | `failed` / `UNKNOWN_ERROR`, but **3** provider calls (BullMQ `attempts: 3` at 1-minute intervals) | observation O-1 |

The fake provider proves the worker's control flow, not real platform behaviour.

**Observation O-1:**
- A definite rejection is redelivered up to BullMQ's attempt limit; the `retryable:false` flag is not honoured. Nothing was created, so there is no duplicate-publication risk, but the provider is called repeatedly.
- `queue_jobs.attempts` stays 0. After BullMQ finished, the row still showed a `next_retry_at` in the past.
- With `20261202000000` unapplied (as in this cert DB and, per earlier reports, production), there is **no `exhausted` marker**. An exhausted job is indistinguishable from one awaiting retry.

## 6. C7 — mixed old/new versions

**Old revision:**
- `5604b50b` (last recorded production deploy per local notes; **not re-verified**), 38 commits behind HEAD.
- Local git objects only; nothing fetched.

**Shared contracts at the old revision** (`git grep` in backend, lib and pages; tests excluded):

| Marker | Count at `5604b50b` |
|---|---|
| `PUBLISH_CLAIMED`, `PUBLISH_CALL_STARTED`, `PUBLISH_OUTCOME_UNCERTAIN` | 0 |
| `THREAD_RESCHEDULING`, `PUBLISH_NOT_ATTEMPTED`, `PUBLISH_RECONCILED_NOT_PUBLISHED` | 0 |
| `retry_state`, `platform_call` | 0 |

**Code-confirmed hazards:**
1. **Old web with new rows.** Old `pages/api/scheduler/retry.ts` resets any `failed` post to `scheduled`, clears `error_code` and enqueues it. A post the new worker marked `PUBLISH_OUTCOME_UNCERTAIN` would be republished.
2. **Old worker with new web.** The old processor writes a plain `failed` with the platform's error code and has no uncertainty concept. The new retry route would then accept the post as definitely failed and republish it.
3. **Old worker with new claims.** Old `claimScheduledPostForPublish` has a timestamp-based stale takeover of `publishing` rows. It would reclaim a post fenced by `PUBLISH_CLAIMED:<token>` after the stale window, whatever the call-started marker. Closure-003 removed that takeover.

**Why the live run is BLOCKED:**
- The old code has no safe provider seam. Its `USE_MOCK_PLATFORMS` fires *after* the token read and OAuth refresh, and it drops the Redis `/N` index.
- Running it would mean either modifying it, which makes it no longer the old version, or exercising the real adapter path, which is not allowed.

**Conclusion.** The "deploy web and worker together at one commit, reconcile marker rows before any rollback" rule stands, now backed by code evidence against the actual old revision.

## 7. Defects and findings (none fixed; proposals only)

| ID | Severity | Where | Defect | Proposed narrow correction |
|---|---|---|---|---|
| D-14B-1 | Medium | [retry.ts:116-147](../../pages/api/scheduler/retry.ts) | Losers of a concurrent retry run `cancelScheduledPostQueueEntry` *before* their compare-and-set fails. A late loser cancels the winner's fresh job, stranding a `scheduled` post with no live job. Seen in 1 of 3 runs at 60-way fan-out. | Claim before cancelling: compare-and-set `failed` → `failed` with a `RETRY_PREPARING:<token>` error code (pinned to the error code that was read), then cancel, then reset on that token, then enqueue. Losers then refuse before any cancel. Add a real-concurrency regression test. |
| D-14B-2 | Medium | [reschedule.ts:741-743, 808-810](../../pages/api/activity-workspace/[id]/reschedule.ts) | The plan write is a plain update. `recordIncomplete` rewrites the whole plan `content` from a superseded request's stale copy, so the plan contradicts the post and suggests repeating an outdated reschedule. Seen in 2 of 3 runs at 6-way. | Before recording incomplete (and before the plan write), re-read the post. If `scheduled_for` ≠ this request's target, answer 409 superseded and write nothing. Make the plan writes compare-and-set on the version this request read or wrote. |
| D-14B-3 | Medium (cert tooling) | `scripts/cert/publish-worker-cert.cjs` (Closure-014A commit `7c24c5b6`) | The real start fails on `@/` aliases (`baseUrl` missing); `--check` hides it. The 014A launcher test covers only `--check`. | Replace the bare register with `require('tsconfig-paths').register({ baseUrl: <root>, paths: <root tsconfig paths> })`, as the scratchpad runner does. Add a test that loads `bullmqClient` through the runner without constructing a Worker. |
| D-14B-4 | Medium (pre-existing) | [RedisEfficiencyPanelMain.tsx:576-583](../../components/super-admin/RedisEfficiencyPanelMain.tsx), `RedisEfficiencyPanelTabs.tsx:397,408` | Every UI write to `/api/admin/rate-limit-config` (Rate Limiter tab Save ×2, and Auto Optimize's rate-limit step) is a plain `fetch` with no Idempotency-Key. It always gets 400 `IDEMPOTENCY_KEY_REQUIRED`, the response is ignored and local state shows the change as saved. These writers are **outside the 22-writer inventory**. The route uses `requireSuperAdminUser` and is outside the 73-route platform-tier matrix (no capability guard, no step-up). | Route `saveRlConfig` through `performSuperAdminWrite` + `freshIdempotencyHeaders`. **Owner decision:** whether rate-limit config becomes a platform-tier write capability with step-up. |
| D-14B-5 | High (usability) | [CompanyContext.tsx:85-97](../../components/CompanyContext.tsx), `hooks/useIntelControl.tsx:1052` | `normalizeCompanyRole` silently downgrades `SUPER_ADMIN` to `COMPANY_ADMIN` under a Supabase session. `/admin/intelligence-control` therefore shows "Loading intelligence control…" forever for a canonical SUPER_ADMIN (observed for 45 s; the server reports the role `SUPER_ADMIN`). A locally signed legacy bridge cookie without a Supabase session redirects to `/login`. W11–W14 have no working UI path. | **Owner decision.** Gate the page on server-side platform authority, as `/super-admin/consumption` does via `/api/admin/check-super-admin`, instead of the client role. |
| D-14B-6 | Unknown (production-dependent) | [pages/api/admin/blog/index.ts:64-88](../../pages/api/admin/blog/index.ts) (since `0465edcc`, on main) | Blog create always inserts `primary_keyword` and `secondary_keywords`. No migration and no `baseline.sql` (the production schema-only dump) defines them, and the cert DB returns 500. Either production lacks them too (blog create broken) or they were added outside the migration set. | **Authorized read-only production inspection** of `public_blogs` columns. Then either add a migration (owner) or drop the fields from the insert. |
| O-1 | Low | publish processor / BullMQ | A definite rejection is retried up to the attempt limit. `queue_jobs.attempts` stays 0 and `next_retry_at` goes stale. With no `retry_state`, exhaustion is invisible. | Map `retryable:false` / `delivery:not_sent` to a non-retried failure. Apply `20261202000000`. |

## 8. Real-browser checks — the 22 UI writers

**Inventory scope.**
- The authoritative source is the Closure-014 implementation inventory: 19 numbered call sites, all now using `performSuperAdminWrite`.
- No derivation of "22" was recorded. It is reproduced exactly by splitting row 15 into POST and DELETE, and counting the cron `<select>` (saves on change) and the Auto Optimize confirm as separate entry points. That is the scope used here.
- The rate-limit writers in D-14B-4 are additional, outside the 22.

**Method:**
- Playwright Chromium with a CDP virtual authenticator, which performs real WebAuthn ceremonies.
- The real rendered page and the real control (button, select, confirm or prompt). No `/api` route was mocked.
- Before each measured press, the user's step-up session was expired. Each writer therefore had to show the full flow: write → 401 `STEP_UP_REQUIRED` → passkey ceremony → `step-up/verify` → device trust → exactly **one** retry.
- **PASS** requires that flow and the expected business result in the cert DB or dedicated Redis.
- The product's first-run "Welcome" tour was dismissed with **Skip tour**.

**Identity and observed audit behaviour:**
- Identity: synthetic `val-super-1@c14bval.invalid`, active exact `SUPER_ADMIN`, passkey enrolled in the browser.
- Trust answered 409 `ALREADY_TRUSTED`, because the same browser fingerprint was already trusted.
- Each pass recorded, in `capability_audit_log`:
  - `step_up_required` (`NO_STEP_UP_SESSION`);
  - `phishing_resistant_required`;
  - then `allowed` and `elevated_route_accessed` with `stepup_factor = webauthn` and `device_trusted = true`.

| # | Component (file:line) | Action → request | Capability | Requests observed | Business result | External integration | Verdict |
|---|---|---|---|---|---|---|---|
| W1 | `pages/admin/blog/new.tsx:239` | Create post → POST `/api/admin/blog` | blog.publish.manage | 401 → step-up 201 → **500** | insert failed: `primary_keyword` column absent (D-14B-6); UI shows "Server error: …"; 0 rows | none | **FAIL** (authorization flow correct; write fails on the cert schema) |
| W2 | `pages/admin/blog/edit/[id].tsx:139` | Save changes → PATCH `/api/admin/blog/:id` | blog.publish.manage | 401 → 201 → 200 | excerpt updated, still draft | none | PASS |
| W3 | `pages/admin/blog/index.tsx:58` | Delete (confirm) → DELETE `/api/admin/blog/:id` | blog.publish.manage | 401 → 201 → 204 | row removed | none | PASS |
| W4 | `hooks/useBlogIntel.tsx:478` | Create series → POST `/api/admin/blog/series` | blog.publish.manage | 401 → 201 → 201 | series row | none | PASS |
| W5 | `hooks/useBlogIntel.tsx:499` | Delete series (confirm) → DELETE `…/series/:id` | blog.publish.manage | 401 → 201 → 204 | removed | none | PASS |
| W6 | `hooks/useBlogIntel.tsx:513` | Edit modal Save → PATCH `…/series/:id` | blog.publish.manage | 401 → 201 → 200 | description updated | none | PASS |
| W7 | `hooks/useBlogIntel.tsx:554` | Create connection → POST `/api/admin/blog/relationships` | blog.publish.manage | 401 → 201 → 201 | 1 relationship row | none | PASS |
| W8 | `hooks/useBlogIntel.tsx:573` | Row delete → DELETE `…/relationships?id=` | blog.publish.manage | 401 → 201 → 204 | removed | none | PASS |
| W9 | `components/super-admin/RedisEfficiencyPanelMain.tsx:589` | Queue override Save → POST `/api/admin/queue-config` | cron.config.manage | — | the control is not rendered: "No queue metrics available. Queue workers must be running." | none | **BLOCKED** (needs live queue metrics; viewer denial proven) |
| W9b | `RedisEfficiencyPanelMain.tsx:615-653` | Auto Optimize → Apply Optimizations | cron.config.manage (+ rate-limit-config) | only proposal locally was rate-limit: **400 `IDEMPOTENCY_KEY_REQUIRED`**, no step-up, no error shown | nothing saved, dialog closed as if successful | none | **FAIL** (D-14B-4; the wrapped cron/queue steps were not reached) |
| W10a | `RedisEfficiencyPanelMain.tsx:601` (CronTab toggle) | toggle → POST `/api/admin/cron-config` | cron.config.manage | 401 → 201 → 200 | `governanceAudit.enabled=false` in Redis DB 3 | none | PASS |
| W10b | `RedisEfficiencyPanelMain.tsx:601` (interval select) | select 2× → POST `/api/admin/cron-config` | cron.config.manage | 401 → 201 → 200 | multiplier 2 stored | none | PASS |
| W11 | `components/IntelControlViewPanels.tsx:198` | Save → PUT `…/scheduler-config` | intelligence.override.manage | — | page never renders (D-14B-5) | none | **BLOCKED** |
| W12 | `IntelControlViewPanels.tsx:400` | Save Override → POST `…/scheduler-overrides` | intelligence.override.manage | — | same | none | **BLOCKED** |
| W13 | `IntelControlViewPanels.tsx:421` | Remove Override → DELETE `…/scheduler-overrides` | intelligence.override.manage | — | same | none | **BLOCKED** |
| W14 | `components/IntelControlViewMain.tsx:44` | Apply Boost → POST `…/scheduler-boost` | intelligence.override.manage | — | same | none | **BLOCKED** |
| W15a | `components/admin/knowledgeGraphCuration.tsx:129` | Confirm → POST `…/knowledge-graph/canonical-topic` | intelligence.override.manage | 401 → 201 → 200 | A became an alias of B | none | PASS |
| W15b | `knowledgeGraphCuration.tsx:129` | Reverse → DELETE `…/canonical-topic` | intelligence.override.manage | 401 → 201 → 200 | alias cleared | none | PASS |
| W16 | `knowledgeGraphCuration.tsx:171` | Generate embedding → POST `…/embed-topic` | intelligence.override.manage | 401 → 201 → **503** `disabled` | UI shows "Embedding generation is currently disabled."; no vector stored | OpenAI, if enabled: flag **unset**, so no provider call (egress guard as backstop) | **PARTIAL** (authorization path only) |
| W17 | `knowledgeGraphCuration.tsx:241` | Create topic → POST `…/knowledge-graph/topic` | intelligence.override.manage | 401 → 201 → 201 | "Created: …" | none | PASS |
| W18 | `knowledgeGraphCuration.tsx:269` | Rename (`window.prompt`) → PATCH `…/topic` | intelligence.override.manage | 401 → 201 → 200 | label renamed | none | PASS |
| W19 | `pages/super-admin.tsx:316` | Engagement → Enable Auto-Rules → Confirm → POST `/api/super-admin/community-ai-policy` | intelligence.override.manage | 401 → 201 → 200 | cert DB policy `auto_rules_enabled=false`; alert "Community-AI platform policy updated." | none | PASS |

**Negative control: all 20 writer route-methods** (covering all 22 entry points):
- Caller: a synthetic `VIEW_ONLY` tenant user holding direct grants of `blog.publish.manage`, `cron.config.manage`, `intelligence.override.manage` and `publish.recovery.manage`, with a **real** passkey step-up (201) and trusted device (201). Each route was called from the app origin with an Idempotency-Key.
- Result: **20/20 → 403 `PLATFORM_SUPER_ADMIN_REQUIRED`**.
- Zero changes to blogs, series, relationships, topics, policy or idempotency rows; Redis config unchanged.
- 20 `elevated_route_denied` audit rows.

**Cancel path.** "Never success after a cancel" is not re-run here. It was proven in a real browser at Closure-012 (A3) for the shared step-up classifier, and by unit tests for this helper.

## 9. Release-prerequisite checklist

Each item is classified as follows:
1. Verified by local evidence (this run).
2. Previously reported, not independently re-verified.
3. Requires authorized production inspection.
4. Blocked by missing evidence.

| Prerequisite | Evidence | Class |
|---|---|---|
| `20261202000000_queue_jobs_retry_state` | **Runtime-optional (1):** the cert DB lacks the column, and C4 and B9 ran cleanly through every writer. **Consequence (1, O-1):** without it, exhaustion is invisible. Production applied state: reported UNAPPLIED earlier (2), needs inspection (3). | 1 + 2 + 3 |
| Live-row unique index `uidx_queue_jobs_live_job_per_post` (20261009000000) | present in the cert DB; held one live row under the 20- and 60-way B9 bursts (1). Production presence: **3**. | 1 + 3 |
| `replace_thread_children` RPC (20260806/09) | present in the cert DB (1). Production: **3**. | 1 + 3 |
| Queue-lock 20260657 must not be applied | signature mismatch **verified against Postgres 17.6** (42883) (1); session-lock-over-pool concern from code (2); fallback path ran (1). Production: confirm the function is absent (**3**). | 1 + 2 + 3 |
| `REDIS_URL` DB path and the two `parseRedisUrl` | both runtime parsers (standalone, BullMQ) and the intelligence queue delegate to `parseRedisConnectionUrl` (1). The app honoured `/3` live (1). Dev-only parsers remain in `scripts/start-all.js` and `scripts/setup-helpers/check-redis.js` (1). **Production URL must have no path or `/0`** (Upstash DB 0 only): **3**. | 1 + 3 |
| `USE_MOCK_PLATFORMS` | still unguarded in every adapter; no `NODE_ENV`/cert check (1). Production value unknown: **3** (owner: fence after confirming it is unset). | 1 + 3 |
| Rollback compatibility | old revision `5604b50b` knows none of the new markers; three code-confirmed republish/takeover hazards (1, §6). Live mixed-version run: **4**. Rows with `PUBLISH_CLAIMED:%`, `PUBLISH_CALL_STARTED`, `PUBLISH_OUTCOME_UNCERTAIN`, `THREAD_RESCHEDULING:%`, `PUBLISH_NOT_ATTEMPTED` or `PUBLISH_RECONCILED_NOT_PUBLISHED` must be reconciled **before** older code runs (operator procedure, not run). | 1 + 4 |
| Super-admin passkey enrollment and trusted device | real passkey step-up and trust work end to end on the local origin for 15 writer presses plus reconcile (1). Q3 is a necessary condition only (014A). Production readiness: each active exact SUPER_ADMIN completes a real step-up on the production origin (**3**). | 1 + 3 |
| Production grant-impact query + independent review | validator re-run against the loopback cert DB: **VALIDATION PASS**, exit 0 (1). Production run and review: **3** (not run). | 1 + 3 |
| Role-casing normalization (`super_admin` rows) | code fails closed (2, Closure-014). The data fix runs only on reviewed Q1 rows: **3**. | 2 + 3 |
| Coordinated deploy (Closures 002, 003, 004, 008) | reinforced by §6 (1); deploy web and worker at one commit together. | 1 |
| `SUPABASE_POOLER_URL` in production | it is an HTTP base URL for supabase-js, not a Postgres DSN (1). Value and target: **3**. | 1 + 3 |
| `public_blogs.primary_keyword` / `secondary_keywords` | absent from migrations, baseline and the cert DB (1). Production: **3** (D-14B-6). | 1 + 3 |
| Cert launcher real start | defect D-14B-3 (1); fix proposed. | 1 |
| Grant-governance trigger (proposed SQL) | not validated against Postgres in this run: **4** (owner decision whether to add it). | 4 |
| Email outreach recipient model, OAuth bridge branch | unchanged owner decisions from Closure-009/010 (2). | 2 |

## 10. Test, certification and gate results

| Gate | Command | Result |
|---|---|---|
| Grant-impact validator, loopback | `CERT_DB_URL=<loopback 127.0.0.1:54322> node scripts/cert/validate-grant-impact-query.cjs` | exit 0. Target `127.0.0.1`, 4 result sets, READ ONLY 25006, fixture matrix PASS, 0 synthetic rows after rollback. **VALIDATION PASS.** |
| Focused suites (17) | `npx jest <17 suites> --runInBand` (closure014a ×2, closure014 cert-fake/Redis/rate-limit/UI-helper, retry/reschedule/uncertain/retry-state suites) | exit 0; **17/17 suites, 421 passed, 0 failed, 0 skipped** |
| Backend certification | `node scripts/typecheck-certification.js` | exit 0; **PASS 259/259, 0 uncovered** |
| Migration quality | `node scripts/check-migration-quality.js` | exit 0; 70 new valid, 0 violations |
| Typecheck | `npm run typecheck` | exit 0; **3/3 projects clean** (`tsconfig.json`, `tsconfig.backend.json`, `tsconfig.scripts.json`) |
| Mutation tests | — | not re-run: no repository code changed in this task |


## 11. Remaining owner decisions and production-only checks

**Owner decisions:**
1. D-14B-1 and D-14B-2 fixes (concurrency), with real-concurrency tests.
2. D-14B-3 launcher fix (a correction to a Closure-014A committed file).
3. D-14B-4: route the rate-limit UI through the helper; decide whether rate-limit config becomes platform-tier with step-up.
4. D-14B-5: the gate for the intelligence-control page. W11–W14 are unusable until this is fixed.
5. D-14B-6: migration vs. code change, after the production schema answer.
6. `USE_MOCK_PLATFORMS` fence; grant-governance trigger; the pooler question for B9 (enable `[db.pooler]` in the cert stack, which needs a stack restart).

**Production-only checks** (authorized operator, read-only):
- The grant-impact query with an independent review.
- `REDIS_URL` path.
- `SUPABASE_POOLER_URL`.
- `USE_MOCK_PLATFORMS`.
- Applied state of `20261009000000`, `20261202000000`, `replace_thread_children` and (absent) `20260657`.
- `public_blogs` columns.
- A real passkey step-up per active SUPER_ADMIN.
- Before any rollback: a count of rows carrying the new markers.

## 12. Changed files

| File | Why |
|---|---|
| `docs/security/CLOSURE_014B_LOCAL_VALIDATION_RESULTS.md` (new, untracked) | this report |

No repository source, test, migration or Closure-014A file was modified. Harness code lives only in the session scratchpad (`c14b/`). The evidence manifest is `closure014b_evidence.sha256`, a new file next to the earlier manifests; none of them was overwritten.

**Synthetic data cleanup.** All ledgered `C14BVAL` rows were removed in one transaction. These were retained:
- the append-only ledgers (`capability_audit_log`, `super_admin_audit_logs`, `creator_audit_log`), which refuse DELETE by design;
- one inert `public.users` row that the immutable `super_admin_audit_logs` references (its GoTrue user and role are deleted).

The audit rows were exported first (404 rows) to `c14b/audit_export.json`.

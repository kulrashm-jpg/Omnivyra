# Closure-014 — consolidated security and release-readiness remediation

Branch: `integration/closure-014`, worktree `C:/tmp/closure-014`, based on `integration/closure-013-d3` @ `f0b89519`.
LOCAL ONLY. Nothing was pushed, merged or deployed. No production resource, query, migration, grant or
credential was touched.

## 0. Repository state reconciled

| Item | Verified |
|---|---|
| Candidate base | `f0b89519` → `46eb9e96` → `e04f8708` → `384ccf39`; `5604b50b` (`origin/main` as of the last local fetch) is an ancestor |
| Closure worktrees 001–013 | at their recorded heads, clean (see §9) |
| Unexplained state | the detached worktree `C:/tmp/closure-013-base` is now at `e04f8708` (earlier `46eb9e96`). This session did not move it, so another session is likely active. Left untouched. |
| Unrelated | a stale `index.lock` in the `union_before` worktree. Left untouched. |
| Local infrastructure | **Docker Desktop reports "unable to start"**, so the certification Supabase/Postgres stack is unavailable. Local Memurai (Redis 7, loopback) is available. |

## 1. Executive summary

**Fixed (with tests and mutation evidence):**
1. **Role casing (A).**
   - `capabilitiesForRole` upper-cased roles, so an active `super_admin` row received every SUPER_ADMIN capability, while every authority predicate compared exactly.
   - The capability layer now agrees with the authority layer: only an exact, active `SUPER_ADMIN` row yields SUPER_ADMIN capabilities. This fails closed.
   - Tenant roles keep their case-insensitive mapping.
2. **Privileged-write governance (B).**
   - Authorization / rate-limit refusals (401/403/429) are no longer cached as idempotent `completed` results. The same key no longer replays `STEP_UP_REQUIRED` after a passkey step-up.
   - A pure pre-authorization predicate stops unauthorized callers reserving idempotency rows on the 8 wrapped routes.
   - Validation-before-authorization is proven side-effect free for every refused principal.
3. **Step-up (C).**
   - The last three platform-tier write capabilities (`blog.publish.manage`, `cron.config.manage`, `intelligence.override.manage`) now require a passkey on a trusted device. Their GET reads are explicitly exempt, including the 60-second panel poll.
   - All 22 live UI writers go through one helper, `performSuperAdminWrite`. It performs a real ceremony, retries exactly once, never reports success after a cancel or failure, and gives actionable messages for 401/403/409/429/5xx and network errors.
   - Pre-existing UI defects fixed:
     - the cron/queue panel saves always got 400 (no `Idempotency-Key`) yet showed "saved";
     - four writers failed silently.
4. **Rate limits (D).**
   - Every platform-tier write route (73) is rate limited before authorization and any business work. The 45 that had no limit got per-route limits sized to the established conventions.
   - `sensitive` (strict in-process budget while Redis is down) is set for destructive, financial and identity writes.
   - The 429 now carries `code: RATE_LIMITED` and `Retry-After`.
5. **Grant governance (E).**
   - A pure issuance rule, `validateCapabilityGrant`.
   - A **proposed** database trigger. It is not a migration; that needs an owner decision.
   - A read-only review query for legacy grants.
6. **Redis (F).**
   - Both parsers and BullMQ's raw options dropped the DB index, and also the ACL username and the decoded password. One strict parser now preserves them; an invalid DB index fails closed and never becomes DB 0.
   - **Live re-test on a real Redis: PASS.**
   - The certification guards are now a loopback allow-list.
7. **Certification worker (G).**
   - A fake-provider seam placed before any token read or OAuth refresh, which cannot activate outside a loopback-only certification environment (it throws instead).
   - A loopback-only egress guard.
   - A publish-only cert launcher.

**Remaining (blocked or owner decisions):**
- The production grant impact is unknown until an authorized operator runs the query and a reviewer checks it.
- Every Postgres-backed local validation is BLOCKED because Docker Desktop is not running: grant-query fixtures, trigger validation, B9, C4, C7.
- The release lineage carries migration `20261202000000` (optional at runtime) and requires a coordinated web+worker deploy.

## 2. Route-by-route matrix

See §11 (generated from source): 73 platform-tier write routes; central guard on all 73; rate limit on all 73; step-up registered for every platform-tier write capability.

## 3. Role casing (WP-A)

| Code path | Before | After |
|---|---|---|
| `capabilityRegistry.capabilitiesForRole` | `role.toUpperCase()`, so `super_admin` got SUPER_ADMIN caps | SUPER_ADMIN only under its exact spelling. Tenant roles are unchanged (case-insensitive). |
| `platformCapabilities.isPlatformSuperAdminPrincipal` | exact `'SUPER_ADMIN'` + `active` | unchanged |
| `rbacService.hasActiveSuperAdminRow`, startup identity check, `invite-user` | exact `.eq('role','SUPER_ADMIN')` + `active` | unchanged |

- **Decision:** align in code, fail closed. This is backed by existing policy, because every authority predicate was already exact.
- **Consequence:** an operator whose only SUPER_ADMIN row is spelled differently loses **all** SUPER_ADMIN access, reads included. The data fix is an owner action, run only after Query 1 identifies such rows:
  ```sql
  UPDATE user_company_roles SET role = 'SUPER_ADMIN' WHERE role <> 'SUPER_ADMIN' AND upper(role) = 'SUPER_ADMIN';
  ```
  It must be run on the reviewed row ids only, inside a transaction with a before/after count. It is NOT run by this work.
- **Tests:** `closure014RoleCasingAuthority.test.ts` (32) covers:
  - `SUPER_ADMIN` and 8 casing/whitespace variants;
  - inactive, expired and invited statuses;
  - a deactivated SUPER_ADMIN with grants;
  - VIEW_ONLY and COMPANY_ADMIN direct-grant holders;
  - a bridge principal and a missing principal;
  - read-only capabilities;
  - valid passkey, no step-up, and TOTP step-up.

## 4. Operator-ready production grant-impact query

- **File:** `docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql`. It is read-only: `BEGIN … READ ONLY`, statement and lock timeouts, `ROLLBACK`, SELECT statements only.
- **Output:** identifiers only (user id, capability, source, scope, role status, account state, impact).

| Query | Purpose |
|---|---|
| Q1 | per-principal impact rows |
| Q2 | counts: affected grants, role-casing rows, exact active SUPER_ADMINs |
| Q3 | passkey readiness (exact active SUPER_ADMINs with a non-revoked passkey) |
| Q4 | legacy platform-tier grants requiring review |

**Procedure (authorized operator only):**
1. Confirm the target **by project ref `klkiseupptzbecbxwrky`**.
2. Run the unmodified file through the approved read-only path:
   ```
   psql "<approved read-only connection>" -X -v ON_ERROR_STOP=1 -f CLOSURE_014_GRANT_IMPACT_QUERY.sql > out.txt
   ```
3. Share Q2 and Q3 counts first.
4. An independent reviewer confirms the ref, the read-only transaction and the counts.
5. **Re-run Q2 immediately before release.**

**Required operator evidence:**
- affected grant counts;
- active SUPER_ADMIN counts;
- passkey-readiness counts;
- role-casing impact (`RELEASE_BLOCKER_super_admin_lockout` rows);
- reviewer sign-off.

**Local validation: BLOCKED.**
- `scripts/cert/validate-grant-impact-query.cjs` (loopback-only, fixtures in a rolled-back transaction) is ready.
- The cert Postgres did not answer because Docker Desktop reports "unable to start".
- Production impact is **not** resolved until the operator returns and the reviewer checks the results.

## 5. Redis parsing and certification isolation (WP-F)

**Defects:**
- `standaloneRedisClient.parseRedisUrl`, `bullmqClient.parseRedisUrl` + `rawConnectionOptions`, and `intelligencePollingQueue.getConnection` dropped `/N`, the ACL username, and percent-decoding of the password.
- `aiResponseCache` (ioredis URL parsing) was already correct.

**Fix:** `lib/redis/redisUrl.ts parseRedisConnectionUrl`.

| Input | Behaviour |
|---|---|
| no path or `/` | db unset, i.e. 0 (unchanged) |
| `/0`–`/15` | that DB |
| negative, out of range, non-integer, encoded, extra segments | `INVALID_DB`, fail closed |
| credentials | decoded; `default`/empty username not sent |
| TLS | `rediss://` or Upstash |
| port | 1–65535 |

- The standalone client keeps its documented localhost fallback for an unparseable URL, but **throws** on an invalid DB.
- BullMQ throws at module load (boot).

**Evidence:**
- `closure014RedisDbSelection.test.ts` (21): the parser matrix, plus the options each client constructor actually receives.
- **Live (real Redis, loopback):** the application's standalone client with `redis://127.0.0.1:6379/13` wrote to DB 13. DB 0 was not written, and its size was unchanged (200 before and after). The key was deleted and DB 13 left empty.

**Compatibility:**
- Production Upstash URLs carry no path, so their behaviour is byte-for-byte unchanged.
- Upstash supports only DB 0, so a production `REDIS_URL` with `/N≠0` would now fail at connect instead of silently using 0.
- **Operator check before release:** confirm production `REDIS_URL` has no path or `/0`. Report only that fact, not the URL.

**Certification isolation:**
- `certAwareEnv.scanCertEnv` and `assert-cert-isolation.mjs`, under `CERT_ENV=1`, require every connection target to be loopback (allow-list). This now includes `SUPABASE_POOLER_URL`, which `supabaseClient` prefers, and `CREATOR_RENDER_REDIS_URL`.
- They forbid `OMNIVYRA_ALLOW_SHARED_QUEUES` and `NODE_ENV=production`.
- The CLI guard now also has the production Upstash marker it lacked (17 tests).
- **Recommendation:** run certification against a dedicated loopback instance, e.g. `memurai.exe --port 6390 --bind 127.0.0.1 --save "" --appendonly no`, with a non-zero DB index. The cert worker plan refuses DB 0.

## 6. Integration validation status (WP-G)

| Check | Status | Evidence / prerequisite |
|---|---|---|
| D-1 Redis DB index | **PASS (live)** | §5 |
| D-2 passkey cancel | PASS (unit; real-browser PASS at Closure-012 resume) | the classifier is unchanged since `e04f8708`; the new helper's cancel path is tested (`closure014SuperAdminWrite`) |
| D-3 direct-grant denial | PASS (unit, 74 route pairs + guard) | real-browser denial was already demonstrated in Closure-012 A9 |
| Step-up / rate limit / idempotency / grant governance | PASS (unit + route harness) | §§3, 7, 8 |
| Real-browser step-up for the 22 new UI writers | **BLOCKED** | needs the cert stack (Docker) and the Closure-012 Playwright harness |
| A2 Search Console 2xx | **BLOCKED** | needs a safe non-production Google OAuth integration (owner) |
| B9 pooled connections | **BLOCKED** | needs Docker plus the pooler enabled in the cert stack config (owner) |
| C4 uncertain outcome via the real worker | **BLOCKED (tooling ready)** | needs the cert DB (Docker). Ready: `CERT_FAKE_PUBLISHER` seam, `scripts/cert/publish-worker-cert.ts` (publish consumer only, `--check` mode), loopback egress guard, dedicated-Redis requirement |
| C7 mixed old/new worker | **BLOCKED** | needs the cert DB plus a runnable old worker build on the isolated stack |

**Fake provider seam:**
- **Placement:** `publishToPlatform`, after the capability check, **before** `getSocialAccount`, `getToken` and OAuth refresh.
- **Activation:** inert unless `CERT_FAKE_PUBLISHER=1`. It throws (→ `not_sent`) if any of these fails: `CERT_ENV=1`, non-production `NODE_ENV`, no Railway/Vercel marker, no shared queues, all DB/Redis/Supabase targets loopback, no production marker.
- **Outcomes** by content tag: published / not_created / ambiguous ×3.
- **Tests** (30): with the fake active, no token read, refresh or real adapter is reached; egress to RFC 5737 TEST-NET is refused synchronously.

**Separate finding (owner):** `USE_MOCK_PLATFORMS` is an **unguarded** production switch. It also fires *after* the token read and OAuth refresh, and is missing in the Instagram/Facebook adapters. It was not changed: fencing it could break a production boot if it happens to be set.

## 7. Privileged-write governance details (WP-B, WP-D, WP-E)

**Idempotency (8 wrapped routes):** `cron-config`, `queue-config`, `credit-cost-config/update`, `credits/grant`, `rbac`, `users` (POST/PATCH/DELETE), `users/create`, `invite-user`.
- **Order unchanged:** key → caller → (new) pure `authorize` predicate → reservation → handler with full audited check.
- **Proven:**
  - unauthorized callers reserve nothing;
  - 401/403/429 are stored `failed`, and the same caller and key re-evaluate;
  - 2xx and ordinary 4xx are still replayed;
  - another caller's key cannot be poisoned (caller-scoped rows).
- **Tests:** `closure014IdempotencyAuthorization` (10), `closure014PreAuthorization` (13).

**Validation-before-authorization:** an empty body from every refused principal on all 65 sibling pairs produced zero business reads, writes, RPCs or outbound fetch, and no `allowed`/`elevated_route_accessed` for a write capability. It is kept where the validation is pure; the messages reveal only field requirements.

**Rate limits:**
- Applied to all 45 previously unlimited routes, at the top of the handler, before any authorization, validation or DB access. Writes only, where the route also serves reads.
- **Tests:**
  - `closure014AdminRateLimit` (8): the real sliding window covering normal use, threshold, burst, a concurrent burst (exactly `limit` pass), IP and prefix isolation, `Retry-After`/`code`, and generous vs strict fallback while Redis is down;
  - the sibling suite: every pair answers 429 `RATE_LIMITED` before any authorization or business effect, and prefixes are distinct per route family.
- **Routes for which a limit might be inappropriate:** none identified. Owner may tune any prefix at runtime through `rate-limit-config`, keyed as the prefix without `rl:`.

**Grant governance:**

| Platform-tier capability class | Intended assignable principals |
|---|---|
| WRITE (15 grantable strings, `identity.admin` expands) | an active, exact `SUPER_ADMIN` only |
| READ (`super_admin.dashboard.view`, `consumption.view.aggregate`) | anyone (delegation) |

- Grantor: an active canonical SUPER_ADMIN, no self-grant. `validateCapabilityGrant` has 36 tests.
- **Proposed** trigger `docs/security/proposed/20261013_capability_assignments_platform_write_guard.sql`, with rollback. A test pins its capability list to the code.
  - **Not validated against Postgres** (Docker) and not in `supabase/migrations`, because adding it is an owner decision.
  - The database-owner bypass (`DISABLE TRIGGER`) is documented.
- **Legacy grants:** identified by Q4 and revoked only by owner decision through the established path. Write grants are already inert at runtime after `f0b89519`.
- **Capability-resolution filtering (WP-B item 9):** NOT implemented.
  - Compatibility assessment: filtering platform-tier direct grants in `resolveUserCapabilities` would also remove read delegation (dashboard view) and change audit shapes, while the central guard already blocks every write path.
  - Recommendation: keep it as a documented option for the owner.

## 8. Migration and release lineage (WP-H)

**Lineage:**
- `5604b50b..f0b89519` has 34 commits; Closure-014 adds its own.
- `b1f35512 WIP(publish) … UNTESTED`: 166 of its 176 added lines survive unchanged in HEAD and are load-bearing for the publish-safety work. Later commits added tests that exercise them, e.g. `publishRetryStateReliability`, `publishUncertainWriterGuards`, `closure012RealBullmqValidation`.
- It **cannot be excluded** without rewriting history and breaking those features. The decision is to certify the final tree, not individual commits. Excluding it would require a new owner-approved branch built without rewriting existing ones.

**Migrations in lineage:** only `20261202000000_queue_jobs_retry_state.sql` (+ rollback).
- **Runtime:** OPTIONAL. Every reader and writer detects 42703/PGRST204; it can be applied before or after the code.
- **DDL:** `ADD COLUMN IF NOT EXISTS retry_state text` + CHECK (`awaiting_retry`, `exhausted`), no backfill.
- **Rollback:** drop the constraint, then the column.

**Prerequisites to confirm in the target (read-only, operator):**
- `uidx_queue_jobs_live_job_per_post` (20261009000000). Without it, single-live-row is not race-proof; the post claim still fences.
- `replace_thread_children` RPC (20260806/09). A **hard** dependency of thread re-schedule.
- **Do NOT apply 20260657** (session advisory lock over pooled connections; BIGINT vs INT4). The code falls back to `optimistic_check`.

**Execution plan for 20261202000000 (owner/operator; not run):**
1. Read-only pre-check: `select count(*) from information_schema.columns where table_name='queue_jobs' and column_name='retry_state'`.
2. Apply in a maintenance window through the approved migration path, with a ledger row.
3. Verify the column and `queue_jobs_retry_state_check` exist.
4. Smoke: a failed publish job records `awaiting_retry`.

**Deployment sequence:**
1. Confirm the prerequisites.
2. Optionally apply 20261202000000.
3. Deploy the Railway worker (+ cron service if `CRON_SERVICE_MODE=worker-only`) and Vercel web **at the same commit, together**. Closures 002, 003, 004 and 008 are HIGH/MED risk when versions are mixed. No new evidence justifies another strategy, and C7 is blocked.
4. **Post-deploy checks:**
   - a publish smoke on a test tenant;
   - `PUBLISH_CLAIMED:`/`PUBLISH_CALL_STARTED` transitions;
   - no 5xx on `/api/super-admin/*`;
   - SUPER_ADMIN step-up works for blog/cron/intelligence writes;
   - 429s carry `Retry-After`.

**Rollback:**
- Revert web and worker together.
- **Before** running older code, reconcile rows that carry newer markers: `PUBLISH_CLAIMED:%`, `PUBLISH_CALL_STARTED`, `PUBLISH_OUTCOME_UNCERTAIN`, `THREAD_RESCHEDULING:%`, `PUBLISH_NOT_ATTEMPTED`, `PUBLISH_RECONCILED_NOT_PUBLISHED`. Older retry and claim paths can republish them; this is an operator procedure.
- The migration rollback is independent and optional.
- Closure-014's code changes need no schema rollback.

## 9. Decision register

| # | Decision | Status | Recommendation / consequence |
|---|---|---|---|
| 1 | Production grant impact + legacy role normalization | **OPEN — operator + reviewer** | run Q1–Q4; normalize any `super_admin` row before release (otherwise that operator is locked out) |
| 2 | Step-up for blog/cron/intelligence writes + UI | **DONE** (policy recipe step 4) | real-browser validation of the 22 writers pending (Docker) |
| 3 | Rate-limit policy | **DONE** (per-route, conventions) | owner may tune at runtime |
| 4 | Idempotency before authorization | **DONE** | — |
| 5 | Grant-governance DB trigger | **OWNER** | approve adding the proposed SQL to the migration set after local validation |
| 6 | Capability-resolution filtering of direct grants | **OWNER** | not recommended now (read delegation impact) |
| 7 | Redis compatibility | **DONE in code; operator check** | confirm production `REDIS_URL` has no `/N≠0` |
| 8 | `USE_MOCK_PLATFORMS` unguarded | **OWNER** | fence to non-production after confirming it is unset in production |
| 9 | OAuth bridge branch | **OWNER (unchanged)** | separate decision, not touched |
| 10 | Verified email-recipient model + schema | **OWNER (unchanged)** | requires schema authorization |
| 11 | Stranded outreach email task recovery | **OWNER (unchanged)** | operator procedure, not run |
| 12 | Passkey enrollment / operator recovery | **OPERATOR** | Q3 must show ≥ 1 (recommended ≥ 2) SUPER_ADMIN with a passkey |
| 13 | Target-env migrations / RPC prerequisites | **OPERATOR** | §8 |
| 14 | Release lineage incl. `b1f35512` | **OWNER** | certify the final tree; coordinated web+worker deploy |
| 15 | Docker Desktop failure (local) | **OWNER (environment)** | restart Docker Desktop + cert stack to unblock §6 and §4 validation |

## 10. Verification gates (final tree)

| Gate | Result |
|---|---|
| Typecheck (`npm run typecheck`) | 3/3 projects clean (first run found 20 frontend narrowing errors in the UI adoption, fixed in the helper's type) |
| Backend certification | PASS, 259/259, 0 uncovered (first run: +2 in a new test — fixed) |
| Migration check | OK; no migration added (the proposed trigger is outside `supabase/migrations`) |
| Gate regression: 124-suite set + all authorization/step-up suites + every Closure-014 suite = 167 | 167/167; 4296 passed, 0 failed, 2 skipped. Against `f0b89519` (3907): 0 new failures. 2 renamed/re-specified tests: `embedTopicRouteB78C4` import allow-list now includes the rate limiter; `stepUpRetryIdempotency` asserts the new contract (a reused denied key is re-evaluated, still mutates exactly once) |
| Whole-repo `jest` (1987 suites) | 29 suites / 106 tests fail — the IDENTICAL failing set as `f0b89519` (0 new, 0 fixed). A first run showed 10 new failing suites; 9 were suites that drive routes which now rate-limit (fixed by stubbing the limiter in authorization-focused suites — the established pattern — or by updating a source-proof import allow-list) plus the step-up retry contract test; 1 (`refreshScheduledPostMedia`) passed in isolation and in the rerun (order-dependent flake) |
| Mutation | 17/17 killed (A1 casing; B1–B3 idempotency/pre-auth; C1–C3 step-up policy, GET exemption, Retry-After in UI; D1–D3 sensitive, Retry-After, a route losing its limit; F1–F3 DB index in parser/BullMQ, cert loopback; G1–G3 fake under production, seam bypass, egress guard; E1 grant policy) |
| Static route-policy check | 73/73 platform-tier write routes centrally guarded and rate limited (generated matrix, §11); completeness test fails on any new unguarded route |
| Live Redis (D-1) | PASS (§5) |
| Postgres-backed local validation | BLOCKED — Docker Desktop "unable to start" |


## 11. Route matrix (generated from source)

| Route | Write methods | Platform-tier capability | Central guard | Route-level authority | Step-up (all registered: passkey + trusted device, 10 min) | Rate limit (prefix, limit, S=sensitive) | Idempotency |
|---|---|---|---|---|---|---|---|
| `admin/access-requests/approve` | POST | identity.admin.assign | yes | — | required | rl:admin:access-requests:approve 20/60s S | — |
| `admin/access-requests/delete` | DELETE | identity.admin.delete | yes | — | required | rl:admin:access-requests:delete 10/60s S | — |
| `admin/access-requests/reject` | POST | identity.admin.revoke | yes | — | required | rl:admin:access-requests:reject 20/60s S | — |
| `admin/billing/allocate` | POST | billing.platform.manage | yes | — | required | rl:admin:billing:allocate 10/60s S | — |
| `admin/billing/reconcile` | POST | billing.platform.manage | yes | — | required | rl:admin:billing:reconcile 5/60s S | — |
| `admin/blog/[id]` | DELETE PATCH | blog.publish.manage | yes | — | required | rl:admin:blog:delete 10/60s S; rl:admin:blog:write 30/60s | — |
| `admin/blog/index` | POST | blog.publish.manage | yes | — | required | rl:admin:blog:create 30/60s | — |
| `admin/blog/relationships` | POST DELETE | blog.publish.manage | yes | — | required | rl:admin:blog:relationships 30/60s | — |
| `admin/blog/series/[id]` | DELETE PATCH | blog.publish.manage | yes | — | required | rl:admin:blog:series:delete 10/60s S; rl:admin:blog:series:write 30/60s | — |
| `admin/blog/series/index` | POST | blog.publish.manage | yes | — | required | rl:admin:blog:series:create 30/60s | — |
| `admin/bootstrap-super-admin` | POST | identity.admin.assign | yes | — | required | rl:admin:bootstrap-super-admin 5/60s S | — |
| `admin/config/[type]` | POST | intelligence.override.manage | yes | — | required (GET exempt) | rl:admin:config:write 20/60s | — |
| `admin/cron-config` | POST | cron.config.manage | yes | — | required (GET exempt) | rl:admin:cron-config 20/60s | pre-auth |
| `admin/experiment/toggle` | POST | intelligence.override.manage | yes | — | required | rl:admin:experiment-toggle 10/60s | — |
| `admin/intelligence/scheduler-boost` | POST | intelligence.override.manage | yes | — | required | rl:admin:intel:scheduler-boost 20/60s | — |
| `admin/intelligence/scheduler-config` | PUT | intelligence.override.manage | yes | — | required | rl:admin:intel:scheduler-config 20/60s | — |
| `admin/intelligence/scheduler-overrides` | POST DELETE | intelligence.override.manage | yes | — | required | rl:admin:intel:scheduler-overrides 20/60s | — |
| `admin/intelligence/throttle-status` | PUT | intelligence.override.manage | yes | — | required | rl:admin:intel:throttle 10/60s | — |
| `admin/invite-user` | POST | identity.admin.assign | yes | — | required | rl:admin:invite-user 20/60s | pre-auth |
| `admin/knowledge-graph/canonical-topic` | POST DELETE | intelligence.override.manage | yes | — | required | rl:admin:kg:canonical-topic 30/60s | — |
| `admin/knowledge-graph/embed-topic` | POST | intelligence.override.manage | yes | — | required | rl:admin:kg:embed-topic 10/60s | — |
| `admin/knowledge-graph/topic` | POST PATCH | intelligence.override.manage | yes | — | required | rl:admin:kg:topic 30/60s | — |
| `admin/queue-config` | POST | cron.config.manage | yes | — | required (GET exempt) | rl:admin:queue-config 20/60s | pre-auth |
| `admin/revoke-super-admin` | POST | identity.admin.revoke | yes | — | required | rl:admin:revoke-super-admin 5/60s S | — |
| `provider-accounts/[id]` | DELETE PUT | integration.platform.oauth.manage | yes | yes | required | rl:provider-accounts:delete 10/60s S; rl:provider-accounts:update 20/60s S | — |
| `provider-accounts/index` | POST | integration.platform.oauth.manage | yes | yes | required | rl:provider-accounts:create 20/60s S | — |
| `super-admin/analytics-provider-config` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-provider-config 10/60s S | — |
| `super-admin/billing-catalog/index` | POST PATCH | billing.platform.manage | yes | — | required | rl:super-admin:billing-catalog 20/60s S | — |
| `super-admin/community-ai-policy` | POST | intelligence.override.manage | yes | — | required | rl:super-admin:community-ai-policy 10/60s S | — |
| `super-admin/companies` | DELETE POST PATCH | identity.admin.assign, organization.delete | yes | — | required | rl:super-admin:companies 20/60s | — |
| `super-admin/companies/archive-abandoned` | POST | organization.delete | yes | — | required | rl:super-admin:companies:archive-abandoned 5/60s S | — |
| `super-admin/companies/promote-admin` | POST | identity.admin.assign | yes | — | required | rl:super-admin:companies:promote-admin 10/60s S | — |
| `super-admin/companies/transfer-ownership` | POST | identity.admin.assign | yes | — | required | rl:super-admin:companies:transfer-ownership 10/60s S | — |
| `super-admin/credit-cost-config/update` | POST | billing.platform.manage | yes | — | required | rl:super-admin:credit-cost-config 20/60s | pre-auth |
| `super-admin/credits/grant` | POST | billing.grant_free_credits | yes | — | required | rl:super-admin:credits-grant 20/60s | pre-auth |
| `super-admin/curated-industry-sources` | POST PATCH DELETE | integration.platform.oauth.manage | yes | yes | required (GET exempt) | rl:super-admin:curated-industry-sources 30/60s | — |
| `super-admin/free-credits/grant` | POST | billing.grant_free_credits | yes | — | required | rl:super-admin:free-credits:grant 20/60s S | — |
| `super-admin/free-credits/requests` | POST | billing.grant_free_credits | yes | — | required | rl:super-admin:free-credits:requests 30/60s | — |
| `super-admin/free-credits/revoke` | POST | billing.grant_free_credits | yes | — | required | rl:super-admin:free-credits:revoke 10/60s S | — |
| `super-admin/ga-connect` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/ga-select-property` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/ga-sync` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/gsc-connect` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/gsc-select-property` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/gsc-sync` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/invitations/[invitationId]/resend` | POST | identity.admin.assign | yes | — | required | rl:super-admin:invite:resend 30/60s | — |
| `super-admin/linkedin-media-smoke-test` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:linkedin-smoke 10/60s | — |
| `super-admin/monetization/operations` | POST | billing.platform.manage | yes | — | required | rl:super-admin:monetization-ops 20/60s S | — |
| `super-admin/outreach/activate` | POST | outreach.platform.manage | yes | yes | required | rl:super-admin:outreach-activate 30/60s | — |
| `super-admin/outreach/approve` | POST | outreach.platform.manage | yes | yes | required | rl:super-admin:outreach-approve 60/60s | — |
| `super-admin/payment-providers/index` | PATCH | billing.platform.manage | yes | — | required | rl:super-admin:payment-providers 10/60s S | — |
| `super-admin/plans/assign` | POST | billing.plan.manage | yes | — | required | rl:super-admin:plans:assign 20/60s S | — |
| `super-admin/plans/create` | POST | billing.plan.manage | yes | — | required | rl:super-admin:plans:create 10/60s S | — |
| `super-admin/plans/override` | POST | billing.plan.manage | yes | — | required | rl:super-admin:plans:override 10/60s S | — |
| `super-admin/plans/toggle` | POST | billing.plan.manage | yes | — | required | rl:super-admin:plans:toggle 20/60s S | — |
| `super-admin/platform-oauth-configs` | POST DELETE | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:platform-oauth-configs 20/60s S | — |
| `super-admin/pricing/index` | POST | billing.plan.manage | yes | — | required | rl:super-admin:pricing 20/60s S | — |
| `super-admin/publish/reconcile` | POST | publish.recovery.manage | yes | yes | required | rl:super-admin:publish:reconcile 20/60s | — |
| `super-admin/purchases/complete` | POST | billing.platform.manage | yes | — | required | rl:super-admin:purchases:complete 10/60s S | — |
| `super-admin/razorpay/create-staging-order` | POST | billing.platform.manage | yes | — | required | rl:super-admin:razorpay:create-staging-order 10/60s S | — |
| `super-admin/razorpay/verify-staging-payment` | POST | billing.platform.manage | yes | — | required | rl:super-admin:razorpay:verify-staging-payment 20/60s S | — |
| `super-admin/rbac` | POST | identity.admin | yes | — | required | rl:super-admin:rbac 20/60s | pre-auth |
| `super-admin/rollout-control` | POST | platform.controls.manage | yes | yes | required | rl:super-admin:rollout-control 30/60s | — |
| `super-admin/serp-acquisition` | POST | integration.platform.oauth.manage | yes | yes | required | rl:super-admin:analytics-write:${operation} 10/60s | — |
| `super-admin/threads/[threadId]/reconcile` | POST | publish.recovery.manage | yes | yes | required | rl:super-admin:threads:reconcile 30/60s | — |
| `super-admin/threads/[threadId]/resume` | POST | publish.recovery.manage | yes | yes | required | rl:super-admin:threads:resume 20/60s | — |
| `super-admin/usage/grant-access` | POST | billing.grant_free_credits | yes | — | required | rl:super-admin:usage:grant-access 20/60s S | — |
| `super-admin/usage/revoke-access` | POST DELETE | billing.grant_free_credits | yes | — | required | rl:super-admin:usage:revoke-access 20/60s S | — |
| `super-admin/users` | POST PATCH DELETE | identity.admin.assign, identity.admin.delete | yes | — | required | rl:super-admin:users 30/60s | pre-auth |
| `super-admin/users/[id]/force-logout` | POST | identity.admin.assign | yes | — | required | rl:super-admin:users:force-logout 30/60s | — |
| `super-admin/users/[id]/resume` | POST | identity.admin.assign | yes | — | required | rl:super-admin:users:resume 20/60s | — |
| `super-admin/users/[id]/suspend` | POST | identity.admin.assign | yes | — | required | rl:super-admin:users:suspend 20/60s | — |
| `super-admin/users/create` | POST | identity.admin.assign | yes | — | required | rl:super-admin:users:create 10/60s | pre-auth |

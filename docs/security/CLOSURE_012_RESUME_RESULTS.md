# Closure-012 resume — integration validation results

Non-production validation only. Run date: 2026-10-12.

Target: the local certification Supabase stack (`cert-supabase`: Kong `:54321`, Postgres `:54322`) and the app in
`--app-only` mode. Base: `integration/closure-012` @ `384ccf39`; that branch is unchanged. The fix below is on
`integration/closure-012-resume`.

## 1. Environment isolation

| Check | Result |
|---|---|
| `omnivyra-worker` / `omnivyra-redis` containers | absent |
| Containers running | only `*_cert-supabase`, all on `supabase_network_cert-supabase` |
| Production markers in container environments | 0 |
| App env file | `.env.cert`, generated from `.env.cert.example` plus `supabase status` (gitignored) |
| App endpoints | Supabase, Postgres and Redis URLs are all loopback; no production marker; no `.env.local` in the worktree |
| App mode | `scripts/start-all.js --app-only`: `ENABLE_AUTO_WORKERS=0`, no Docker calls, no BullMQ consumers, no cron |
| WebAuthn | `WEBAUTHN_RP_ID=localhost`, origin `http://localhost:3000` |
| Identities | synthetic only (`@c12val.invalid`) |
| Real operator accounts | none used |
| Real providers | none contacted |

**Isolation gap found (defect D-1).** `REDIS_URL=redis://127.0.0.1:6379/14` was meant to confine the app to Redis DB 14.
Both `parseRedisUrl` functions drop the database index:
- `backend/queue/standaloneRedisClient.ts:22`
- `backend/queue/bullmqClient.ts:109`

The app therefore wrote to **DB 0** of the local Memurai instance. This is still loopback only and not production.

The run was contained as follows:
- DB 0 key names were snapshotted (205 keys) before any further writes.
- The app's queue prefix resolves to `omnivyra:local:` (`non-production-isolated`), not the shared `bull` prefix.
- No consumer was running.
- Cleanup removed exactly the keys the run created; DB 0 is back to its pre-run set of 204 keys.

**Vector.** `supabase_vector_cert-supabase` restarts with "network unreachable". Vector is the stack's log shipper and sits
on no request path used here: Kong, GoTrue, PostgREST and Postgres all served every check. Its impact is limited to
container-log aggregation. Per the instructions, it was not restarted.

## 2. Section A — authentication and UI step-up

All ceremonies ran in headless Chromium with a CDP virtual authenticator (CTAP2, internal, resident key, UV) against the
real routes. No ceremony was mocked.

| # | Result | Evidence |
|---|---|---|
| A1 | PASS | `begin-registration` → `startRegistration` → `verify-registration` 201 for every synthetic operator; `webauthn_credentials` rows; audit `passkey_registered` |
| A2 | PASS (authorization path) / BLOCKED (2xx) | `POST /api/super-admin/gsc-sync`: 401 `STEP_UP_REQUIRED` → passkey step-up 201 → ONE retry; exactly 2 POSTs; audit `elevated_route_accessed` (`analytics.gsc.sync`). The retry then returned 404 `OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND`. The 2xx and the UI button both require a connected Search Console property, which needs Google OAuth (not authorized). The identical UI helper flow is proven in A11. |
| A3 | FAIL → fixed → PASS | Cancel (authenticator removed) in the rollout console: 1 POST, no write. Before the fix the UI said "Step-up is not available… Enroll a passkey" (defect D-2). After the fix: "Step-up was cancelled. Try again to confirm with a passkey.", 1 rollout POST, 0 step-up verifies, Redis unchanged. |
| A4 | PASS (behavior) / evidence deviation | Expired step-up → prompt again → 2xx, 2 POSTs. The audit reason is `NO_STEP_UP_SESSION`, not `STEP_UP_EXPIRED` (finding F-2). |
| A5 | PASS | Device revoked (200) → retry → prompt → trust → 2xx. `trusted_devices.id` is unchanged (`ed3607ef…`) and active again. |
| A6 | PASS | `Accept-Language: fr-FR` → 401 `TRUSTED_DEVICE_REQUIRED` → prompt → new trust → 2xx; 2 rows with 2 distinct fingerprints |
| A7 | PASS | TOTP-only SUPER_ADMIN: TOTP enrolled, MFA login, TOTP step-up 201 (`factor=totp`); rollout-control 401 `STEP_UP_REQUIRED`; audit `step-up: FACTOR_INSUFFICIENT`; Redis unchanged |
| A8 | PASS | Inactive SUPER_ADMIN with a valid passkey step-up and trusted device: 403 `CAPABILITY_NOT_HELD`; audit `elevated_route_denied`; no write |
| A9 | **FAIL** (2 routes) | VIEW_ONLY tenant user holding direct grants of all four write capabilities, with passkey step-up and trust. 20 of 23 route/method pairs refused with 403 `PLATFORM_SUPER_ADMIN_REQUIRED`; `publish/reconcile` was confirmed with a well-formed body. However, `POST`/`DELETE /api/super-admin/platform-oauth-configs` and `POST /api/super-admin/analytics-provider-config` **passed authorization**: audit `allowed` + `elevated_route_accessed`, and the 400s are post-authorization validation (defect D-3). Row diff: 0 in `queue_jobs`, `scheduled_posts`, `outreach_tasks`, the DLQ, idempotency keys and capability assignments; rollout unchanged. |
| A10 | PASS | Validly signed bridge cookie (fresh `issuedAt`, local secret) and nothing else: rollout-control 401 `NOT_AUTHENTICATED`, gsc-sync 401, Google callback 307 `error=unauthorized` (no principal) |
| A11 | PASS | Rollout console through the real `submitSuperAdminWrite`: 401 → passkey → `stepup_sessions` row (600 s) → `trusted_devices` row → ONE retry → 200; exactly 2 rollout POSTs; flag state changed once; `super_admin_audit_logs` `rollout.override.kill` names the operator |

## 3. Section B — database and concurrency (real Postgres + PostgREST)

Fixtures were synthetic: an inactive LinkedIn account with a placeholder token, and C12VAL-marked posts. No worker was running.

| # | Result | Evidence |
|---|---|---|
| B1 | PASS | 409 `POST_ALREADY_PUBLISHED`; row byte-identical; no queue row |
| B2 | PASS | 20 parallel retries: 1 × 200 `enqueued` and 19 × 409 `NOT_RETRYABLE`; exactly one live `queue_jobs` row |
| B3 | PASS | The retry's reset blocked on a held row lock (observed in `pg_stat_activity`). The claim `PUBLISH_CLAIMED:<token>` and `publishing` landed, and the retry got 409 `NOT_RETRYABLE`; the claim is intact and no queue row was created. |
| B4 | PASS | With `metadata.platform_call`: the row stays `processing`, no second job, retry answered `duplicate`. Without it: `cancelled` and replaced by one `pending`. |
| B5 | PASS | `uidx_queue_jobs_live_job_per_post` is present; two concurrent inserts gave `inserted` and `23505`; one live row |
| B6 | PASS | Two concurrent activity-workspace reschedules to different times: 200 and 409 `SCHEDULED_POST_CHANGED_CONCURRENTLY`. The post, the plan and the single live job all carry the winner's time; the old job is `cancelled`. |
| B7 | PASS | anon and tenant-B JWTs read 0 rows from `scheduled_posts`, `queue_jobs` and `outreach_tasks`; PATCH affects 0 rows; INSERT into `queue_jobs` is refused (42501); content unchanged. The policies grant `service_role` only. |
| B8 | PASS | Two concurrent `devices/trust` on an expired row: one 201, one 409 `ALREADY_TRUSTED`; one row with the same id, revived |
| B9 | BLOCKED | The local stack has no PgBouncer/Supavisor container, and these routes reach Postgres through PostgREST. Prerequisite: a cert stack with the pooler enabled (a `config.toml` change and stack restart, needing authorization). |

## 4. Section C — remaining checks

C1–C3, C5, C6, C8 and C9 passed earlier on real BullMQ (`384ccf39`, 11/11).

| # | Result | Missing prerequisites |
|---|---|---|
| C4 | BLOCKED | 1. A publish-only worker launcher: the existing launchers start every consumer, including OAuth refresh and intelligence polling, which call external providers. 2. A fake publishing-provider seam in the worker: none exists, and adding one changes the production publish path. 3. Redis DB isolation (D-1) or a dedicated Redis instance. |
| C7 | BLOCKED | Everything C4 needs, plus a runnable old worker build on the isolated stack |

## 5. Defects and findings

| ID | Severity | Status | Description |
|---|---|---|---|
| D-1 | Medium (environment isolation) | **Open — owner decision** | `REDIS_URL` database index is ignored by both `parseRedisUrl` functions. Any process expecting `/N` isolation uses DB 0. Not fixed: fixing it would change behavior for every deployment whose `REDIS_URL` carries a path. |
| D-2 | Low (UX) | **Fixed** | `lib/security/superAdminStepUp.ts` classified cancellation only by message substring. A real browser cancel (`name === 'NotAllowedError'`, message without the name) was reported as "not available… Enroll a passkey". It is now also classified by `err.name`. |
| D-3 | Medium (authorization) | **Open — owner decision** | `platform-oauth-configs` (POST/DELETE) and `analytics-provider-config` (POST) gate on `INTEGRATION_PLATFORM_OAUTH_MANAGE` + step-up only, with no `requirePlatformWriteAuthority`. A non-platform user holding a direct grant passes. By static reading, the same applies to `provider-accounts` (POST/PUT/DELETE), `curated-industry-sources` (POST/PATCH/DELETE) and `linkedin-media-smoke-test` (POST). These were not probed, because the smoke test can reach a real provider. Not fixed: the owner has deferred privileged-write authorization decisions to a separate review. |
| F-1 | Info | — | The operations-center snapshot reads the rollout override synchronously from a per-process 30 s cache, so the console showed `canonical-grounding` unkilled while Redis had `killed:true`. |
| F-2 | Info | — | `STEP_UP_EXPIRED` (`StepUpAuthorizationService.ts:45`) is unreachable: `IdentityResolver.fetchStepUpState` already reports an expired session as inactive, so the audit says `NO_STEP_UP_SESSION`. The validation doc's A4 evidence expectation should be corrected, or the resolver should surface expiry. |
| F-3 | Info | — | Passkey `verify-authentication` with a Supabase session present runs in step-up mode and mints no `auth_sessions` row (documented). An operator who has only a Supabase session gets 409 `NO_AUTH_SESSION` from UI step-up until they sign in through the MFA/passkey flow. |
| F-4 | Info | — | The trusted-device fingerprint (UA + language + cookie names) matched across separate headless browser contexts (A2 trust returned `ALREADY_TRUSTED`), which complements A6. |

## 6. Cleanup

**Deleted:**
- all 7 GoTrue identities;
- 5 of 7 `public.users` mirrors;
- 3 companies;
- 7 `user_company_roles` and 5 `capability_assignments`;
- passkeys, TOTP factor and its Vault secret, and recovery codes;
- sessions, step-up sessions and trusted devices;
- 8 posts, 7 queue jobs, 1 plan, 1 campaign and 1 social account;
- 1 free-credit claim and 1 organization-credit row.

**Retained, because append-only triggers refuse DELETE by design (not bypassed):**
- 208 `capability_audit_log` rows;
- 5 `super_admin_audit_logs` rows, plus the 2 inert `public.users` mirrors they reference (super1 and super2, with no GoTrue identity, role or capability);
- 1 `creator_audit_log` row;
- 1 `credit_transactions` row: 300 credits granted to "C12VAL platform" by `sync-supabase-user` during A7.

**Redis:**
- DB 0 is back to its pre-run 204 keys: the 8 `omnivyra:local::publish*` keys and the rollout override were removed.
- DBs 14 and 15 are empty.

**App:** stopped; nothing listens on `:3000`.

## 7. Regression for the D-2 fix

| Gate | Result |
|---|---|
| Focused: `superAdminWriteStepUp`, `analyticsStepUpWiring`, `stepUpRetryIdempotency`, `providerCredentialStepUp` | 4/4 suites, 46/46 tests |
| Mutant (name check removed) | KILLED by both new tests (2 failed), file restored by hash |
| Real browser A3 re-run | PASS ("Step-up was cancelled…", 1 POST, no write) |
| Gate regression (124-suite set, compared to `384ccf39`) | 124/124 suites; 2575 passed, 0 failed, 2 skipped; 0 new failures; 0 missing tests (+2 new) |
| `node scripts/typecheck-certification.js` | PASS, 259/259, 0 uncovered |
| `npm run typecheck` | 3/3 projects clean |
| Whole-repo `jest` (informational) | 29 suites / 106 tests fail — the known whole-repo baseline (CI is not a whole-repo job); none of the failing suites imports `superAdminStepUp` or `stepUpClient` |

Earlier worktrees (`closure-001` through `closure-011`) are at their recorded heads with no tracked changes. All 13 evidence
manifests verify, and `integration/closure-012` is still at `384ccf39`.

Non-production validation only; no release activity performed.

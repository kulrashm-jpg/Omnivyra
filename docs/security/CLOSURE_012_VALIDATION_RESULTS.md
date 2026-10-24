# Closure-012 — non-production validation results

Plan: `docs/security/CLOSURE_011_INTEGRATION_VALIDATION.md`. Candidate:
`integration/closure-012` (child of Closure-011 `5d1b67ef`). **Non-production
validation only; no release activity performed.**

## 1. Environment boundary (how it was established)

| Fact | How verified (read-only) |
|---|---|
| Docker engine **stopped** (`docker-desktop` WSL distro Stopped; docker API pipe absent) | `docker version` / `wsl -l -v` |
| Starting Docker would auto-start `omnivyra-worker`, a container whose env points at the **production** Supabase host (restart policy brings it up with the daemon) | recorded operational fact (2026-09-11 incident note); the fix lives in `C:/virality/docker-compose.yml`, which this work must not touch |
| ⇒ the local Supabase/PostgREST/GoTrue certification stack (Docker-only) was **not started** | decision: starting it would itself be a production-touching state change |
| No node/worker/app process running | process list (command lines only) |
| Redis = **Memurai 7.4.3**, standalone, bound to **127.0.0.1:6379 only**, owned by the local Windows service | `INFO server`, listen-address check |
| Logical **DB 15 empty (0 keys) before**; DB 0 holds 208 keys from earlier local workers and was never read or written | `INFO keyspace` counts, `DBSIZE` — no key names or values read |
| Harness hard-codes loopback / DB 15 / prefix `c12val-<random>`, takes nothing from env, aborts unless DB 15 is empty, obliterates its keys after | test source |
| **After the run: DB 15 = 0 keys, DB 0 still 208 keys** | same probe |
| No `.env*` file other than the tracked `*.example` templates exists in the worktree; no env/credential file was opened | file-name listing only |

## 2. Section A — authentication / passkey / UI step-up: **BLOCKED (all A1–A11)**

Every A check needs the app running against GoTrue + PostgREST + Postgres
(passkey, step-up, trusted-device and audit state are database rows) and a real
browser ceremony. The only local stack is Docker-based (see §1).

Prerequisites to unblock, each needing the owner's authorization:
1. Neutralize the production-connected local worker BEFORE starting Docker
   (repoint `docker-compose.yml` `worker.env_file` away from `.env.local`, or
   remove the `omnivyra-worker` container's restart policy).
2. Start the certification stack (`supabase init` with project id `certenv`,
   `supabase start`), load `supabase/_schema/baseline.sql` + the newer
   migrations, `NOTIFY pgrst, 'reload schema'`.
3. Run the app with `ENV_FILE=.env.cert CERT_ENV=1` (the isolation guard
   `scripts/cert/assert-cert-isolation.mjs` refuses production hosts).
4. Real WebAuthn: Playwright 1.59.1 is installed (`node_modules/playwright`);
   use a Chromium virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`)
   with `WEBAUTHN_RP_ID=localhost` / `WEBAUTHN_RP_ORIGIN=http://localhost:3000`
   in the cert env only. A mocked ceremony is NOT a substitute.
5. Synthetic identities per the plan (`val-super-1`, `val-super-off`,
   `val-viewer`, …) created in the cert database.

## 3. Section C — real BullMQ: results

Harness: `backend/tests/integration/closure012RealBullmqValidation.test.ts`
(opt-in `OMNIVYRA_REAL_BULLMQ_VALIDATION=1`); 11/11 passed. Real: BullMQ 5.76.6 Queue +
Worker on Memurai, and the production code under test
(`atomicCancelAndReEnqueueScheduledPost`, `cancelScheduledPostQueueEntry`,
`sweepQueueDrift`, `replayDeadLetterEntry`). Faked: the database (in-memory,
write-time predicates; live-row uniqueness simulated), the provider, telemetry.

| Check | Observed queue (BullMQ) | Observed DB (fake) | Result |
|---|---|---|---|
| C1 failed re-enqueue after the cancel removed the delayed job | old job **missing**; 0 delayed/waiting/active | old row `cancelled`; failed-enqueue row retired; **no live row**; rollback `skipped: bullmq_job_removed` | **PASS** |
| C2 old job survives (remove fails), still delayed | old job **delayed** | row restored to `pending` (CAS from `cancelled`); one live row | **PASS** |
| C2b job ACTIVE in a real worker (locked) | real `remove()` **refused** (locked); job stays **active** | row `cancelled`; rollback `skipped: prior_job_was_processing` (never restored) | **PASS** |
| C3 processing row with `metadata.platform_call` (call started), real job active | job **active**, untouched | row stays `processing`; reported `call_started_not_cancelled` | **PASS** |
| C3b processing row, call NOT started | job **removed** | row `cancelled` | **PASS** |
| C3c stale job whose row already `completed` | job still **delayed** | row stays `completed`; nothing cancelled | **PASS** |
| C5 DLQ re-drive of a publish entry | **0 jobs** added | dead letter kept; `publish_redrive_unsupported` | **PASS** |
| C6 drift sweep | healthy job **delayed** | orphan pending row (no job) `cancelled: drift_self_heal`; healthy row untouched; `peer_unknown: 0` | **PASS** |
| C6b drift probe hits a Redis ERROR (injected) | job still **delayed** | row NOT cancelled; `peer_unknown: 1` (unknown is never "missing") | **PASS** |
| C9 a concurrent reschedule lands its live row + real job between our cancel and our insert | their job **delayed**; our old job **missing** | only their row live; we report `ok:false`, `duplicate_conflict: live_job_for_another_time` | **PASS** |
| C8 two concurrent reschedules to different times | exactly **one** live job = the live row's id | exactly one live row; any `ok:true` matches its own time; not both ok | **PASS** |
| C4 uncertain provider outcome through the real publish worker | — | — | **NOT RUN** — needs the real publish processor + database (Section A prerequisites); covered only by unit suites |
| C7 mixed old/new versions | — | — | **BLOCKED** — needs two deployable builds (old worker image) on an isolated stack; not constructible without Docker |

Provider outcomes: no provider was involved in C1–C8 (queue-state checks);
**no exactly-once claim is made**.

## 4. Section B — database / concurrency: **BLOCKED (B1–B9)**

All need real Postgres + PostgREST (+ RLS, a pooled endpoint for B9). Same
prerequisites as §2 steps 1–3, plus: confirm migrations 20261009000000
(live-row unique index) and 20261202000000 are part of the loaded schema;
a PgBouncer endpoint for B9. No schema was changed to make a check pass.

## 5. Defects

None found by the executed checks. No product code changed in Closure-012.

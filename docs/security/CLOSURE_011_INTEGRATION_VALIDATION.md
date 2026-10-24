# Closure-011 — integration validation (for a separately authorized environment)

Purpose: the behaviours in-memory tests cannot prove. Run in a NON-production
environment built from the candidate (e.g. the local cert stack described in
the WRITER-CERT-002 notes: Supabase + PostgREST + Redis + one worker), with
synthetic tenants and posts only. Nothing here was executed. **No step may send
real outreach, publish to a real social platform, or touch production.**

Common preconditions (every check):
- Environment: a dedicated validation project (NOT project ref
  `klkiseupptzbecbxwrky`), schema = baseline + every migration the target will
  have (record the exact list, including 20261009000000 and 20261202000000).
- Code: web and worker both at the candidate commit (record both SHAs).
- Platform adapters stubbed to a local fake provider (records calls, returns
  scripted success / 5xx / timeout); outbound email transport disabled or
  pointed at a sink.
- Synthetic data: tenants `val-co-a`, `val-co-b`; users `val-super-1`,
  `val-super-2` (SUPER_ADMIN), `val-super-off` (SUPER_ADMIN row deactivated),
  `val-viewer` (VIEW_ONLY + direct grant of the four write capabilities),
  `val-owner-a`, `val-mate-a` (company A), `val-owner-b` (company B).
- Evidence: HTTP request/response pairs, DB rows before/after (`scheduled_posts`,
  `queue_jobs`, `stepup_sessions`, `trusted_devices`, `security_audit_log`),
  BullMQ job states (`getJob(id).getState()`), worker logs, fake-provider call log.
- Cleanup: delete synthetic tenants (cascade), flush the validation Redis,
  revoke synthetic passkeys/devices. Failure of any "expected" = release blocker.

## A. Authentication

| # | Procedure | Expected | Evidence | Prod auth? |
|---|---|---|---|---|
| A1 | `val-super-1` enrolls a passkey (virtual WebAuthn authenticator in a real browser, e.g. Chrome DevTools) at `/settings/security` | 2xx; `webauthn_credentials` row | response, row | no |
| A2 | `val-super-1` opens Analytics → "Refresh Search Console" with no step-up | 401 `STEP_UP_REQUIRED` → passkey prompt → `stepup_sessions` row (600 s) → `trusted_devices` row → ONE retry → 2xx; exactly 2 POSTs | network log, rows, audit `elevated_route_accessed` | no |
| A3 | Cancel the passkey prompt in A2 | error "Step-up was cancelled…", 1 POST, no success notice, no ingestion | network log, UI | no |
| A4 | Same as A2 after 10 min | prompt again (expired step-up) | audit reason `STEP_UP_EXPIRED` | no |
| A5 | Revoke the trusted device, retry the action | prompt → device revived (same `trusted_devices.id`, Closure-011 fix) → 2xx | row id before/after | no |
| A6 | Change the browser's language, retry | 401 → prompt → new trust for the new fingerprint (documents fingerprint fragility) | rows | no |
| A7 | TOTP-only operator attempts rollout-control | 401 `STEP_UP_REQUIRED` (factor insufficient), no write | audit `FACTOR_INSUFFICIENT` | no |
| A8 | `val-super-off` with a valid passkey step-up | 403, no write | response, audit | no |
| A9 | `val-viewer` (direct grants + valid step-up) on each step-up route | 403 `PLATFORM_SUPER_ADMIN_REQUIRED`, no write/queue/outbound | response, row diff | no |
| A10 | A signed legacy bridge cookie on a step-up route and on the Google callback | 401 / no principal (bridge hard-expired) | responses | no |
| A11 | Rollout console "kill" on a test flag | 401 → prompt → 2xx; flag state changes once; admin audit names the operator | Redis key, audit | no |

## B. Database and concurrency (real Postgres + PostgREST)

| # | Procedure | Expected | Evidence | Prod auth? |
|---|---|---|---|---|
| B1 | Tenant retry of a failed post that carries `platform_post_id` | 409 `POST_ALREADY_PUBLISHED`; row unchanged | row | no |
| B2 | 20 parallel tenant retries of one failed post | exactly one 200, others 409; one live `queue_jobs` row | rows, responses | no |
| B3 | Retry while a worker claim lands (inject via a paused worker) | 409; claim (`PUBLISH_CLAIMED:`) intact | rows | no |
| B4 | Cancel of a `processing` queue row WITH `metadata.platform_call` vs WITHOUT (PostgREST filter `metadata->platform_call is null`) | with: row stays `processing`, listed in `call_started_not_cancelled`; without: `cancelled` | rows, response | no |
| B5 | Confirm the live-row unique index exists (`\d queue_jobs`) and two concurrent inserts for one post | one insert, the other 23505 → `duplicate` | psql output | target-env check needs authorization |
| B6 | Two concurrent reschedules of one post to different times | one 200, one 409 (`updated_at` CAS) or 502 `duplicate_conflict`; never a 200 with the other's job | rows, responses | no |
| B7 | RLS: as an `anon` and a tenant-B JWT, read/write tenant-A `scheduled_posts`, `queue_jobs`, `outreach_tasks` via PostgREST | denied / empty | responses | no |
| B8 | Trusted-device revive race: two concurrent `/api/auth/devices/trust` for an expired row | one 201, one 409 `ALREADY_TRUSTED`; one row | rows | no |
| B9 | Pooling: run B2/B6 through the pooled (PgBouncer) endpoint | same outcomes | logs | no |

## C. Queue and publishing (real BullMQ + one worker, fake provider)

| # | Procedure | Expected | Evidence | Prod auth? |
|---|---|---|---|---|
| C1 | Reschedule a post whose delayed job exists; force the new enqueue to fail (Redis add error) | old job removed → rollback `skipped: bullmq_job_removed`; failed-enqueue row `cancelled`; no live row; safety-net cron enqueues at the new time when due; ONE publish | job states, rows, provider log | no |
| C2 | Same, but make the old job's removal fail | rollback `restored` only if the job is `delayed/waiting`; row back to `pending`; one publish | job state, rows | no |
| C3 | Unschedule a post whose job is active and has called the provider | queue row stays `processing`; post outcome recorded by the worker; no second publish | rows, provider log | no |
| C4 | Provider returns 5xx after the call started | post `failed` + `PUBLISH_OUTCOME_UNCERTAIN`; no automatic republish; tenant retry 409; super-admin reconcile (with step-up) records the outcome | rows, provider log | no |
| C5 | DLQ re-drive of a publish entry | 422 `publish_redrive_unsupported`; DLQ row kept; audit `failed`; nothing enqueued | response, rows, audit | no |
| C6 | Drift sweep with a `pending` row whose BullMQ job is missing | row cancelled by the sweep; post re-enqueued by the safety net | rows, logs | no |
| C7 | Mixed versions: old worker + new web, and new worker + old web, against uncertain/claimed rows | documents the republish risk; confirms the "deploy together" rule | provider log | no |

## D. Exit criteria

All A–C expected outcomes observed with evidence attached; any deviation is a
release blocker. Production-specific checks (enrollment of the real
SUPER_ADMINs, presence of 20261009000000 / 20261202000000 in the target,
direct `capability_assignments` grants) each need their own authorization.

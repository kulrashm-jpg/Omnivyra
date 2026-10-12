# Closure-011 — release review (local only)

Candidate: `integration/closure-011` (child of Closure-010 `528e32d9`). Nothing
in this document was verified against production; every runtime claim is
marked with its evidence or as unverified.

## 1. Deployment and dependency inventory, Closures 002–010

Chain verified by `git merge-base --is-ancestor`:
`5604b50b → 38a4dc04 → d864ffdc → b282bdb5 → 3374f840 → 09163bfd → c6394c13 → 16af41d4 → bdf4337f → 15cc885d → 35fcca1d → 528e32d9`.
`git diff --name-status 38a4dc04 528e32d9 -- supabase/` is empty: **no closure
adds or changes a migration.**

| Closure | Final | What changes | Worker | Web/API | UI | Relies on existing schema / index / RPC | Capability / operator action | Mixed-version / rollback risk |
|---|---|---|---|---|---|---|---|---|
| 002 | d864ffdc | Uncertain outcomes: 5xx/timeout/network/unknown → `PUBLISH_OUTCOME_UNCERTAIN`; thread nodes write `PUBLISH_CALL_STARTED`; reconcile route | yes (publishProcessor, publishOutcome, queries, publishNowService, threadPublishOrchestrator, platformAdapter) | yes (sweep cron, publish/reconcile) | no | `scheduled_posts.error_code/platform_post_id/updated_at`, `queue_jobs.metadata/error_code` (baseline); `queue_jobs.retry_state` optional (absence tolerated) | none | **HIGH** — old web/worker treat failed+UNCERTAIN as retryable → republish |
| 003 | b282bdb5 | Fenced claims `PUBLISH_CLAIMED:<uuid>` → CAS to `PUBLISH_CALL_STARTED`; no takeover after the call starts; writers refuse uncertain | yes | yes (schedule, sweep, schedule/posts, retry, social/publish) | no | same columns; markers ≤ varchar(100) | none | **HIGH** — the pre-003 claim takes over any 5-min-old `publishing` row whatever its code → duplicate risk. **Web + worker together.** |
| 004 | 3374f840 | Owner-scoped thread re-schedule; `THREAD_RESCHEDULING:<uuid>` fence; children never standalone | yes | yes | no | RPC `replace_thread_children` (20260806/07/09) | none | MED — old orchestrator ignores the fence; crashed-fence recovery unverified |
| 005 | 09163bfd | Platform write authority on recovery routes; owner + lifecycle guard on unschedule/reschedule | shared classifier only | yes | no | same columns | non-SUPER_ADMIN operators lose recovery writes | LOW–MED |
| 006 | c6394c13 | Reschedule order CAS-first (pins `updated_at`), compensation, durable `reschedule_incomplete` | no | yes | no | `scheduled_posts.updated_at`; JSON key in plan content | none | LOW — marker orphaned on rollback (UI rendering unverified) |
| 007 / 007-f3 | 16af41d4 / bdf4337f | Tests only (stale suites; release seam sanctioned) | no | no | no | – | none | none |
| 008 | 15cc885d | Guarded rollback; failed-enqueue retire; DLQ publish refusal; foreign-time duplicate = failure; cancel excludes call-started processing rows | yes (schedulerPostQueueControl: web AND worker) | yes | no | `queue_jobs.metadata` (jsonb, baseline); **unique index `uidx_queue_jobs_live_job_per_post` (20261009000000)**; lock RPCs optional (fallback) | none | MED — `platform_call` marker written only by workers ≥ closure-001; without the 20261009 index concurrent reschedules can both insert (post claim still fences the publish) |
| 009 | 35fcca1d | 3 new step-up capabilities; platform write authority on ~21 write routes; recipient override refused; SERP validation | DLQ service only | yes (~22 routes) | no | `capability_assignments.capability` is free text — **no DB provisioning** | passkey + trusted device for SUPER_ADMINs; direct-grant operators lose writes | LOW — rollback loosens authz |
| 010 | 528e32d9 | Tenant retry owner-only; published identity refused | no | yes | no | `scheduled_posts.platform_post_id` | none | LOW |
| **011** | this branch | UI step-up adoption (analytics writes, rollout console); trusted-device re-trust fix | no | trust route (via service) | **yes** | `trusted_devices` UNIQUE (user_id, fingerprint) (baseline) | none | LOW |

**Coordinated deployment:** 002, 003, 004 and 008 change code that runs in BOTH
the Railway worker and the Vercel web/API; they must ship as one version to
both planes. 005, 006, 009, 010, 011 are web/API (and UI) only, apart from the
shared publishOutcome / jobInspection classification.

**Schema prerequisites to CONFIRM in the target environment before release**
(not inferable from Git): migration 20261009000000 (live-row unique index),
20261202000000 (`queue_jobs.retry_state`, tolerated if absent), and the
`replace_thread_children` RPC migrations. The queue lock RPCs (20260657) must
NOT be applied as written (session lock over pooled connections; BIGINT
arguments to an INT4 overload — code review, unverified against a database).

**Rollback hazard:** rolling back to main or closure-001 leaves rows that older
code misreads (`PUBLISH_CLAIMED:%`, `PUBLISH_CALL_STARTED`,
`PUBLISH_OUTCOME_UNCERTAIN`, `THREAD_RESCHEDULING:%`, `PUBLISH_NOT_ATTEMPTED`,
`PUBLISH_RECONCILED_NOT_PUBLISHED`): old retry/claim paths can republish them.
A rollback needs those rows reconciled first (operator procedure; not run).

## 2. Passkey and trusted-device readiness

Policy for all four capability families (`outreach.platform.manage`,
`publish.recovery.manage`, `platform.controls.manage`,
`integration.platform.oauth.manage`): `phishingResistantOnly` (WebAuthn only),
`trustedDeviceRequired`, `maxAgeSeconds: 600` — plus an active platform
SUPER_ADMIN role (`requirePlatformWriteAuthority`).

- **Enrollment:** `POST /api/auth/passkeys/begin-registration` +
  `verify-registration`; UI `pages/settings/security.tsx` ("Enroll new
  passkey"). Any authenticated non-bridge principal may enroll; no capability
  or step-up gate (a "Wave 2C mfa.enroll" gate is still a TODO).
- **Step-up:** `begin-authentication` → `POST /api/auth/step-up/verify`
  (requires a DB-backed auth session, else 409 `NO_AUTH_SESSION`); rotates the
  auth session and mints a `stepup_sessions` row bound to it; TTL 600 s;
  **reusable for the whole window and session-wide** (scoped_capability is
  stored but not enforced; consumed_at is never set). `maxAgeSeconds` is not
  read — freshness is the stored expiry.
- **Trusted device:** a `trusted_devices` row for `(user_id, fingerprint)`,
  fingerprint = djb2 of `user-agent | accept-language | sorted cookie names`
  (no IP). Established by `POST /api/auth/devices/trust` (needs an active
  step-up of any factor); default TTL 30 days (cap 90). Both client step-up
  helpers trust the device automatically after a passkey ceremony.
  **Fragile:** a browser update, a language change or a new cookie name changes
  the fingerprint and silently drops trust.
- **Fixed in Closure-011:** re-trusting a browser whose trust EXPIRED or was
  REVOKED failed for ever (UNIQUE (user_id, fingerprint) + INSERT → 500). The
  dormant row is now revived by compare-and-set.
- **Denials the client sees:** every step-up shortfall (none, expired, revoked,
  TOTP, untrusted device) is the same `401 STEP_UP_REQUIRED`; the precise
  reason is only in the security audit (`phishing_resistant_required`).
  Bridge → 403 `BRIDGE_FACTOR_INSUFFICIENT`; no session → 401
  `NOT_AUTHENTICATED`; not a platform SUPER_ADMIN → 403
  `PLATFORM_SUPER_ADMIN_REQUIRED`.
- **UI support (after Closure-011):** analytics writes and the rollout console
  run the passkey flow; outreach approve/activate, publish reconcile, thread
  resume/reconcile and SERP acquisition have **no UI caller** (script/curl
  callers will receive a 401 they cannot satisfy without a browser ceremony).
- **No break-glass exists** for these capabilities. Recovery: self-service
  (enroll a new passkey while signed in) or peer reset by another SUPER_ADMIN
  holding `mfa.revoke` (`POST /api/super-admin/users/reset-mfa`). If every
  SUPER_ADMIN lost access at once there is no in-app path.

**Operator rollout sequence (each step needs separate authorization in the
real environment):**
1. Confirm `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN` are correct for the origin.
2. Each SUPER_ADMIN signs in through the canonical session flow (step-up needs
   a DB-backed auth session).
3. Each SUPER_ADMIN enrolls **two** passkeys.
4. Each SUPER_ADMIN, on the real operating browser, completes a passkey step-up
   and trusts the browser; confirm "Trusted device: yes" / "Active step-up:
   yes" in `/settings/security`.
5. Keep at least two SUPER_ADMINs able to reset MFA for each other.
6. Only then deploy the gates; watch the audit for `phishing_resistant_required`.
7. Tell operators: a browser update / language change / new cookie can drop
   device trust; trust expires after 30 days; a step-up lasts 10 minutes.

## 3. Email outreach recipient model (design finding — not implemented)

Preserved: `outreach/activate` refuses a body `recipient` (400
`RECIPIENT_OVERRIDE_NOT_PERMITTED`); the email transport receives no recipient
and refuses (`invalid_recipient`, after the `LEAD_OUTREACH_EMAIL_ENABLED`
gate). **Internal-channel outreach is unaffected** (its transport ignores the
recipient) and the **approval gate is intact** (approval has no recipient
dependency).

No verified recipient exists in the data model today: `leads.email` and
`unified_persons.primary_email` are unverified; `identity_claims` has a
`verification_state` axis but its only writer sets `'unverified'`;
`canonical_leads` has no address; `consent_records` is a platform-capability
ledger, not person consent. Suppression (`outreach_suppressions`,
`contact_governance_records`) is the only person-level permission signal.

Minimal future design (owner decision on what "verified" means):
1. Source: the lead's person (`outreach_tasks.person_id`, else
   `leads.unified_person_id`) → its active, VERIFIED `identity_claims` email in
   the same tenant. Never `leads.email` / `primary_email`.
2. A verification writer for `identity_claims` (columns exist; code only).
3. Bind at materialisation/approval: `outreach_tasks.recipient_claim_id` +
   `recipient_hash` (schema change — needs authorization), immutable once
   approved; dispatch re-reads the claim and refuses on any drift.
4. Suppression/governance fed the bound address (existing paths).
5. Audit carries claim id / hash only (no PII), per the existing evidence rules.
6. Before email goes live, also fix: an approved email task dispatched once
   while email is disabled is stranded in `queued` (no `queued → approved`
   transition; activation reports it `not_approved`).

## 4. Google OAuth callback — legacy bridge branch (owner decision)

`pages/api/analytics/connect/google/callback.ts:72-122`: with a legacy bridge
session, the callback skips the authenticated-user requirement AND the
`state.userId === user.id` binding, then binds the Google tokens to the
company named in the signed state.

- **Reachable today?** No: `getLegacySuperAdminSession` returns null for the
  hard-expired bridge (expiry 2026-08-05), for dry-run, and for any signature
  failure. It re-arms if the expiry constant is ever extended.
- **Sufficiency:** state is HMAC-signed, 10-minute TTL, but has no nonce /
  single-use record / browser binding, and the same key signs other providers'
  states (a missing `flow` is treated as GA4). With the branch live, a bridge
  holder + a leaked fresh state could bind their own Google account to that
  company.
- **Removal:** a minimal code-only change (no flow depends on it: tenant and
  super-admin connect both embed a real user id, and super-admin connect now
  refuses bridge principals). **Not changed here** — recorded as an owner
  decision since Closure-010; recommended with a callback regression test
  (bridge cookie + no/mismatched user → `unauthorized` / `invalid_oauth_state`),
  optionally restricting `flow` to `ga4|gsc`.
- `scripts/verify-ga-fixes-handlers.ts` already reflects the current contract
  (Closure-010); not executed (it loads the environment it is pointed at).

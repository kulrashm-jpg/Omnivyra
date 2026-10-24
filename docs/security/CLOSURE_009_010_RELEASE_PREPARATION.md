# Closure-009/010 — release preparation checklist (local-only)

Status: **not released.** Candidate `integration/closure-010` (built on
Closure-009 `35fcca1d`). Every item below is either verified locally or
explicitly marked as needing a separately authorized production step. Nothing
here was done against production.

## 1. What changes for operators

| Surface | Required after release |
|---|---|
| outreach approve / activate | `outreach.platform.manage` + passkey step-up on a trusted device + active platform SUPER_ADMIN |
| publish reconcile, thread resume / reconcile | `publish.recovery.manage` + passkey step-up on a trusted device + active platform SUPER_ADMIN |
| rollout-control (every action) | `platform.controls.manage` + passkey step-up on a trusted device + active platform SUPER_ADMIN |
| GA/GSC connect, property selection, sync; SERP acquisition | `integration.platform.oauth.manage` + passkey step-up on a trusted device + active platform SUPER_ADMIN |
| DLQ re-drive, planner force-mode / rollout / features, customer-activation, integration audit, cache flush, observability baseline | dashboard view + active platform SUPER_ADMIN (no step-up) |
| tenant `POST /api/scheduler/retry` | **unchanged tenant authority**: the post owner's session only (Closure-010) |

## 2. Checklist

- [ ] **Super-admin passkey enrollment.** Every platform SUPER_ADMIN who performs
  the step-up writes above needs a WebAuthn (passkey) factor AND a trusted
  device. TOTP is refused for these capabilities. Confirm enrollment with each
  operator before release. *Production step — needs separate authorization.*
- [ ] **Operators relying on direct grants.** A user who held
  `super_admin.dashboard.view` (or any write capability) through a
  `capability_assignments` row but is NOT an active platform SUPER_ADMIN loses
  every write in §1. Establishing whether such operators exist requires reading
  production `capability_assignments`. *Production step — needs separate
  authorization; not inspected here.*
- [ ] **UI handling of `401 STEP_UP_REQUIRED`.** The routes answer the standard
  denial shape (`code: 'STEP_UP_REQUIRED'`, `capability`, `stepUpStatus`) from
  `requireCapability`/`respondDenied`. Verify that each calling surface
  (operations center, outreach tools, analytics tab, rollout console) launches
  the passkey challenge and retries, rather than showing a generic error.
  Not verified locally (no UI test covers these routes).
- [x] **`scripts/verify-ga-fixes-handlers.ts` updated** (Closure-010) to the
  current contract: unauthenticated → `401 NOT_AUTHENTICATED`; the legacy bridge
  cookie is refused on GA connect/select (writes) and on the summary read (the
  bridge hard-expired 2026-08-05). Typechecked; **not run** (it reads the env
  file it is pointed at — never run it against production without
  authorization).
- [ ] **Email outreach stays unavailable.** `POST /api/super-admin/outreach/activate`
  refuses a caller-supplied `recipient` (400 `RECIPIENT_OVERRIDE_NOT_PERMITTED`)
  because no verified recipient model exists (no lead/task contact binding).
  The email transport therefore receives no recipient and refuses
  (`invalid_recipient`). Internal-channel outreach is unaffected. A verified
  recipient model is an owner/product decision before email outreach ships.
- [ ] **Google OAuth callback legacy bridge branch.**
  `pages/api/analytics/connect/google/callback.ts` still accepts a legacy bridge
  session (`hasSuperAdminSession`, lines ~72–121) in place of the state's
  `userId == session user` check. Today it is inert: the shared bridge
  lifecycle evaluation (`getLegacySuperAdminSession` →
  `evaluateBridgeCookieLifecycle`) returns no session for the hard-expired
  bridge. It becomes live again if the bridge expiry is ever extended. Removing
  the branch is outside the approved Closure-009/010 scope — **owner decision**.
- [ ] **Production-only validation still required** (in-memory tests cannot
  prove these):
  - real passkey / trusted-device step-up flows end to end;
  - PostgREST behaviour of the Closure-008 `metadata->platform_call` filter and
    of every compare-and-set predicate; row-level security;
  - whether the live-row unique index (migration 20261009000000) is applied;
  - real BullMQ job states for the guarded rollback;
  - concurrency under real connection pooling.
  *Each needs a separately authorized integration/production plan.*

## 3. Not changed by Closure-009/010

- No migration was authored or applied.
- The tenant retry route keeps owner-only tenant authority; platform recovery
  keeps the dedicated capability, step-up and platform SUPER_ADMIN.
- No push, PR, merge or deployment.

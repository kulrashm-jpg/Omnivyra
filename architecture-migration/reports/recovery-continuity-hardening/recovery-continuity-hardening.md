# Recovery Continuity Hardening — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Eliminate the highest-impact dead-end user states. Add canonical primitives for resumable flows, close the resend-verification + resend-invitation gaps, surface orphan organizations + stuck users to operators.

---

## Files audited

### Existing primitives (composed; not modified)
- [pages/api/auth/reset.ts](../../../pages/api/auth/reset.ts) — password-reset rate-limit gate (constant-response pattern; reused for resend-verification + resend-invitation)
- [pages/api/auth/accept-invite.ts](../../../pages/api/auth/accept-invite.ts) — `signInWithOtp` send pattern
- [pages/api/auth/magic-link.ts](../../../pages/api/auth/magic-link.ts) — same OTP-send pattern
- [pages/api/team/invite.ts](../../../pages/api/team/invite.ts) — admin invite path; uses `createAndSendInvitation`
- [backend/services/invitationService.ts](../../../backend/services/invitationService.ts) — `createInvitation` (idempotent on key) + `createAndSendInvitation` (send-then-revoke-on-failure)
- [backend/security/MfaIntent.ts](../../../backend/security/MfaIntent.ts) — model for the new generic `ContinuationToken`
- [backend/security/TenantGuard.ts](../../../backend/security/TenantGuard.ts) — consumed by admin-mode resend
- [backend/services/requestAccessService.ts](../../../backend/services/requestAccessService.ts) — `requireAdminRateLimit` for admin endpoints
- [backend/security/requireCapability.ts](../../../backend/security/requireCapability.ts) — capability gate

### Recovery flows audited (no modification — read-only inventory)
- signup → verify-email → callback chain
- accept-invite → otp → callback
- password-reset (reset → set-password → revoke-all-other-sessions)
- MFA-verify (built last phase; sufficient)
- onboarding profile / company chain
- post-login routing
- legacy super-admin and content-architect login

### Recovery dead-ends found and addressed

| Dead-end | Status before | Closed by |
|---|---|---|
| Verification email expired/lost; no resend | unrecoverable except re-signup (blocked by signup_intents) | new `/api/auth/resend-verification` |
| Invitation expired/lost; invitee can't request new | required admin SQL | new `/api/auth/resend-invitation` self-serve mode |
| Admin can't trigger a resend from team UI | absent | new `/api/auth/resend-invitation` admin mode |
| Headless org (no admin) | required SQL | new `/api/super-admin/orphan-organizations` (read) |
| Abandoned org (no members) | required SQL | new `/api/super-admin/orphan-organizations` (read) |
| Suspended org with active campaigns | invisible | new `/api/super-admin/orphan-organizations` (read) |
| Users stuck in partial onboarding state for hours/days | invisible | new `/api/super-admin/recovery-state` (read) |

### Recovery dead-ends explicitly **not** addressed this phase (out of scope)
- Per scope: "Do NOT touch platform isolation / tenant authorization architecture / onboarding broadly / unrelated auth systems / UI redesign"
- **Owner-transfer endpoint** (would close HEADLESS org repair) — requires an authority-mutation endpoint that's tenant-architecture work; deferred.
- **Onboarding state-machine refactor** — surfaces the partial states; doesn't redefine them.
- **Multi-tab continuation token** — `ContinuationToken` primitive is in place; integration into the auth-callback / verify-email flow is a follow-up that would touch onboarding.
- **Soft-delete resurrection flow** — operator concern; out of recovery-continuity scope.

---

## Files created (5)

1. **[backend/security/ContinuationToken.ts](../../../backend/security/ContinuationToken.ts)** — generic HMAC-signed short-lived continuation token. Generalises the `MfaIntent` pattern across:
   - email-verification resume
   - invite acceptance handoff
   - onboarding resume
   - MFA recovery session continuation
   - password-reset resume

   API: `issueContinuationToken({ kind, subject, data, ttlSeconds })` + `readContinuationToken<TData>({ token, expectedKind })`. Kind is type-checked at consume time — a token issued for `verify_email` cannot be replayed against an `invite_resend` consumer. 15-min default TTL, 24h max. Cookie-or-URL transport at the caller's discretion.

2. **[pages/api/auth/resend-verification.ts](../../../pages/api/auth/resend-verification.ts)** — public, unauthenticated. Per-IP (5/h) + per-email (3/h) rate limit. Constant-response (no enumeration). Three audited outcomes: `sent` / `soft_deleted` / `already_verified` / `not_found`. Soft-deleted accounts are NOT silently re-issued — they go through the normal support escalation path. Verification email goes via the same `signInWithOtp` SMTP path used by signup + accept-invite, so the user-facing experience stays uniform.

3. **[pages/api/auth/resend-invitation.ts](../../../pages/api/auth/resend-invitation.ts)** — two modes detected by body shape:
   - Self-serve (`{ email }`): per-email + per-IP rate-limited, finds any non-accepted / non-revoked invitation row, revokes the old token, issues a fresh one via `createAndSendInvitation`. Constant-response.
   - Admin (`{ invitationId }`): authenticated. Tenant-guarded by `requireTenantAccess` against the invitation's `company_id` with `requireRoleIn: ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN']`. Revokes old + issues fresh. Rejected if invitation already accepted (409) or not found (404).

4. **[backend/services/orphanOrgDetector.ts](../../../backend/services/orphanOrgDetector.ts)** — `detectOrphans({ limit })`. Read-only. Classifies each organization as:
   - `HEADLESS` — has active members but zero admin-class members
   - `ABANDONED` — has zero active members
   - `DELETED_OWNER` — every active admin has `is_deleted=true` on their `users` row
   - `SUSPENDED_WITH_ACTIVITY` — `companies.status != 'active'` BUT the org still has active campaigns

   Single batched query against `companies` + `user_company_roles` + `users` + `campaigns`; bounded at 1000 orgs/run. Returns the precise counts (active members, active admins, deleted admins, hasActiveCampaigns) so an operator can choose the right remedy without a follow-up SQL.

5. **[pages/api/super-admin/orphan-organizations.ts](../../../pages/api/super-admin/orphan-organizations.ts)** — admin endpoint, GET-only, capability-gated (`SUPER_ADMIN_DASHBOARD_VIEW`) + admin rate limit. Wraps `detectOrphans`.

6. **[pages/api/super-admin/recovery-state.ts](../../../pages/api/super-admin/recovery-state.ts)** — admin endpoint, GET-only. Enumerates non-deleted users older than `stuckHours` (default 24) and classifies each into recovery buckets:
   - `unverified_email` — `is_email_verified=false`
   - `partial_onboarding_state` — `onboarding_state` ∈ {`pending_verification`, `verified`, `profile_pending`}
   - `no_company_no_invite` — neither active membership nor pending invitation
   - `no_password` — `has_password=false` for users old enough to plausibly have set one

   Operator can act per-bucket: trigger resend-verification, manually verify, escalate to support, etc.

## Files modified

None.

---

## Canonical recovery-engine results

`ContinuationToken` is the new generic primitive:

| Property | Mechanism |
|---|---|
| HMAC integrity | SHA-256 over `payloadB64` using `SESSION_COOKIE_SECRET` |
| Kind-check at consume | Token minted for one kind cannot be replayed against another consumer |
| Expiry enforcement | Both `exp` (configured TTL) AND `iat` future-tolerance (30s skew window) |
| Constant-time signature compare | `timingSafeEqual` |
| Single-use semantics | NOT enforced by token itself — caller marks the underlying state advanced (invitation.accepted_at, recovery_codes.used_at, etc.). This separation lets the same token be safely retried within the consume endpoint's idempotent state transition. |
| Transport-agnostic | Cookie OR URL-query OR JSON body — caller's choice |

The existing `MfaIntent` continues to use its own bespoke implementation. Integrating MfaIntent into the new generic was deliberately deferred — the MFA flow is stable post-validation and a refactor risks regression. Future MFA-recovery and onboarding-resume flows should adopt `ContinuationToken` directly.

## Onboarding/invite continuity results

- **Verification email loss** — closed by `resend-verification`. Users can self-serve a fresh email with rate-limited safety.
- **Invitation expiry** — closed by `resend-invitation` self-serve mode. Invitees recover without admin intervention.
- **Admin invite resend** — closed by `resend-invitation` admin mode. Tenant-guarded; revokes old + issues fresh.
- **Duplicate org / membership creation** — preserved invariants from the existing `createInvitation` (idempotency-key UNIQUE) + `bootstrapCompanyFromSignupIntent` (active-role short-circuit). New endpoints do NOT create new companies or memberships; they only reissue invitation rows.
- **Stale onboarding state visibility** — closed by `recovery-state`.

## MFA / account recovery results

The MFA enforcement phase already shipped:
- `mfa-verify` (TOTP / WebAuthn / recovery-code factors)
- `recovery-login` (recovery-code primary auth with global session revoke)
- `mfa_intent` cookie continuation
- per-user + per-IP brute-force protection on factor verifiers

This phase did not modify those — the canonical recovery-code path remains the way to re-establish access when a primary factor is lost. `recovery-state` surfaces users whose `unverified_email` blocks the MFA flow so the operator can intervene.

## Orphan / owner recovery results

Detection: complete via `detectOrphans`. The four classifications are reported with full counts.

Repair: NOT in this phase's scope. Per-spec ("Do NOT touch tenant authorization architecture"), an authority-mutation endpoint to transfer ownership / promote a member / claim an abandoned org is a separate phase.

The `orphan-organizations` endpoint is the operator-grade visibility surface. Combined with the existing super-admin `users` and `companies` endpoints, an operator can manually repair using existing primitives:
- HEADLESS → `super-admin/users PATCH` to upgrade an existing member to COMPANY_ADMIN
- ABANDONED → `super-admin/companies PATCH` to deactivate the company
- DELETED_OWNER → `super-admin/users PATCH` on the deleted user OR upgrade another member
- SUSPENDED_WITH_ACTIVITY → existing campaign-management endpoints

A follow-up phase should add a single canonical `transfer-ownership` endpoint to make this one click.

## Safe cleanups completed

None destructive. Purely additive — five new files; zero existing files modified.

---

## Remaining blockers

1. **No ownership-transfer endpoint.** HEADLESS org repair requires manual super-admin role mutation today. The detector now surfaces these orgs, but the click-to-fix is a separate phase.

2. **No "claim abandoned org" flow.** ABANDONED orgs (zero active members) have no automated remedy. Operator must either deactivate the company or invite a fresh admin manually.

3. **`ContinuationToken` is not yet wired** into the email-verification or password-reset flows. Both currently rely on Supabase's built-in OTP/recovery tokens, which are sufficient for the happy path. The new primitive is in place for future flows that need server-controlled continuation state (multi-step onboarding resume, multi-device handoff, etc.) but does not replace Supabase's link-based flow this phase.

4. **No multi-tab coordination beyond Supabase's own session listener.** A user who starts signup in one tab and continues in another sees Supabase's auth-state change events, but there is no canonical "I'm in flow X step Y" message broadcast. Future phase.

5. **No automated cleanup of old signup_intents rows** (24h TTL on creation but no scheduled purge). Out of recovery scope; tracked separately.

6. **Stuck-user detection (`recovery-state`) is read-only.** No automated nudge — an operator has to act on the report. A future phase could send an automated "did you mean to finish?" email at T+72h.

7. **`/api/auth/team/invite.ts` and `/api/auth/accept-invite.ts` co-exist** with their non-`/team` counterparts. The two paths share `createAndSendInvitation` so behavior is consistent, but the duplicate routing surface is confusing. Out of scope.

---

## Validation commands executed

| Command | Result |
|---|---|
| `find pages/api/auth -name 'resend*'` | none before; 2 created this phase |
| Manual review of `accept-invite.ts` SMTP-send pattern | confirmed `signInWithOtp` is the canonical primitive — reused for resend-verification |
| Manual review of `invitationService.ts` | confirmed `createAndSendInvitation` is idempotent + safe for resend |
| Manual review of `requireTenantAccess` | confirmed admin-mode resend gates correctly with role filter |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, zero errors |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Dead-end recovery states (highest-frequency: verify-email, invite-expired) | **2** | **0** | -2 |
| Dead-end recovery states (operator-detectable but not repairable: HEADLESS / ABANDONED / DELETED_OWNER) | **3** (invisible) | **3** (visible via detector; click-to-fix still missing) | 0 (visibility achieved; repair still in queue) |
| Orphan organization states (detection) | **0 surfaces** | **1** (canonical detector + admin endpoint) | +1 |
| Stale onboarding paths (operator visibility) | **0** | **1** (recovery-state endpoint) | +1 |
| Invite replay risks | **0** (existing idempotency-key UNIQUE) | **0** (preserved) | 0 |
| Duplicate org-creation paths | **0** (existing bootstrap short-circuits on active role) | **0** (preserved) | 0 |
| Duplicate membership paths | **0** | **0** (resend revokes-then-recreates the invitation row only) | 0 |
| Recovery lockout chains (TOTP-only user with no recovery codes + no WebAuthn + no admin help) | **1** (last phase) | **0** if MFA-enrollment nudge + admin transfer-ownership are added — but neither is in this phase. Effectively still **1**. | 0 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch platform isolation
- ❌ Did not touch tenant authorization architecture
- ❌ Did not rewrite onboarding broadly
- ❌ Did not refactor unrelated auth systems
- ❌ Did not perform UI redesign work
- ❌ Did not add an ownership-transfer endpoint (separate phase)
- ❌ Did not modify `signup`, `verify-email`, `accept-invite`, or `set-password` core flows
- ❌ Did not integrate `ContinuationToken` into existing flows (primitive in place; adoption is opt-in)

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Ownership-transfer endpoint | Click-to-fix HEADLESS / DELETED_OWNER orgs from the orphan-organizations report | 1 service + 1 super-admin endpoint |
| Onboarding-resume integration | Adopt `ContinuationToken` for the verify-email + onboarding-step chain so multi-tab + multi-device users resume cleanly | onboarding flow integration |
| Auto-prompt stuck users | T+72h email reminder for users in `recovery-state` partial buckets | 1 cron + 1 email template |
| Signup-intent cleanup cron | Purge expired signup_intents older than N days | 1 cron |
| Soft-delete-resurrection flow | Operator-driven undelete with confirmation + audit | 1 endpoint |

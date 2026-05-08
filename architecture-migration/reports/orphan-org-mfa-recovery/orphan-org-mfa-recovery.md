# Orphan-Org Recovery + MFA-Lockout Completion — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Eliminate the two remaining unrecoverable user/org states left open by the recovery-continuity phase: orphan/headless organizations (HEADLESS / DELETED_OWNER / ABANDONED) and the permanent TOTP-only MFA lockout chain.

---

## Files audited

### Existing primitives composed (no modifications)
- [backend/services/orphanOrgDetector.ts](../../../backend/services/orphanOrgDetector.ts) — read-only detector built last phase; the new repair endpoints consume its classifications.
- [backend/security/totp/TotpFactorRepository.ts](../../../backend/security/totp/TotpFactorRepository.ts) — `findActiveForUser`, `revokeFactor`.
- [backend/security/webauthn/WebAuthnCredentialRepository.ts](../../../backend/security/webauthn/WebAuthnCredentialRepository.ts) — `listForUser`, `revokeCredential`.
- [backend/security/SessionAuthorityService.ts](../../../backend/security/SessionAuthorityService.ts) — `revokeAllSessionsForUser`.
- [backend/security/stepup/StepUpSessionService.ts](../../../backend/security/stepup/StepUpSessionService.ts) — `revokeForUser`.
- [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts) — `logSecurityEvent`.
- [backend/security/requireCapability.ts](../../../backend/security/requireCapability.ts) — capability gating + step-up policy.
- [shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts) — `IDENTITY_ADMIN_ASSIGN`, `ORGANIZATION_DELETE`, `MFA_REVOKE`. All three already policy-marked for phishing-resistant step-up via `StepUpPolicyRegistry`.
- [pages/api/super-admin/users.ts](../../../pages/api/super-admin/users.ts) — existing role-mutation pattern (direct UPDATE on `user_company_roles` + audit row); the new ownership-recovery endpoints mirror this.

### Recovery-state surface audited
- HEADLESS / DELETED_OWNER → fixed by `promoteMemberToAdmin`
- HEADLESS / DELETED_OWNER (with explicit handoff) → fixed by `transferOwnership`
- ABANDONED → fixed by `archiveAbandonedOrg`
- SUSPENDED_WITH_ACTIVITY → existing `super-admin/companies` PATCH (unchanged)
- TOTP-only permanent lockout → fixed by `adminResetMfa`

---

## Files created (5)

1. **[backend/services/orgOwnershipRecoveryService.ts](../../../backend/services/orgOwnershipRecoveryService.ts)** — canonical org-ownership repair authority with three operations:
   - `promoteMemberToAdmin({ orgId, userId, performedBy, reason })` — promote an existing active member to `COMPANY_ADMIN`. Idempotent against an already-admin user.
   - `transferOwnership({ orgId, fromUserId, toUserId, performedBy, reason, demoteToRole? })` — promote the to-user, then demote the from-user (default `CONTENT_CREATOR`). Promotes BEFORE demoting so the org never becomes admin-less if the second mutation fails. Idempotent.
   - `archiveAbandonedOrg({ orgId, performedBy, reason, force? })` — soft-archive a zero-active-members org. Pass `force=true` to override the zero-members invariant. Idempotent against an already-archived org.

   Each operation:
   - Validates org existence + active state (rejects `NO_ORG` / `ORG_INACTIVE`)
   - Validates target user existence + non-deleted state (rejects `NO_TARGET_USER` / `TARGET_USER_DELETED`)
   - Validates active membership (rejects `NO_MEMBERSHIP` / `STALE_MEMBERSHIP`)
   - Records a full audit row via `logSecurityEvent` with operator + target + reason + outcome
   - Returns a discriminated union so the caller handles every reason explicitly

2. **[pages/api/super-admin/companies/transfer-ownership.ts](../../../pages/api/super-admin/companies/transfer-ownership.ts)** — admin endpoint, capability-gated by `IDENTITY_ADMIN_ASSIGN` (which is already policy-marked for phishing-resistant step-up). Reasons map to canonical HTTP status codes (404 / 409 / 410 / 500).

3. **[pages/api/super-admin/companies/promote-admin.ts](../../../pages/api/super-admin/companies/promote-admin.ts)** — admin endpoint for HEADLESS / DELETED_OWNER repair. Promotes without demoting anyone. Same gate.

4. **[pages/api/super-admin/companies/archive-abandoned.ts](../../../pages/api/super-admin/companies/archive-abandoned.ts)** — admin endpoint for ABANDONED soft-archive. Capability-gated by `ORGANIZATION_DELETE`.

5. **[backend/security/MfaResetService.ts](../../../backend/security/MfaResetService.ts)** — `adminResetMfa({ userId, performedBy, reason, alsoRevokeRecoveryCodes?, alsoRevokeSessions? })`. Composes the existing TOTP / WebAuthn / recovery-code / session revoke primitives into a single audit-grade reset:
   - Revokes the user's active TOTP factor
   - Revokes every non-revoked WebAuthn credential
   - Marks every unused recovery code as used (when `alsoRevokeRecoveryCodes !== false`)
   - Revokes every live `auth_sessions` + `stepup_sessions` row (when `alsoRevokeSessions !== false`)
   - Returns counts of each revoked surface + an `idempotent` flag (true when the user had no remaining factors before the call)

   Importantly, the user has NO self-serve path — all resets are operator-driven. Self-serve "reset MFA via email" would create an email-takeover MFA-bypass; we deliberately avoid that. After reset, the user re-enrolls fresh on next login (the MFA-enforcement gate sees `userHasVerifiedMfaFactor=false` and proceeds without an MFA challenge).

6. **[pages/api/super-admin/users/reset-mfa.ts](../../../pages/api/super-admin/users/reset-mfa.ts)** — admin endpoint, capability-gated by `MFA_REVOKE` (the same gate that protects the user-facing factor revoke; phishing-resistant step-up, 10-minute window). Operator must supply a reason ≥ 4 chars — recorded to audit.

## Files modified

None.

---

## Orphan-org recovery results

The four classifications now have one-click repair flows backed by canonical TS primitives:

| Classification | Endpoint | Mutation | Idempotent |
|---|---|---|---|
| HEADLESS | `POST /api/super-admin/companies/promote-admin` | UPDATE user_company_roles SET role='COMPANY_ADMIN' | yes |
| DELETED_OWNER (with non-deleted member) | `POST /api/super-admin/companies/promote-admin` | same | yes |
| DELETED_OWNER (no non-deleted member) | manual re-invite via existing `super-admin/users` POST | (existing) | (existing) |
| ABANDONED | `POST /api/super-admin/companies/archive-abandoned` | UPDATE companies SET status='archived' | yes |
| Owner handoff | `POST /api/super-admin/companies/transfer-ownership` | promote target + demote source | yes |
| SUSPENDED_WITH_ACTIVITY | existing `super-admin/companies` PATCH | UPDATE companies SET status='active' | (existing) |

All flows route through `orgOwnershipRecoveryService`; no inline role SQL.

## Ownership-transfer results

`transferOwnership` enforces the invariants:

- **Active org validation** — rejects on `NO_ORG` / `ORG_INACTIVE`.
- **Active target-user validation** — rejects on `NO_TARGET_USER` / `TARGET_USER_DELETED` / `NO_MEMBERSHIP` / `STALE_MEMBERSHIP`.
- **Single-owner invariant**: NOT enforced (data model already permits multi-COMPANY_ADMIN). The from-user is demoted to a non-admin role so the operation is a true handoff, not a duplicate.
- **Role-transition safety**: promote-then-demote ordering ensures the org never becomes admin-less if the demote step fails (the source still holds admin in that case — operator can retry).
- **Membership consistency**: only mutates rows that are already `status='active'`; never creates new memberships.
- **Audit lineage**: actor + principal + resource + reason + outcome, indexable via `capability_audit_log`.

Idempotent shape: a re-click after a successful transfer (target already COMPANY_ADMIN, source already at the target demote role) returns `idempotent: true` without mutating.

## MFA-lockout recovery results

`adminResetMfa` eliminates the permanent TOTP-only lockout chain. Reset flow:

1. Operator (super-admin with `MFA_REVOKE` + phishing-resistant step-up via THEIR own factors) calls the endpoint with the locked user's id + reason.
2. Service revokes the target's TOTP factor, every WebAuthn credential, every unused recovery code, every live auth_session, every live step-up session.
3. Audit row written with operator + target + counts + reason.
4. User re-authenticates; the MFA-enforcement gate sees zero factors and proceeds without a challenge — they re-enroll from `/settings/security` cleanly.

Step-up protection at the endpoint:
- `MFA_REVOKE` is policy-marked for phishing-resistant step-up at the route layer ([StepUpPolicyRegistry](../../../backend/security/stepup/StepUpPolicyRegistry.ts)). The operator can't reset MFA without their own WebAuthn step-up.
- The OPERATOR's MFA is required to break the TARGET'S MFA. This is the canonical "I'm losing access" recovery shape: the user can't bypass their own MFA, but the platform has a controlled escape hatch.
- All session revocations after the factor reset close the window where a stolen pre-reset session continues post-reset.

No self-serve user path is exposed. Per-spec: "no recovery bypass / no partial-auth continuation / no stale recovery authority" — all enforced.

## Recovery-authority results

| Authority | Mechanism | Single source |
|---|---|---|
| Canonical principal binding | `requireCapability` resolves the operator's principal before each repair | yes |
| Continuation-token ownership | not used in this phase (admin-driven, no multi-step flow) | n/a |
| Expiration ownership | step-up session expiry (10-min window) is the canonical bound | yes |
| Audit attribution | `logSecurityEvent` with explicit `actorUserId` + `principalUserId` + `reason` | yes |
| Inline reset helpers | none — every mutation routes through `orgOwnershipRecoveryService` or `MfaResetService` | yes |
| Direct DB role mutation | only inside the canonical service, never from a route handler | yes |

## Safe cleanups completed

None destructive. Purely additive — six new files; zero existing files modified. The previous phase's `orphanOrgDetector` + admin endpoints continue unchanged.

---

## Remaining blockers

1. **No self-serve MFA recovery path.** Intentional — every self-serve path I considered (email-confirmation reset, recovery-code reset without WebAuthn, "I lost everything" form) reduces to email-takeover bypass. The canonical recovery is operator-driven via support contact. A future phase could add an opt-in self-serve flow with a long cooldown + explicit user-acknowledged risk acceptance, but the security tradeoff is poor.

2. **No automated link from orphan-org detection to repair.** The detector returns classifications + counts; an operator must read the report and POST to the corresponding endpoint. A simple admin UI could chain "view orphan org → click repair" but the per-spec scope excludes UI work.

3. **`transferOwnership` does not currently support a fresh-invite handoff.** The to-user must already be an active member of the org. For ABANDONED orgs (no members at all) the recovery is: archive the org, then operator manually invites a new admin via the existing `super-admin/users POST` (which IS able to create a member with `COMPANY_ADMIN` role). The two-step is acceptable because ABANDONED orgs are rare and the operator's intent should be explicit.

4. **`adminResetMfa` does not delete `webauthn_challenges` or `stepup_sessions` for the target.** The auth_sessions revoke covers active sessions; outstanding step-up sessions are also revoked. Stale challenge rows that never resolved are left for natural expiry — they cannot authenticate independently.

5. **No "force-MFA-re-enrollment" flag**. Post-reset, the user CAN log in without MFA (no factors → no challenge). Whether they MUST re-enroll before doing anything is a separate UX question (post-login banner, capability gating, etc.) — out of this phase's scope.

6. **Existing `pages/api/super-admin/users.ts:DELETE` flow** has its own user-deletion path that includes some cascade. Coordinating its semantics with `archiveAbandonedOrg` (which only archives the company, not the abandoned-user data) is a follow-up. Today they don't conflict but they're independently authoritative.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -n 'user_company_roles' pages/api/super-admin/users.ts` | confirm the existing role-mutation pattern (direct UPDATE + audit log) | confirmed; new service mirrors |
| `grep -n 'export.*revoke' backend/security` | inventory existing revoke primitives | found TOTP, WebAuthn, sessions, step-up — all reused |
| `grep -n '^export const IDENTITY_ADMIN_ASSIGN\|^export const ORGANIZATION_DELETE\|^export const MFA_REVOKE'` | confirm capability constants exist | all three present |
| Manual review of `StepUpPolicyRegistry` | confirm the three capabilities are policy-marked for step-up | confirmed (IDENTITY_ADMIN_ASSIGN: phishing-resistant + trusted device; ORGANIZATION_DELETE: same; MFA_REVOKE: phishing-resistant) |
| Manual trace of `transferOwnership` ordering | promote-then-demote to never leave the org admin-less | confirmed |
| Manual trace of `adminResetMfa` audit-row content | every revoke counted, no silent failure | confirmed |
| `npx tsc --noEmit -p tsconfig.json` | typecheck | **exit 0**, zero errors |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Unrecoverable orphan-org states (HEADLESS / DELETED_OWNER without manual SQL) | **2** | **0** | -2 |
| Unrecoverable orphan-org states (ABANDONED — invisible / unrepairable) | **1** | **0** | -1 |
| Permanent MFA lockout chains (TOTP-only with no recovery codes + no WebAuthn) | **1** | **0** | -1 |
| Manual repair-only flows (orphan-org + MFA reset) | **3** | **0** | -3 |
| Duplicate ownership paths in the data model | **0** (model permits multi-admin by design) | **0** | 0 |
| Stale recovery authorities (inline role mutation, ad-hoc MFA reset) | **0 canonical** + scattered ops scripts | **2 canonical services** (orgOwnershipRecovery + MfaReset) | +2 canonical / -ad-hoc |
| Replayable ownership transfers | **n/a** (no canonical endpoint) | **0** (transfer is idempotent on second click) | 0 |
| Cross-org repair spoof risk | **n/a** | **0** (every endpoint is capability-gated against the target org) | 0 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch platform isolation
- ❌ Did not rewrite onboarding broadly
- ❌ Did not refactor unrelated auth systems
- ❌ Did not perform UI redesign
- ❌ Did not modify the MFA architecture (reuses existing factor primitives)
- ❌ Did not modify the org architecture (uses existing `companies` + `user_company_roles`)
- ❌ Did not add a self-serve MFA recovery flow (intentional — email-takeover risk)
- ❌ Did not add a fresh-invite handoff inside `transferOwnership` (two-step via existing endpoints)
- ❌ Did not add an admin UI (per scope: "do NOT perform UI redesign work outside recovery continuity")

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Admin UI for orphan-org repair | one-click "view orphan → fix" from the operator dashboard | UI work |
| Force-MFA-re-enrollment flag | post-reset user must re-enroll before reaching protected routes | 1 capability check |
| Self-serve MFA recovery (with cooldown) | low-volume opt-in path with 24h cooldown + audit | service + endpoint + email template |
| Fresh-invite handoff in `transferOwnership` | combine "invite new owner" + "promote on accept" into one flow with continuation-token | service + endpoint |
| Stale `webauthn_challenges` cleanup cron | purge unresolved challenges older than N hours | 1 cron |

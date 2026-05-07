# Identity Runtime Dependency Graph — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.** Every edge cites a file:line.

This document traces the actual runtime call chains for every identity-related operation. Direction, conditional branches, rollback branches, async/RPC boundaries, and auth boundaries are explicit at every hop.

---

## Legend

```
A → B            : A directly calls B (synchronous)
A ⇢ B            : A causes B asynchronously (HTTP redirect, email click, etc.)
A ⟶ rpc:NAME     : A invokes a Postgres RPC named NAME
A ⟶ supabase:X   : A calls Supabase Auth X (auth.signUp, auth.admin.deleteUser, etc.)
[guard: X]       : conditional gate that blocks the path
[branch: X | Y]  : code path forks
[rollback: ...]  : runs only on failure of the prior call
{table.col}      : write target
```

---

## 1. Self-signup work-email (canonical)

```
pages/create-account.tsx:76 [handleSubmit]
  ├─ fetch POST /api/auth/signup
  │    pages/api/auth/signup.ts:37 [handler]
  │      ├─ rate-limit: rl:auth:signup 5/h/IP (line 44)
  │      ├─ validateWorkEmail [serverValidation.ts:16]
  │      │    [guard: BLOCKED_DOMAIN → 400]
  │      ├─ checkDomainEligibility (MX lookup)
  │      │    [guard: no_mx → 400]
  │      ├─ supabase.from('users').select('is_deleted, ...').eq('email', email)
  │      │    [branch: is_deleted=true → 403 ACCOUNT_DELETED]
  │      │    [branch: existing+role → 409 ACCOUNT_EXISTS]
  │      │    [branch: existing-no-role → 409 RESUME_SIGNUP]
  │      ├─ rpc:auth_user_confirmed(p_email)  [PROVENANCE UNKNOWN — see orphaned-logic]
  │      │    [branch: confirmed → 409 RESUME_SIGNUP]
  │      └─ {signup_intents.insert: status=pending, intent_data={company_name}, expires_at=now+24h}
  │
  ├─ supabase.auth.signUp({email, password, emailRedirectTo: <origin>/auth/callback})
  │    ⟶ supabase:signUp creates {auth.users}, sends confirmation email
  │      [guard: 'already registered' → UI redirects to /login?reason=resume_signup]
  │
  ⇢ user clicks confirmation email → /auth/callback.tsx
  
pages/auth/callback.tsx:37 [callback]
  ├─ supabase.auth.exchangeCodeForSession(code)
  │    ⟶ supabase:exchange swaps code → session in browser
  ├─ fetch POST /api/auth/sync-supabase-user (Bearer)
  │    pages/api/auth/sync-supabase-user.ts:72 [handler]
  │      ├─ verifySupabaseAuthHeader  [serverValidation.ts:30]
  │      │    ⟶ supabase.auth.getUser(token)
  │      │    returns {id, email, emailVerified}
  │      ├─ users.select(is_deleted) eq supabase_uid
  │      │    [branch: is_deleted=true → 403 + auditLog ghost_session_detected]
  │      ├─ users.select(is_deleted) eq email
  │      │    [branch: is_deleted=true → 403]
  │      ├─ rpc:auth_user_has_password(p_user_id)
  │      │    [20260422_auth_user_has_password_fn.sql:11 — confirmed]
  │      │    fail-open returns false on error
  │      │
  │      ├─ [branch UID-match]:
  │      │    {users.update supabase_uid, is_email_verified=true, last_sign_in_at=now, has_password} (line 172)
  │      │
  │      ├─ [branch EMAIL-match]:
  │      │    {users.update supabase_uid=auth.id, is_email_verified=true, last_sign_in_at=now, has_password,
  │      │      [active_company_id from user_company_roles]} (line 235)
  │      │
  │      └─ [branch BRAND-NEW]:
  │           ├─ invitations.select WHERE email AND not-expired-not-revoked
  │           │    [branch invitation: pre-link active_company_id from invitation.company_id]
  │           ├─ {users.insert id, supabase_uid, email, is_email_verified=true,
  │           │     last_sign_in_at, has_password, [active_company_id]} (line 286)
  │           └─ bootstrapCompanyFromSignupIntent(userId, email, supabaseUid)
  │                pages/api/auth/sync-supabase-user.ts:382
  │                  ├─ user_company_roles.select WHERE user_id AND status=active
  │                  │    [branch: any-active-role → return ok, no bootstrap] (line 390-397)
  │                  ├─ invitations.select WHERE email AND pending
  │                  │    [branch: pending-invite → return ok, no bootstrap] (line 402-410)
  │                  ├─ signup_intents.select intent_data.company_name
  │                  ├─ isFreeEmailDomain(emailDomain) [companyMatchService.ts:55]
  │                  │    [branch: free-email → return ok, no bootstrap] (line 427-428)
  │                  ├─ companies.select WHERE admin_email_domain=emailDomain
  │                  │    [branch: claimed → notifyAdminAndProspectOfClaimedDomain → return ok] (line 437-461)
  │                  │      └─ writes signup_referrals (line 850, 873, 897)
  │                  ├─ resolveDomain(emailDomain) — canonical-domain enforcement
  │                  │    [branch: input != final OR is_forwarding → ROLLBACK PATH below]
  │                  │
  │                  ├─ {companies.insert id, name, website=companyId-uuid,
  │                  │     admin_email_domain, domain_claimed_at=now, status='active'} (line 656)
  │                  ├─ saveDomainRecord
  │                  │    {company_domains.insert company_id, input_domain, final_domain,
  │                  │      verification_status='pending', created_via='user', is_primary=true} (line 700)
  │                  ├─ {user_company_roles.insert user_id, company_id, role='COMPANY_ADMIN',
  │                  │     status='active', join_source='self_registered', accepted_at=now} (line 733)
  │                  ├─ {users.update company_id, active_company_id, role='COMPANY_ADMIN',
  │                  │     onboarding_state='company_complete'} (line 751-759)
  │                  ├─ grantInitialFreeCredit({orgId, userId, emailDomain})
  │                  │    backend/services/initialFreeCreditService.ts:40
  │                  │      ├─ free_credit_claims.select WHERE org AND category='initial_free_credit'
  │                  │      │    [branch: already-claimed → return granted=false] (line 46-55)
  │                  │      ├─ free_credit_config.select WHERE category='initial_free_credit'
  │                  │      │    [BUG: seed used 'initial' not 'initial_free_credit' →
  │                  │      │     hardcoded fallback 50/14d kicks in (line 29-30)]
  │                  │      ├─ {organization_credits.upsert all-balances=0, credit_rate_usd=0.001} (line 79)
  │                  │      ├─ createCredit({orgId, amount, category='free', referenceType='free_credits',
  │                  │      │    idempotencyKey, phase='grant'})
  │                  │      │    └─ rpc:apply_credit_reservation
  │                  │      │         [20260322_wallet_reservation.sql:119 — confirmed]
  │                  │      │         {credit_transactions.insert + organization_credits.update free_balance+=N}
  │                  │      ├─ {free_credit_claims.insert user_id, org, category='initial_free_credit',
  │                  │      │    credits_granted, domain} (line 118)
  │                  │      └─ {companies.update free_credit_granted_at=now WHERE NULL} (line 139)
  │                  └─ {signup_intents.update status='completed', completed_at=now} (line 773-776)
  │
  │  [ROLLBACK PATH — canonical-domain rejection on BRAND-NEW INSERT]
  │      sync-supabase-user.ts:331-342
  │        ├─ {users.update is_deleted=true, deleted_at=now} (line 333)
  │        └─ supabase.auth.admin.deleteUser(supabaseUid) (line 336)
  │           [signup_intents NOT rolled back; remains as 'pending']
  │
  ├─ fetch POST /api/auth/verify-email (Bearer)
  │    pages/api/auth/verify-email.ts:28 [handler]
  │      ├─ verifySupabaseAuthHeader
  │      ├─ getSupabaseUserFromRequest
  │      │    [branch: !user → BACKSTOP INSERT path] (lines 50-83)
  │      │      ├─ supabase.auth.getUser(rawToken)
  │      │      ├─ {users.insert supabase_uid, email, is_email_verified=true} (line 63)
  │      │      └─ [fallback if column-missing] {users.insert email, is_email_verified=true} (line 70)
  │      ├─ {users.update is_email_verified=true, last_sign_in_at=now,
  │      │    onboarding_state='verified' if 'pending_verification'} (line 110-122)
  │      ├─ {signup_intents.update status='completed'} (idempotent, line 128-148)
  │      └─ route decision:
  │           [branch: !has_password → /auth/set-password]
  │           [branch: !name → /onboarding/profile]
  │           [branch: first verified → /welcome]
  │           [branch: else → getUserPreferenceRoute]
  │
  └─ fetch GET /api/auth/post-login-route (Bearer)
       pages/api/auth/post-login-route.ts:26 [handler]
         ├─ verifySupabaseAuthHeader (line 36)
         ├─ users.select by supabase_uid OR email (line 47)
         │    [branch: !user → 403 ghost session]
         │    [branch: is_deleted → 403 ACCOUNT_DELETED]
         ├─ [branch: !has_password → return /auth/set-password]
         ├─ [branch: !name OR onboarding_state ∈ {verified, pending_verification}
         │    → return /onboarding/profile]
         ├─ user_company_roles.select WHERE user_id AND status=active
         │    [branch: no-active-role → return /onboarding/company]
         ├─ {users.update company_id, role} (line 108-113) — writes deprecated column
         └─ getUserPreferenceRoute(userId)
              backend/services/userPreferencesService.ts (NOT AUDITED)
              upserts user_preferences
```

---

## 2. Magic-link login

```
pages/login.tsx [mode=email magic link]
  ├─ fetch POST /api/auth/magic-link
  │    pages/api/auth/magic-link.ts:27 [handler]
  │      ├─ rate-limit rl:auth:magic-link 5/h/IP
  │      ├─ users.select WHERE email
  │      │    [branch: is_deleted → 400 INVALID_CREDENTIALS]
  │      │    [branch: missing → fallback rpc:auth_user_confirmed]
  │      │    [branch: !confirmed → 400 INVALID_CREDENTIALS]
  │      └─ return {proceed: true}
  │
  ├─ supabase.auth.signInWithOtp({email, shouldCreateUser:false, emailRedirectTo})
  │
  ⇢ user clicks email → /auth/callback.tsx
  → SAME AS PATH 1 from /auth/callback onward (sync-supabase-user, etc.)
```

**Note:** `shouldCreateUser: false` — magic-link cannot create new users. The exception is the invitation path below.

---

## 3. Invitation acceptance

```
[ISSUANCE — admin or super-admin]
  pages/api/super-admin/users.ts:342 [POST]
  OR pages/api/company/users.ts:342 [POST]
    ├─ requireSuperAdminUser  OR  ensureCompanyAdminAccess
    ├─ findOrCreateUserByEmail
    │    [retry on PG 23505 unique-violation]
    │    {users.insert email, name=email-localpart, is_email_verified=false}
    ├─ upsertUserCompanyRole
    │    {user_company_roles.insert/update status='invited', invited_at=now}
    └─ createAndSendInvitation
         backend/services/invitationService.ts:124 [createInvitation]
           ├─ normalizeInvitationState — revoke prior pending invites (line 25-40)
           ├─ {invitations.insert email, company_id, role,
           │    token_hash=SHA256(rawToken), expires_at=now+7d,
           │    idempotency_key (optional)}
           └─ emailService.sendInvitation — emails the raw token

[ACCEPTANCE]
  ⇢ user clicks email → /auth/accept-invite?token=…
  
  pages/api/auth/accept-invite.ts:26 [handler]
    ├─ tokenHash = SHA256(rawToken)
    ├─ invitations.select WHERE token_hash
    │    [branch: accepted_at !== null → 400 ALREADY_ACCEPTED]
    │    [branch: revoked_at !== null → 400 REVOKED]
    │    [branch: token_consumed_at !== null → 400 ALREADY_USED]
    │    [branch: expires_at < now → {invitations.update revoked_at=now} → 400 EXPIRED]
    ├─ {invitations.update token_consumed_at=now WHERE id AND token_consumed_at IS NULL}
    │    (line 81 — single-flight consume)
    │    [branch: race-loser → 409]
    └─ supabase.auth.signInWithOtp({email, shouldCreateUser:true, emailRedirectTo})
         [ROLLBACK on signInWithOtp failure]
            {invitations.update token_consumed_at=null} (line 109-112)
  
  ⇢ user clicks magic link → /auth/callback.tsx
    ├─ exchangeCodeForSession
    └─ POST /api/auth/sync-supabase-user
         sync-supabase-user.ts → bootstrapCompanyFromSignupIntent
            ├─ user_company_roles.select [branch: active-role → return]
            ├─ invitations.select WHERE email AND pending
            │    ✓ MATCH → return ok (line 402-410)
            │    [SILENT BYPASS: canonical-domain check, free-email check, company creation
            │     are ALL SKIPPED for invited users — no audit log entry written]
  
  ⇢ /auth/set-password?flow=signup
    pages/api/auth/set-password.ts:11 [handler]
      ├─ verifySupabaseAuthHeader
      ├─ users.select has_password
      │    [guard signup: has_password=true → 400 INVALID_SIGNUP_FLOW] (line 50-52)
      ├─ supabase.auth.admin.updateUserById(authUserId, {password}) (line 54)
      │    [no rollback on failure → user lands on /auth/set-password again]
      ├─ invitations.select WHERE email AND consumed-pending
      │    [branch: pending-invite → rpc:activate_invitation_membership]
      │      [20260420_lockdown_idempotency.sql:136 — confirmed]
      │      flips user_company_roles.status invited→active for that org
      └─ {users.update has_password=true} (line 129-132)
```

**KEY BYPASS:** the invitation skip in `bootstrapCompanyFromSignupIntent` (line 402-410) is the load-bearing line that lets a super-admin invite a `gmail.com` user as `COMPANY_ADMIN` of any company — the canonical-domain block at line 463+ never fires because of the early return. This is documented at sync-supabase-user.ts:399-401.

---

## 4. Password recovery

```
pages/login.tsx [mode='forgot']
  ├─ fetch POST /api/auth/reset
  │    pages/api/auth/reset.ts:21 [handler]
  │      ├─ rate-limit rl:auth:reset 5/h/IP
  │      └─ return {ok:true}  [NO DB read — enumeration-safe by design]
  │
  └─ supabase.auth.resetPasswordForEmail(email, {redirectTo: <origin>/auth/set-password?flow=recovery})
       ⟶ supabase:resetPasswordForEmail sends recovery email if email exists in auth.users
  
  ⇢ user clicks recovery link → /auth/set-password?flow=recovery
       NOTE: This SKIPS /auth/callback. Recovery redirectTo lands directly here.
  
  pages/auth/set-password.tsx:46 [init]
    [branch hash-fragment: setSession({access_token, refresh_token})] (line 51-65)
    [branch PKCE code: exchangeCodeForSession(code)] (line 67-75)
    [branch existing-session: getSession()] (line 77-83)
    [branch all-fail: setStage('error') "Link expired"] (line 85-86)
  
  → POST /api/auth/set-password (Bearer, body={password, flow:'recovery'})
       pages/api/auth/set-password.ts:11
         ├─ getSupabaseUserFromRequest [branch: ACCOUNT_DELETED → 403]
         ├─ supabase.auth.getUser(rawToken) → authUserData
         ├─ users.select has_password
         │    [guard recovery: has_password=false → 400 INVALID_RECOVERY_FLOW]
         ├─ supabase.auth.admin.updateUserById(authUserId, {password})
         │    [NO rollback; failure → 500]
         ├─ [branch: pending invitation also exists for email]
         │    rpc:activate_invitation_membership — (no-op for already-active member)
         └─ {users.update has_password=true}  [no-op for recovery — already true]
       returns route
  
  ⇢ setTimeout(router.replace(route), 1200) — auto-signed-in
       [SESSION NOT INVALIDATED — pre-existing access tokens still valid]
       [NO AUDIT LOG ENTRY — auth_audit_logs has no password_changed event]
```

---

## 5. Onboarding/setup-company (free-email or invited)

```
pages/onboarding/setup-company.tsx
  → fetch POST /api/onboarding/setup-company
       pages/api/onboarding/setup-company.ts:65 [handler]
         ├─ verifySupabaseAuthHeader (Bearer required)
         ├─ users.select WHERE email
         │    [guard: is_deleted → 403]
         ├─ [branch: free-email user]
         │    ├─ user_company_roles.select WHERE user_id AND status=invited
         │    │    [branch: pending-invite → activate]
         │    │      {user_company_roles.update status='active', accepted_at=now} (line 159-162)
         │    │      {users.update company_id, onboarding_state='company_complete'} (line 166, 198)
         │    ├─ access_requests.select WHERE email AND status=approved
         │    │    [branch: approved-request → grant role]
         │    └─ [branch: neither → 403 INVITE_REQUIRED]
         ├─ [branch: free-email + active-org-count >= PUBLIC_EMAIL_MAX_ORGS] → 400
         ├─ [branch: existing active role] → return idempotent
         ├─ findMatchingCompany [branch: match → return needs-access-request]
         └─ [happy path]
              ├─ {companies.insert id, name, website, admin_email_domain, domain_claimed_at} (line 341)
              ├─ {company_profiles.insert ...}
              ├─ {user_company_roles.insert role='COMPANY_ADMIN', status='active'} (line 394)
              ├─ {users.update company_id, role='COMPANY_ADMIN', onboarding_state='company_complete'} (line 404)
              └─ grantInitialFreeCredit({orgId, userId, emailDomain=adminEmailDomain})
                   [NO free-email guard re-applied — invited gmail user GETS the 50-credit grant]
                   {free_credit_claims.insert} + rpc:apply_credit_reservation
```

---

## 6. Super-admin invite of personal email (no-domain-check path)

```
[ENTRY] auth: super_admin_session=1 cookie OR Bearer with role=SUPER_ADMIN
  pages/api/super-admin/users.ts:342 [POST]
    ├─ requireSuperAdminAccess  [super-admin/users.ts:20-25]
    │    NOTE: content_architect cookie NOT accepted on this endpoint
    ├─ Validation:
    │    [guard: missing email/companyId → 400]
    │    [guard: role=SUPER_ADMIN → 400 (only one disallowed role)]
    │    NO validateWorkEmail call
    │    NO checkDomainEligibility (MX) call
    │    NO isFreeEmailDomain check
    ├─ companies.select WHERE id [guard: not-found → 404]
    ├─ findOrCreateUserByEmail (line 50-145)
    │    [guard: existing.is_deleted → 403 ACCOUNT_DELETED]
    │    {users.insert email, name=localpart, is_email_verified=false} [retry on 23505]
    ├─ upsertUserCompanyRole
    │    {user_company_roles.upsert role='COMPANY_ADMIN', status='invited', invited_at=now}
    │    [user_company_roles.role HAS NO CHECK constraint — any string passes]
    ├─ [optional override_domain branch — line 461-539]
    │    [guard: override_type ∉ {no_website, domain_exception, manual_assignment} → 400]
    │    saveDomainRecord {company_domains.insert verification_status='admin_override',
    │                       created_via='admin'}
    │    [branch: domain conflict + confirm_reassignment=true]
    │      reassignDomain (line 513) — moves company_domains row between companies
    ├─ createAndSendInvitation [as in Path 3]
    ├─ audit_logs.insert action='SUPER_ADMIN_INVITE'
    │    [actor_user_id NULL when cookie-only super-admin]
    └─ logDomainUnverifiedUsageForCompany (fire-and-forget)

  → invitee email link → Path 3 acceptance
       SILENTLY BYPASSES canonical-domain check via pending-invitation skip
       SILENTLY BYPASSES free-email check via pending-invitation skip
       SILENTLY BYPASSES company creation (not needed — already exists)
```

---

## 7. Super-admin manual user delete

```
pages/api/super-admin/users.ts:672 [DELETE]
  ├─ requireSuperAdminAccess
  ├─ users.select id, supabase_uid, firebase_uid (line 725)
  │    [DEAD COLUMN: firebase_uid was DROPPED in 20260407]
  │    [STATUS: query may fail at runtime — see orphaned-logic]
  ├─ supabase.auth.admin.deleteUser(supabaseUid) (line 743)
  │    [tolerates not-found → idempotent]
  │    [aborts request on other errors — NO compensating rollback]
  ├─ {users.update is_deleted=true, deleted_at=now} (line 762-780)
  │    [IF THIS FAILS AFTER auth.admin.deleteUser SUCCEEDED → poisoned state,
  │     manual SQL fix per comment at line 778]
  └─ {user_company_roles.update status='inactive', deactivated_at=now WHERE user_id} (line 790-799)

  → audit_logs.insert action='SUPER_ADMIN_DELETE_USER'
```

---

## 8. Super-admin login (cookie session)

```
pages/super-admin/login.tsx
  → fetch POST /api/super-admin/login
       pages/api/super-admin/login.ts:4 [handler]
         ├─ rate-limit
         ├─ [guard: body.username !== process.env.SUPER_ADMIN_USERNAME → 401]
         ├─ [guard: body.password !== process.env.SUPER_ADMIN_PASSWORD → 401]
         ├─ Set-Cookie: super_admin_session=1; HttpOnly; SameSite=Lax; Max-Age=86400 (line 24)
         ├─ Set-Cookie: content_architect_session=; (clear conflicting cookie) (line 31)
         └─ NO audit_logs row — this login event is not auditable

  [SESSION CHECK]
  /api/super-admin/session.ts:18
    └─ requireSuperAdminUser ONLY → ignores cookie
       [returns isSuperAdmin:false for cookie-only sessions]
```

---

## 9. Content Architect login

```
pages/api/super-admin/content-architect-login.ts:23
  ├─ requireSuperAdminUser  OR  super_admin_session=1 cookie  (one of)
  ├─ Set-Cookie: content_architect_session=1 (line 54)
  ├─ Set-Cookie: content_architect_company_id=<uuid> (optional, line 63)
  ├─ Set-Cookie: super_admin_session=; (clear conflicting) (line 77)
  └─ super_admin_audit_logs.insert action='CONTENT_ARCHITECT_LOGIN'

  [DOWNSTREAM EFFECT — rbacService.ts:238-240]
    if user.userId === 'content_architect' return {role: COMPANY_ADMIN, ...}
    [GRANTS effective COMPANY_ADMIN scope across ALL companies for any
     handler that accepts content_architect_session]
```

---

## 10. Helper-call dependency map (auth helpers fan-out)

```
verifySupabaseAuthHeader [serverValidation.ts:30]
  → supabase.auth.getUser(token)
  callers (Bearer-only):
    pages/api/auth/sync-supabase-user.ts:83
    pages/api/auth/post-login-route.ts:36
    pages/api/team/accept-invite.ts:43
    pages/api/onboarding/complete.ts:50
    pages/api/onboarding/company-domain-check.ts:46
    pages/api/domain/verify.ts:82
    pages/api/domain/verification-status.ts:82
    pages/api/domain/track-event.ts:61
    pages/api/domain/regenerate-token.ts:68
    backend/middleware/authMiddleware.ts:47, :178
    archive/.../company/users/reinvite.ts:11

getSupabaseUserFromRequest [supabaseAuthService.ts:122]
  → extractCookieToken (3 cookie patterns)
  → supabase.auth.getUser(token) [5s timeout, dev-only JWT-claims fallback]
  → users.select is_deleted [branches at lines 145, 157]
  callers (Bearer OR cookie):
    pages/api/virality/playbooks/[id].ts:21
    pages/api/virality/playbooks/index.ts:21
    pages/api/user/subscription.ts:18
    pages/api/user/preferences/index.ts:42
    pages/api/super-admin/system-intelligence.ts:39
    pages/api/super-admin/system-health.ts:31
    pages/api/admin/consumption/llm.ts:39
    pages/api/admin/consumption/apis.ts:31
    pages/api/campaigns/index.ts:134
    backend/services/requestAccessService.ts:36

requireAuth [authMiddleware.ts:39]
  → verifySupabaseAuthHeader
  → users.select supabase_uid + back-fill if email-match
  callers:
    pages/api/admin/autonomous.ts:24
    pages/api/campaigns/pending/index.ts:19
    archive/unreachable-api-routes/...

requireCompanyAccess [authMiddleware.ts:99]
  callers (always after requireAuth):
    pages/api/campaigns/pending/index.ts:24
    pages/api/admin/autonomous.ts:31, :60
    pages/api/analytics/status.ts:25
    pages/api/analytics/select-property.ts:24
    pages/api/analytics/force-sync.ts:31
    pages/api/analytics/connect/google.ts:23

requireSuperAdmin [authMiddleware.ts:146]  ← Bearer-only, DIFFERENT from requireSuperAdminUser
  callers:
    pages/api/system/engagement-controls.ts:20
    pages/api/system/dead-letters.ts:19
    pages/api/admin/revenue-analytics.ts:55

requireSuperAdminUser [requestAccessService.ts:49]  ← Bearer OR cookie
  → getSupabaseUserFromRequest
  → isPlatformSuperAdmin
  callers:
    pages/api/super-admin/users.ts:24, :31
    pages/api/super-admin/session.ts:18
    pages/api/super-admin/rbac.ts:11
    pages/api/super-admin/credit-cost-config/update.ts:31
    pages/api/super-admin/companies.ts:15
    pages/api/super-admin/community-ai-metrics.ts:12
    pages/api/admin/rate-limit-config.ts:37
    pages/api/admin/queue-config.ts:41
    pages/api/admin/cron-config.ts:49
    backend/middleware/requireSuperAdmin.ts:21

isSuperAdmin [rbacService.ts:249]  ← duplicate of isPlatformSuperAdmin
  callers:
    pages/api/social/publish.ts:58
    pages/api/admin/delete-content.ts:17
    pages/api/admin/delete-campaign.ts:38
    pages/api/admin/delete-activity.ts:17
    pages/api/recommendations/[id]/create-campaign.ts:91
    pages/api/recommendation-policy.ts:57
    pages/api/social-platforms/configs.ts:45, :74
    pages/api/virality/playbooks/[id].ts:39
    pages/api/virality/playbooks/index.ts:29
    pages/api/provider-accounts/[id].ts:34
    pages/api/provider-accounts/index.ts:33
    pages/api/campaigns/list.ts:39
    pages/api/campaigns/index.ts:47, :142
    backend/services/rbacService.ts:241, :290

isPlatformSuperAdmin [rbacService.ts:260]  ← duplicate body
  callers:
    pages/api/virality/playbooks/[id].ts:37
    pages/api/virality/playbooks/index.ts:26
    pages/api/system/overview.ts:68
    pages/api/super-admin/system-intelligence.ts:40
    pages/api/super-admin/system-health.ts:32
    pages/api/super-admin/redis-metrics.ts:33
    pages/api/super-admin/queue-metrics.ts:47
    pages/api/admin/credits/index.ts:32, :45
    pages/api/admin/consumption/llm.ts:46
    pages/api/admin/consumption/apis.ts:35
    backend/services/requestAccessService.ts:56, :84, :115
    backend/services/rbacService.ts:291
    lib/api/authGuard.ts:91

enforceRole [rbacService.ts:271]
  → resolveUserContext → getSupabaseUserFromRequest
  → isSuperAdmin + isPlatformSuperAdmin (parallel — duplicate roundtrip)
  → getUserRole(userId, companyId)
  callers:
    pages/api/whitepapers/generate.ts:52
    pages/api/whatsapp/templates/index.ts:62
    pages/api/whatsapp/broadcasts/[id].ts:60
    pages/api/whatsapp/broadcasts/index.ts:72
    pages/api/articles/generate.ts:52
    pages/api/threads/generate.ts:36
    pages/api/admin/blog/generate.ts:71
    backend/middleware/withRBAC.ts:38

assertOrgMembership [requestAccessService.ts:78]
  callers:
    pages/api/activity-workspace/content.ts:471
    backend/services/creditExecutionService.ts:322

requireAuthenticatedInternalUser [requestAccessService.ts:31]
  → getSupabaseUserFromRequest [branches on ACCOUNT_DELETED]
  callers:
    pages/api/admin/system/health.ts:31
    pages/api/admin/pricing/update.ts:240
    pages/api/admin/pricing/apply.ts:36
    pages/api/admin/credits/index.ts:29, :42
    backend/services/requestAccessService.ts:53, :112
```

---

## 11. RPC and external boundaries summary

| RPC | Defined in | Called from | Purpose |
|---|---|---|---|
| `auth_user_confirmed(p_email)` | **NOT FOUND** in `supabase/migrations/` | signup.ts:139, login.ts:53, magic-link.ts:52, sync-supabase-user.ts:149 | Detect `auth.users` orphans (confirmed-but-no-app-row) |
| `auth_user_has_password(p_user_id)` | [20260422_auth_user_has_password_fn.sql:11](supabase/migrations/20260422_auth_user_has_password_fn.sql#L11) | sync-supabase-user.ts:149-165 | Reads `auth.users.encrypted_password IS NOT NULL` |
| `activate_invitation_membership(p_invitation_id, p_user_id, p_now)` | [20260420_lockdown_idempotency.sql:136](supabase/migrations/20260420_lockdown_idempotency.sql#L136) | set-password.ts:83-100 | Flips `user_company_roles.status` invited→active atomically |
| `apply_credit_reservation(p_org, p_amount, p_phase, p_idempotency_key, ...)` | [20260322_wallet_reservation.sql:119](supabase/migrations/20260322_wallet_reservation.sql#L119), rewritten in [20260323_remove_balance_credits.sql](supabase/migrations/20260323_remove_balance_credits.sql) | creditExecutionService.ts:193 (HOLD/CONFIRM/RELEASE) | Wallet mutations + ledger insert |
| `apply_credit_partial_confirm` | [20260322_wallet_reservation.sql] (later additive) | creditExecutionService.ts:244 | Partial CONFIRM with measured cost |
| `free_credits_summary` | (referenced from super-admin/free-credits/summary.ts) | summary.ts | Aggregation view |

| Supabase Auth call | Caller (file:line) | Effect |
|---|---|---|
| `supabase.auth.signUp` | pages/create-account.tsx:135-139 | Creates `auth.users`, sends confirmation email |
| `supabase.auth.signInWithPassword` | pages/login.tsx (browser) | Returns access+refresh tokens |
| `supabase.auth.signInWithOtp({shouldCreateUser:false})` | pages/login.tsx (magic-link mode) | Login-only OTP |
| `supabase.auth.signInWithOtp({shouldCreateUser:true})` | pages/api/auth/accept-invite.ts:99-106 | The ONLY path that creates an `auth.users` row for a non-self-signup user |
| `supabase.auth.resetPasswordForEmail` | pages/login.tsx:292-294 | Sends recovery email |
| `supabase.auth.exchangeCodeForSession` | pages/auth/callback.tsx:37; pages/auth/set-password.tsx:67-75 | PKCE code → session |
| `supabase.auth.setSession` | pages/auth/set-password.tsx:51-65 | Hash-fragment recovery flow |
| `supabase.auth.getUser(token)` | backend/services/supabaseAuthService.ts:77-119; pages/api/auth/set-password.ts:34-38; verify-email.ts:50+ | Token → user lookup with 5s timeout |
| `supabase.auth.admin.updateUserById(id, {password})` | pages/api/auth/set-password.ts:54 | The ONLY production password mutation |
| `supabase.auth.admin.deleteUser(uid)` | pages/api/super-admin/users.ts:743; pages/api/auth/sync-supabase-user.ts:336 | Auth row deletion |
| `supabase.auth.admin.createUser` | NONE in production code (only Jest mock at backend/tests/integration/user_lifecycle_management.test.ts:215) | — |
| `supabase.auth.admin.signOut(userId)` | NONE | No "log out all sessions" mechanism exists |

---

## 12. Cookie boundaries

```
Cookie: sb-<project>-auth-token
  set by: Supabase client (browser) on session establishment
  read by: extractCookieToken [supabaseAuthService.ts:14-57]
  patterns supported: sb-<project>-auth-token, auth-token, supabase-auth

Cookie: super_admin_session=1
  set by: pages/api/super-admin/login.ts:24 (env-credential auth)
  read by: backend/services/superAdminSession.ts:6
  cleared by: pages/api/super-admin/logout.ts:7
  cleared by: pages/api/super-admin/content-architect-login.ts:77

Cookie: content_architect_session=1
  set by: pages/api/super-admin/content-architect-login.ts:54
  read by: backend/services/contentArchitectService.ts:14
  read by: proxy.ts:45 (middleware dispatch)
  cleared by: pages/api/super-admin/login.ts:31
  cleared by: pages/api/super-admin/logout.ts:14

Cookie: content_architect_company_id=<uuid>
  set by: pages/api/super-admin/content-architect-login.ts:63
  read by: backend/services/contentArchitectService.ts:22
  cleared by: pages/api/super-admin/logout.ts:21
```

---

## 13. Cross-flow shared subroutines

```
findOrCreateUserByEmail
  duplicate definitions:
    pages/api/super-admin/users.ts:50-145
    pages/api/company/users.ts:115-155 (similar)

bootstrapCompanyFromSignupIntent
  pages/api/auth/sync-supabase-user.ts:382-800
  callers: only sync-supabase-user.ts:200, :255, :305

grantInitialFreeCredit
  backend/services/initialFreeCreditService.ts:40-144
  callers:
    pages/api/auth/sync-supabase-user.ts:765-769 (work-email bootstrap)
    pages/api/onboarding/setup-company.ts:441-449 (free-email + invited paths)

createCredit
  backend/services/creditExecutionService.ts:817-847
  callers:
    backend/services/initialFreeCreditService.ts:90+ (initial grant)
    pages/api/super-admin/free-credits/grant.ts:78-91 (admin grant — writes to PAID category)
    backend/services/purchaseService.ts:41+ (purchase completion)

normalizeInvitationState
  backend/services/invitationService.ts:25-40
  revokes prior pending invites for same (email, company)
  caller: createAndSendInvitation (line 124-153)

resolveDomain (canonical-domain enforcement)
  backend/services/domainCanonicalService.ts
  caller: sync-supabase-user.ts:463-653 (USER flow only)
  [BYPASSED for invitation flow at sync-supabase-user.ts:402-410]

verifySupabaseAuthHeader (Bearer-only)
isSuperAdmin / isPlatformSuperAdmin (DB-backed, identical bodies)
extractCookieToken (cookie patterns)
  — see Section 10
```

---

## 14. Async boundaries (request lifecycle splits)

The user's identity is established asynchronously across HTTP requests:

```
T0  POST /api/auth/signup            (signup_intents row written)
T1  supabase.auth.signUp             (auth.users row written, email queued)
T2  user clicks email link           (network roundtrip — minutes/hours/days later)
T3  GET /auth/callback?code=…        (exchangeCodeForSession)
T4  POST /api/auth/sync-supabase-user (users + companies + roles + credits — single request)
T5  POST /api/auth/verify-email       (idempotent re-assertion)
T6  GET /api/auth/post-login-route    (route resolution)
```

T2 is unbounded — `signup_intents` rows stale after `expires_at = T0+24h`. Between T0 and T4, the user has no `users` row. Between T4 and T6, the user is in onboarding state but the routing has not landed.

The pending-invitation skip in `bootstrapCompanyFromSignupIntent` (line 402-410) means an invited user's identity is established at T4 with a different code path than a self-signup user, but in the same request cycle.

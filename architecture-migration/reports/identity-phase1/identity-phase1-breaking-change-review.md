# Identity Phase 1 — Breaking Change Review (Wave 1)

**Branch:** `identity-spine-consolidation`
**Wave:** 1 of 3
**Date:** 2026-05-07

This document inventories the user-visible / operational impact of Wave 1 changes. Wave 2 and Wave 3 are tracked separately.

---

## Compatibility risks

### Risk 1 — Schema/runtime mismatch on `users.role` and `users.company_id`

**State:** Both columns still exist in the production DB (NOT dropped). Production code no longer reads or writes either column. Any external integration that reads `users.role` or `users.company_id` — including BI dashboards, RLS policies that reference these columns, or ad-hoc SQL — will see stale data going forward.

**Magnitude:** New users created post-Wave-1 will have NULL `users.role` and NULL `users.company_id`. Existing users keep whatever value those columns held at the time of their last write.

**Surfaces to check before Wave 2 column-drop migration:**
- RLS policies that reference `users.role` or `users.company_id` (per [supabase/migrations/20260403_enable_rls_all_tables.sql](supabase/migrations/20260403_enable_rls_all_tables.sql)).
- Any dashboards / scripts in `scripts/` that read these columns.
- Any external system (Stripe, Mixpanel, etc.) that's pulling user metadata via `users` view.

### Risk 2 — `auth_audit_logs.firebase_uid` column NULLs

**State:** `lib/auth/auditLog.ts` no longer writes `firebase_uid` into `auth_audit_logs`. The column still exists in DB. New audit rows will have NULL in this field.

**Magnitude:** Trivial — the column was already being written as NULL (the code wrote `opts.firebaseUid ?? null` and no caller passed `firebaseUid`).

### Risk 3 — `free_credit_profiles.firebase_uid` schema-source mismatch

**State:** `database/free-credits-schema.sql` no longer declares the column, but the column still exists in the prod DB. Drift between the schema file and reality.

**Magnitude:** No production code reads or writes the column. Only relevant if anyone re-creates the schema from the file (which they shouldn't — migrations are the source of truth).

---

## Migration impacts (DB)

| Migration debt | Wave |
|---|---|
| Drop `users.role` column | Wave 2 or post-Wave-3 |
| Drop `users.company_id` column | Wave 2 or post-Wave-3 |
| Drop `auth_audit_logs.firebase_uid` column + index | Wave 2 |
| Drop `free_credit_profiles.firebase_uid` column | Wave 2 |
| Provision canonical `user_company_roles WHERE role='SUPER_ADMIN'` row | Wave 3 prerequisite — **the user must designate which `users.id` / email gets promoted** |

---

## UI impacts

### UI surface: `pages/admin/users.tsx`

- The role-edit dropdown reads `user.role` from an API response (`backend/services/userManagementService.ts:listUsers`). The API source already queries `user_company_roles`. UI behavior unchanged.

### UI surface: `pages/auth/callback.tsx`, `pages/login.tsx`

- `getSupabaseUserFromRequest` and `requireAuth` still respond with the same shapes; UI flows unchanged.
- `verify-email.ts` no longer falls back to schema-version-pre-2026-04-06 INSERT semantics. Any user whose Supabase auth row exists but `users` row is missing will hit the new resolver path; the row-creation backstop still works the same way.

### UI surface: super-admin / content-architect dashboards

- Wave 1 made NO changes to super-admin or content-architect cookies. UI flows unchanged.
- Wave 3 will affect these dashboards (per Task 7 plan).

---

## Admin impacts

### Super-admin user-delete flow

- `pages/api/super-admin/users.ts` DELETE handler used to SELECT `firebase_uid` along with `supabase_uid`. The Phase 1 audit identified this as a schema-error risk — the SELECT could have failed on current schema.
- **Post-Wave-1**: SELECT only reads `id, supabase_uid`. The DELETE flow is now correct on current schema.
- **Risk eliminated**: super-admin DELETE is no longer at risk of failing at the SELECT step.

### Company-admin invite flow

- The `addExistingUserToCompany` fast-path (auto-add without invite) was DELETED. It was gated on `firebase_uid` being truthy — a permanently-false condition since 2026-04-07.
- **Behavioral change** observable to admins: every invite now sends an email, even if the target user is already authenticated in another company. Pre-Wave-1, the code attempted to take an auto-add path that was actually unreachable, so the practical behavior is unchanged.

### Admin/feedback super-admin gate

- `pages/api/admin/feedback.ts` now uses `isPlatformSuperAdmin` instead of a local `users.role='SUPER_ADMIN'` check.
- **Behavioral change**: pre-Wave-1, the check would have matched any user with `users.role='SUPER_ADMIN'`. Post-Wave-1, it requires a `user_company_roles WHERE role='SUPER_ADMIN'` row.
- **Implication**: Combined with the DB state (zero `user_company_roles` SUPER_ADMIN rows), `/api/admin/feedback` is currently unreachable to any user. This was already true for the cookie-only super-admin path (this endpoint never accepted the cookie). The remediation is the Wave 3 SUPER_ADMIN provisioning step — Wave 1 surfaces the gap rather than masking it.

---

## Onboarding impacts

### Self-signup work-email flow

- Bootstrap (`bootstrapCompanyFromSignupIntent`) no longer writes `users.role` or `users.company_id`. It writes `users.active_company_id` and `users.onboarding_state` only. Role still gets created in `user_company_roles`.
- Routing decisions in `pages/api/auth/post-login-route.ts` now read role/active-org exclusively from `user_company_roles`/`users.active_company_id`.
- **Behavior change**: identical end-to-end UX. The user reaches the same destination.

### Free-email / invitation-acceptance flow

- `pages/api/onboarding/setup-company.ts` 4 paths and `pages/api/team/accept-invite.ts` no longer write the deprecated columns.
- **Behavior change**: same end-to-end UX.

### Resume-status / abandoned-signup detection

- `pages/api/auth/resume-status.ts` no longer combines `users.role && users.company_id && companyRole` to detect a "completed" account. It now uses only `user_company_roles` active-row presence.
- **Behavior change**: more accurate detection. Pre-Wave-1, a user with stale `users.role`/`users.company_id` (set during a previous failed bootstrap) but no active role would have been wrongly flagged as completed. Post-Wave-1, that edge case resolves correctly.

### `pages/api/auth/signup.ts`

- Same gate simplification as resume-status. Behaviour: equivalent or strictly more correct.

---

## Invitation impacts

- Wave 1 made NO changes to the invitation lifecycle. Wave 2 (Task 6) will harden invitation activation with a mandatory audit event and centralized orchestration.

---

## Operational impacts

### Auth resolution semantics

- The dev-only JWT-claims fallback in `backend/services/supabaseAuthService.ts` was REMOVED. In dev environments where Supabase auth times out (>5s), requests will now fail closed with `INVALID_TOKEN` instead of silently falling back to JWT claims.
- **Impact on local dev**: if Supabase auth becomes unreachable, local development loses the ability to authenticate. (No production impact — the fallback was dev-only.)

### Cookie token extraction

- Centralized in `backend/services/authResolver.ts`. Three cookie patterns still supported (`sb-*-auth-token`, `auth-token`, `supabase-auth`). Behavior identical.

### Logging

- New log keys: `auth_resolver_supabase_lookup_failed`, `auth_resolver_token_invalid`, `auth_resolver_cookie_base64_decode_failed`, `auth_resolver_cookie_parse_failed`. Replace the corresponding `supabase_*` log keys from the legacy implementation.

---

## Public API surface

No HTTP API changes. All endpoint URLs, request/response shapes, and error codes are preserved.

---

## Roll-back guidance

If a critical issue surfaces post-deploy:

1. Each Wave 1 commit is independently revertable:
   - `7a69a3c1` — firebase removal (lowest blast radius)
   - `2bccbcca` — deprecated reads/writes removal (highest blast radius — affects routing)
   - `6f9fb6d9` — auth resolver consolidation (medium blast radius)

2. Reverting `2bccbcca` (Tasks 1+2) will restore the deprecated dual-authority writes. The deprecated columns will start accumulating new writes again, but read-side routing will fall back to `user_company_roles` correctly because the canonical writes were already in place.

3. Reverting `6f9fb6d9` (Tasks 4+8) will restore the duplicate logic across `verifySupabaseAuthHeader`, `getSupabaseUserFromRequest`, `requireAuth`. Behavior pre/post-revert is functionally equivalent (the new resolver was a refactor, not a behavior change).

4. Reverting `7a69a3c1` (Task 5) re-introduces the `firebase_uid` SELECT in super-admin DELETE — which would re-introduce the runtime-error risk on current schema. NOT recommended unless paired with re-adding the column (which would also require dropping the column-drop migration's effect).

---

## Wave 2 / Wave 3 prerequisites surfaced by Wave 1

1. **Provision a canonical SUPER_ADMIN.** Required before Wave 3 Task 7 can begin. The user must designate a target user (email or `users.id`).
2. **Migration to drop deprecated columns.** Optional in Wave 1 for safety; recommended in Wave 2.
3. **Audit-event taxonomy update.** Wave 2 needs `invitation_canonical_domain_bypass` added to `AuthAuditEvent` enum.
4. **`profiles.is_super_admin` column** — third super-admin authority not in the original Phase 1 audit. Wave 3 must address.

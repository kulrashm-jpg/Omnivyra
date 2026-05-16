# Stability Guards

These guards are lightweight contract boundaries. They should make drift visible without becoming a rewrite framework or a substitute for product tests.

These tests protect critical platform contracts without mutating data, changing schemas, or executing operator tools.

Protected contracts:

- Auth login remains a server precheck followed by Supabase password sign-in.
- Invalid login stays generic and predictable.
- Supabase session fields consumed by the login page remain present.
- `sync-supabase-user` keeps public user, Supabase UID, MFA, and session projection contracts stable.
- Session summary keeps role, organization, MFA, step-up, and device shape stable.
- Password reset and recovery-login response structures remain stable.
- Company billing summary, ledger, export, and idempotency recovery contracts remain org-scoped and shape-stable.
- Runtime startup does not import or execute operator scripts.
- Frontend code must not reference service-role secrets.

Forbidden assumptions:

- Stability tests must not create, update, delete, upsert, or migrate data.
- Stability tests must not call Supabase, external APIs, operator scripts, or dev startup commands.
- Operator scripts must not become dependencies of `npm run dev`, `npm run start`, or frontend/runtime bundles.

Do not casually change:

- `pages/login.tsx`
- `pages/api/auth/login.ts`
- `pages/api/auth/sync-supabase-user.ts`
- `pages/api/auth/session.ts`
- `pages/api/auth/post-login-route.ts`
- `pages/api/company/billing/*`
- `backend/services/billing/idempotency/*`
- `scripts/start-all.js`
- `scripts/_core/operatorSafety.ts`

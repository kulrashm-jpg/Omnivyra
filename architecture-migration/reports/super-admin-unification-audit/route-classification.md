# Super-Admin & Admin Route Classification

**Generated**: 2026-05-07
**Method**: source-grounded inspection of every route under `pages/super-admin/`, `pages/api/super-admin/`, `pages/api/admin/`, and admin-relevant routes elsewhere.

Classification scheme (per prompt):
- **A — canonical-auth compliant**: uses `requireCapability` or `resolvePrincipal` exclusively
- **B — bridge-only**: only the legacy cookie path grants authority
- **C — dual-authority**: cookie short-circuits OR Supabase token + role check (parallel chains)
- **D — hard bypass**: the route has its own ad-hoc cookie check or no auth at all on a sensitive surface
- **E — dead/legacy**: dead path / unused / obsolete

---

## Summary table

| Class | Count | Wave 3 disposition |
|---|---|---|
| A — canonical compliant | 30 | KEEP |
| B — bridge-only | 4 | DELETE in Wave 3 |
| C — dual-authority | ~80 | migrate to A in Wave 3B/3 |
| D — hard bypass | 5 | URGENT — migrate or quarantine |
| E — dead/legacy | 3 | DELETE |
| **Total audited** | ~122 | — |

(Counts approximate; some routes have multiple handlers with mixed patterns. The full list below.)

---

## Class A — canonical-auth compliant (30 routes)

### Capability-gated (15)

| Route | Capability |
|---|---|
| [pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts) | `IDENTITY_ADMIN_ASSIGN` |
| [pages/api/admin/revoke-super-admin.ts](../../../pages/api/admin/revoke-super-admin.ts) | `IDENTITY_ADMIN_ASSIGN` |
| [pages/api/auth/passkeys/revoke.ts](../../../pages/api/auth/passkeys/revoke.ts) | self-targeted |
| [pages/api/auth/totp/recovery/regenerate.ts](../../../pages/api/auth/totp/recovery/regenerate.ts) | self-targeted |
| [pages/api/auth/totp/revoke.ts](../../../pages/api/auth/totp/revoke.ts) | self-targeted |
| [pages/api/external-apis/index.ts](../../../pages/api/external-apis/index.ts) (platform-scope GET only) | mixed — see Class C below |
| [pages/api/super-admin/credit-cost-config/update.ts](../../../pages/api/super-admin/credit-cost-config/update.ts) | `BILLING_MANAGE` |
| [pages/api/super-admin/free-credits/grant.ts](../../../pages/api/super-admin/free-credits/grant.ts) | `BILLING_GRANT_FREE_CREDITS` (with Class E side-effect) |
| [pages/api/super-admin/free-credits/requests.ts](../../../pages/api/super-admin/free-credits/requests.ts) | `BILLING_GRANT_FREE_CREDITS` (Class E side-effect) |
| [pages/api/super-admin/plans/create.ts](../../../pages/api/super-admin/plans/create.ts) | `BILLING_PLAN_MANAGE` |
| [pages/api/super-admin/purchases/complete.ts](../../../pages/api/super-admin/purchases/complete.ts) | `BILLING_MANAGE` |
| [pages/api/super-admin/users.ts](../../../pages/api/super-admin/users.ts) | `IDENTITY_ADMIN_VIEW`/`MUTATE` |
| [pages/api/team/self-joined.ts](../../../pages/api/team/self-joined.ts) | `TEAM_VIEW_SELF` |
| [pages/api/virality/playbooks/index.ts](../../../pages/api/virality/playbooks/index.ts) | `PLAYBOOK_MANAGE` |
| [pages/api/virality/playbooks/[id].ts](../../../pages/api/virality/playbooks/[id].ts) | `PLAYBOOK_MANAGE` |

### `resolvePrincipal` direct (15)

The `pages/api/auth/*` self-service routes — passkeys, totp, devices, sessions, step-up, capabilities, session, refresh.

---

## Class B — bridge-only (4 routes)

These ONLY accept the bridge cookie; canonical auth never applies.

| Route | Behavior |
|---|---|
| [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) | Mints C1 cookie via env-var compare |
| [pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts) | Clears C1+C2+C3 cookies |
| [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) | Mints C2+C3 via env-var compare |
| [pages/super-admin/login.tsx](../../../pages/super-admin/login.tsx) | UI for the above |

Wave 3 deletes these together with `legacyCookieSuperAdminBridge.ts`.

---

## Class C — dual-authority (~80 routes)

These accept multiple authority sources with route-local precedence. Cookie usually wins. Examples:

### Pattern A (cookie short-circuit + Supabase fallback) — 67 files
Sample (full list available via `grep "super_admin_session" pages/api/`):
- [pages/api/admin/audit-logs.ts:11](../../../pages/api/admin/audit-logs.ts) — cookie OR `isPlatformSuperAdmin`
- [pages/api/admin/blog/*.ts](../../../pages/api/admin/blog/) — same pattern across 7 files
- [pages/api/admin/cache-management.ts](../../../pages/api/admin/cache-management.ts)
- [pages/api/admin/config/[type].ts](../../../pages/api/admin/config/[type].ts)
- [pages/api/admin/consumption/*.ts](../../../pages/api/admin/consumption/) — 5 files
- [pages/api/admin/cost-accounting.ts](../../../pages/api/admin/cost-accounting.ts)
- [pages/api/admin/external-users.ts](../../../pages/api/admin/external-users.ts)
- [pages/api/admin/intelligence/*.ts](../../../pages/api/admin/intelligence/) — 6 files
- [pages/api/admin/platform-oauth-configs/index.ts](../../../pages/api/admin/platform-oauth-configs/index.ts)
- [pages/api/admin/railway-*.ts](../../../pages/api/admin/) — 2 files
- [pages/api/admin/access-requests/approve.ts](../../../pages/api/admin/access-requests/approve.ts)
- [pages/api/admin/experiment/toggle.ts](../../../pages/api/admin/experiment/toggle.ts)
- [pages/api/cron/anomaly-sweep.ts](../../../pages/api/cron/anomaly-sweep.ts)
- [pages/api/super-admin/*.ts](../../../pages/api/super-admin/) — many top-level routes
- [pages/api/social-accounts/verify-config.ts](../../../pages/api/social-accounts/verify-config.ts)
- [pages/api/organization/usage-summary.ts](../../../pages/api/organization/usage-summary.ts), [enforcement-state.ts](../../../pages/api/organization/enforcement-state.ts)

### Pattern B (`getLegacySuperAdminSession` + Supabase fallback) — 19 files
- [pages/api/external-apis/index.ts](../../../pages/api/external-apis/index.ts)
- [pages/api/external-apis/access.ts](../../../pages/api/external-apis/access.ts)
- [pages/api/external-apis/company-config.ts](../../../pages/api/external-apis/company-config.ts)
- [pages/api/external-apis/health-summary.ts](../../../pages/api/external-apis/health-summary.ts)
- [pages/api/external-apis/platforms.ts](../../../pages/api/external-apis/platforms.ts)
- [pages/api/external-apis/presets.ts](../../../pages/api/external-apis/presets.ts)
- [pages/api/company/llm-config.ts](../../../pages/api/company/llm-config.ts), [llm-providers.ts](../../../pages/api/company/llm-providers.ts)
- [pages/api/company-profile/index.ts](../../../pages/api/company-profile/index.ts)
- + 10 others

### Pattern C (`isContentArchitectSession` + Supabase fallback) — 13 files
- [pages/api/activity-workspace/creator-asset.ts](../../../pages/api/activity-workspace/creator-asset.ts)
- [pages/api/activity-workspace/resolve.ts](../../../pages/api/activity-workspace/resolve.ts)
- [pages/api/admin/platform-oauth-configs/index.ts](../../../pages/api/admin/platform-oauth-configs/index.ts) (overlaps with Pattern A)
- [pages/api/campaigns/index.ts](../../../pages/api/campaigns/index.ts)
- [pages/api/company-profile/index.ts](../../../pages/api/company-profile/index.ts) (overlaps)
- [pages/api/content-architect/search.ts](../../../pages/api/content-architect/search.ts)
- [pages/api/super-admin/credit-packages/index.ts](../../../pages/api/super-admin/credit-packages/index.ts)
- [pages/api/super-admin/free-credits/activity.ts](../../../pages/api/super-admin/free-credits/activity.ts), [profiles.ts](../../../pages/api/super-admin/free-credits/profiles.ts), [summary.ts](../../../pages/api/super-admin/free-credits/summary.ts)
- [pages/api/super-admin/plans/toggle.ts](../../../pages/api/super-admin/plans/toggle.ts)

### Pattern D (`requireSuperAdminUser` only — Supabase-only DB-backed) — ~60 files
These are technically NOT dual-authority because they don't honor the bridge cookie. Listed here for completeness because they ARE part of the super-admin admin surface.

Sample:
- All of [pages/api/super-admin/](../../../pages/api/super-admin/) NOT in Class A or Class B
- [pages/api/admin/audit-logs.ts](../../../pages/api/admin/audit-logs.ts) (also Pattern A)
- [pages/api/admin/blog/index.ts](../../../pages/api/admin/blog/index.ts) (Pattern A + this)

These will FAIL for a bridge-cookie-only operator. They are correctly hardened in this respect — but they are still on the legacy facade and need to migrate to `requireCapability` for consistency and audit.

---

## Class D — hard bypass (5 routes)

These have ad-hoc auth that bypasses every helper.

| Route | Bypass | Risk |
|---|---|---|
| [pages/api/super-admin/platform-oauth-configs.ts](../../../pages/api/super-admin/platform-oauth-configs.ts) | Reads C1, C2, Bearer (T1), and SSR Supabase cookies (S1), then queries `super_admins` table (G1 — DEAD) and falls back to ANY admin role string. Five auth surfaces, one route. | High — multiple silent fallbacks; SSR cookie path is the only one in the codebase |
| [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) | env-only; no Supabase, no DB, no audit | the **mint surface** — trivial replay if env leaks |
| [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) | env-only; writes `super_admin_audit_logs` table | same |
| [pages/api/social-accounts/status.ts](../../../pages/api/social-accounts/status.ts) | reads `super_admins` table (G1 — DEAD) | dead, but currently silently grants nothing — danger if table is created |
| [proxy.ts](../../../proxy.ts) | forwards bridge cookie | low — not authority itself but propagates state |

---

## Class E — dead/legacy (3)

| Item | Path | Reason |
|---|---|---|
| `super_admins` table reads | [pages/api/super-admin/platform-oauth-configs.ts:60-66](../../../pages/api/super-admin/platform-oauth-configs.ts), [pages/api/social-accounts/status.ts](../../../pages/api/social-accounts/status.ts) | Table does not exist in remote DB; queries silently return null |
| `userId === 'content_architect'` short-circuits | [backend/services/rbacService.ts:235,279](../../../backend/services/rbacService.ts), [backend/services/userContextService.ts:94](../../../backend/services/userContextService.ts), [pages/api/campaigns/list.ts:31](../../../pages/api/campaigns/list.ts) | Reachable only via the synthetic content-architect path; dead once Class B routes delete |
| `pages/api/super-admin/session.ts` | [pages/api/super-admin/session.ts](../../../pages/api/super-admin/session.ts) | DOC says "Replaces the legacy cookie check" but only does Supabase-only `requireSuperAdminUser`. Dead probe — UI doesn't appear to call it (super-admin dashboard goes straight to `/api/super-admin/platform-oauth-configs` for the auth probe). |

---

## Per-route disposition for Wave 3B/Wave 3

| Route | Class | Wave |
|---|---|---|
| All Class A routes (30) | A | KEEP |
| Class B login/logout endpoints (4) | B | Wave 3 (DELETE) |
| Class C Pattern A (67) | C | Wave 3B (migrate to `requireCapability`) |
| Class C Pattern B (19) | C | Wave 3B (replace `getLegacySuperAdminSession` with `requireCapability`) |
| Class C Pattern C (13) | C | Wave 3B + 3 (collapse content-architect) |
| Class C Pattern D (~60 `requireSuperAdminUser`) | C | Wave 3B (migrate to `requireCapability` for canonical audit) |
| Class D platform-oauth-configs | D | Wave 3B URGENT — has the most parallel paths |
| Class D login/content-architect-login | D | Wave 3 (DELETE with bridge) |
| Class D social-accounts/status | D | Wave 3B (remove dead `super_admins` query) |
| Class E `super_admins` reads | E | Wave 3B (delete refs) |
| Class E content_architect short-circuits | E | Wave 3 (delete with bridge) |
| Class E `/api/super-admin/session.ts` | E | Wave 3 (delete; UI does not consume) |

---

## Notable structural observations

1. **No Next.js `middleware.ts`** at the project root — every auth gate is route-handler-local. This means there is no single chokepoint where Wave 3B can install a "deny everything not canonical" rule. Every route migrates individually.
2. **`fetchWithAuth` (frontend)** sends Bearer token only when a Supabase session exists. For super-admin sessions, only cookies travel — meaning every super-admin API MUST honor the bridge cookie for the dashboard to work today, and any cookie-removal forces a parallel Supabase-login flow first.
3. **No CSRF protection** evident on the bridge mint endpoints. `super_admin_session=1` is set with `SameSite=Lax` which mitigates CSRF for unsafe methods, but the env-var compare in [login.ts](../../../pages/api/super-admin/login.ts) does not check origin/referer. **Class D risk** but limited because env knowledge is required.
4. **`SUPER_ADMIN_FALLBACK` debug log** in `external-apis/index.ts:51-56` indicates that `isSuperAdmin` and `isPlatformSuperAdmin` can disagree. Both ARE `user_company_roles.role='SUPER_ADMIN'` queries, but `isSuperAdmin` doesn't filter by `status='active'` while `isPlatformSuperAdmin` doesn't either — they're effectively identical now. The debug log is leftover from an earlier divergence.

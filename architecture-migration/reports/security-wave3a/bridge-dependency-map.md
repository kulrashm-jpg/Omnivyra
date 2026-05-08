# Wave 3A — Bridge Dependency Map

**Branch**: `identity-spine-enforcement`
**Generated**: 2026-05-07
**Question answered**: "What would break if `legacyCookieSuperAdminBridge.ts` were deleted today, and how do we observe that ahead of time?"

---

## 1. The bridge surface (single point of synthesis)

```
                  HTTP request
                       │
                       ▼
        ┌─────────────────────────────────┐
        │   resolvePrincipal(req)          │
        │   (IdentityResolver.ts)          │
        └────────┬───────────┬─────────────┘
                 │           │
       Supabase  │           │  fallback to bridge
       wins      │           ▼
                 │  resolveLegacyCookieSuperAdminPrincipal(req)
                 │  (legacyCookieSuperAdminBridge.ts)
                 │           │
                 │           │  if super_admin_session=1
                 │           │  OR content_architect_session=1
                 │           │  AND env vars set
                 │           │  AND not hard-expired
                 │           │  AND NOT LEGACY_BRIDGE_DRY_RUN
                 │           ▼
                 │  ┌───────────────────────────────┐
                 │  │ AuthenticatedPrincipal {       │
                 │  │   userId: 'legacy:cookie-…'   │
                 │  │   sessionId: null              │
                 │  │   capabilities: bridge-allow   │
                 │  │   legacyCookieSuperAdmin: true │
                 │  │ }                              │
                 │  └───────────────────────────────┘
                 ▼
       Capability + step-up evaluation
       (bridge always rejected at step-up)
```

The bridge's authority is synthesized entirely inside `resolveLegacyCookieSuperAdminPrincipal`. There is **no other code path that produces a principal with `legacyCookieSuperAdmin: true`**. Every consumer of bridge authority ultimately came through this single function.

---

## 2. Direct callers of the bridge function

Only one file imports `resolveLegacyCookieSuperAdminPrincipal`:

- [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts):253 — fallback in `resolvePrincipal`.

This is intentional. Wave 1 consolidation made `IdentityResolver` the only caller, so Wave 3 deletion is mechanically simple: delete the bridge file, delete that one import + 5-line fallback, run typecheck.

---

## 3. Indirect bridge consumers (reach the bridge through `resolvePrincipal`)

Anything that calls `resolvePrincipal` can receive a bridge principal. The audit telemetry below records bridge usage to distinguish "actual bridge dependency" from "happens to call resolvePrincipal but never sees bridge in production".

### Bridge-allowed at the capability layer

These will return data to a bridge principal because the bridge allowlist (`legacyCookieSuperAdminCapabilities()`) includes the capabilities they require:

| Route | Capability required | Bridge in allowlist? |
|---|---|---|
| `pages/api/external-apis/index.ts` (GET tenant) | none in tenant POST path; uses role-string | partial |
| `pages/api/super-admin/users.ts` (GET) | `IDENTITY_ADMIN_VIEW` | yes |
| `pages/api/team/self-joined.ts` | `TEAM_VIEW_SELF` | yes |

(All other capability-gated routes either require step-up — which the bridge cannot satisfy — or require capabilities outside the bridge allowlist.)

### Bridge-blocked at the step-up layer

Every route in the elevated-action set automatically rejects bridge principals because `evaluateStepUp(principal, requirement)` returns `BRIDGE_PRINCIPAL_INELIGIBLE` whenever `principal.legacyCookieSuperAdmin === true`. This includes:

- `pages/api/admin/bootstrap-super-admin.ts` (mode=bootstrap explicitly rejects bridge before policy eval; mode=promote rejects via `requireCapability` step-up)
- `pages/api/admin/revoke-super-admin.ts`
- `pages/api/super-admin/credit-cost-config/update.ts`
- `pages/api/super-admin/plans/create.ts`
- `pages/api/super-admin/purchases/complete.ts`
- `pages/api/super-admin/users.ts` PATCH/DELETE
- All `pages/api/auth/*` mutation routes (passkey/totp/device/session)

### Bridge-blocked at the auth layer (unrelated to bridge cookie)

Routes calling `requireSuperAdminUser` from `requestAccessService.ts` go through `getSupabaseUserFromRequest`, which only validates Supabase tokens. Bridge cookies are silently ignored. These routes were never bridge-reachable.

---

## 4. Direct cookie readers (bypass the canonical resolver)

These files read `super_admin_session` or `content_architect_session` cookies directly without going through `resolveLegacyCookieSuperAdminPrincipal`. Each one must be evaluated for whether it grants AUTHORITY (Wave 3 must replace) or merely BRANCHES UI (Wave 3 deletes branch).

### Authority-granting (must replace before bridge removal)

| File | Behavior | Wave 3 plan |
|---|---|---|
| [backend/services/superAdminSession.ts](../../../backend/services/superAdminSession.ts) | Central cookie helper | Delete; replace callers with `resolvePrincipal` |
| [backend/services/contentArchitectSecurityService.ts](../../../backend/services/contentArchitectSecurityService.ts) | Authority for content-architect-mode | Replace with capability check (`CONTENT_ARCHITECT_*`) |
| [backend/services/contentArchitectService.ts](../../../backend/services/contentArchitectService.ts) | Same | Same |
| [backend/middleware/authMiddleware.ts](../../../backend/middleware/authMiddleware.ts) | Reads cookie name in legacy facade | Delete bridge branch |
| [proxy.ts](../../../proxy.ts) | Forwards cookie | Delete forwarding rule |

### UI branching (no authority — safe to leave until Wave 3 cleanup)

- `pages/super-admin/consumption.tsx` — renders different summary if cookie present
- `hooks/useSysHealth.tsx` — polling toggle
- `pages/api/super-admin/session.ts` — used by old UI to decide login redirect
- ~70 other API files where the cookie is referenced incidentally (most often inside a fallback that already fails fast)

The dry-run flag (`LEGACY_BRIDGE_DRY_RUN=1`) simulates Wave 3 removal:
- Authority-grant paths emit `bridge_authority_rejected` audit rows.
- UI-branch paths produce no audit (so any audit-emitter that fires under dry-run IS an authority dependency).

This is the operator's verification handle before flipping the kill switch in Wave 3.

---

## 5. Bridge mint surface (where the cookie originates)

| File | Sets cookie | Authority |
|---|---|---|
| [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) | `super_admin_session=1` | `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD` env compare |
| [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) | `content_architect_session=1` | (env-based; same pattern) |
| [pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts) | clears bridge cookies | n/a |

These three files are the entire mint surface. Wave 3 deletes them.

---

## 6. Audit event taxonomy for bridge observation

| Event | Decision value | When emitted |
|---|---|---|
| Bridge granted authority | `bridge_used` (legacy) / `bridge_authority_used` (Wave 3A) | Successful bridge resolution |
| Bridge rejected (hard expiry) | `bridge_rejected` (legacy) | After `LEGACY_BRIDGE_HARD_EXPIRY_AT` |
| Bridge rejected (env misconfig) | `bridge_rejected` (legacy) | Production with no env vars |
| Bridge rejected (dry-run) | `bridge_authority_rejected` (Wave 3A) | When `LEGACY_BRIDGE_DRY_RUN=1` and cookie present |
| Authority-source conflict | `trust_authority_conflict_detected` (Wave 3A) | RESERVED — emitter not yet wired |

Operator query for Wave 3 readiness (run against `capability_audit_log`):
```sql
-- Is anything still depending on the bridge?
SELECT count(*) AS bridge_uses_last_7d
FROM capability_audit_log
WHERE via_legacy_bridge = true
  AND occurred_at >= now() - interval '7 days';

-- Under dry-run, what would have been rejected?
SELECT capability, count(*) AS would_break
FROM capability_audit_log
WHERE decision = 'bridge_authority_rejected'
  AND occurred_at >= now() - interval '7 days'
GROUP BY capability
ORDER BY count(*) DESC;
```

If the first query is 0 and the second is also 0 after running with `LEGACY_BRIDGE_DRY_RUN=1` for 7 days, the bridge can be deleted with no functional impact.

---

## 7. Hard-expiry timeline

| Date | Event |
|---|---|
| 2026-05-07 (today) | Wave 3A landed: bootstrap route + dry-run flag + audit events |
| 2026-05-07 → 2026-08-04 | Operator runs dry-run telemetry; provisions DB-backed SUPER_ADMIN via bootstrap route |
| **2026-08-05** | `LEGACY_BRIDGE_HARD_EXPIRY_AT` — bridge always returns null regardless of dry-run |
| Wave 3 (date TBD, before hard expiry) | Delete bridge file + mint endpoints + direct cookie readers |

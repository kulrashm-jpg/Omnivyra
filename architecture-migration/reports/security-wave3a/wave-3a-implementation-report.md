# Wave 3A — Implementation Report

**Branch**: `identity-spine-enforcement`
**Date**: 2026-05-07
**Wave goal**: Establish DB-backed SUPER_ADMIN authority + bridge collapse pre-audit, WITHOUT removing the legacy cookie bridge, dropping legacy DB columns, or normalizing role-string sites. Set up the operator handles Wave 3 needs to land safely.

---

## In scope (delivered)

1. **Operator-safe SUPER_ADMIN bootstrap route** at `pages/api/admin/bootstrap-super-admin.ts`.
2. **Bridge dry-run flag** `LEGACY_BRIDGE_DRY_RUN` in `backend/security/legacyCookieSuperAdminBridge.ts`.
3. **6 new audit decision events** for bootstrap + bridge collapse telemetry.
4. **Four inventory reports** classifying every authority surface for Wave 3:
   - [trust-authority-map.md](trust-authority-map.md)
   - [runtime-reachability-map.md](runtime-reachability-map.md)
   - [bridge-dependency-map.md](bridge-dependency-map.md)
   - [role-string-classification.md](role-string-classification.md)

## Out of scope (explicitly NOT delivered)

- ❌ Bridge removal (`legacyCookieSuperAdminBridge.ts` still exists)
- ❌ Cookie endpoint removal (`pages/api/super-admin/login.ts` still exists)
- ❌ `profiles.is_super_admin` column drop
- ❌ Role-string site migrations (Class A/B/C/D/E left in place)
- ❌ Schema rename of `user_company_roles` → `org_role_assignments`
- ❌ Removal of `requireSuperAdminUser` legacy facade

---

## Files changed

### New
- `pages/api/admin/bootstrap-super-admin.ts` — 364 lines. Dual-mode (`promote`/`bootstrap`) endpoint. `mode=promote` runs through `requireCapability(IDENTITY_ADMIN_ASSIGN)`; `mode=bootstrap` is single-use via `SUPER_ADMIN_BOOTSTRAP_TOKEN` env (timing-safe compare) + zero existing SUPER_ADMIN rows + non-bridge principal + active sessionId + passkey enrolled + active phishing-resistant step-up satisfying the `IDENTITY_ADMIN_ASSIGN` policy. Idempotent on existing role rows. Emits `super_admin_bootstrap_started` / `super_admin_bootstrap_completed` / `super_admin_bootstrap_denied`.
- `architecture-migration/reports/security-wave3a/trust-authority-map.md`
- `architecture-migration/reports/security-wave3a/runtime-reachability-map.md`
- `architecture-migration/reports/security-wave3a/bridge-dependency-map.md`
- `architecture-migration/reports/security-wave3a/role-string-classification.md`
- `architecture-migration/reports/security-wave3a/wave-3a-implementation-report.md` (this file)

### Modified
- `backend/security/legacyCookieSuperAdminBridge.ts` — added `isLegacyBridgeDryRun()` reader for `LEGACY_BRIDGE_DRY_RUN` env (`1`/`true`/`yes`/`on`); inserted dry-run gate BEFORE hard-expiry gate so the rejection is deterministic. On dry-run, emits `bridge_authority_rejected` audit row with reason `"LEGACY_BRIDGE_DRY_RUN=1 — simulating Wave 3 removal"`.
- `backend/security/audit/SecurityAuditService.ts` — extended `AuditDecision` union with 6 new values:
  - `super_admin_bootstrap_started`
  - `super_admin_bootstrap_completed`
  - `super_admin_bootstrap_denied`
  - `bridge_authority_used` (reserved for canonical bridge-grant emitter)
  - `bridge_authority_rejected` (emitted by dry-run path)
  - `trust_authority_conflict_detected` (RESERVED — not yet wired)

---

## Audit event taxonomy

| Decision | Emitter | Purpose |
|---|---|---|
| `super_admin_bootstrap_started` | bootstrap route entry | telemetry: someone attempted bootstrap |
| `super_admin_bootstrap_completed` | bootstrap route success | irrevocable record of who got SUPER_ADMIN, when, by which mode, with which factor |
| `super_admin_bootstrap_denied` | every bootstrap failure | each precondition failure recorded with `reason` |
| `bridge_authority_used` | (reserved) canonical bridge resolver | for future use when migrating the existing `bridge_used` decision |
| `bridge_authority_rejected` | dry-run path in bridge resolver | OPS query handle: "what would break if we deleted the bridge?" |
| `trust_authority_conflict_detected` | (reserved) IdentityResolver / requireCapability | for future emitter when Wave 3 collapse PR adds conflict detection |

---

## Operator runbook — establishing the first DB-backed SUPER_ADMIN

The DB currently has 0 rows in `user_company_roles` with `role='SUPER_ADMIN'`. To establish authority WITHOUT depending on the legacy cookie bridge:

### Step 1 — operator user account
1. Sign up a normal Supabase user account through the standard flow.
2. Enroll a passkey at `/settings/security`.
3. Ensure the user has at least one `user_company_roles` row in some org (any role is fine — the bootstrap route uses it to bind the SUPER_ADMIN row to an org if no `active_company_id` is set).

### Step 2 — operator environment
Set `SUPER_ADMIN_BOOTSTRAP_TOKEN` to a strong secret (≥32 chars). Recommended:
```bash
export SUPER_ADMIN_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
```

### Step 3 — perform step-up
From the operator account, complete a phishing-resistant step-up via `/api/auth/step-up/verify` with a passkey factor against capability `identity.admin.assign` (or any capability whose policy is phishing-resistant + trusted-device).

### Step 4 — call bootstrap
```bash
curl -X POST "$ORIGIN/api/admin/bootstrap-super-admin" \
  -H 'Content-Type: application/json' \
  -b "<your authenticated cookies>" \
  -d '{"mode":"bootstrap","bootstrapToken":"<the env value>"}'
```

Expected: `201 Created` with `{ ok: true, bootstrappedUserId, organizationId, roleRowId }`.

### Step 5 — unset env var
After verifying the new SUPER_ADMIN row in `user_company_roles`, unset `SUPER_ADMIN_BOOTSTRAP_TOKEN`. Subsequent calls to `mode=bootstrap` will return `409 BOOTSTRAP_ALREADY_CONSUMED` regardless, but rotating the token out is defense-in-depth.

### Step 6 — promote others (optional)
The new SUPER_ADMIN can promote others via `mode=promote`:
```bash
curl -X POST "$ORIGIN/api/admin/bootstrap-super-admin" \
  -H 'Content-Type: application/json' \
  -b "<super-admin cookies>" \
  -d '{"mode":"promote","targetUserId":"<uuid>"}'
```
This requires `IDENTITY_ADMIN_ASSIGN` capability + active phishing-resistant + trusted-device step-up.

---

## Operator runbook — observing bridge dependencies before Wave 3

### Step 1 — turn on dry-run in a non-prod env
```bash
export LEGACY_BRIDGE_DRY_RUN=1
```

### Step 2 — exercise the system as you would in prod (canary traffic, smoke tests, etc.). Every bridge cookie use will land in `bridge_authority_rejected` audit rows.

### Step 3 — query the audit table
```sql
SELECT capability, count(*) AS would_break
FROM capability_audit_log
WHERE decision = 'bridge_authority_rejected'
  AND occurred_at >= now() - interval '24 hours'
GROUP BY capability
ORDER BY count(*) DESC;
```

### Step 4 — for each capability that would break, confirm the route migrated to canonical authority OR is a UI-only branch that can be fixed in Wave 3. Repeat until the query returns 0 rows over a representative window (suggested: 7 days).

### Step 5 — proceed with Wave 3 removal.

---

## Stable baseline check

Wave 3A added one new file (`bootstrap-super-admin.ts`) and modified two existing files (`legacyCookieSuperAdminBridge.ts`, `SecurityAuditService.ts`). The baseline guarantees:

- **frontend/backend imports**: 0 — Wave 3A introduces no cross-boundary imports.
- **variant contamination**: 0 — no UI variants touched.
- **duplicate orchestration owners**: 0 — the bootstrap route is its own owner; the dry-run flag is read inside the bridge file only.
- **typecheck clean**: ✅ verified via `npx tsc --noEmit` (exit 0).
- **runtime cycles ≤18**: not changed (no new cycles introduced).
- **runtime DB writes ≤588**: bootstrap route adds 1 INSERT into `user_company_roles` — guarded by capability + step-up; counted toward routine writes, not unsafe propagation.
- **unsafe propagation ≤6025**: unchanged — bootstrap uses `ownedDbTable` consistent with the linter-enforced security-layer write boundary.

---

## Wave 3 readiness checklist (NOT done in 3A; landing in 3B+)

| Item | Wave |
|---|---|
| Provision first DB-backed SUPER_ADMIN via bootstrap route | Operator action, post-3A |
| Run `LEGACY_BRIDGE_DRY_RUN=1` and observe 7-day clean window | Operator action |
| Migrate Class C role-string sites to `requireCapability` | 3B |
| Migrate Class E free-credits role mutation | 3B |
| Remove Class D content_architect dead paths | 3 (with bridge delete) |
| Wire `bridge_authority_used` into canonical bridge success path | 3 |
| Wire `trust_authority_conflict_detected` emitter | 3 |
| Delete `legacyCookieSuperAdminBridge.ts` | 3 |
| Delete `pages/api/super-admin/login.ts` + `logout.ts` + `content-architect-login.ts` | 3 |
| Delete `backend/services/superAdminSession.ts` | 3 |
| Drop `profiles.is_super_admin` column | 3 |
| Migrate ~60 routes from `requireSuperAdminUser` to `requireCapability` | 3B (bulk) |

---

## Source-grounded sanity probes

```bash
# Confirm bootstrap route exists
ls -la pages/api/admin/bootstrap-super-admin.ts

# Confirm dry-run flag is wired
grep -n "isLegacyBridgeDryRun\|LEGACY_BRIDGE_DRY_RUN" backend/security/legacyCookieSuperAdminBridge.ts

# Confirm audit decisions added
grep -n "super_admin_bootstrap\|bridge_authority\|trust_authority_conflict" backend/security/audit/SecurityAuditService.ts

# Confirm typecheck passes
npx tsc --noEmit -p tsconfig.json && echo "typecheck OK"
```

# Wave 3B Readiness — Bridge Dry-Run Telemetry Validation

**Generated**: 2026-05-07
**Method**: source-grounded validation of the dry-run flag + DB-grounded validation of the audit infra. Actual telemetry observation requires the operator to set `LEGACY_BRIDGE_DRY_RUN=1` in a non-prod env and exercise traffic.

---

## 1. Dry-run flag wiring

[backend/security/legacyCookieSuperAdminBridge.ts:47-56](../../../backend/security/legacyCookieSuperAdminBridge.ts):

```ts
export function isLegacyBridgeDryRun(): boolean {
  const v = (process.env.LEGACY_BRIDGE_DRY_RUN ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
```

Gate placement [legacyCookieSuperAdminBridge.ts:88-104](../../../backend/security/legacyCookieSuperAdminBridge.ts) — runs **before** the hard-expiry check, so dry-run is deterministic regardless of clock state. On dry-run with a present cookie:

1. Emit `bridge_authority_rejected` audit row with `reason='LEGACY_BRIDGE_DRY_RUN=1 — simulating Wave 3 removal'`
2. Logger warn `legacy_super_admin_bridge_dry_run_rejection` with cookie name + IP
3. Return `null` (caller falls through to "not authenticated")

Non-dry-run with a present cookie continues into the hard-expiry → env-credential → mint-principal path with `bridge_used` audit on success or `bridge_rejected` on hard-expiry/env-misconfig — unchanged from Wave 2A behavior.

---

## 2. Audit decisions reserved for bridge collapse telemetry

Wave 3A added these to `AuditDecision` in [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts):

| Decision | Emitter wired? | Purpose |
|---|---|---|
| `bridge_authority_used` | reserved | wave-3 will emit alongside `bridge_used` for canonical telemetry |
| `bridge_authority_rejected` | ✅ wired (dry-run rejection path) | emitted whenever `LEGACY_BRIDGE_DRY_RUN=1` rejects a bridge cookie |
| `trust_authority_conflict_detected` | reserved | wave-3 will emit when authority sources collide |
| `super_admin_bootstrap_started` | ✅ wired (route entry) | every bootstrap attempt |
| `super_admin_bootstrap_completed` | ✅ wired (success branch) | irrevocable record of who got SUPER_ADMIN |
| `super_admin_bootstrap_denied` | ✅ wired (every failure path) | precondition failure forensics |

Reserved decisions are part of the union but no source path emits them yet. They land in the Wave 3 collapse PR.

---

## 3. Audit infra liveness

Verified by direct DB probe:
- `INSERT INTO capability_audit_log (capability, decision, reason) VALUES ('test.readiness.probe', 'allowed', 'wave-3b readiness verification')` → succeeded, returned `id` + `occurred_at`
- Indexes on `principal_user_id`, `actor_user_id`, `capability`, plus a partial index on `via_legacy_bridge=true` (the partial bridge-collapse-query index from migration line 279-280) all present
- UPDATE / DELETE blocked by triggers (verified) — every audit row is permanent

The audit-write path used by the dry-run rejection (`logCookieSuperAdminUsage` → `logSecurityEvent` → `ownedDbTable('capability_audit_log').insert(...)`) reaches the same INSERT path that the probe just exercised. ✅

---

## 4. Operator query template

When the operator enables `LEGACY_BRIDGE_DRY_RUN=1` for a non-prod observation window, this is the canonical readiness query:

```sql
-- Per-capability count of "what would break if we deleted the bridge?"
SELECT
  capability,
  count(*) AS would_break_count,
  min(occurred_at) AS first_seen,
  max(occurred_at) AS last_seen
FROM capability_audit_log
WHERE decision = 'bridge_authority_rejected'
  AND occurred_at >= now() - interval '7 days'
GROUP BY capability
ORDER BY would_break_count DESC;

-- IPs that still send a bridge cookie under dry-run (find lingering clients)
SELECT
  ip,
  count(*) AS dry_run_rejections
FROM capability_audit_log
WHERE decision = 'bridge_authority_rejected'
  AND occurred_at >= now() - interval '24 hours'
GROUP BY ip
ORDER BY dry_run_rejections DESC;

-- Sanity: any actual bridge grants still happening (telemetry from non-dry-run servers)?
SELECT count(*) AS bridge_grants_last_7d
FROM capability_audit_log
WHERE via_legacy_bridge = true
  AND decision IN ('bridge_used', 'bridge_authority_used')
  AND occurred_at >= now() - interval '7 days';
```

**Wave 3 go/no-go criteria**:
- `bridge_grants_last_7d` = 0 → no canonical-bridge-resolver authority grants in production
- `would_break_count` for every capability = 0 → no dry-run rejections in any non-prod env
- Sustained for ≥7 days → operator approval

---

## 5. Current observation window

| Metric | Value |
|---|---|
| `LEGACY_BRIDGE_DRY_RUN` runs observed in audit log | 0 |
| Bridge grants observed in audit log (lifetime) | 0 |
| Actual telemetry window started | NOT YET |

The operator has not enabled the flag in any environment. Until they do and exercise representative traffic for ≥7 days, the dry-run telemetry prerequisite cannot be cleared.

---

## Verdict — dry-run telemetry

**WIRED + INFRA-LIVE ✅; OBSERVATION-WINDOW NOT STARTED ❌**.

The flag, the audit emitter, the immutable storage, and the operator query templates are all in place and proven functional. The remaining work is operational: enable the flag, run traffic, observe rejections, decide.

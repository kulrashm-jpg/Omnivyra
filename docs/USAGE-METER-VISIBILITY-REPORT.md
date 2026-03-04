# USAGE METER VISIBILITY REPORT

## 1. File Created

| File | Purpose |
|------|--------|
| `pages/api/super-admin/usage-meter.ts` | GET endpoint that reads a single row from `usage_meter_monthly` for the given organization and year/month, returns current-month usage snapshot (llm tokens, external_api calls, automation executions, and total_cost for super admin only). Access-controlled; cost masked for non–super admin. |

## 2. Access Flow Explanation

- **Identify user:** Cookie `super_admin_session=1` or Supabase session via `getSupabaseUserFromRequest`.
- **Super admin:** If cookie is set, or Supabase user exists and `isPlatformSuperAdmin(userId)` is true → full access; `total_cost` included in response.
- **Non–super admin:** Must have a row in `usage_report_access` for (userId, organization_id). `hasUsageAccess(userId, organizationId, false)` is called; if false → 403 FORBIDDEN_NO_USAGE_ACCESS.
- **Same rule as Phase 7B (usage-report):** Same `requireAuth` pattern and `hasUsageAccess` usage; no new access tables or logic.

## 3. Zero-Row Behavior

- Single query: `.eq('organization_id', orgId).eq('year', year).eq('month', month).maybeSingle()`. If no row exists (e.g. no usage yet for that org/month), `row` is null.
- `buildUsage(null, includeCost)` returns: `llm: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }`, `external_api: { calls: 0 }`, `automation: { executions: 0 }`, and optionally `total_cost: 0` for super admin. So the endpoint returns zeros for all counters when the meter row does not exist; no error.

## 4. Super Admin Example Response

```json
{
  "success": true,
  "scope": {
    "organization_id": "org-uuid",
    "year": 2025,
    "month": 3
  },
  "usage": {
    "llm": {
      "input_tokens": 125000,
      "output_tokens": 32000,
      "total_tokens": 157000
    },
    "external_api": { "calls": 12 },
    "automation": { "executions": 45 },
    "total_cost": 0.0523
  }
}
```

(With optional query params `year` and `month`; if omitted, server current UTC year/month is used.)

## 5. Shared-User Masked Example

Same structure, but `usage` has no `total_cost` key:

```json
{
  "success": true,
  "scope": { "organization_id": "org-uuid", "year": 2025, "month": 3 },
  "usage": {
    "llm": { "input_tokens": 125000, "output_tokens": 32000, "total_tokens": 157000 },
    "external_api": { "calls": 12 },
    "automation": { "executions": 45 }
  }
}
```

Operational counters only; cost hidden.

## 6. Confirmation No Ledger Scan

- The handler only queries `usage_meter_monthly` via one `.select().eq().eq().eq().maybeSingle()`. There are no references to `usage_events`, no RPCs that read the ledger, and no aggregation over events. The endpoint does not scan the ledger.

## 7. Confirmation O(1) Lookup

- A single indexed lookup on `(organization_id, year, month)` — index `idx_usage_meter_org` on `(organization_id, year, month)` supports this. One row is returned or null; no aggregation, no grouping, no multi-row scan. Behavior is O(1) with respect to data size.

## 8. Confirmation No Enforcement

- The endpoint only reads and returns current meter values. It does not enforce limits, compare usage to plans, block requests, or modify the meter or any other table. It is read-only visibility.

# OBSERVABILITY LAYER REPORT (ALERT VISIBILITY + ORGANIZATION USAGE SUMMARY)

## 1. Files Created

| File | Purpose |
|------|--------|
| **pages/api/super-admin/usage-alerts.ts** | GET; super admin only. Optional query: organization_id, year, month (default current UTC). Reads usage_threshold_alerts with filters, order triggered_at DESC. Returns success, scope { year, month }, alerts array (organization_id, resource_key, threshold_percent, triggered_at). No joins, no aggregation. |
| **pages/api/organization/usage-summary.ts** | GET; required organization_id, optional year/month (default current UTC). Access: super admin full; else hasUsageAccess(organization_id). Reads usage_meter_monthly (one row), resolveOrganizationPlanLimits, usage_threshold_alerts for org/year/month. Returns success, scope, plan { plan_key, limits }, usage { per resource: used, limit, percent_used }, alerts. No total_cost or monthly_price in response (operational only). |

## 2. Access Control Explanation

- **usage-alerts:** Super admin only (cookie or isPlatformSuperAdmin). No org-scoped sharing; only super admin sees the alert center.
- **usage-summary:** Same pattern as usage-report and usage-meter: identify user (cookie or Supabase). If super admin → full access. If not → must have a row in usage_report_access for (userId, organization_id); otherwise 403 FORBIDDEN_NO_USAGE_ACCESS. Both roles see the same response shape for usage-summary (plan limits, usage counters, percent, alerts); no cost fields are returned, so no cost masking branch needed in code.

## 3. Data Flow Explanation

- **usage-alerts:** Single query to usage_threshold_alerts filtered by year, month, and optionally organization_id. Results ordered by triggered_at DESC. Response is the scope plus the list of alert rows (no joins).
- **usage-summary:** Three parallel reads: (1) usage_meter_monthly one row for org/year/month, (2) resolveOrganizationPlanLimits(organizationId) for plan_key and limits, (3) usage_threshold_alerts for that org/year/month. Meter columns are mapped to resource keys (llm_total_tokens → llm_tokens, etc.). For each resource we build { used, limit, percent_used }. Alerts are returned as-is. No ledger table is read.

## 4. Percent Calculation Logic

- **percent_used:** For each resource, `percent_used = limit != null && limit > 0 ? round((used / limit) * 10000) / 100 : null`. No division by zero; if limit is null or ≤ 0, percent_used is null. Never treat unlimited as 0%.

## 5. Super Admin Response Examples

**GET /api/super-admin/usage-alerts?year=2025&month=3**

```json
{
  "success": true,
  "scope": { "year": 2025, "month": 3 },
  "alerts": [
    {
      "organization_id": "org-uuid",
      "resource_key": "llm_tokens",
      "threshold_percent": 95,
      "triggered_at": "2025-03-12T14:10:00Z"
    }
  ]
}
```

**GET /api/organization/usage-summary?organization_id=org-uuid**

```json
{
  "success": true,
  "scope": { "organization_id": "org-uuid", "year": 2025, "month": 3 },
  "plan": {
    "plan_key": "growth",
    "limits": {
      "llm_tokens": 2000000,
      "external_api_calls": 5000,
      "automation_executions": 2000
    }
  },
  "usage": {
    "llm_tokens": { "used": 157000, "limit": 2000000, "percent_used": 7.85 },
    "external_api_calls": { "used": 12, "limit": 5000, "percent_used": 0.24 },
    "automation_executions": { "used": 45, "limit": 2000, "percent_used": 2.25 }
  },
  "alerts": [
    {
      "resource_key": "llm_tokens",
      "threshold_percent": 80,
      "triggered_at": "2025-03-10T09:00:00Z"
    }
  ]
}
```

## 6. Shared-User Response Example

- Same structure as above. The response does not include total_cost or monthly_price for any caller; only plan_key, limits, usage (used, limit, percent_used), and alerts. So the “shared-user” view is identical in shape; cost masking is achieved by omitting cost from the API contract.

## 7. Confirmation No Enforcement

- Both endpoints are read-only. They do not block execution, change meter/ledger/plans, or enforce limits. They only return current state for observability.

## 8. Confirmation No Ledger Scan

- usage-alerts reads only usage_threshold_alerts. usage-summary reads only usage_meter_monthly, plan resolution (pricing_plans, plan_limits, assignments, overrides), and usage_threshold_alerts. usage_events (ledger) is never queried.

## 9. Confirmation O(1) Performance

- **usage-alerts:** One filtered index scan on usage_threshold_alerts (by year, month, optionally organization_id); no aggregation, no join.
- **usage-summary:** One row from usage_meter_monthly (indexed lookup by org, year, month); one plan resolution (bounded by one assignment and a small number of limit/override rows); one filtered query on usage_threshold_alerts for one org/year/month. All are O(1) or bounded small reads per request.

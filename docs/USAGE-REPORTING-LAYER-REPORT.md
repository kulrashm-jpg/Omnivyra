# USAGE REPORTING LAYER REPORT

## 1. Files Created

| File | Purpose |
|------|--------|
| `database/usage_report_access.sql` | Table `usage_report_access` (organization_id, user_id, granted_by, unique(organization_id, user_id)) and indexes on organization_id, user_id. |
| `database/usage_report_rpc.sql` | PostgreSQL function `get_usage_report(p_organization_id, p_campaign_id, p_process_type, p_source_type, p_provider_name, p_model_name, p_start_date, p_end_date, p_include_detail)` returning JSONB with totals, by_provider_model, by_process, by_campaign, recent_events (when p_include_detail true, max 100 rows). Read-only; no modification to usage_events. |
| `backend/services/usageAccessService.ts` | `hasUsageAccess(userId, organizationId, isSuperAdmin)` — returns true if isSuperAdmin or a row exists in usage_report_access for that user and org. |
| `pages/api/super-admin/usage/grant-access.ts` | POST; requires super admin; body `organization_id`, `user_id`; inserts into usage_report_access (ignores duplicate 23505); returns success. |
| `pages/api/super-admin/usage/revoke-access.ts` | POST or DELETE; requires super admin; body `organization_id`, `user_id`; deletes matching row; returns success. |
| `pages/api/super-admin/usage-report.ts` | GET; required query `organization_id`; optional `campaign_id`, `process_type`, `source_type`, `provider_name`, `model_name`, `start_date`, `end_date`, `detail=true`. Access: identify user (cookie or Supabase), isSuperAdmin via cookie or isPlatformSuperAdmin; if not super admin, requires hasUsageAccess(userId, organization_id); else 403. Calls RPC `get_usage_report`, then masks cost for non–super admin. Response: success, scope, totals, by_provider_model, by_process, by_campaign, recent_events (if detail=true). |

## 2. Access Flow Explanation

- **Super Admin:** Cookie `super_admin_session=1` or Supabase user with `isPlatformSuperAdmin(userId)` → full access to any `organization_id`; cost fields included.
- **Granted user:** Supabase user, not super admin. Must have a row in `usage_report_access` for (organization_id, user_id). Only that organization can be queried; cost fields are stripped (total_cost, unit_cost, pricing_snapshot removed from totals, breakdowns, and recent_events).
- **No access:** No session, or session without super admin and without a grant for the requested organization_id → 403 NOT_AUTHORIZED or FORBIDDEN_NO_USAGE_ACCESS.
- **Grant/revoke:** Only super admin can call grant-access and revoke-access to create or remove org-scoped read access for a user.

## 3. Example Super Admin Response

```json
{
  "success": true,
  "scope": {
    "organization_id": "org-uuid",
    "start_date": "2025-01-01",
    "end_date": "2025-01-31"
  },
  "totals": {
    "total_events": 150,
    "total_input_tokens": 45000,
    "total_output_tokens": 12000,
    "total_tokens": 57000,
    "total_cost": 0.0243,
    "avg_latency_ms": 420.5,
    "error_rate_percent": 1.33
  },
  "by_provider_model": [
    {
      "provider_name": "openai",
      "model_name": "gpt-4o-mini",
      "total_tokens": 50000,
      "total_cost": 0.018,
      "avg_latency_ms": 380,
      "error_rate_percent": 0
    }
  ],
  "by_process": [
    {
      "process_type": "generateCampaignPlan",
      "total_events": 80,
      "total_tokens": 40000,
      "total_cost": 0.012,
      "avg_latency_ms": 500
    }
  ],
  "by_campaign": [
    {
      "campaign_id": "camp-uuid",
      "total_events": 50,
      "total_tokens": 15000,
      "total_cost": 0.005,
      "avg_latency_ms": 350
    }
  ],
  "recent_events": []
}
```

(With `detail=true`, `recent_events` is the last 100 usage_events rows with full columns including unit_cost, total_cost, pricing_snapshot for super admin.)

## 4. Example Shared-User Masked Response

Same structure as above, but:

- **totals:** no `total_cost`.
- **by_provider_model:** each object has no `total_cost`.
- **by_process:** each object has no `total_cost`.
- **by_campaign:** each object has no `total_cost`.
- **recent_events** (if detail=true): each event has no `unit_cost`, `total_cost`, or `pricing_snapshot`.

Operational metrics (events, tokens, latency_ms, error_rate_percent, error_flag, etc.) are unchanged.

## 5. Confirmation Cost Masking Works

- In `usage-report.ts`, when `!auth.isSuperAdmin` we build `totals` from `maskCostInTotals(totalsRaw)` (drops `total_cost`), and each of `by_provider_model`, `by_process`, `by_campaign`, and `recent_events` is mapped through mask helpers that remove `total_cost` or `unit_cost`/`total_cost`/`pricing_snapshot`. The JSON sent in the response uses these masked values only; the RPC result is never returned raw to non–super admins.

## 6. Confirmation Aggregation Is SQL-Level

- All aggregation is done inside the PostgreSQL function `get_usage_report`: counts, sums (tokens, cost), averages (latency), and error_rate_percent are computed in SQL. Grouping by provider_name/model_name, process_type, and campaign_id is done in SQL. The API only calls `supabase.rpc('get_usage_report', {...})` and then applies cost masking when the caller is not a super admin. No JavaScript loops over raw usage_events rows for aggregation.

## 7. Confirmation Ledger Remains Immutable

- `usage_events` is only ever read. The RPC and the reporting layer perform only SELECTs (and in the RPC, read-only aggregation). No INSERT/UPDATE/DELETE is performed on `usage_events` by the access table, the RPC, or the usage-report/grant/revoke endpoints. The ledger remains append-only and immutable.

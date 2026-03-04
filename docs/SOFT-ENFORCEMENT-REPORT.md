# SOFT ENFORCEMENT REPORT (THRESHOLD ALERT ENGINE)

## 1. Table Created

**`database/usage_alerts.sql`**

- **usage_threshold_alerts:** `id`, `organization_id`, `resource_key`, `year`, `month`, `threshold_percent` (80 | 95 | 100), `triggered_at`. Unique on `(organization_id, resource_key, year, month, threshold_percent)`. Index on `(organization_id, year, month)`. No foreign keys.

## 2. Alert Evaluation Flow

**`backend/services/usageAlertService.ts` — `evaluateUsageThresholds(organizationId)`**

1. **Current period:** Derive `year` and `month` from server UTC (same as meter).
2. **Meter snapshot:** Load one row from `usage_meter_monthly` for that org/year/month; read `llm_total_tokens`, `external_api_calls`, `automation_executions`.
3. **Plan limits:** Call `resolveOrganizationPlanLimits(organizationId)` to get effective limits (plan + overrides) for `llm_tokens`, `external_api_calls`, `automation_executions`.
4. **Per resource:** For each resource, if `limit` is null or ≤ 0, skip. Otherwise compute `percent = (usage / limit) * 100` using the mapping below.
5. **Threshold:** From `percent`, choose a single threshold: ≥ 100 → 100, ≥ 95 → 95, ≥ 80 → 80; else skip.
6. **Dedupe:** Query `usage_threshold_alerts` for a row with same `organization_id`, `resource_key`, `year`, `month`, `threshold_percent`. If one exists, skip insert.
7. **Insert:** If no row exists, insert one alert row. Entire function is inside try/catch; on error only log, never throw.

Evaluation is driven only by meter and plan data; it does not read the ledger or change the meter.

## 3. Threshold Detection Logic

- **Resource → meter column:** `llm_tokens` → `llm_total_tokens`, `external_api_calls` → `external_api_calls`, `automation_executions` → `automation_executions`.
- **Percent:** `percent = (current_usage / monthly_limit) * 100`. Division uses the resolved plan limit (override or plan default).
- **Threshold choice:** One threshold per evaluation per resource: if `percent >= 100` then 100; else if `percent >= 95` then 95; else if `percent >= 80` then 80; else no alert. So at 85% we record only 80%; at 96% we record 95% (and may already have 80%); at 101% we record 100% (and may already have 80% and 95%).

## 4. Duplicate Prevention

- Before insert, a select checks for an existing row with the same `(organization_id, resource_key, year, month, threshold_percent)`.
- If a row exists, we skip insert for that threshold. So each threshold fires at most once per resource per org per month, even if evaluation runs many times (e.g. after every meter increment).
- The unique constraint on the table guarantees at most one row per (org, resource, year, month, threshold_percent).

## 5. Example Scenario (85%, 96%, 101%)

- **Plan limit:** e.g. `llm_tokens = 1_000_000` for the org/month.
- **85%:** Usage 850_000 → percent 85 → threshold 80. No row for (org, llm_tokens, year, month, 80) → insert WARNING (80%) alert.
- **96%:** Usage 960_000 → percent 96 → threshold 95. No row for 95 → insert CRITICAL (95%) alert. Row for 80 already exists → no second 80% insert.
- **101%:** Usage 1_010_000 → percent 101 → threshold 100. No row for 100 → insert OVER_LIMIT (100%) alert. Rows for 80 and 95 may already exist → no duplicate.

Result: up to three alert rows per resource per org per month (80, 95, 100), each written once.

## 6. Integration Point

- **usageMeterService.ts:** Immediately after a successful `increment_usage_meter` RPC call, `void evaluateUsageThresholds(params.organization_id)` is invoked. Not awaited. Meter increment is unchanged; threshold evaluation runs as a side effect and does not block or retry the meter.

## 7. Confirmation No Execution Blocking

- No code in execution paths (LLM, external API, automation) awaits or depends on `evaluateUsageThresholds`. The only call is fire-and-forget from the meter service after an increment. Execution flows are unchanged; alerts are written asynchronously and failures are logged only.

## 8. Confirmation No Coupling to Ledger

- Alert service reads only `usage_meter_monthly` and `resolveOrganizationPlanLimits` (plan/assignments/overrides). It does not read or write `usage_events` or any other ledger table.

## 9. Confirmation Fire-and-Forget Behavior

- `incrementUsageMeter` calls `void evaluateUsageThresholds(orgId)` so the caller does not wait for threshold evaluation. Success or failure of alert evaluation does not affect the meter increment result or any upstream caller.

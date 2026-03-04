# USAGE METER ENGINE REPORT

## 1. Files Created

| File | Purpose |
|------|--------|
| `database/usage_meter.sql` | Table `usage_meter_monthly` (organization_id, year, month, llm_*_tokens, external_api_calls, automation_executions, total_cost, unique(organization_id, year, month)) and index. PostgreSQL function `increment_usage_meter(p_organization_id, p_year, p_month, p_llm_input_tokens, ...)` for atomic upsert. |
| `backend/services/usageMeterService.ts` | `incrementUsageMeter(params)` — resolves year/month from server time, maps source_type to RPC deltas, calls `supabase.rpc('increment_usage_meter', {...})` inside try/catch; on failure only `console.error`; never throws. |

## 2. RPC Function

- **Name:** `increment_usage_meter`
- **Parameters:** `p_organization_id`, `p_year`, `p_month`, `p_llm_input_tokens`, `p_llm_output_tokens`, `p_llm_total_tokens`, `p_external_api_calls`, `p_automation_executions`, `p_total_cost` (all deltas; defaults 0).
- **Behavior:** `INSERT ... ON CONFLICT (organization_id, year, month) DO UPDATE SET` each counter column to `usage_meter_monthly.column + EXCLUDED.column`, and `updated_at = now()`. Single round-trip; no read-modify-write in application code.

## 3. Atomic Increment Strategy

- All increments are performed in PostgreSQL via one RPC call. The function uses `INSERT ... ON CONFLICT DO UPDATE` so that either a new row is inserted with the given deltas or an existing row is updated by adding the deltas to current values. No SELECT-then-UPDATE in JS; no race conditions from concurrent increments; the database holds a row-level lock during the upsert. Counters are month-bucketed (year, month) from server time in the service layer.

## 4. LLM Increment Path

- **File:** `backend/services/aiGateway.ts`
- **Location:** Immediately after the successful `logUsageEvent` in `runCompletion` (when the completion has already been returned and usage/cost are known).
- **Call:** `void incrementUsageMeter({ organization_id: request.companyId ?? UNKNOWN_ORG, source_type: 'llm', input_tokens, output_tokens, total_tokens, total_cost: cost.total_cost ?? undefined })`. Not awaited.
- **Effect:** RPC receives non-zero llm_*_tokens and total_cost deltas; other deltas are 0.

## 5. External API Increment Path

- **File:** `backend/services/externalApiService.ts`
- **Location:** Inside `executeExternalApiRequest`, after `logUsageEvent`, only when `response.ok` is true.
- **Call:** `void incrementUsageMeter({ organization_id: orgId, source_type: 'external_api', total_cost: 0 })`. Not awaited.
- **Effect:** RPC receives `p_external_api_calls = 1`, `p_total_cost = 0`; other deltas are 0.

## 6. Automation Execution Increment Path

- **File:** `backend/services/communityAiActionExecutor.ts`
- **Locations:** All three success paths that already call `logUsageEvent` with `source_type: 'automation_execution'`:
  1. Manual simulated execution — after `logUsageEvent`, before `return simulated`.
  2. RPA success — after `logUsageEvent`, before `return { ok: true, status: 'executed', ... }`.
  3. Connector (API) success — after `logUsageEvent`, before `return { ok: true, status: 'executed', response }`.
- **Call:** `void incrementUsageMeter({ organization_id: action.organization_id, source_type: 'automation_execution' })`. Not awaited.
- **Effect:** RPC receives `p_automation_executions = 1`; no cost or token deltas.

## 7. No Blocking Behavior

- Every `incrementUsageMeter` call is invoked with `void` (fire-and-forget). Callers never await it. Execution continues immediately after the meter call. If the RPC fails, `usageMeterService` catches the error and logs with `console.error` only; it does not rethrow, so the caller is never blocked or failed by the meter.

## 8. No Dependency on Ledger

- Meter increments are triggered from the same code paths that call `logUsageEvent`, but the meter service does not read `usage_events`, does not check whether the ledger insert succeeded, and is called independently. Ledger and meter are separate; meter success or failure does not affect ledger, and ledger success or failure does not affect whether the meter is incremented (both are called from the same place, but neither depends on the other’s result).

## 9. Example Row After Mixed Activity

For one organization in 2025-03, after some LLM calls, external API calls, and automation executions:

| organization_id | year | month | llm_input_tokens | llm_output_tokens | llm_total_tokens | external_api_calls | automation_executions | total_cost |
|-----------------|------|-------|-------------------|-------------------|------------------|--------------------|------------------------|------------|
| org-uuid        | 2025 | 3     | 125000            | 32000             | 157000           | 12                 | 45                     | 0.0523     |

- `llm_*` and `total_cost` from aiGateway success path.
- `external_api_calls` from successful `executeExternalApiRequest` (response.ok).
- `automation_executions` from manual, RPA, and connector success paths in `executeAction`.

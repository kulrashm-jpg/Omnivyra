# EXECUTION GUARDRAIL IMPLEMENTATION REPORT

## 1. Files Modified

| File | Change |
|------|--------|
| `database/execution_guardrails.sql` | **Created.** Table `execution_guardrails` + index; `alter table community_ai_actions add column skip_reason text`. |
| `backend/services/executionGuardrailService.ts` | **Created.** `GuardrailResult`, `canExecuteAction(action, context)`, live guardrail checks. |
| `backend/services/communityAiAutoRuleService.ts` | **Modified.** Import `canExecuteAction`. Before `executeAction`, call guardrail; if not allowed, set `status: 'skipped_guardrail'`, `skip_reason`, and return (no execute). |
| `backend/services/communityAiScheduler.ts` | **Modified.** Import `canExecuteAction`. Before `executeAction`, call guardrail; if not allowed, set `status: 'skipped_guardrail'`, `skip_reason`, and `continue`. |

## 2. DB Changes Applied

- **New table `execution_guardrails`**: `id`, `company_id` (unique), `auto_execution_enabled` (default true), `daily_platform_limit`, `per_post_reply_limit`, `per_evaluation_limit`, `created_at`, `updated_at`. Index on `company_id`.
- **`community_ai_actions`**: Added nullable `skip_reason text`. Status value `skipped_guardrail` is supported (status is text, no enum change).
- No foreign keys, no data migration, no seed.

## 3. Injection Points Confirmed

| Flow | File | Location |
|------|------|----------|
| Auto-executed (evaluateAutoRules) | `communityAiAutoRuleService.ts` | Immediately after playbook validation, before `executeAction(record, ...)`. Calls `canExecuteAction(..., { source: 'evaluation' })`. On block: update row to `skipped_guardrail` + `skip_reason`, then return from map callback (no execute, no retry). |
| Approved + scheduled (communityAiScheduler) | `communityAiScheduler.ts` | After token/playbook checks, before `executeAction(action, ...)`. Calls `canExecuteAction(..., { source: 'scheduler' })`. On block: update row to `skipped_guardrail` + `skip_reason`, then `continue` (no execute, no retry). |

Guardrails are **not** applied in:
- Manual `POST /api/community-ai/actions/execute` (unchanged).
- `executeAction()` itself (unchanged).
- Retry logic, publish queue, engagement polling, adapters, token refresh, strategy layers, UI.

## 4. Sample Blocked Scenario

- Company has `execution_guardrails(company_id, auto_execution_enabled = false)`.
- Auto-rule or scheduler attempts to run an action for that company.
- `canExecuteAction` returns `{ allowed: false, reason: 'auto_disabled' }`.
- Row is updated: `status = 'skipped_guardrail'`, `skip_reason = 'auto_disabled'`; `executed_at` remains null; no call to `executeAction`, no retry, no scheduler re-attempt. Action is visible in activity queue as skipped_guardrail.

## 5. Sample Allowed Scenario

- No row in `execution_guardrails` for the company → `canExecuteAction` returns `{ allowed: true }` (default open).
- Or row exists with `auto_execution_enabled = true` and limits not exceeded → `{ allowed: true }`.
- Execution proceeds as before; status becomes `executed` or `failed` per existing logic.

## 6. Confirmation Manual Execution Unchanged

- `pages/api/community-ai/actions/execute` (and any manual execute path) was **not** modified.
- Guardrail is only invoked in `communityAiAutoRuleService.ts` (evaluation flow) and `communityAiScheduler.ts` (scheduler flow). Manual execute still bypasses guardrails as specified.

## 7. Guardrail Logic Summary

- **Step 1:** Load `execution_guardrails` by `company_id` (action’s `organization_id` used as `company_id`). No row → allow.
- **Step 2:** If `auto_execution_enabled === false` → block with reason `auto_disabled`.
- **Step 3:** If `daily_platform_limit` set: count executed actions for company + platform with `updated_at >= startOfToday`; if count ≥ limit → block with `daily_platform_limit`.
- **Step 4:** If `action_type === 'reply'` and `per_post_reply_limit` set: count executed replies for company + platform + `target_id`; if count ≥ limit → block with `per_post_limit`.
- **Step 5:** If `context.source === 'evaluation'` and `per_evaluation_limit` set: count executed actions for company + platform with `updated_at >= (now - 10 minutes)`; if count ≥ limit → block with `per_evaluation_limit`.
- All counts use existing `community_ai_actions` columns (`organization_id`, `platform`, `status`, `updated_at`, `target_id`, `action_type`). No `executed_at` column added; `updated_at` used as proxy for execution time.

## 8. Behavior When Blocked

- `action.status` = `skipped_guardrail`.
- `action.skip_reason` = reason code.
- `executed_at` remains null.
- No retry, no scheduler re-attempt.
- Visible in activity queue; deterministic.

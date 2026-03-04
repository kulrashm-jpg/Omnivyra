# EXECUTION TIME CORRECTION REPORT

## 1. Files Modified

| File | Change |
|------|--------|
| `backend/services/executionGuardrailService.ts` | All guardrail count queries now use `executed_at` instead of `updated_at`. Added `.not('executed_at', 'is', null)` so only executed actions with a timestamp are counted. |
| `backend/services/communityAiAutoRuleService.ts` | When status is set to `executed` after successful `executeAction`, the update now includes `executed_at: new Date().toISOString()`. Only set when `nextStatus === 'executed'`; not set on failed or skipped_guardrail. |
| `backend/services/communityAiScheduler.ts` | Same as auto-rule: when status becomes `executed`, the update includes `executed_at: new Date().toISOString()`. |
| `database/execution_guardrails.sql` | Added `alter table community_ai_actions add column if not exists executed_at timestamptz null;` so the column exists for writes and guardrail queries. |

## 2. Confirmation: Guardrail Queries Use executed_at Only

- **Daily platform limit:** Filter is `.eq('status', 'executed').not('executed_at', 'is', null).gte('executed_at', startOfToday())`. No reference to `updated_at`.
- **Per post reply limit:** Filter is `.eq('status', 'executed').not('executed_at', 'is', null)` (no time window). No reference to `updated_at`.
- **Per evaluation window:** Filter is `.eq('status', 'executed').not('executed_at', 'is', null).gte('executed_at', tenMinutesAgo())`. No reference to `updated_at`.

Guardrail logic is decoupled from `updated_at`; only `executed_at` is used for execution time.

## 3. Confirmation: executed_at Set Only on Successful Execution

- **communityAiAutoRuleService.ts:** `updatePayload.executed_at` is set only when `nextStatus === 'executed'`. Not set when status is `failed` or `skipped`. Not set when the action is blocked by guardrail (status becomes `skipped_guardrail` in a separate update that does not include `executed_at`).
- **communityAiScheduler.ts:** Same: `updatePayload.executed_at` is set only when `nextStatus === 'executed'`. Not set for failed or skipped.

`executed_at` is never overwritten in these flows (we only set it in the same update that sets `status: 'executed'`). Other status updates (failed, skipped_guardrail, etc.) do not include `executed_at`.

## 4. Confirmation: No Other Flow Mutates executed_at

- **Manual `/api/community-ai/actions/execute`:** Not modified; no change to its behavior. It does not write `executed_at` in this change.
- **communityAiActionExecutor:** Does not update `community_ai_actions`; it only returns a result. Callers (auto-rule, scheduler) perform the DB update.
- **Other community_ai_actions updates:** Grep showed no other code path that sets `status: 'executed'` on `community_ai_actions`. The only writers for `status: 'executed'` (and now `executed_at`) are the two injection points above.

No generic or mass update touches `executed_at`; only the two execution-success updates set it.

## 5. Example Daily Limit Scenario (Correct Behavior)

- Company has `execution_guardrails(company_id, daily_platform_limit = 5)`.
- Five actions for that company + platform have already been executed today; each has `status = 'executed'` and `executed_at` set to the time of execution.
- Guardrail query counts rows with `organization_id`, `platform`, `status = 'executed'`, `executed_at` not null, and `executed_at >= startOfToday()` → count = 5.
- Sixth action is about to run → `canExecuteAction` returns `{ allowed: false, reason: 'daily_platform_limit' }` → action is marked `skipped_guardrail` with `executed_at` remaining null.
- Later, an existing row is updated for metadata (e.g. `updated_at` changed); guardrail count is unchanged because it uses only `executed_at` and `status = 'executed'`.

Execution time is determined solely by `executed_at`; guardrails are immune to metadata edits on `updated_at`.

# USAGE LEDGER FOUNDATION REPORT

## 1. Files Created

| File | Purpose |
|------|--------|
| `database/usage_events.sql` | Append-only table `usage_events` with indexes on organization_id+created_at, campaign_id+created_at, source_type+source_name, provider_name+model_name. No updates allowed. |
| `backend/services/usageLedgerService.ts` | `logUsageEvent(params)` (try/catch, never throw), `resolveLlmCost(provider, model, inputTokens, outputTokens)`, and `PROVIDER_PRICING` map (openai gpt-4o-mini / gpt-4o, anthropic claude-3-5-sonnet). Unknown models: tokens logged, pricing_snapshot null, total_cost null. |

## 2. LLM Instrumentation Location

- **Primary:** `backend/services/aiGateway.ts` — `runCompletion()`. Single wrapper for all gateway operations (generateRecommendation, generateCampaignPlan, previewStrategy, optimizeWeek, generateDailyPlan, generateDailyDistributionPlan, suggestDuration, moderateChatMessage, etc.). Latency measured with `Date.now()` before/after `client.chat.completions.create()`. On success: usage extracted from `completion.usage`, cost from `resolveLlmCost('openai', request.model, ...)`, one `logUsageEvent` with tokens, latency_ms, unit_cost, total_cost, pricing_snapshot. On catch: one `logUsageEvent` with error_flag true, error_type from response status or message, latency_ms; then error rethrown.
- **Secondary:** `backend/services/llm/openaiAdapter.ts` — `runDiagnosticPrompt()`. Same pattern: latency wrap, success log with usage/cost, catch log with error_flag true and rethrow. Uses `UNKNOWN_ORG` for organization_id (no company context in this path).

## 3. External API Instrumentation Location

- **File:** `backend/services/externalApiService.ts` — `executeExternalApiRequest()`. Wrapped in try/catch. On success: `logUsageEvent` with source_type `'external_api'`, provider_name `'trend_vendor'`, source_name from `input.source.name` (fallback `'external_api'`), process_type `'external_api_request'`, latency_ms, error_flag from `!response.ok`, error_type `HTTP ${response.status}` when not ok, total_cost 0, pricing_snapshot `{ fixedCost: 0 }`. organization_id from `input.source.company_id` or sentinel UUID. On catch: same event with error_flag true, error_type from error message, then rethrow.

## 4. Automation Execution Instrumentation Location

- **File:** `backend/services/communityAiActionExecutor.ts` — inside `executeAction()`, on every successful execution path (no cost):
  - **Manual simulated:** Before `return simulated;` — one `logUsageEvent` with source_type `'automation_execution'`, provider_name `action.platform`, source_name `${action.platform}:${action.action_type}`, process_type `'community_execution'`, metadata `{ action_id: action.id }`.
  - **RPA success:** Before returning `{ ok: true, status: 'executed', response: { ...rpaResult, ... } }` — same event shape.
  - **Connector (API) success:** Before `return { ok: true, status: 'executed', response }` — same event shape.

All use `organization_id: action.organization_id`, campaign_id/user_id null. No unit_cost or total_cost.

## 5. Example Successful LLM Ledger Entry

After a successful `runCompletion` call (e.g. generateCampaignPlan) with companyId set:

- organization_id: company UUID  
- campaign_id: null  
- source_type: `'llm'`  
- provider_name: `'openai'`  
- model_name: e.g. `'gpt-4o-mini'`  
- source_name: `'openai:gpt-4o-mini'`  
- process_type: e.g. `'generateCampaignPlan'`  
- input_tokens, output_tokens, total_tokens: from completion.usage  
- latency_ms: elapsed ms  
- error_flag: false  
- unit_cost, total_cost: from resolveLlmCost (openai gpt-4o-mini pricing)  
- pricing_snapshot: `{ input_per_1k: 0.0003, output_per_1k: 0.0006 }`  
- created_at: insert time  

## 6. Example Failed LLM Ledger Entry

After a thrown error in `runCompletion` (e.g. network or API error):

- organization_id: request.companyId or UNKNOWN_ORG  
- source_type: `'llm'`  
- provider_name: `'openai'`  
- model_name: request.model  
- source_name: `openai:${request.model}`  
- process_type: request.operation  
- input_tokens, output_tokens, total_tokens: null  
- latency_ms: elapsed ms until catch  
- error_flag: true  
- error_type: e.g. `'429'` or error message  
- unit_cost, total_cost, pricing_snapshot: null  

Business logic: error is rethrown; caller behavior unchanged.

## 7. Example External API Entry

After `executeExternalApiRequest`:

- organization_id: source.company_id or UNKNOWN_ORG  
- source_type: `'external_api'`  
- provider_name: `'trend_vendor'`  
- source_name: source name or `'external_api'`  
- process_type: `'external_api_request'`  
- latency_ms: elapsed  
- error_flag: false if response.ok, true if !response.ok or on catch  
- error_type: null on success, or `HTTP ${status}` / error message on failure  
- total_cost: 0  
- pricing_snapshot: `{ fixedCost: 0 }` on success, null on catch  

## 8. Append-Only Behavior

- **Schema:** `usage_events` has no unique constraint that would encourage upserts. Only inserts are performed.
- **Code:** `usageLedgerService.ts` only calls `supabase.from('usage_events').insert(...)`. No `.update()`, `.upsert()`, or delete on `usage_events` anywhere in the codebase.
- **Guarantee:** No code path updates or deletes rows in `usage_events`; the ledger is append-only.

## 9. Logging Failure Does Not Block Business Logic

- `logUsageEvent()` is wrapped in try/catch; on insert failure it only runs `console.error('[usageLedger] insert failed', ...)` and returns. It never throws.
- All call sites use `void logUsageEvent(...)` (fire-and-forget). LLM and external API paths rethrow the original error after logging on failure; success paths do not await the log.
- No retry is performed on ledger insert. Business logic does not depend on ledger success.

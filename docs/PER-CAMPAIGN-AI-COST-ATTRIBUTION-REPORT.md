# Per-Campaign AI Cost Attribution — Implementation Report

**Status:** Plumbing only. No schema changes. Backward compatible. Optional `campaign_id` throughout.

---

## 1. Files Modified

| File | Change |
|------|--------|
| `backend/services/aiGateway.ts` | Extended `GatewayRequest` with `campaignId?: string \| null`. In `runCompletion`, both `logUsageEvent` calls (error and success) now pass `campaign_id: request.campaignId ?? null`. |
| `backend/services/usageLedgerService.ts` | **No change.** Already accepts `campaign_id?: string \| null` and writes `campaign_id: params.campaign_id ?? null`. |
| `backend/services/campaignAiOrchestrator.ts` | All `generateCampaignPlan` calls and `evaluateWeeklyAlignment` now pass `campaignId` (and `companyId: null` where needed). `evaluateWeeklyAlignment` accepts optional `campaignId` and forwards it to `generateCampaignPlan`. |
| `backend/services/dailyContentDistributionPlanService.ts` | `callDistributionLLM` (aiGateway `generateDailyDistributionPlan`) now receives `campaignId: input.campaignId ?? null`. |
| `backend/services/campaignOptimizationService.ts` | `optimizeWeekPlan` input extended with `campaignId?: string \| null`. `optimizeWeek` call passes `campaignId: input.campaignId ?? null`. Call site of `optimizeWeekPlan` passes `campaignId: input.campaignId ?? null`. |

---

## 2. Where `campaignId` Is Now Passed

| Call path | campaignId source |
|-----------|-------------------|
| **generateCampaignPlan** (main plan generation) | `campaignAiOrchestrator`: `input.campaignId` |
| **generateCampaignPlan** (repair / regeneration, 3 call sites) | `campaignAiOrchestrator`: `input.campaignId` |
| **generateCampaignPlan** (evaluateWeeklyAlignment) | `campaignAiOrchestrator`: `params.campaignId` → callers pass `input.campaignId` |
| **generateDailyDistributionPlan** | `dailyContentDistributionPlanService`: `input.campaignId` |
| **optimizeWeek** | `campaignOptimizationService`: `optimizeWeekPlan(input.campaignId)` → caller passes `input.campaignId` |

---

## 3. Call Sites Not Changed (No Campaign Context or Not LLM)

| Location | Reason |
|----------|--------|
| `contentGenerationPipeline.ts` — `generateCampaignPlan` (discoverability, master content, platform variant) | Functions do not receive `campaignId` in their signatures; pipeline is lower-level. Could be extended later by threading `campaignId` through pipeline options. |
| `campaignRecommendationService.ts` — `generateDailyPlan` | Local helper that builds daily plan from weekly (no aiGateway call). |
| `aiGateway` — `generateRecommendation`, `previewStrategy`, `suggestDuration`, `moderateChatMessage`, `generatePrePlanningExplanation` | Callers do not pass campaign context in this change; `campaignId` remains optional and unused on these paths. |
| `usageLedgerService.logUsageEvent` | Already supported `campaign_id`; no code change. |
| `usage_meter_monthly` / `incrementUsageMeter` | Not modified; meter logic unchanged. |
| External API / automation execution logging | Not modified; out of scope. |

---

## 4. Validation

- **Backward compatibility:** `campaignId` is optional everywhere. Omission leaves `usage_events.campaign_id` null (existing behavior).
- **No breaking signature changes:** Only optional properties added; existing callers continue to work.
- **TypeScript:** No new type errors; existing calls that do not pass `campaignId` remain valid.
- **usage_meter_monthly:** Unchanged; still incremented from same success paths without campaign dimension.

---

## 5. What This Unlocks

- **System Dashboard / reporting:** Filter AI consumption by `campaign_id`; top N campaigns by cost; tokens/cost per campaign.
- **Campaign Health (Enterprise):** Per-campaign AI cost breakdown.
- **Future:** Campaign-level AI budget caps using `usage_events.campaign_id` and existing ledger.

---

## 6. Manual Verification (Post-Implementation)

1. Generate a campaign plan (e.g. from campaign chat / plan flow).
2. Generate a daily distribution plan for a campaign.
3. Run week optimization for a campaign.
4. Query `usage_events` for recent LLM rows, e.g.  
   `SELECT id, organization_id, campaign_id, process_type, total_tokens, total_cost, created_at FROM usage_events WHERE source_type = 'llm' ORDER BY created_at DESC LIMIT 20;`  
5. Confirm `campaign_id` is populated for the above flows when run in campaign context.

---

*End of report. No schema changes. No new tables. Optional plumbing only.*

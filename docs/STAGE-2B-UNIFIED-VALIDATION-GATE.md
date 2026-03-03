# Stage 2B — Unified Validation Gate

## Objective

Single entry point for capacity and frequency validation: `validateCapacityAndFrequency()`. Reuses existing logic from `capacityExpectationValidator` and aligns with `deterministicWeeklySkeleton`; supports optional blueprint so strategy blueprints (e.g. from recommendations) are validated too.

---

## New module

**File:** `backend/services/capacityFrequencyValidationGateway.ts`

- **Function:** `validateCapacityAndFrequency(input)`
- **Inputs:** `weekly_capacity`, `available_content`, `exclusive_campaigns`, `platform_content_requests`, `cross_platform_sharing`, optional `blueprint`, optional `message`, optional `override_confirmed`.
- **Output:** Same as existing `validation_result` format (`CapacityValidationResult` from capacityExpectationValidator). Returns `null` when there is no demand to validate (e.g. empty platform_content_requests and no blueprint).

When `blueprint` is provided and `platform_content_requests` is empty, demand is derived from the first blueprint week (`execution_items` or `platform_allocation` + `content_type_mix`).

---

## Call sites updated

| Location | Change |
|----------|--------|
| **campaignAiOrchestrator.ts** | Replaced `validateCapacityVsExpectation` with `validateCapacityAndFrequency`. Same arguments; no blueprint passed at plan time (validation uses prefilled planning context). |
| **pages/api/campaigns/recommendations.ts** | Before saving a strategy blueprint from recommendations: loads `getCampaignPlanningInputs(campaignId)`, calls `validateCapacityAndFrequency({ ...planningInputs, blueprint })`. If `status === 'invalid'` and not `override_confirmed`, returns `400` with `validation_result` and does not save. |
| **Create-campaign flow** | Covered by orchestrator: `pages/api/recommendations/create-campaign-from-group.ts` and `pages/api/recommendations/[id]/create-campaign.ts` both call `runCampaignAiPlan`, which runs the gateway inside the orchestrator. No additional call added in these handlers. |

---

## Deterministic skeleton

**File:** `backend/services/deterministicWeeklySkeleton.ts`

- **Removed:** The block that threw `DeterministicWeeklySkeletonError('DETERMINISTIC_REQUEST_EXCEEDS_AVAILABLE_PLUS_CAPACITY', ...)` when requested weekly execution exceeded available_content + capacity (after exclusive_campaigns).
- **Reason:** Capacity/frequency validation is now the responsibility of the gateway. Callers (orchestrator) run `validateCapacityAndFrequency()` first and only call `buildDeterministicWeeklySkeleton` when the result is valid or override is confirmed. The skeleton no longer throws capacity errors.

---

## Example validation response

Same shape as before (`CapacityValidationResult`):

```json
{
  "status": "invalid",
  "override_confirmed": false,
  "requested_total": 12,
  "requested_platform_postings_total": 18,
  "weekly_capacity_total": 5,
  "exclusive_campaigns_total": 0,
  "effective_capacity_total": 5,
  "available_content_total": 2,
  "supply_total": 7,
  "deficit": 5,
  "requested_by_platform": { "linkedin": 6, "facebook": 6, "x": 6 },
  "suggested_requested_by_platform": { "linkedin": 2, "facebook": 2, "x": 2 },
  "suggested_adjustments": { "reduce_total_by": 5 },
  "explanation": "Requested weekly execution exceeds available_content + weekly_capacity (after exclusive_campaigns consume capacity first)."
}
```

Valid case:

```json
{
  "status": "valid",
  "override_confirmed": false,
  "requested_total": 6,
  "requested_platform_postings_total": 9,
  "weekly_capacity_total": 5,
  "exclusive_campaigns_total": 0,
  "effective_capacity_total": 5,
  "available_content_total": 2,
  "supply_total": 7,
  "deficit": 0,
  "requested_by_platform": { "linkedin": 3, "facebook": 3, "x": 3 },
  "explanation": "Requested weekly execution is within available_content + weekly_capacity (after exclusive_campaigns consume capacity first)."
}
```

---

## Duplicate logic removed

- **capacityExpectationValidator:** Not removed; it remains the single implementation of the capacity math. The gateway **calls** it and does not duplicate its logic.
- **deterministicWeeklySkeleton:** Removed the **duplicate capacity check** that compared `total_weekly_content_count` to `availableTotal + capacityTotal` and threw `DETERMINISTIC_REQUEST_EXCEEDS_AVAILABLE_PLUS_CAPACITY`. That decision now lives only in the gateway; the skeleton no longer performs or throws on capacity.

---

## Validation

- **AI plan:** Orchestrator still runs validation in the same place (before building deterministic skeleton) and only proceeds to skeleton when valid or override confirmed. Same behavior as before.
- **Strategy blueprint:** When persisting a strategy blueprint from recommendations (`pages/api/campaigns/recommendations.ts`), the blueprint is validated via the gateway (demand derived from blueprint when needed). If invalid and not overridden, the save is rejected with `400` and `validation_result`.

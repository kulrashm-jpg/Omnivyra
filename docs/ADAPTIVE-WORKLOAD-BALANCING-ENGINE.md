# Adaptive Auto Workload Balancing Engine

## Objective

When requested content exceeds production capacity, automatically rebalance workload while preserving campaign intent instead of immediately failing validation. Balancing layer runs before rejection; existing validation is preserved. If balancing is disabled or fails, original invalid result is returned.

---

## 1. workloadBalancerService logic

**File:** `backend/services/workloadBalancerService.ts`

**Function:** `balanceWorkload(input)`

**Input:** `platform_content_requests`, `weekly_capacity_total`, `available_content_total`, `effective_capacity_total` (optional), `cross_platform_sharing`, `campaign_intent`, `content_types`, `exclusive_campaigns_total`.

**Rules (V1):**

- **Rule A — Preserve high-value content types first:** Priority order `video > carousel > post > article`. Reduction is applied to lowest-priority rows first.
- **Rule B — Prefer repurposing over removal:** When reducing, unique content count is decreased while keeping platform distribution (rows are reduced per (platform, content_type)).
- **Rule C — Reduce evenly across platforms:** Iteration over rows is by priority then key; no platform is zeroed out unless required to meet supply.
- **Rule D — Conversion protection:** If `campaign_intent` suggests conversion, rows that look like conversion/CTA/lead content are skipped during reduction.

**Output:** `{ balanced_requests, adjustments_made, original_requested_total, balanced_total, reason }` or `null` if no balancing needed or balancing cannot bring total within supply.

**Example reason:** `"Adjusted posting volume to match production capacity while preserving video and conversion-stage content."`

---

## 2. Example before vs after request

**Before (over capacity):**

- `platform_content_requests`: `[{ platform: 'linkedin', content_type: 'post', count_per_week: 5 }, { platform: 'facebook', content_type: 'post', count_per_week: 5 }, { platform: 'linkedin', content_type: 'video', count_per_week: 2 }]`
- `supply_total`: 8  
- `requested_total` (unique with sharing): e.g. 7 (5 post + 2 video if sharing) or 12 (sum if no sharing). Assume 12 platform total, 7 unique with sharing; supply 8 → invalid.

**After balancing (with sharing):**

- Unique target ≤ 8. Reduce from lowest priority: post. Reduce linkedin post 5→4, then facebook post 5→4, etc., until unique total ≤ 8.
- `balanced_requests`: e.g. `[{ platform: 'linkedin', content_type: 'post', count_per_week: 3 }, { platform: 'facebook', content_type: 'post', count_per_week: 3 }, { platform: 'linkedin', content_type: 'video', count_per_week: 2 }]` (example; exact numbers depend on algorithm).
- `balanced_total`: 8.
- `adjustments_made`: true.
- `reason`: `"Adjusted posting volume to match production capacity while preserving video and conversion-stage content."`

---

## 3. Validation response with status = balanced

When the gateway runs balancing and the recheck passes, it returns a result with `status: 'balanced'`:

```json
{
  "status": "balanced",
  "override_confirmed": false,
  "requested_total": 12,
  "requested_platform_postings_total": 12,
  "weekly_capacity_total": 5,
  "exclusive_campaigns_total": 0,
  "effective_capacity_total": 5,
  "available_content_total": 3,
  "supply_total": 8,
  "deficit": 4,
  "requested_by_platform": { "linkedin": 7, "facebook": 5 },
  "explanation": "Requested weekly execution is within available_content + weekly_capacity (after exclusive_campaigns consume capacity first).",
  "balanced_requests": [
    { "platform": "linkedin", "content_type": "post", "count_per_week": 3 },
    { "platform": "facebook", "content_type": "post", "count_per_week": 3 },
    { "platform": "linkedin", "content_type": "video", "count_per_week": 2 }
  ],
  "planning_adjustment_reason": "Adjusted posting volume to match production capacity while preserving video and conversion-stage content."
}
```

---

## 4. Example week payload showing adjustment reason

**get-weekly-plans / blueprint week:**

```json
{
  "week_number": 2,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness",
  "distribution_strategy": "STAGGERED",
  "distribution_reason": "Cross-platform reuse across multiple platforms detected → Staggered distribution selected.",
  "planning_adjustment_reason": "Adjusted posting volume to match production capacity while preserving video and conversion-stage content."
}
```

**UI (weekly summary):**  
Small text line under the week header, e.g.:  
`AI adjusted workload to match your weekly capacity.`  
(or the full `planning_adjustment_reason` from the API).

---

## Integration summary

- **capacityFrequencyValidationGateway:** Before returning `invalid`, calls `balanceWorkload()` when `enable_workload_balancing !== false`. On success, revalidates with `balanced_requests` and returns `status: 'balanced'` with `balanced_requests` and `planning_adjustment_reason`.
- **campaignAiOrchestrator:** When `validation_result.status === 'balanced'`, sets `prefilledPlanning.platform_content_requests` to `balanced_requests` so the deterministic skeleton uses them; attaches `planning_adjustment_reason` to each week from `validation_result.planning_adjustment_reason`.
- **APIs:** `planning_adjustment_reason` is included in get-weekly-plans, daily-plans (from blueprint week), and activity-workspace resolve.
- **UI:** Shown in campaign daily plan (per-week) and activity workspace (header) as a small text line.

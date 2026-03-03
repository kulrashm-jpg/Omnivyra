# Planning Adjustments Summary — Final Architectural Polish

## Objective

When the Workload Balancer adjusts the plan, expose a concise human-readable summary (what was reduced, what was preserved). Additive only; no planning or balancing logic changes.

---

## 1. Summary builder implementation

**File:** `backend/services/planningAdjustmentSummaryService.ts`

**Function:** `buildPlanningAdjustmentsSummary(input)`

**Input:**
- `original_platform_content_requests` (same shape as gateway input)
- `balanced_requests` (array of `{ platform, content_type, count_per_week }`)

**Logic (V1):**
- Parse both into rows and aggregate **by content_type** (sum counts).
- **Reduced:** content types where balanced total < original total → e.g. `["posts: -3", "articles: -1"]`.
- **Preserved:** high-value types (video, carousel, reel) where original > 0 and balanced === original → e.g. `["videos", "carousels"]`.
- **text:** One sentence: `"Adjusted workload: reduced 3 posts and 1 article while preserving videos and carousels."` (or fallback if nothing to list).

**Output:**
```ts
{
  reduced: string[];
  preserved: string[];
  text: string;
}
```

---

## 2. Example before vs after requests

**Original (platform_content_requests):**
```json
[
  { "platform": "linkedin", "content_type": "post", "count_per_week": 5 },
  { "platform": "facebook", "content_type": "post", "count_per_week": 3 },
  { "platform": "linkedin", "content_type": "video", "count_per_week": 2 },
  { "platform": "linkedin", "content_type": "article", "count_per_week": 1 }
]
```
By type: post 8, video 2, article 1.

**Balanced (balanced_requests):**
```json
[
  { "platform": "linkedin", "content_type": "post", "count_per_week": 3 },
  { "platform": "facebook", "content_type": "post", "count_per_week": 2 },
  { "platform": "linkedin", "content_type": "video", "count_per_week": 2 },
  { "platform": "linkedin", "content_type": "article", "count_per_week": 0 }
]
```
By type: post 5 (−3), video 2 (unchanged), article 0 (−1).

**Summary output:**
```json
{
  "reduced": ["posts: -3", "articles: -1"],
  "preserved": ["videos"],
  "text": "Adjusted workload: reduced 3 posts and 1 article while preserving videos."
}
```

---

## 3. Example API payload

**get-weekly-plans (one week):**
```json
{
  "weekNumber": 2,
  "phase_label": "Awareness",
  "distribution_strategy": "STAGGERED",
  "planning_adjustment_reason": "Adjusted posting volume to match production capacity while preserving video and conversion-stage content.",
  "planning_adjustments_summary": {
    "reduced": ["posts: -3", "articles: -1"],
    "preserved": ["videos"],
    "text": "Adjusted workload: reduced 3 posts and 1 article while preserving videos."
  }
}
```

---

## 4. Example UI rendering snippet

**Where planning_adjustment_reason is shown (activity workspace or campaign daily plan):**

```tsx
{(payload as any).planning_adjustment_reason && (
  <p className="text-xs text-gray-500 mt-0.5">{(payload as any).planning_adjustment_reason}</p>
)}
{(payload as any).planning_adjustments_summary?.text && (
  <p className="text-xs text-gray-500 mt-0.5">What changed: {(payload as any).planning_adjustments_summary.text}</p>
)}
```

**Example rendered:**
```
AI adjusted workload to match your weekly capacity.
What changed: reduced 3 posts while preserving videos.
```

- text-xs, gray tone, no new layout blocks; shown only when summary exists.

---

## Integration summary

- **Gateway:** When returning `status: 'balanced'`, calls `buildPlanningAdjustmentsSummary(original, balanced_requests)` and adds `planning_adjustments_summary` to the result.
- **Orchestrator:** Attaches `validation_result.planning_adjustments_summary` to each week as `planning_adjustments_summary`.
- **APIs:** get-weekly-plans, daily-plans, activity-workspace/resolve expose optional `planning_adjustments_summary`.
- **UI:** Campaign daily plan and activity workspace show “What changed: {summary.text}” below the adjustment reason when present.

No balancing or execution logic changed; legacy and non-balanced plans unchanged.

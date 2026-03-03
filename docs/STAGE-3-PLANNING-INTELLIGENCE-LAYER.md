# Stage 3 — Planning Intelligence Layer

## Objective

Automatic distribution strategy selection: the system decides between **AI_OPTIMIZED**, **STAGGERED**, and **QUICK_LAUNCH** from campaign context. Decision layer only; no UI changes, no rewrite of planning flows.

---

## Step 1 — Service

**File:** `backend/services/planningIntelligenceService.ts`

**Function:** `determineDistributionStrategy(input)`

**Input:**

- `campaignDurationWeeks`
- `weekly_capacity_total` (or `weeklyCapacity`)
- `requested_total` (or `postingDemand`)
- `platformCount`
- `cross_platform_sharing` (or `crossPlatformReuse`)
- `contentTypes` (optional)
- `campaignIntent` (optional)

---

## Step 2 — Decision matrix (initial version)

| Condition | Result |
|-----------|--------|
| `campaign duration <= 1` week | **QUICK_LAUNCH** |
| `requested_total > (weekly_capacity_total * 1.5)` | **QUICK_LAUNCH** |
| `cross_platform_sharing === true` **and** `platform count >= 2` | **STAGGERED** |
| Otherwise | **AI_OPTIMIZED** |

Evaluation order: QUICK_LAUNCH rules first, then STAGGERED, then default AI_OPTIMIZED.

---

## Step 3 — Integration

**File:** `backend/services/campaignAiOrchestrator.ts`

- Called after `validation_result` exists and planning context is finalized (in `runCampaignAiPlanWithPrefill`).
- Uses `validation_result.requested_total` and `validation_result.weekly_capacity_total` when available; otherwise falls back to skeleton/prefilled values.
- Result is passed as `ctx.distributionStrategy` and attached to each week as `week.distribution_strategy` in `runWithContext` before return.
- **Default:** `AI_OPTIMIZED` when strategy is missing or unavailable.

---

## Step 4 — Daily generation behavior

**File:** `pages/api/campaigns/generate-weekly-structure.ts`

When creating daily items (deterministic path with `execution_items`):

| Mode | Behavior |
|------|----------|
| **AI_OPTIMIZED** | One item per slot; all platforms on the same day (existing behavior). Same as QUICK_LAUNCH for deterministic path. |
| **STAGGERED** | One item per (slot, platform); `dayIndex` spread across the week. Same `master_content_id` appears on different days (one day per platform). |
| **QUICK_LAUNCH** | One item per slot; all platforms share the same `dayIndex` (same day for all platform rows for the same `master_content_id`). |

Non-deterministic (AI) path: `campaignMode` and `distributionMode` are derived from `weekBlueprint.distribution_strategy` and passed to `generateAIDailyDistribution` (unchanged from Stage 2).

---

## Step 5 — Backward compatibility

- If `distribution_strategy` is missing on the week → treat as **AI_OPTIMIZED** (existing behavior preserved).

---

## Example week JSON (with distribution_strategy)

```json
{
  "week_number": 2,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness",
  "topics": [{ "topicTitle": "Problem we solve" }, { "topicTitle": "Customer story" }],
  "topics_to_cover": ["Problem we solve", "Customer story"],
  "content_type_mix": ["post", "video"],
  "platform_allocation": { "linkedin": 3, "facebook": 2 },
  "execution_items": [],
  "distribution_strategy": "STAGGERED"
}
```

---

## Example daily rows by mode

One logical piece (slot) with `master_content_id: "mc_1"` and platforms `linkedin`, `facebook`.

### AI_OPTIMIZED / QUICK_LAUNCH (same day for all platforms)

| dayIndex | platformTargets        | master_content_id |
|----------|------------------------|-------------------|
| 3        | ["linkedin", "facebook"] | mc_1              |

One daily item; one row per platform in DB, both with `day_index` 3.

### STAGGERED (spread across days)

| dayIndex | platformTargets | master_content_id |
|----------|-----------------|-------------------|
| 2        | ["linkedin"]     | mc_1              |
| 3        | ["facebook"]     | mc_1              |

Two daily items (one per platform); same `master_content_id`, different `dayIndex`.

### QUICK_LAUNCH (explicit same day)

| dayIndex | platformTargets        | master_content_id |
|----------|------------------------|-------------------|
| 1        | ["linkedin", "facebook"] | mc_1              |

One daily item; all platform rows get the same `dayIndex` (1).

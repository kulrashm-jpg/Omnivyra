# Phase 1 — Daily Distribution Cleanup Implementation Report

**Date:** 2025-03-07  
**Goal:** Remove everything that creates or mutates schedule outside the weekly plan.

---

## 1. Summary of Changes

| Area | Change | Files Modified |
|------|--------|----------------|
| **Day assignment in weekly plan** | Added `day_index` to `topic_slots` when building execution_items | `backend/services/campaignAiOrchestrator.ts` |
| **generate-weekly-structure** | Removed AI path; require execution_items; read `day_index` from blueprint | `pages/api/campaigns/generate-weekly-structure.ts` |
| **Daily distribution service** | Disabled with guard — throws if called | `backend/services/dailyContentDistributionPlanService.ts` |
| **Campaign wave date overwrite** | Disabled — no longer mutates `entry.row.date` in daily layer | `pages/api/campaigns/generate-weekly-structure.ts` |

---

## 2. Removed / Disabled

### Daily distribution logic (removed from flow)
- **`generateDailyDistributionPlan`** — No longer called. Service has `DAILY_DISTRIBUTION_DISABLED` guard; throws if invoked.
- **`generateDailyDistributionPlanBatch`** — Same.
- **`spreadEvenlyAcrossDays`** — Removed from `generate-weekly-structure.ts`. Day assignment moved to weekly plan (campaignAiOrchestrator).
- **AI daily distribution prompts** — `dailyDistribution.prompt.ts` and `getDailyDistributionSystemPrompt` remain in codebase but are no longer used in the flow (service is disabled).

### Day / time mutation in daily layer
- **Campaign wave schedule** — `entry.row.date = assignment.scheduled_date` commented out. Wave info still attached to content; date is not overwritten.

---

## 3. New Flow

1. **Weekly plan generation** (`campaignAiOrchestrator`): When building execution_items, each `topic_slot` gets a deterministic `day_index` via `spreadDaysForCount(count, 7)`.
2. **generate-weekly-structure**: Requires `execution_items` with `topic_slots`. Reads `day_index` from each slot (fallback `(k % 7) + 1` for legacy blueprints). No AI. No `spreadEvenlyAcrossDays`.
3. **Daily plans**: Persisted to `daily_content_plans` with `day_of_week` and `date` derived from blueprint `day_index` + campaign start. No downstream mutation.

---

## 4. Error When execution_items Missing

If a week has no `execution_items`, generate-weekly-structure now throws:

```
EXECUTION_ITEMS_REQUIRED: Week must have execution_items with topic_slots. Daily distribution is disabled; schedule comes from weekly plan only.
```

---

## 5. Daily Planner Behavior

- **Daily plan = visualization** of weekly schedule. Schedule originates from weekly plan.
- **No AI logic** in daily layer.
- **No distribution logic** in daily layer. Day is read from blueprint.

---

## 6. Files Not Modified (intentionally)

- **`dailyDistribution.prompt.ts`** — Left in place. Prompt registry still has `daily_distribution` entry. No callers remain.
- **`commit-daily-plan.ts`** — User edits to daily plans still persist. Per spec: daily should mirror weekly; manual edits are allowed as user overrides.
- **`autopilotExecutionPipeline`** — Sets `scheduled_time` when items lack it. That is execution scheduling, not planning distribution; left as-is.

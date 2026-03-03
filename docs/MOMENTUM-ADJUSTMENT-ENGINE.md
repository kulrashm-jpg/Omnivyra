# Adaptive Momentum Engine — Self-Healing Campaign Planning

## Objective

When workload balancing reduces content, preserve campaign narrative momentum by marking later weeks as absorbing strategic intent from earlier weeks. Additive only; no new content generation, no schema or execution changes.

---

## 1. momentumAdjustmentService logic

**File:** `backend/services/momentumAdjustmentService.ts`

**Function:** `adjustCampaignMomentum(input)`

**Input:**
- `weeks[]` — array of week objects
- `validation_result` — optional; must have `status === 'balanced'` and `planning_adjustments_summary.reduced.length > 0` for any adjustment

**Momentum loss detection:**
- Momentum loss exists when `validation_result.status === 'balanced'` AND `planning_adjustments_summary.reduced` has at least one item.
- If not, returns `weeks` unchanged.

**Adjustment (V1):**
- **Rule A — Forward redistribution:** Week 1 is treated as the week that lost volume; Week 2 is marked as absorbing.
- Week 1 gets `momentum_adjustments: { carried_forward_to: [2], reason: "Week 1 workload reduction carried forward." }`.
- Week 2 gets `momentum_adjustments: { absorbed_from_week: [1], reason: "Week 1 workload reduction carried forward." }`.
- **Rule B — Phase order:** No content is moved backward; only metadata is added. Phase progression is unchanged.
- **Rule C — Capacity:** No new content or counts are added; only optional metadata on existing weeks.
- **Rule D — Identity:** No master_content_id or execution_items are changed.

**Output:** New array of week objects with `momentum_adjustments` added where applicable. No other fields are modified.

---

## 2. Before vs after week example

**Before (Week 1, no momentum metadata):**
```json
{
  "week_number": 1,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness",
  "topics_to_cover": ["Problem we solve", "Customer story"],
  "planning_adjustment_reason": "Adjusted posting volume to match production capacity..."
}
```

**After (Week 1 with momentum_adjustments):**
```json
{
  "week_number": 1,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness",
  "topics_to_cover": ["Problem we solve", "Customer story"],
  "planning_adjustment_reason": "Adjusted posting volume to match production capacity...",
  "momentum_adjustments": {
    "carried_forward_to": [2],
    "reason": "Week 1 workload reduction carried forward."
  }
}
```

**Week 2 after:**
```json
{
  "week_number": 2,
  "phase_label": "Education",
  "momentum_adjustments": {
    "absorbed_from_week": [1],
    "reason": "Week 1 workload reduction carried forward."
  }
}
```

---

## 3. Example momentum_adjustments payload

**On a week that absorbed from Week 1:**
```json
{
  "absorbed_from_week": [1],
  "reason": "Week 1 workload reduction carried forward."
}
```

**On Week 1 when intent is carried forward:**
```json
{
  "carried_forward_to": [2],
  "reason": "Week 1 workload reduction carried forward."
}
```

**Exposure:** Optional field on week in get-weekly-plans, daily-plans (per week), and activity-workspace resolve payload when the activity’s week has it.

---

## 4. Confirmation: phase order preserved

- **No backward movement:** The service only adds `momentum_adjustments` metadata. It does not move topics, execution_items, or phase labels between weeks.
- **Forward only:** Week 1 is marked `carried_forward_to: [2]`; Week 2 is marked `absorbed_from_week: [1]`. No week receives content or intent from a later week.
- **Awareness → Education → Authority → Conversion:** Phase labels and week order are unchanged. Metadata only indicates that Week 2 carries forward narrative intent from Week 1; it does not alter phase progression or create new content.

---

## Integration summary

- **Orchestrator:** After attaching distribution_strategy, planning_adjustment_reason, and planning_adjustments_summary to each week, calls `adjustCampaignMomentum({ weeks, validation_result })` and replaces `structured.weeks` with the result. Runs only when a balanced plan exists.
- **APIs:** get-weekly-plans, daily-plans, activity-workspace/resolve expose optional `momentum_adjustments` on the week (or week-derived payload).
- **UI:** Campaign daily plan and activity workspace show a small line when `momentum_adjustments.absorbed_from_week` is present: e.g. “Momentum adjusted from Week 1” (text-xs, gray).

Existing campaigns and non-balanced plans are unchanged. No new IDs, prompts, or execution logic.

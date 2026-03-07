# Weekly Scheduling Model — Implementation Report

**Date:** 2025-03-07  
**Phase:** 2 — Single Source of Truth for Scheduling  
**Constraint:** Phase 1 removed daily distribution; no scheduling logic reintroduced in daily planners.

---

## 1. Data Model Updates

### New fields on weekly activity (topic_slot)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `topic_code` | string | — | Single letter identifier (A, B, C) |
| `content_code` | string | — | Unique identifier (A1, A2, B1) |
| `scheduled_day` | number \| null | null | Day index 1–7 relative to campaign week |
| `scheduled_time` | string \| null | null | Time string (HH or HH:MM) |
| `target_regions` | string[] | [] | Region identifiers |
| `timezone_mode` | `'regional' \| 'single_timezone'` | `'regional'` | Timezone handling |
| `repurpose_index` | number | 1 | Index within topic repurpose chain |
| `repurpose_total` | number | 1 | Total outputs from same topic |

### Storage location

- Weekly activities live in `execution_items[].topic_slots[]` in the twelve_week_plan blueprint.
- All new fields are set on each topic_slot by `assignWeeklySchedule()` before the plan is saved.

### Backward compatibility

- `applyScheduleDefaults()` fills missing fields when reading older records.
- Defaults: `scheduled_day=null`, `scheduled_time=null`, `target_regions=[]`, `timezone_mode='regional'`, `repurpose_index=1`, `repurpose_total=1`.

---

## 2. Service Creation

**File:** `backend/services/weeklyScheduleAllocator.ts`

**Function:** `assignWeeklySchedule(input: AssignWeeklyScheduleInput)`

**Responsibilities:**
- Assigns `topic_code` (A, B, C by unique topic order)
- Assigns `content_code` (A1, A2, B1 within each topic)
- Assigns `scheduled_day` (1–7, spread across week, no same-topic same-day)
- Assigns `scheduled_time` (default `"09:00"`)
- Assigns `repurpose_index` and `repurpose_total` per topic
- Assigns `target_regions` from input
- Assigns `timezone_mode` (default `"regional"`)

**Design:** Deterministic rules only; no AI.

---

## 3. Topic / Content Code Generation

- Topic codes: Topic 1 → A, Topic 2 → B, Topic 3 → C, etc.
- Content codes: per topic, A1, A2, A3 … B1, B2 …

---

## 4. Scheduling Rules (Initial Version)

- Spread activities across Mon–Sun (days 1–7).
- Avoid placing two items from the same topic on the same day.
- Respect repurpose order spacing (≥1 day between consecutive items in same topic).
- Default `scheduled_time` = `"09:00"`.

---

## 5. Integration Point

**File:** `backend/services/campaignAiOrchestrator.ts`

**Location:** After global_progression_index re-index, before writer-ready week enrichment.

```ts
assignWeeklySchedule({
  weeklyActivities: weeksForSchedule,
  campaignStartDate: undefined,
  region: derived from prefilledPlanning/recommendationContext,
});
```

Scheduling fields are set on topic_slots before the plan is persisted or used downstream.

---

## 6. Example Weekly Activity Record

```json
{
  "topic_code": "A",
  "content_code": "A1",
  "topic": "AI adoption barriers",
  "platform": "linkedin",
  "content_type": "post",
  "scheduled_day": 2,
  "scheduled_time": "09:00",
  "target_regions": ["india"],
  "timezone_mode": "regional",
  "repurpose_index": 1,
  "repurpose_total": 3,
  "intent": { "objective": "...", "cta_type": "...", "target_audience": "..." },
  "master_content_id": "campaign_w1_post_0_0"
}
```

Note: `platform` and `content_type` come from the parent execution_item; each topic_slot may map to multiple platforms when shared.

---

## 7. Files Touched

| File | Change |
|------|--------|
| `backend/services/weeklyScheduleAllocator.ts` | New service |
| `backend/services/campaignAiOrchestrator.ts` | Import + call `assignWeeklySchedule` after global index |
| `backend/types/CampaignBlueprint.ts` | Comment on execution_items scheduling fields |
| `backend/tests/unit/weeklyScheduleAllocator.test.ts` | Unit tests |

---

## 8. Constraint Confirmed

After this change, weekly activities always carry schedule metadata. No other service assigns or changes schedule outside this layer. Daily planner will read these values and not generate them.

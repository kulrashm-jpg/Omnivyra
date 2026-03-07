# Phase 4 — AI Chat Plan Editing Engine — Implementation Report

**Date:** 2025-03-07  
**Phase:** 4 — AI-assisted schedule edits using content codes  
**Constraint:** No changes to weeklyScheduleAllocator; edit existing schedules only.

---

## 1. Objective

Allow AI chat (and direct user input) to interpret instructions referencing activity codes (A1, B2, etc.) and update weekly schedules safely.

Example instructions:

- Move A3 to Friday morning  
- Swap A2 and B1  
- Delay A1 by one day  
- Delete B2  
- Add Instagram post under topic B  

---

## 2. weeklyPlanEditEngine Service

**File:** `backend/services/weeklyPlanEditEngine.ts`

**Main function:** `applyWeeklyPlanEdits(planWeek, editInstructions)`

**Responsibilities:**

- Locate activities by `content_code`
- Modify `scheduled_day`, `scheduled_time`
- Maintain repurpose order (recompute `repurpose_index` / `repurpose_total` after delete)
- Enforce validation rules

**Supported operations:**

| Operation | Example | Effect |
|-----------|---------|--------|
| **MOVE** | Move A3 to Friday 09:00 | Update scheduled_day, scheduled_time |
| **SWAP** | Swap A2 and B1 | Exchange day and time between two slots |
| **DELAY** | Delay A1 by 1 day | Increment scheduled_day (clamped 1–7) |
| **ADVANCE** | Advance A1 by 1 day | Decrement scheduled_day (clamped 1–7) |
| **DELETE** | Delete B2 | Remove slot; recompute repurpose for topic |
| **ADD** | Add Instagram post under topic B | New slot B3, next available day, 09:00 |

---

## 3. weeklyPlanCommandParser Service

**File:** `backend/services/weeklyPlanCommandParser.ts`

**Function:** `parseWeeklyPlanCommands(instruction: string): EditOperation[]`

**Responsibilities:**

- Parse natural language into structured operations
- Return empty array when nothing can be parsed

**Example output:**

```ts
{ type: "move", content_code: "A3", day: 5, time: "09:00" }
{ type: "swap", content_code_a: "A2", content_code_b: "B1" }
{ type: "delay", content_code: "A1", days: 1 }
{ type: "delete", content_code: "B2" }
{ type: "add", topic_code: "B", platform?: "instagram", content_type?: "post" }
```

**Supported phrases:**

- move / to / morning / afternoon / evening / day names (Mon–Sun)  
- swap … and …  
- delay … by N day(s)  
- advance … by N day(s)  
- delete / remove …  
- add [platform] [content_type] under topic [letter]  

---

## 4. Validation Rules

| Rule | Behavior |
|------|----------|
| Max 3 activities per day | If target day exceeds, `findNextAvailableDay` picks an alternative |
| Same topic spacing ≥ 1 day | New/ moved slots avoid placing same topic on adjacent days |
| scheduled_day 1–7 | All day values clamped |

---

## 5. Integration

**API:** `POST /api/campaigns/apply-weekly-plan-edits`

**Body:** `{ campaignId, weekNumber, instruction }` or `{ campaignId, weekNumber, editInstructions }`

**Flow:**

1. Load plan (draft or committed) for campaign
2. Resolve target week by weekNumber
3. Parse instruction (if string) via `parseWeeklyPlanCommands`
4. Apply edits with `applyWeeklyPlanEdits`
5. Persist via `saveDraftBlueprint` or `updateToEditedCommitted`

**UI:**

- Weekly activity board shows an “Apply edit” input: user types e.g. “Move A3 to Friday morning”
- On success, `loadData()` is called to refresh the board
- Cards move columns when `scheduled_day` changes

---

## 6. Files Created / Modified

| File | Change |
|------|--------|
| `backend/services/weeklyPlanEditEngine.ts` | **New** — Edit engine |
| `backend/services/weeklyPlanCommandParser.ts` | **New** — Command parser |
| `pages/api/campaigns/apply-weekly-plan-edits.ts` | **New** — API route |
| `components/weekly-board/WeeklyActivityBoard.tsx` | **Modified** — Apply edit input + button |
| `pages/campaign-daily-plan/[id].tsx` | **Modified** — Pass campaignId, onEditApplied |
| `backend/tests/unit/weeklyPlanCommandParser.test.ts` | **New** — Parser tests |
| `backend/tests/unit/weeklyPlanEditEngine.test.ts` | **New** — Engine tests |

---

## 7. Confirmation Checklist

1. **weeklyPlanEditEngine service created** — `backend/services/weeklyPlanEditEngine.ts`  
2. **Command parser created** — `backend/services/weeklyPlanCommandParser.ts`  
3. **Supported operations implemented** — MOVE, SWAP, DELAY, ADVANCE, DELETE, ADD  
4. **Validation rules applied** — Max 3/day, topic spacing, day 1–7  
5. **Integration with AI chat workflow** — API + Apply edit UI on weekly board; refresh after apply  

---

## 8. Scheduling Logic

`weeklyScheduleAllocator` was **not** modified. Edits only change existing `topic_slots`; no new scheduling logic is introduced.

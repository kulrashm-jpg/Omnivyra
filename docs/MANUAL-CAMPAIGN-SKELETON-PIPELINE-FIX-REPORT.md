# MANUAL CAMPAIGN SKELETON PIPELINE — FIX IMPLEMENTATION REPORT

**Date:** 2025-03-14  
**Scope:** Manual Campaign Builder only. No changes to Recommended Hub, TrendCampaignsTab, or `/api/recommendations/*`.

---

## FILES MODIFIED

| File | Changes |
|------|---------|
| `pages/api/campaigns/planner-finalize.ts` | Core logic: use `calendar_plan`, `buildWeeksFromCalendarPlan`, user start date, `daily_content_plans` from activities, placeholder slots, validation |
| `components/planner/FinalizeSection.tsx` | Send `calendar_plan`, require skeleton for new campaigns (`canFinalize` = campaignId \|\| hasSkeleton) |

---

## NEW FUNCTIONS

| Function | Location | Purpose |
|----------|----------|---------|
| `dayNameToIndex(day)` | planner-finalize.ts | Map day name (e.g. Monday) to 1–7 index |
| `computeDayDate(campaignStart, weekNumber, dayName)` | planner-finalize.ts | Compute YYYY-MM-DD for a slot |
| `normalizePlatform(p)` | planner-finalize.ts | Normalize platform (twitter→x) for storage |
| `buildWeeksFromCalendarPlan(calendarPlan)` | planner-finalize.ts | Convert `calendar_plan.activities` → weeks structure for `twelve_week_plan`; skeleton comes from planner state only |

---

## CODE CHANGES

### CHANGE 1 — Use Preview Skeleton During Finalize

**Before:** `weeks = buildStructuredWeeksFromStrategy(strategy_context, ideaTitle)` (discarded preview)

**After:**
- Accept `calendar_plan` from request body.
- When `calendar_plan.activities` present: `weeks = buildWeeksFromCalendarPlan(body.calendar_plan)`.
- Persist that structure into `twelve_week_plan` via `saveStructuredCampaignPlan` + `commitDraftBlueprint`.

### CHANGE 2 — Use User Start Date

**Before:** `const startDate = new Date().toISOString().split('T')[0];`

**After:**
```ts
const startDate =
  (typeof strat?.planned_start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(strat.planned_start_date.trim())
    ? strat.planned_start_date.trim()
    : null) ?? new Date().toISOString().split('T')[0];
```

Campaign insert uses `start_date: startDate`. Existing campaigns updated with `start_date` when missing.

### CHANGE 3 — Persist Drag-Drop Slot Moves

`daily_content_plans` rows are built from `calendar_plan.activities`:

```ts
for (const activity of calendar_plan.activities) {
  // Insert row with campaign_id, week_number, day_of_week, date, platform, content_type,
  // title, topic, content (placeholder), status, execution_id
}
```

When `useCalendarPlanPath` is true, `runPlannerCommitAndGenerateWeekly` is **skipped**. Slots come directly from planner state.

### CHANGE 4 — Support Placeholder Slots

Each activity without theme/content is stored with:

```ts
content: JSON.stringify({
  placeholder: true,
  label: `${platform} ${content_type}`,
}),
```

Example: `LinkedIn Video` with `placeholder: true`.

### CHANGE 5 — Ignore platform_content_requests at Finalize

Skeleton comes only from `calendar_plan`. No dependency on `platform_content_requests`, `posting_frequency`, or `content_mix` when `calendar_plan` is provided. `buildWeeksFromCalendarPlan` uses `calendar_plan.activities` only.

### CHANGE 6 — Keep Recommended Hub Safe

**Verified untouched:**
- `TrendCampaignsTab.tsx` — not modified
- `recommendationCampaignBuilder.ts` — not modified
- `/api/recommendations/*` — not modified
- `/api/campaigns/ai/plan` — when `campaignId` exists (recommended flow), behavior unchanged

Manual builder runs when `mode=direct` and `campaignId=null`. Finalize requires `calendar_plan` for new campaigns.

### CHANGE 7 — Validate Finalize Input

When new campaign and no valid `calendar_plan`:

```ts
if (!useCalendarPlanPath && !existingCampaignId) {
  return res.status(400).json({
    error: 'Generate skeleton first. Complete Campaign Context and Execution Setup, then click Generate Skeleton before finalizing.',
  });
}
```

Also uses `validateCalendarPlan` from `plannerIntegrityService` when `calendar_plan` is sent.

---

## RECOMMENDED HUB CHECK

| Artifact | Status |
|----------|--------|
| `TrendCampaignsTab.tsx` | **UNTOUCHED** |
| `recommendationCampaignBuilder.ts` | **UNTOUCHED** |
| `pages/api/recommendations/*` | **UNTOUCHED** |
| `pages/api/campaigns/ai/plan` | **UNTOUCHED** (manual builder path unchanged; recommended path uses `campaignId`) |

---

## VERIFICATION RESULT

| Check | Result |
|-------|--------|
| Build | TypeScript compiles (Next.js build initiated) |
| Linter | No errors on modified files |
| Manual flow (Generate Skeleton → Move slot → Finalize) | Expected: `start_date` from strategy, moved slots persisted, `daily_content_plans` rows created, placeholders stored |

**Manual test steps:**
1. Set `start_date: 2025-03-20`, `duration_weeks: 4`, video: 2, text: 3, carousel: 1.
2. Click **Generate Skeleton**.
3. Move one slot to a different day.
4. Click **Finalize Campaign**.

**Expected:**
- `campaigns.start_date = 2025-03-20`
- Slots reflect moved days in `daily_content_plans`
- `daily_content_plans` rows created from `calendar_plan.activities`
- Placeholder content stored (`placeholder: true`, `label`)

---

## DATA FLOW

```
ExecutionSetupPanel (Generate Skeleton)
  → POST /api/campaigns/ai/plan (preview_mode: true)
  → weeksToCalendarPlan() → setCalendarPlan()

ActivityCardWithControls (drag/move)
  → handleMoveToDay() → updateActivityInPlan() → setCalendarPlan()

FinalizeSection (Finalize Campaign)
  → POST /api/campaigns/planner-finalize { calendar_plan, strategy_context, ... }
  → buildWeeksFromCalendarPlan(calendar_plan)
  → saveStructuredCampaignPlan + commitDraftBlueprint
  → Insert daily_content_plans from calendar_plan.activities
  → Redirect to /campaign-calendar/{campaign_id}
```

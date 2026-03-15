# CAMPAIGN EXECUTION READINESS AUDIT

**Goal:** Verify the system can support this execution model:

```
Strategic Theme Card
→ Campaign Creation (AI Chat OR BOLT)
→ Week Plan
→ Day Plan
→ Activity Workspace
→ Repurpose
→ Schedule
→ Dashboard Calendar
```

**Audit Date:** Based on codebase inspection. No implementation performed.

---

## SECTION 1 — DAY PLAN STRUCTURE

### DAY PLAN STRUCTURE REPORT

| Field | Value |
|-------|-------|
| **Component** | CampaignDailyPlanPage |
| **File Path** | `pages/campaign-daily-plan/[id].tsx` |
| **Data Source** | `retrieve-plan` (draftPlan/committedPlan weeks), `get-weekly-plans`, `daily-plans` (fallback when no blueprint weeks) |
| **Weeks Rendered** | Yes — all weeks via `weeksToShow` (1..totalWeeks). Uses `WeeklyActivityBoard` per week. |
| **Activity Cards Rendered** | Yes — `GridActivity` mapped from blueprint `daily_execution_items` or `daily_content_plans`. Rendered as cards in week×day grid. |
| **Supports Global Actions (Yes/No)** | **Partial** — No top-level "Repurpose & Schedule Entire Campaign" button. Has per-week `handleRegenerateWeek`, per-week `handleDrop` (drag-drop), `openActivityWorkspace` per activity. No campaign-wide bulk action. |

| Field | Value |
|-------|-------|
| **Component** | campaign-daily-plan route |
| **File Path** | `pages/campaign-daily-plan/[id].tsx` |
| **Data Source** | Same as above; route is the page. |
| **Weeks Rendered** | Yes |
| **Activity Cards Rendered** | Yes |
| **Supports Global Actions (Yes/No)** | Partial |

| Field | Value |
|-------|-------|
| **Component** | daily-plans API |
| **File Path** | `pages/api/campaigns/daily-plans.ts` |
| **Data Source** | `daily_content_plans` (Supabase), `getUnifiedCampaignBlueprint` for distribution strategy |
| **Weeks Rendered** | N/A (API returns flat array; client groups by week) |
| **Activity Cards Rendered** | N/A (API returns normalized plans; client maps to GridActivity) |
| **Supports Global Actions (Yes/No)** | N/A |

**Week-level filtering or scrolling:** `focusWeek` from `?week=N` triggers `scrollIntoView` on the week ref. No explicit week filter dropdown; all weeks rendered, scroll to focus.

---

## SECTION 2 — GLOBAL AUTO SCHEDULE BUTTON

### AUTO SCHEDULE CAPABILITY

| Service | File Path | Can Repurpose | Can Schedule | Used By | Reusable For Bulk Campaign Scheduling |
|---------|-----------|---------------|--------------|---------|--------------------------------------|
| **structuredPlanScheduler** | `backend/services/structuredPlanScheduler.ts` | No (uses pre-existing content) | Yes — `scheduleStructuredPlan` writes to `scheduled_posts` | BOLT, `schedule-structured-plan` API, CampaignAIChat | Yes — accepts plan + campaignId; when `generateContent: true` calls `generateContentForDailyPlans` |
| **scheduleStructuredPlan** | Same file | Via `generateContentForDailyPlans` when `options.generateContent === true` | Yes | BOLT, schedule-structured-plan API | Yes |
| **boltPipelineService** | `backend/services/boltPipelineService.ts` | Orchestrates; calls scheduleStructuredPlan with `generateContent: true` | Yes (via scheduleStructuredPlan) | BOLT execute API, bolt queue worker | Yes — but tied to BOLT run; not a standalone "bulk schedule" endpoint |
| **repurposeGraphEngine** | `backend/services/repurposeGraphEngine.ts` | Yes — expands slots into repurposed formats; sets `repurpose_of` | No | dailyContentDistributionPlanService, BOLT planning | No — planning layer only; does not schedule |
| **buildPlatformVariantsFromMaster** | `backend/services/contentGenerationPipeline.ts` | Yes — master → platform variants | No | Activity Workspace API, boltContentGenerationForSchedule | Yes — reusable; called by `generateContentForDailyPlans` |
| **generateContentForDailyPlans** | `backend/services/boltContentGenerationForSchedule.ts` | Yes — master + variants per topic group | No | structuredPlanScheduler (when generateContent) | Yes — generates content for all daily plans; does not insert into scheduled_posts |

**Summary:** A combined repurpose + schedule flow exists inside BOLT and `scheduleStructuredPlan` when `generateContent: true`. There is **no standalone API or Day Plan UI button** that triggers "Repurpose & Schedule Entire Campaign" from the Day Plan page. The capability is embedded in BOLT and the schedule-structured-plan API.

---

## SECTION 3 — ACTIVITY WORKSPACE REPURPOSE FLOW

### ACTIVITY WORKSPACE FLOW

| Component | File Path | Supports Multi Platform | Repurpose Service | Schedule Trigger | Writes To Table |
|-----------|-----------|-------------------------|-------------------|------------------|-----------------|
| **ActivityWorkspacePage** | `pages/activity-workspace.tsx` | Yes — `schedules` array; one row per platform/variant | `buildPlatformVariantsFromMaster` via `/api/activity-workspace/content` | "Add to Schedule" / commit flow | Uses commit-daily-plan or social/post APIs → `daily_content_plans`, `scheduled_posts` |
| **activity-workspace/content API** | `pages/api/activity-workspace/content.ts` | Yes | `buildPlatformVariantsFromMaster` | N/A | Does not write; returns variants |
| **activity-workspace/resolve API** | `pages/api/activity-workspace/resolve.ts` | Yes — rebuilds payload from blueprint | N/A | N/A | Reads only |
| **activity-workspace/creator-asset API** | `pages/api/activity-workspace/creator-asset.ts` | N/A | N/A | N/A | Writes `creator_asset`, `content_status` to `daily_content_plans` |

**Flow confirmation:**
1. Activity workspace loads **all platforms linked to an activity** via `schedules` in payload (one row per platform/variant).
2. Repurposing generates **platform variants** via `buildPlatformVariantsFromMaster` when user clicks "Repurpose Content."
3. Scheduling creates **scheduled_posts** via commit-daily-plan, createLegacyScheduledPost, or schedule-structured-plan — not directly from activity-workspace page; user must trigger "Add to Schedule" or equivalent.

---

## SECTION 4 — CREATOR DEPENDENT ACTIVITIES

### CREATOR DEPENDENT SYSTEM

| Field | Table | Purpose | Used By | Supports Placeholder State (Yes/No) |
|-------|-------|---------|---------|-------------------------------------|
| **creator_asset** | daily_content_plans | JSONB — uploaded creator asset (video, carousel, image): `{ type, url, files[], thumbnail?, description?, transcript? }` | activity-workspace resolve, creator-asset API, PlanningCanvas, CreatorContentPanel | Yes — null/absent = placeholder; populated = ready for repurpose |
| **content_status** | daily_content_plans | TEXT — `CREATOR_REQUIRED`, `READY_FOR_PROMOTION`, etc. | activity-workspace, PlanningCanvas (getExecutionModeBadge), creator-asset API | Yes — CREATOR_REQUIRED = placeholder; READY_FOR_PROMOTION = ready |
| **content_status** | plannerSessionStore (CalendarPlanActivity) | In-memory; same semantics | PlanningCanvas | Yes |
| **creator_asset** | plannerSessionStore | In-memory | PlanningCanvas | Yes |
| **content_source** | campaign_execution_checkpoint | Enum: `content_assets` \| `daily_content_plans` | campaignExecutionCheckpointService | Yes — distinguishes source |
| **creator_card** | daily_content_plans (in content JSON) | Nested in content JSON; creator brief/card | daily-plans API, activity-workspace | Yes |

**Placeholder flow:** Placeholder activity exists when `creator_asset` is null and `content_status` is `CREATOR_REQUIRED` (or similar). Creator uploads via `/api/activity-workspace/creator-asset` → sets `creator_asset` and `content_status: READY_FOR_PROMOTION`. Activity Workspace then enables "Generate Promotion Content" (repurpose) via CreatorContentPanel.

---

## SECTION 5 — DASHBOARD CALENDAR EVENT DATA

### CALENDAR EVENT STRUCTURE

| Field | Source Table | Used In UI | Shows Activity Level | Supports Repurpose Order |
|-------|--------------|------------|----------------------|--------------------------|
| **campaign** | campaigns | DashboardPage | No — campaign-level only | No |
| **stage** | stageAvailability (derived) | getCalendarStageAppearance | No — campaign stage (weekly_planning, daily_cards, content_created, content_scheduled, content_shared, overdue) | No |
| **label** | Derived (campaign.name or "Week N - campaign.name") | Calendar cell | No — campaign or week label | No |
| **dailyPlans** | daily_content_plans (count) | stage-availability-batch | No — count only | No |
| **contentReadyDailyPlans** | daily_content_plans (count where content not null) | stage-availability-batch | No — count only | No |
| **scheduledPosts** | scheduled_posts | stage-availability-batch | No — count only | No |
| **publishedPosts** | scheduled_posts | stage-availability-batch | No — count only | No |

**Summary:** Dashboard calendar does **not** show activity-level events. It shows campaign-level stages per date. Each calendar cell displays a campaign (or "Week N - Campaign Name" in weekly mode) with a stage badge. It does **not** show Platform, Content Type, Topic, Repurpose Order, or individual activity status.

---

## SECTION 6 — REPURPOSE ORDER TRACKING

### REPURPOSE RELATIONSHIP MODEL

| Field | Table | Purpose | Supports Ordered Repurpose |
|-------|-------|---------|----------------------------|
| **repurpose_of** | repurposeGraphEngine output (in-memory / blueprint slots) | Links derived slot to source slot ID | Yes — lineage tracking |
| **repurpose_index** | weeklyScheduleAllocator, weeklyPlanEditEngine, WeeklyActivity | 1-based index within topic repurpose chain | Yes — e.g. 1, 2, 3 for "1/3", "2/3", "3/3" |
| **repurpose_total** | Same | Total outputs from same topic | Yes |
| **topic_group** | Not found in codebase | — | No |
| **sequence_index** | ScheduleItem in activity-workspace payload | 1-based index in distribution list for topic | Yes — similar concept |
| **total_distributions** | ScheduleItem | Total distributions for topic | Yes |

**Note:** `repurpose_index` and `repurpose_total` live in blueprint/slot structures and `WeeklyActivity` (via `weeklyActivityAdapter`). They are **not** stored in `daily_content_plans` or `scheduled_posts`. `scheduled_posts` has no `repurpose_index` or `repurpose_total` column.

**WeeklyActivityCard** displays repurpose as `{repurpose_index}/{repurpose_total}` when `repurpose_total > 1`.

---

## SECTION 7 — BULK CAMPAIGN EXECUTION

### BULK EXECUTION CAPABILITY

| Service | Can Generate Variants | Can Schedule Posts | Needs Refactor |
|---------|------------------------|--------------------|----------------|
| **generateContentForDailyPlans** | Yes — master + platform variants per topic group | No | No — add optional schedule step or call from new bulk endpoint |
| **structuredPlanScheduler** | Via generateContentForDailyPlans when generateContent=true | Yes | No — already supports combined flow when called with generateContent |
| **boltPipelineService** | Yes (orchestrates) | Yes | No — BOLT-only; not exposed as Day Plan button |
| **buildPlatformVariantsFromMaster** | Yes | No | No |

**Summary:** The system **can** execute "for each activity: generate variants → assign schedule date/time → create scheduled_posts" **when** `scheduleStructuredPlan` is called with `generateContent: true` and a plan derived from `daily_content_plans`. This is used by BOLT. There is **no** Day Plan–triggered bulk endpoint or button that invokes this flow. A new API (e.g. `POST /api/campaigns/[id]/repurpose-and-schedule`) could call `generateContentForDailyPlans` + `scheduleStructuredPlan` (or equivalent) to achieve "Repurpose & Schedule Entire Campaign."

---

## SECTION 8 — CALENDAR COLOR SYSTEM

### CALENDAR STATUS MODEL

| Status | Color | Where Defined | Used By |
|--------|-------|---------------|---------|
| **weekly_planning** | white/gray (`bg-white text-gray-800 border-gray-300`) | `DashboardPage.tsx` getCalendarStageAppearance | Dashboard calendar |
| **daily_cards** | green (`bg-green-100 text-green-800 border-green-200`) | Same | Dashboard calendar |
| **content_created** | sky (`bg-sky-100 text-sky-800 border-sky-200`) | Same | Dashboard calendar |
| **content_scheduled** | emerald (`bg-emerald-600 text-white`) | Same | Dashboard calendar |
| **content_shared** | blue (`bg-blue-700 text-white`) | Same | Dashboard calendar |
| **overdue** | red (`bg-red-600 text-white`) | Same | Dashboard calendar |

**Note:** Statuses such as `CREATOR_PENDING`, `CONTENT_READY`, `REPURPOSED`, `SCHEDULED`, `PUBLISHED` do **not** exist as calendar-stage enum values. The Dashboard uses campaign execution stage: weekly_planning → daily_cards → content_created → content_scheduled → content_shared → overdue. `content_status` on `daily_content_plans` (e.g. CREATOR_REQUIRED, READY_FOR_PROMOTION) is used in Activity Workspace and PlanningCanvas, not in the Dashboard calendar.

---

## SECTION 9 — BOLT FINAL EXECUTION MODE

### BOLT SCHEDULING CAPABILITY

| Service | Creates Variants | Schedules Posts | Creates Calendar Entries |
|---------|------------------|------------------|---------------------------|
| **boltPipelineService** | Yes — via scheduleStructuredPlan with generateContent: true | Yes — scheduleStructuredPlan writes scheduled_posts | Yes — scheduled_posts are the calendar source; Dashboard shows campaign stage when scheduledPosts > 0 |
| **scheduleStructuredPlan** | Yes (when generateContent) — calls generateContentForDailyPlans | Yes — inserts into scheduled_posts | Yes |
| **generateContentForDailyPlans** | Yes | No | No |

**BOLT outcomeView: 'schedule' or 'campaign_schedule':**
- When `outcomeView === 'campaign_schedule'`, BOLT runs `schedule-structured-plan` stage.
- `runScheduleStructuredPlan` calls `scheduleStructuredPlan({ weeks: plan.weeks }, campaignId, { generateContent: true })`.
- Variants are generated; posts are inserted; campaign status set to `schedule`, `blueprint_status: ACTIVE`.
- Calendar entries = `scheduled_posts` rows; Dashboard infers `content_scheduled` when scheduledPosts > 0.

**Gap:** Dashboard calendar does not render individual posts; it shows campaign-level stage. A full "activity-level calendar" view would need to read `scheduled_posts` (or a join with daily_content_plans) and render per-post chips.

---

## SECTION 10 — IMPLEMENTATION READINESS

### IMPLEMENTATION READINESS SUMMARY

#### What Already Exists

| Capability | Location |
|------------|----------|
| Day Plan page with all weeks and activity cards | CampaignDailyPlanPage |
| Week-focus query param (?week=N) | campaign-daily-plan; scrollIntoView |
| Per-activity open Activity Workspace | openActivityWorkspace |
| Repurpose (buildPlatformVariantsFromMaster) | contentGenerationPipeline, activity-workspace/content API |
| Bulk repurpose + schedule (generateContent + scheduleStructuredPlan) | BOLT, schedule-structured-plan API |
| Creator placeholder (creator_asset, content_status) | daily_content_plans, creator-asset API |
| Repurpose order (repurpose_index, repurpose_total) | Blueprint/slots, WeeklyActivityCard |
| Dashboard campaign-level stage calendar | DashboardPage |
| scheduled_posts (platform, content_type, title, content) | DB schema |

#### What Must Be Added

| Item | Description |
|------|-------------|
| **"Repurpose & Schedule Entire Campaign" button** | Top-level button on CampaignDailyPlanPage that triggers bulk repurpose + schedule for all activities. |
| **Bulk repurpose-and-schedule API** | New endpoint (e.g. `POST /api/campaigns/[id]/repurpose-and-schedule`) that loads daily_content_plans, calls generateContentForDailyPlans, then scheduleStructuredPlan (or equivalent). |
| **Activity-level calendar view** | Dashboard or campaign-calendar enhancement to show individual scheduled_posts (Platform, Content Type, Topic, Repurpose Order, Status) per date, if required. |
| **repurpose_index/repurpose_total in scheduled_posts** | Optional schema addition if repurpose order must appear on calendar events. |

#### What Must Be Modified

| Item | Modification |
|------|--------------|
| **CampaignDailyPlanPage** | Add global "Repurpose & Schedule Entire Campaign" button; wire to new bulk API. |
| **Dashboard calendar** | If activity-level display is required: add data source from scheduled_posts (or daily_content_plans + scheduled_posts join); extend CalendarActivity type; render per-post chips. |
| **stage-availability-batch** | No change if staying campaign-level. If activity-level: may need new endpoint that returns scheduled posts by date. |

#### What Must Be Removed

| Item | Reason |
|------|--------|
| Nothing strictly required for this audit | Audit is verification-only; removal depends on unification plan from Safe Implementation Plan. |

---

## APPENDIX — EXECUTION MODEL VERIFICATION

| Step | Supported | Notes |
|------|-----------|-------|
| Strategic Theme Card | Yes | Recommendation cards, TrendCampaignsTab |
| Campaign Creation (AI Chat OR BOLT) | Yes | campaign-planning, BOLT execute |
| Week Plan | Yes | campaign-details, twelve_week_plan |
| Day Plan | Yes | campaign-daily-plan |
| Activity Workspace | Yes | activity-workspace |
| Repurpose | Yes | buildPlatformVariantsFromMaster |
| Schedule | Yes | structuredPlanScheduler, scheduled_posts |
| Dashboard Calendar | Partial | Campaign-level only; not activity-level |

**Critical gap:** A top-level "Repurpose & Schedule Entire Campaign" action on the Day Plan page does not exist. The underlying services (generateContentForDailyPlans + scheduleStructuredPlan) exist and are used by BOLT; they must be exposed via a new API and Day Plan button.

# Campaign Planning & Scheduling Architecture — Full System Audit

**Goal:** Unify campaign execution flow to a single path:
> Week Plan → Day View → Activity Workspace → Repurpose → Schedule → Dashboard Calendar

**Scope:** Remove or replace the separate Day View in the recommendation campaign flow with the existing Campaign Planner Day View.

---

## SECTION 1 — DAY VIEW IMPLEMENTATIONS

### TABLE: DAY VIEW COMPONENTS

| Component Name | File Path | Used In Route | Used In Flow | Reusable | Notes |
|----------------|-----------|---------------|--------------|----------|-------|
| **CampaignDailyPlanPage** | `pages/campaign-daily-plan/[id].tsx` | `/campaign-daily-plan/[id]` | Planner, Recommendation (BOLT) | Yes | Primary day-level grid: week×day with `GridActivity`; click → Activity Workspace. Uses `retrieve-plan`, `daily-plans` API, `distributionEngine`, `WeeklyActivityBoard`. |
| **CampaignCalendarPage** | `pages/campaign-calendar/[id].tsx` | `/campaign-calendar/[id]` | Planner, Recommendation (BOLT) | Yes | Calendar layout per campaign; `CalendarActivity`; click → `openActivityDetail` → Activity Workspace. Uses `retrieve-plan`, `daily-plans` fallback. |
| **PlanningCanvas** (Day view mode) | `components/planner/PlanningCanvas.tsx` | `/campaign-planning` (embedded) | Planner | No (embedded) | View modes: Campaign, Month, Week, **Day**. Day view: activities per day box. Click activity → Activity Workspace (preview via localStorage when no campaignId). Source: `plannerState.calendar_plan`. |
| **DailyPlanModal** | `components/WeeklyRefinementInterface.tsx` | Via WeeklyRefinementInterface | Planner (Legacy) | No | Modal overlay; lists daily plans for selected week. Read-heavy; AI amendment. Does not open Activity Workspace or full day grid. |
| **DailyPlanningInterface** | `components/DailyPlanningInterface.tsx` | Used in campaign-details, activity flows | Planner | Yes | Full daily planning UI with `DailyActivity` cards, `openActivityWorkspace(activityId)`. Source: daily execution items. |
| **Campaign-details inline week×day** | `pages/campaign-details/[id].tsx` | `/campaign-details/[id]` | Planner | No | Inline week×day grid with `editedWeekDailyPlans`, `saveWeekDailyPlan`, `regenerateWeekDailyPlan`. Links to `buildDailyPlanPageUrl` (campaign-daily-plan) and `openCampaignCalendar` (campaign-calendar). |
| **ComprehensivePlanningInterface** | `components/ComprehensivePlanningInterface.tsx` | Various | Planner (possibly legacy) | Partial | Local `dailyPlans` state; `handleGenerateDailyPlan` per week/day. |
| **Dashboard Calendar** | `components/DashboardPage.tsx` | Dashboard `activeTab=calendar` | Dashboard | No | Month/Week view; `getCalendarActivitiesForDate` returns campaign-level stage (e.g. "Week N - Campaign Name"). Not activity-level. |
| **Recommendations daily_plan display** | `pages/recommendations.tsx` | `/recommendations` | Recommendation | No | Renders `engineResult.daily_plan` (slice of 14 items). Preview only, not execution path. |

**Summary:** The canonical execution Day View is **CampaignDailyPlanPage** (`/campaign-daily-plan/[id]`). Both Planner and BOLT (Recommendation) flows can land there. **CampaignCalendarPage** is an alternative day-level view (calendar layout). **PlanningCanvas Day view** is planner-only and does not route to campaign-daily-plan. **DailyPlanModal** is a modal subset, not a full day grid.

---

## SECTION 2 — WEEK → DAY PLAN GENERATION

### TABLE: WEEK → DAY DISTRIBUTION LOGIC

| Service/File | Input | Output | Distribution Logic | AI or Deterministic | Used In Flow |
|--------------|-------|--------|---------------------|---------------------|--------------|
| **generateWeeklyStructureService** | `campaignId`, `week`, `theme`, `contentFocus`, etc. | `daily_content_plans` rows | Reads blueprint/strategy; creates daily_content_plans per platform/content_type/topic. | AI (generates) | Planner, BOLT |
| **distributionEngine** | `UnifiedExecutionUnit[]`, week | `UnifiedExecutionUnit[]` with `day` assigned | `applyStaggeredDistribution`, `applyAllAtOnceDistribution`, `resolveDistributionStrategy` (AUTO from momentum + unit count). | Deterministic | Read-time in daily-plans API, campaign-daily-plan |
| **unifiedExecutionAdapter** | Blueprint items / daily_content_plans rows | `UnifiedExecutionUnit` | `blueprintItemToUnifiedExecutionUnit`, `dailyPlanRowToUnifiedExecutionUnit`. | Deterministic | daily-plans API, campaign-daily-plan |
| **daily-plans API** | `campaignId` | Normalized daily plans | Reads `daily_content_plans`; applies `applyDistributionForWeek` per week; `applyUnifiedToDailyPlanResponse`. | Deterministic (read-time) | campaign-daily-plan, campaign-calendar |
| **dailyContentDistributionPlanService** | Week plan, strategy | Daily distribution (day_index, platform, content_type) | AI-generated per-day allocation. | AI | Planning pipeline |
| **repurposeGraphEngine** | Weekly slots | Expanded slots (repurpose_of) | Expands core slot into repurposed formats; sets `repurpose_of` on derived. | Deterministic | `dailyContentDistributionPlanService`, BOLT |
| **weeklyScheduleAllocator** | Slots | Slots with `scheduled_day`, `repurpose_index`, `repurpose_total` | Assigns day; respects repurpose spacing (≥1 day between same-topic items). | Deterministic | BOLT pipeline |
| **boltPipelineService** | BOLT payload | Campaign + `daily_content_plans` | Orchestrates: `generateWeeklyStructure`; optionally `scheduleStructuredPlan`. | AI + Deterministic | BOLT (Recommendation flow) |

**Summary:** Week → Day is hybrid: AI generates weekly structure and daily slots; deterministic `distributionEngine` and `weeklyScheduleAllocator` assign days at read/write time.

---

## SECTION 3 — ACTIVITY WORKSPACE ENTRY POINTS

### TABLE: ACTIVITY WORKSPACE ENTRY POINTS

| Component | File Path | Trigger | Route | Notes |
|-----------|----------|--------|------|-------|
| **CampaignDailyPlanPage** | `pages/campaign-daily-plan/[id].tsx` | Activity click (`GridActivity`) | `/activity-workspace?workspaceKey=...` | `openActivityWorkspace(activity)`; builds payload with `dailyExecutionItem`, `schedules`; stores in sessionStorage `activity-workspace-${campaignId}-${execution_id}`. |
| **CampaignCalendarPage** | `pages/campaign-calendar/[id].tsx` | "Open Activity Detail" click | `/activity-workspace?workspaceKey=...` | `openActivityDetail(activity)`; same sessionStorage pattern. |
| **DailyPlanningInterface** | `components/DailyPlanningInterface.tsx` | Activity card click | `/activity-workspace` | `openActivityWorkspace(activityId)`; uses activity ID to resolve workspace. |
| **PlanningCanvas** | `components/planner/PlanningCanvas.tsx` | Activity card click | `/activity-workspace` | When `campaignId` exists: sessionStorage; preview mode: `activity-workspace-planner-preview-{execution_id}` in localStorage. |
| **ContentTab** (planner) | `components/planner/tabs/ContentTab.tsx` | "Open Workspace" button | `/activity-workspace` | `openActivityWorkspace()`; maps `WeeklyActivity` to `GridActivity`. |
| **ActivityWorkspacePage** | `pages/activity-workspace.tsx` | Direct navigation, or from resolve API | `/activity-workspace` | Loads from `workspaceKey` (sessionStorage/localStorage) or `/api/activity-workspace/resolve` (workspaceKey or campaignId+executionId). |

**Summary:** Entry is consistent: click activity → build payload → sessionStorage (or localStorage for preview) → navigate to `/activity-workspace`. Resolve API can rebuild payload from blueprint/daily_execution_items when sessionStorage is missing.

---

## SECTION 4 — REPURPOSING SYSTEM

### TABLE: REPURPOSING SYSTEM

| Service | Platforms Supported | Input | Output | Used By | Auto/Manual |
|---------|---------------------|-------|-------|--------|-------------|
| **buildPlatformVariantsFromMaster** | LinkedIn, X, Instagram, YouTube, Facebook, blog (via `contentGenerationPipeline`) | `DailyExecutionItemLike` (master_content, intent, topic) | `PlatformVariantPayload[]` | Activity Workspace API (`/api/activity-workspace/content`), BOLT schedule stage (`boltContentGenerationForSchedule`), CreatorContentPanel | Manual (Activity Workspace "Repurpose Content") + Auto (BOLT) |
| **repurposeGraphEngine** | Per `REPURPOSE_GRAPH`, `PLATFORM_REPURPOSE_CASCADE` | Weekly slots | Expanded slots with `repurpose_of` | `dailyContentDistributionPlanService`, BOLT | Auto (planning) |
| **platformAdapters** (`backend/services/platformAdapters/*`) | LinkedIn, X, YouTube, Reddit, Slack, Discord, GitHub, etc. | Publish payload | Publish result | `engagementIngestionService`, `publishNowService`, test-connection | Publish (post-repurpose) |
| **platformResponseFormatter** | Per platform | Raw content | Platform-formatted content | Content pipeline | Auto |

**Summary:** Repurposing is centralized in `buildPlatformVariantsFromMaster`. Activity Workspace triggers it manually; BOLT uses it in the schedule stage. `repurposeGraphEngine` handles plan-level expansion; no separate "platformFormatter" service for repurpose.

---

## SECTION 5 — SCHEDULING SYSTEM

### TABLE: SCHEDULING SYSTEM

| Service | Input | Creates Calendar Event | Writes To Table | Dashboard Calendar Integration | Notes |
|---------|-------|------------------------|-----------------|--------------------------------|-------|
| **structuredPlanScheduler** | Structured plan (weeks/daily/platforms), `campaignId` | No (DB only) | `scheduled_posts` | Indirect (Dashboard reads campaigns; content-calendar reads scheduled_posts) | `scheduleStructuredPlan()`; resolves `social_accounts` by campaign `user_id` and platform. |
| **schedulerService** | Cron | No | `queue_jobs`, BullMQ | No | `findDuePostsAndEnqueue()`: reads `scheduled_posts` (status=`scheduled`, `scheduled_for` ≤ now), enqueues publish jobs. |
| **boltPipelineService** | BOLT payload | No | `daily_content_plans`, `scheduled_posts` (via schedule stage) | Yes (campaign appears in Dashboard) | Runs `scheduleStructuredPlan` in `schedule-structured-plan` stage when outcomeView warrants. |
| **createLegacyScheduledPost** (`pages/api/social/post.ts`) | Post payload | No | `scheduled_posts` | Indirect | Manual/legacy post creation. |
| **commit-daily-plan API** | Activities from UI | No | `daily_content_plans` | Yes | `POST /api/campaigns/commit-daily-plan`; maps activities to `daily_content_plans` insert. |

**Summary:** Scheduling writes to `scheduled_posts` via `structuredPlanScheduler` or legacy APIs. Dashboard calendar does not read `scheduled_posts` directly; it shows campaign-level stages from `getCampaignExecutionStage` and `stageAvailability`.

---

## SECTION 6 — DASHBOARD CALENDAR

### TABLE: DASHBOARD CALENDAR

| Component | File Path | Data Source | Event Types | Color Coding Logic |
|-----------|----------|-------------|-------------|--------------------|
| **DashboardPage Calendar** | `components/DashboardPage.tsx` | `campaigns` (from `/api/campaigns`), `stageAvailability` | Campaign stage per date (e.g. "Week N - Campaign Name") | `getCalendarStageAppearance(stage)`: `weekly_planning`, `daily_cards`, `content_created`, `content_scheduled`, `content_shared`, `overdue` — badge classes per stage. |
| **CampaignCalendarPage** | `pages/campaign-calendar/[id].tsx` | `retrieve-plan`, `daily-plans` | `CalendarActivity` (execution_id, title, platform, date, time, stage) | Stage-based: `STAGE_META` (awareness, education, authority, engagement, conversion, team_note) — `pillClass`, `colorClass`. |
| **ContentCalendar** | `pages/content-calendar.tsx` | Mock `scheduledPosts` | Post (platform, status, scheduledTime) | `getPlatformColor(post.platform)` — platform-based. |
| **CalendarView** | `pages/calendar-view.tsx` | Unknown | — | — |

**Summary:** Dashboard calendar is campaign-centric (stage per date). Campaign-specific calendar (`campaign-calendar/[id]`) is activity-centric. Content calendar is post-centric but currently uses mock data.

---

## SECTION 7 — DATA STRUCTURE

### TABLE: DATA MODEL

| Table | Purpose | Key Fields | Used By |
|-------|---------|------------|---------|
| **campaigns** | Campaign metadata | `id`, `user_id`, `name`, `status`, `current_stage`, `start_date`, `end_date`, `duration_weeks` | All flows; Dashboard; stage-availability-batch |
| **twelve_week_plan** | 12-week blueprint | `campaign_id`, `weeks` (JSONB), `status` | Blueprint service; retrieve-plan; BOLT |
| **weekly_content_refinements** | Week-level refinements | `campaign_id`, `week_number`, `twelve_week_plan_id` | Refinement flows |
| **daily_content_plans** | Day-level execution items | `campaign_id`, `week_number`, `day_of_week`, `date`, `platform`, `content_type`, `topic`, `execution_id`, `scheduled_post_id`, `creator_asset`, `content_status` | daily-plans API; campaign-daily-plan; campaign-calendar; activity-workspace resolve; commit-daily-plan |
| **scheduled_posts** | Scheduled/posted content | `campaign_id`, `user_id`, `social_account_id`, `platform`, `content`, `scheduled_for`, `status`, `platform_post_id` | structuredPlanScheduler; schedulerService; publishProcessor |
| **campaign_recommendation_weeks** | Recommendation stage per week | `campaign_id`, `week_number` | Recommendation flows |
| **bolt_execution_runs** | BOLT run state | `company_id`, `target_campaign_id`, `payload`, `result_campaign_id`, `status` | BOLT execute/progress API |

**Note:** No dedicated `campaign_weeks` table; weeks are in `twelve_week_plan.weeks` and `daily_content_plans.week_number`. No `repurposed_content` table; repurpose lives in `daily_content_plans` / execution items (`platform_variants` in memory/blueprint).

---

## SECTION 8 — DUPLICATION DETECTION

### LIST: DUPLICATE OR CONFLICTING SYSTEMS

| Duplicate/Conflict | Description | Recommendation |
|--------------------|-------------|----------------|
| **Two Day View destinations for BOLT** | BOLT `outcomeView: 'daily_plan'` → `/campaign-daily-plan/[id]`; `outcomeView: 'schedule'` → `/campaign-calendar/[id]`. Both are day-level views. | Unify: single Day View (campaign-daily-plan) as canonical; campaign-calendar as Schedule view (post Day View). |
| **Campaign-details inline week×day vs campaign-daily-plan** | campaign-details has inline grid + buttons to campaign-daily-plan and campaign-calendar. Duplicate representation of daily plans. | Keep campaign-details as Week Plan hub; link to campaign-daily-plan for Day View. Remove inline day-level edit if it duplicates campaign-daily-plan. |
| **DailyPlanModal vs CampaignDailyPlanPage** | DailyPlanModal (WeeklyRefinementInterface) shows one week's daily plans in a modal; limited edit (AI amendment only). CampaignDailyPlanPage is full grid with drag-drop, regenerate, open workspace. | Replace DailyPlanModal "Open Daily Plan" with navigation to campaign-daily-plan focused on that week. |
| **PlanningCanvas Day view vs campaign-daily-plan** | Planner has in-app Day view; campaign-daily-plan is a separate page. Different data sources (plannerState vs API). | Use campaign-daily-plan as Day View after planner finalize. PlanningCanvas Day can remain for preview-only before campaign exists. |
| **Dashboard calendar vs campaign-calendar** | Dashboard shows campaign stages per date (high-level); campaign-calendar shows activities per campaign. Different granularity. | Keep both; Dashboard = multi-campaign overview; campaign-calendar = single-campaign schedule. Ensure they use same underlying data where applicable. |
| **Activity Workspace entry from multiple UIs** | campaign-daily-plan, campaign-calendar, DailyPlanningInterface, PlanningCanvas, ContentTab all open activity-workspace. | Consolidate to: campaign-daily-plan and campaign-calendar as primary entry; others delegate or redirect. |

---

## SECTION 9 — CURRENT FLOW MAP

### FLOW DIAGRAM (TEXT)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           CAMPAIGN PLANNER FLOW                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  campaign-planning (AI Chat, PlanningCanvas)
         │
         ▼
  [Week Plan] ← twelve_week_plan, weekly_content_refinements
         │
         ├──► campaign-details/[id]  (Week Plan view, inline week×day grid)
         │         │
         │         ├── "Daily Plan" / enhanceAllWeeks ──► campaign-daily-plan/[id]
         │         │
         │         └── "Calendar" ────────────────────► campaign-calendar/[id]
         │
         ├──► generate-weekly-structure API ──► daily_content_plans
         │
         └──► campaign-daily-plan/[id]  (Day View — week×day grid, GridActivity)
                   │
                   ├── Click activity ──► openActivityWorkspace ──► activity-workspace
                   │
                   └── activity-workspace: master content, Repurpose Content, Schedule
                                    │
                                    ▼
                         buildPlatformVariantsFromMaster (repurpose)
                                    │
                                    ▼
                         Add to schedule ──► scheduled_posts (commit-daily-plan or structuredPlanScheduler)
                                    │
                                    ▼
                         Dashboard Calendar (campaign stage per date)
                         campaign-calendar (activity-level calendar)


┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                     RECOMMENDATION (BOLT) CAMPAIGN FLOW                                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  Recommendations tab (TrendCampaignsTab)
         │
         ▼
  BOLT: onBuildCampaignFast({ outcomeView, durationWeeks })
         │
         ├── outcomeView: 'week_plan'     ──► campaign-details/[id]?mode=fast
         │
         ├── outcomeView: 'daily_plan'    ──► campaign-daily-plan/[id]   ◄── SEPARATE DAY VIEW ENTRY
         │
         ├── outcomeView: 'repurpose'    ──► activity-workspace?campaignId=... (skips Day View)
         │
         ├── outcomeView: 'schedule'     ──► campaign-calendar/[id]
         │
         └── outcomeView: 'campaign_schedule' ──► campaign-details/[id]?mode=fast
         │
         ▼
  boltPipelineService: ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan
         │
         └── daily_content_plans + scheduled_posts created
```

**Key divergence:** BOLT can land on campaign-daily-plan, campaign-calendar, or activity-workspace directly (repurpose), bypassing a consistent Week → Day → Activity sequence.

---

## SECTION 10 — REQUIRED CHANGES (REFACTOR PLAN)

### Remove
| Item | Reason |
|------|--------|
| BOLT `outcomeView: 'repurpose'` direct-to-activity-workspace | Bypasses Day View; violates unified flow. |
| DailyPlanModal as primary day interaction | Replace with navigation to campaign-daily-plan. |
| Inline day-level edit in campaign-details (if redundant) | campaign-daily-plan already supports edit; avoid dual maintenance. |
| BOLT `outcomeView: 'schedule'` as primary post-BOLT destination | Schedule should follow Day View; redirect daily_plan → campaign-daily-plan, then user proceeds to calendar. |

### Replace
| Item | With |
|------|------|
| BOLT post-completion routing | Always land on campaign-details or campaign-daily-plan. Remove direct repurpose/schedule shortcuts; user flows Day → Activity Workspace → Repurpose → Schedule. |
| DailyPlanModal "Open Daily Plan" | Button/link to `/campaign-daily-plan/[id]?week=N` with focus on selected week. |
| Recommendations `engineResult.daily_plan` inline display | If used as execution path, replace with link to campaign-daily-plan once campaign exists. |

### Reuse
| Item | Usage |
|------|-------|
| **CampaignDailyPlanPage** | Single canonical Day View for Planner and BOLT. |
| **CampaignCalendarPage** | Schedule view after Day View; linked from campaign-daily-plan or Dashboard. |
| **Activity Workspace** | Sole entry from Day View (campaign-daily-plan or campaign-calendar activity click). |
| **distributionEngine**, **unifiedExecutionAdapter** | Keep as read-time distribution for daily-plans API. |
| **buildPlatformVariantsFromMaster** | Keep as repurpose engine; called from Activity Workspace and BOLT schedule stage. |

### New Services Needed
| Service | Purpose |
|---------|---------|
| **Unified post-BOLT redirect** | Single rule: BOLT completion → campaign-daily-plan (or campaign-details with prominent "Open Day View" CTA). Remove outcomeView-based routing. |
| **Week-focus query param** | `campaign-daily-plan/[id]?week=N` to auto-scroll/focus week N when arriving from Week Plan or BOLT. |

### Data Changes Needed
| Change | Purpose |
|--------|---------|
| None strictly required | Existing tables support unified flow. Optional: add `campaign_id` + `execution_id` index on `daily_content_plans` if resolve lookups are slow. |

---

## EXECUTIVE SUMMARY

1. **Canonical Day View:** `CampaignDailyPlanPage` (`/campaign-daily-plan/[id]`) — reuse for both Planner and BOLT.

2. **BOLT routing:** Remove `repurpose` and `schedule` as immediate post-BOLT destinations. Route all BOLT completions to campaign-details or campaign-daily-plan; user follows Day → Activity Workspace → Repurpose → Schedule.

3. **Replace DailyPlanModal** with navigation to campaign-daily-plan.

4. **Keep CampaignCalendarPage** as Schedule view (after Day View), not as alternate Day View.

5. **Single execution path:**
   ```
   Week Plan (campaign-details / campaign-planning)
        → Day View (campaign-daily-plan)
             → Activity Workspace (activity click)
                  → Repurpose (buildPlatformVariantsFromMaster)
                       → Schedule (commit / structuredPlanScheduler)
                            → Dashboard Calendar
   ```

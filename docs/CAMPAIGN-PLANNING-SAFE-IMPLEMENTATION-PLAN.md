# Campaign Planning & Scheduling — Safe Implementation Plan

**Source:** `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md`  
**Target Architecture:**
```
Week Plan → Day View (CampaignDailyPlanPage) → Activity Workspace → Repurpose → Schedule → Dashboard Calendar
```

**Status:** Plan only — no implementation. Execute in sequence to avoid breaking the system.

---

## PHASE 1 — CANONICAL SYSTEM MAP

### TABLE: CANONICAL SYSTEM MAP

| Layer | Component | File Path | Reason Selected | Systems To Deprecate |
|-------|-----------|-----------|-----------------|----------------------|
| **Week Plan** | CampaignDetailsPage (Week Plan view) | `pages/campaign-details/[id].tsx` | Primary hub for week-level planning; displays twelve_week_plan, weekly_content_refinements; links to Day View and Calendar. Used by both Planner and BOLT. | campaign-planning as sole Week Plan (keep for pre-campaign planning); ComprehensivePlanningInterface week view if duplicate |
| **Day View** | CampaignDailyPlanPage | `pages/campaign-daily-plan/[id].tsx` | Single canonical day-level grid; week×day with GridActivity; click → Activity Workspace. Used by Planner and BOLT. Full feature set: drag-drop, regenerate, open workspace. | DailyPlanModal; PlanningCanvas Day view as execution path; BOLT direct repurpose/schedule routing |
| **Activity Workspace** | ActivityWorkspacePage | `pages/activity-workspace.tsx` | Sole destination for activity editing: master content, repurpose, schedule. Resolve API rebuilds payload from blueprint. | Multiple entry points (consolidate to Day View + Calendar only) |
| **Repurpose Engine** | buildPlatformVariantsFromMaster | `backend/services/contentGenerationPipeline.ts` | Central repurposing: master → platform variants. Used by Activity Workspace API and BOLT schedule stage. | No deprecation; single canonical service |
| **Scheduler** | structuredPlanScheduler | `backend/services/structuredPlanScheduler.ts` | Writes to scheduled_posts from structured plan. Resolves social_accounts. Used by BOLT and commit flows. | createLegacyScheduledPost as secondary path (keep for manual posts) |
| **Dashboard Calendar** | DashboardPage Calendar | `components/DashboardPage.tsx` | Multi-campaign overview; campaign stage per date. Uses stageAvailability, getCalendarStageAppearance. | ContentCalendar mock data (separate concern) |

**Schedule View (post–Day View):** `CampaignCalendarPage` (`pages/campaign-calendar/[id].tsx`) — activity-level calendar; reached after Day View, not as alternate Day View.

---

## PHASE 2 — ROUTING UNIFICATION

### ROUTE FLOW DIAGRAM

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                        MANDATORY EXECUTION SEQUENCE                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘

  ENTRY POINTS (campaign creation)
  ├── campaign-planning (AI Chat) ──────────────────┐
  ├── Recommendations tab (BOLT) ───────────────────┤
  └── Direct campaign creation ─────────────────────┤
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 1. WEEK PLAN                                                                 │
  │    Route: /campaign-details/[id]                                              │
  │    View: Week-level grid, themes, generate weekly structure                   │
  │    CTA: "Open Day View" / "Daily Plan" → campaign-daily-plan                  │
  └─────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 2. DAY VIEW (CANONICAL)                                                      │
  │    Route: /campaign-daily-plan/[id]?week=N (optional focus)                   │
  │    View: Week×day grid, GridActivity, drag-drop, regenerate                  │
  │    CTA: Click activity → activity-workspace                                  │
  └─────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 3. ACTIVITY WORKSPACE                                                        │
  │    Route: /activity-workspace?workspaceKey=...                                │
  │    Entry: From Day View or Calendar only (sessionStorage payload)             │
  │    Actions: Master content, Repurpose Content, Add to Schedule               │
  └─────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 4. REPURPOSE (in-activity)                                                   │
  │    Trigger: "Repurpose Content" button → buildPlatformVariantsFromMaster     │
  │    No separate route; part of Activity Workspace                             │
  └─────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 5. SCHEDULE                                                                  │
  │    Route: /campaign-calendar/[id]  OR  commit-daily-plan API                 │
  │    Writes: scheduled_posts via structuredPlanScheduler                        │
  │    CTA: From Day View "Open Calendar" or Activity Workspace "Add to Schedule"│
  └─────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 6. DASHBOARD CALENDAR                                                        │
  │    Route: /dashboard (activeTab=calendar)                                    │
  │    View: Multi-campaign stage overview per date                             │
  │    Data: campaigns + stageAvailability                                       │
  └─────────────────────────────────────────────────────────────────────────────┘


  BOLT POST-COMPLETION ROUTING (unified)
  ─────────────────────────────────────
  All outcomeView values → campaign-daily-plan/[id] (or campaign-details with "Open Day View" CTA)
  Removed: direct repurpose, direct schedule as first destination
```

---

## PHASE 3 — COMPONENTS TO REMOVE

### TABLE: COMPONENTS TO REMOVE / DEPRECATE

| Component | File Path | Reason For Removal | Replacement Component |
|-----------|-----------|--------------------|------------------------|
| **DailyPlanModal** (as primary day interaction) | `components/WeeklyRefinementInterface.tsx` | Modal duplicates campaign-daily-plan; limited edit; bypasses full Day View. | Replace "Open Daily Plan" / modal content with link: `/campaign-daily-plan/[id]?week=N` |
| **BOLT outcomeView: 'repurpose'** | `components/recommendations/tabs/TrendCampaignsTab.tsx` | Skips Day View; violates mandatory flow. | Remove option; route to campaign-daily-plan |
| **BOLT outcomeView: 'schedule'** (as primary) | `components/recommendations/tabs/TrendCampaignsTab.tsx` | Skips Day View; schedule should follow Day View. | Route to campaign-daily-plan; user proceeds to calendar from Day View |
| **RecommendationDayView** (if exists as separate) | N/A — inline in recommendations.tsx | `engineResult.daily_plan` display is preview-only; not execution path. | If used as execution entry, replace with link to campaign-daily-plan |
| **PlanningCanvas Day view** (as execution path) | `components/planner/PlanningCanvas.tsx` | In-app Day view uses plannerState; campaign-daily-plan uses API. After finalize, user should go to campaign-daily-plan. | Keep Day view for preview-only (no campaign); after finalize, route to campaign-daily-plan |
| **Inline day-level edit** (if fully redundant) | `pages/campaign-details/[id].tsx` | Duplicate of campaign-daily-plan edit; dual maintenance. | Simplify to read-only preview + "Edit in Day View" link; full edit in campaign-daily-plan |

**Do NOT remove:** CampaignCalendarPage, DailyPlanningInterface (used in flows), ContentCalendar, PlanningCanvas (keep for preview).

---

## PHASE 4 — COMPONENTS TO MODIFY

### TABLE: COMPONENTS TO MODIFY

| Component | File Path | Modification Required |
|-----------|-----------|------------------------|
| **TrendCampaignsTab** | `components/recommendations/tabs/TrendCampaignsTab.tsx` | Unify BOLT post-completion routing: all outcomeView → campaign-daily-plan (or campaign-details). Remove repurpose/schedule as immediate destinations. |
| **RecommendationBlueprintCard** | `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Remove or gray out BoltOutcomeView options: repurpose, schedule. Optionally simplify to "Week Plan" and "Day View" only. |
| **WeeklyRefinementInterface** | `components/WeeklyRefinementInterface.tsx` | Replace DailyPlanModal usage with navigation to campaign-daily-plan. Add "Open Day View" button linking to `/campaign-daily-plan/[id]?week=N`. |
| **CampaignDailyPlanPage** | `pages/campaign-daily-plan/[id].tsx` | Add `?week=N` query param support: auto-scroll/focus to week N when present. Add prominent "Open Calendar" / "Schedule" CTA linking to campaign-calendar. |
| **CampaignDetailsPage** | `pages/campaign-details/[id].tsx` | Ensure "Daily Plan" / "Open Day View" always goes to campaign-daily-plan. Simplify inline week×day to read-only + link if needed. |
| **CampaignCalendarPage** | `pages/campaign-calendar/[id].tsx` | Add breadcrumb or back link: "← Day View" to campaign-daily-plan. Clarify as Schedule view (post–Day View). |
| **ActivityWorkspacePage** | `pages/activity-workspace.tsx` | No routing change; ensure resolve API supports all entry paths. Add "Back to Day View" link when campaignId + executionId available. |
| **DashboardPage** | `components/DashboardPage.tsx` | Ensure campaign cards link to campaign-details or campaign-daily-plan (not deprecated paths). |
| **pages/api/bolt/execute** | `pages/api/bolt/execute.ts` | No change to API; routing is client-side in TrendCampaignsTab. |
| **boltPipelineService** | `backend/services/boltPipelineService.ts` | outcomeView in payload is client routing hint only; no backend change. Optionally log deprecated outcomeView values. |

---

## PHASE 5 — SERVICES IMPACT

### TABLE: SERVICES IMPACT

| Service | Impact | Modification Needed |
|---------|--------|---------------------|
| **distributionEngine** | None | No change. Read-time distribution for daily-plans API. |
| **unifiedExecutionAdapter** | None | No change. Keeps blueprint/daily plan → UnifiedExecutionUnit mapping. |
| **boltPipelineService** | Low | No logic change. outcomeView is passed through; client handles routing. Optional: deprecation warning when outcomeView in ['repurpose','schedule']. |
| **structuredPlanScheduler** | None | No change. Continues to write scheduled_posts. |
| **buildPlatformVariantsFromMaster** | None | No change. Canonical repurpose engine. |
| **generateWeeklyStructureService** | None | No change. Creates daily_content_plans. |
| **daily-plans API** | None | No change. Used by campaign-daily-plan and campaign-calendar. |
| **activity-workspace resolve API** | Low | Ensure supports campaignId+executionId when "Back to Day View" is used. Likely already supported. |
| **stage-availability-batch API** | None | No change. Dashboard calendar data source. |

**Summary:** Most services unchanged. Primary impact is client-side routing in TrendCampaignsTab and WeeklyRefinementInterface.

---

## PHASE 6 — DATA FLOW

### DATA FLOW DIAGRAM

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED DATA FLOW                                              │
└──────────────────────────────────────────────────────────────────────────────────────┘

  weekly_plan
  ├── twelve_week_plan (campaign_id, weeks JSONB)
  └── weekly_content_refinements (campaign_id, week_number)
        │
        │  generateWeeklyStructureService
        ▼
  daily_content_plans
  ├── campaign_id, week_number, day_of_week, date
  ├── platform, content_type, topic, execution_id
  └── creator_asset, content_status, scheduled_post_id (nullable)
        │
        │  User opens Activity Workspace (from Day View click)
        │  Payload: dailyExecutionItem, schedules, repurposing_context
        ▼
  activity_workspace (sessionStorage / resolve API)
  ├── Loads: campaignId, executionId, dailyExecutionItem
  └── Master content stored in daily_content_plans / content_assets
        │
        │  buildPlatformVariantsFromMaster (Repurpose Content)
        ▼
  repurposed_content (in-memory / execution item)
  ├── platform_variants[] on DailyExecutionItem
  └── Stored back to daily_content_plans / blueprint when saved
        │
        │  structuredPlanScheduler OR commit-daily-plan
        │  Add to Schedule (Activity Workspace) OR BOLT schedule stage
        ▼
  scheduled_posts
  ├── campaign_id, social_account_id, platform, content
  ├── scheduled_for, status
  └── platform_post_id (after publish)
        │
        │  schedulerService.findDuePostsAndEnqueue → publish
        │  Dashboard reads: campaigns + stageAvailability
        ▼
  dashboard_calendar
  ├── Data: campaigns (from /api/campaigns)
  ├── Stage: stageAvailability (from stage-availability-batch)
  └── Display: getCalendarActivitiesForDate → campaign stage per date
```

**Note:** No dedicated `repurposed_content` table. Repurpose lives in `platform_variants` on execution items / daily_content_plans context.

---

## PHASE 7 — IMPLEMENTATION ORDER

### IMPLEMENTATION SEQUENCE

| Step | Title | Description |
|------|-------|-------------|
| **STEP 1** | Add campaign-daily-plan `?week=N` support | Implement week-focus query param on CampaignDailyPlanPage. Auto-scroll or focus week N. No routing changes yet. |
| **STEP 2** | Replace DailyPlanModal with navigation | In WeeklyRefinementInterface: replace modal "Open Daily Plan" with link to `/campaign-daily-plan/[id]?week=N`. Remove or hide DailyPlanModal as primary interaction. |
| **STEP 3** | Unify BOLT post-completion routing | In TrendCampaignsTab: route all outcomeView completions to campaign-daily-plan (or campaign-details with "Open Day View" CTA). Remove repurpose and schedule as immediate destinations. |
| **STEP 4** | Simplify RecommendationBlueprintCard outcome options | Remove or deprecate BoltOutcomeView options: repurpose, schedule. Keep week_plan, daily_plan, campaign_schedule; map all to campaign-daily-plan or campaign-details. |
| **STEP 5** | Add Day View ↔ Calendar navigation | CampaignDailyPlanPage: add "Open Calendar" / "Schedule" CTA → campaign-calendar. CampaignCalendarPage: add "← Day View" back link → campaign-daily-plan. |
| **STEP 6** | Add Activity Workspace "Back to Day View" | ActivityWorkspacePage: when campaignId + executionId present, show "Back to Day View" linking to campaign-daily-plan with week param if derivable. |
| **STEP 7** | Simplify campaign-details inline day grid | If inline week×day edit duplicates campaign-daily-plan, simplify to read-only preview with "Edit in Day View" link. Keep regenerate/save only if not redundant. |
| **STEP 8** | Update Dashboard campaign links | Ensure campaign cards and calendar drill-downs link to campaign-details or campaign-daily-plan. No links to deprecated direct repurpose/schedule. |
| **STEP 9** | Verify PlanningCanvas post-finalize flow | After planner finalize, ensure user is directed to campaign-details or campaign-daily-plan (not only PlanningCanvas Day view). |
| **STEP 10** | Documentation and cleanup | Update docs, remove dead code paths, add deprecation comments for outcomeView repurpose/schedule if kept for backward compat. |

---

## PHASE 8 — RISK ANALYSIS

### TABLE: RISK ANALYSIS

| Risk | Affected Component | Mitigation |
|------|--------------------|------------|
| **BOLT users expect direct repurpose** | TrendCampaignsTab, BOLT flow | Keep outcomeView in API for analytics; route all to campaign-daily-plan. Add tooltip: "You'll land in Day View—click any activity to repurpose." |
| **WeeklyRefinement users lose modal** | WeeklyRefinementInterface | Replace with one-click navigation to campaign-daily-plan. Ensure week param is passed so user sees same week. |
| **Broken activity-workspace entry** | ActivityWorkspacePage, resolve API | Test all entry paths: campaign-daily-plan, campaign-calendar. Ensure resolve API works with campaignId+executionId. |
| **Campaign-details inline edit removal** | campaign-details | Phase carefully: first add "Edit in Day View" link; only remove inline edit if users confirm campaign-daily-plan suffices. |
| **PlanningCanvas Day view confusion** | PlanningCanvas | Keep for preview (no campaign yet). Document: "After saving campaign, use Day View (campaign-daily-plan) for execution." |
| **RecommendationBlueprintCard option removal** | RecommendationBlueprintCard | Soft deprecate: gray out or hide repurpose/schedule; keep in types for backward compat. Add migration note. |
| **Dashboard link changes** | DashboardPage | Audit all campaign click handlers; ensure no broken links to old flows. |
| **Regression in BOLT pipeline** | boltPipelineService | outcomeView is pass-through; no pipeline logic change. Run BOLT smoke test after routing changes. |

---

## PHASE 9 — FILES THAT WILL CHANGE

### Complete File List

| File | Change Type |
|------|-------------|
| `pages/campaign-daily-plan/[id].tsx` | Modify — add ?week=N support, add "Open Calendar" CTA |
| `pages/campaign-calendar/[id].tsx` | Modify — add "← Day View" back link |
| `pages/activity-workspace.tsx` | Modify — add "Back to Day View" link (optional) |
| `pages/campaign-details/[id].tsx` | Modify — simplify inline day grid if needed; ensure Day View links |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | Modify — unify BOLT routing |
| `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Modify — simplify BoltOutcomeView options |
| `components/WeeklyRefinementInterface.tsx` | Modify — replace DailyPlanModal with navigation |
| `components/DashboardPage.tsx` | Modify — verify campaign links |
| `backend/services/boltPipelineService.ts` | Modify — optional deprecation log for outcomeView |
| `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` | Reference — no change |
| `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md` | New — this document |

**Files not changed:** distributionEngine, unifiedExecutionAdapter, structuredPlanScheduler, buildPlatformVariantsFromMaster, daily-plans API, activity-workspace resolve API, generateWeeklyStructureService, PlanningCanvas (logic), DailyPlanningInterface.

---

## PHASE 10 — IMPLEMENTATION PROMPTS

Each prompt is designed to be executed independently in Cursor. Use the audit and this plan as context.

---

### Prompt 1 — Add campaign-daily-plan `?week=N` support

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** Add support for the `week` query parameter on the CampaignDailyPlanPage (`pages/campaign-daily-plan/[id].tsx`). When `?week=N` is present (N = 1-based week number), auto-scroll or focus the week N section so the user lands on the correct week. Use `router.query.week`; if `focusWeek` state exists, align with it. Ensure no regression for existing links without the param.

**Acceptance:** Navigating to `/campaign-daily-plan/[id]?week=2` scrolls or focuses week 2. Links from WeeklyRefinementInterface and BOLT can pass `?week=N` for better UX.

---

### Prompt 2 — Replace DailyPlanModal with navigation to campaign-daily-plan

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `components/WeeklyRefinementInterface.tsx`, replace the DailyPlanModal as the primary way to view/edit daily plans. When the user clicks "Open Daily Plan" or similar for a week, navigate to `/campaign-daily-plan/[campaignId]?week=[weekNumber]` instead of opening the modal. You may keep the DailyPlanModal as a lightweight read-only preview if useful, or remove it. Ensure `companyId` is passed in the URL if the app uses it.

**Acceptance:** Clicking to open daily plan for a week navigates to campaign-daily-plan with the correct week. No modal as primary interaction.

---

### Prompt 3 — Unify BOLT post-completion routing

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`. BOLT flow is in `components/recommendations/tabs/TrendCampaignsTab.tsx`.

**Task:** Unify BOLT post-completion routing. After BOLT completes (`prog.status === 'completed'`), route the user to `campaign-daily-plan` for ALL outcomeView values (week_plan, daily_plan, repurpose, schedule, campaign_schedule). Remove the separate routes that send users directly to activity-workspace (repurpose) or campaign-calendar (schedule). Use `/campaign-daily-plan/[completedCampaignId]?companyId=...` as the default. Optionally, for outcomeView `week_plan` or `campaign_schedule`, you may route to campaign-details with a prominent "Open Day View" CTA—but the primary post-BOLT destination should be campaign-daily-plan.

**Acceptance:** All BOLT completions land on campaign-daily-plan (or campaign-details with Day View CTA). No direct repurpose or schedule as first destination.

---

### Prompt 4 — Simplify RecommendationBlueprintCard outcome options

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `components/recommendations/cards/RecommendationBlueprintCard.tsx`, simplify the BoltOutcomeView options shown to the user. Remove or gray out the "Repurpose" and "Schedule" options that previously routed users directly to activity-workspace or campaign-calendar. Keep "Week Plan", "Daily Plan", and "Schedule as per campaign date" (or similar). Ensure the underlying `onBuildCampaignFast` still receives an outcomeView for analytics, but all result in the same post-BOLT routing (handled in TrendCampaignsTab). Do not break the BOLT execute API contract.

**Acceptance:** User sees simplified outcome options; repurpose/schedule are not offered as immediate destinations. BOLT still runs and routes to campaign-daily-plan.

---

### Prompt 5 — Add Day View ↔ Calendar navigation

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:**
1. **CampaignDailyPlanPage** (`pages/campaign-daily-plan/[id].tsx`): Add a prominent "Open Calendar" or "View Schedule" button/link that navigates to `/campaign-calendar/[id]` (with companyId if needed). Place it in the header or near the week grid.
2. **CampaignCalendarPage** (`pages/campaign-calendar/[id].tsx`): Add a "← Day View" or "Back to Day View" link that navigates to `/campaign-daily-plan/[id]` (with companyId if needed). Place it in the header.

**Acceptance:** User can move between Day View and Calendar with one click. Flow is: Day View → Calendar (schedule) and Calendar → Day View.

---

### Prompt 6 — Add Activity Workspace "Back to Day View" link

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `pages/activity-workspace.tsx`, when the workspace payload includes `campaignId` (and ideally `weekNumber` or `executionId`), add a "Back to Day View" or "← Day View" link in the header or breadcrumb that navigates to `/campaign-daily-plan/[campaignId]?companyId=...` (and `?week=N` if week is known). The workspace payload is loaded from sessionStorage or the resolve API—inspect the structure to get campaignId and weekNumber. If weekNumber is not available, omit the week param.

**Acceptance:** From Activity Workspace, user can return to Day View with one click when campaign context is present.

---

### Prompt 7 — Simplify campaign-details inline day grid (optional)

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `pages/campaign-details/[id].tsx`, the inline week×day grid may duplicate campaign-daily-plan. Assess: if the inline grid supports drag-drop, regenerate, save—and campaign-daily-plan does the same—consider simplifying the campaign-details view to a read-only preview of daily plans with a clear "Edit in Day View" link to campaign-daily-plan. If both are heavily used, keep both but ensure "Daily Plan" / "Open Day View" always goes to campaign-daily-plan. Do not break existing flows; this is a simplification to reduce dual maintenance.

**Acceptance:** campaign-details is the Week Plan hub; Day View editing is clearly in campaign-daily-plan. No regression.

---

### Prompt 8 — Update Dashboard campaign links

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `components/DashboardPage.tsx`, audit all links and click handlers that navigate to a campaign. Ensure they go to either `campaign-details/[id]` or `campaign-daily-plan/[id]`. Remove or update any links that previously went to activity-workspace or campaign-calendar as the first destination (unless from a campaign-specific context like campaign-calendar itself). The Dashboard calendar shows campaign stages; clicking a campaign or date should support the unified flow.

**Acceptance:** Dashboard campaign links align with Week Plan → Day View flow. No broken or deprecated direct links.

---

### Prompt 9 — Add optional boltPipelineService deprecation log

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** In `backend/services/boltPipelineService.ts`, the `BoltPayload` includes `outcomeView`. Add an optional deprecation log (e.g. `console.warn` or structured log) when `outcomeView` is `'repurpose'` or `'schedule'`, indicating that these are deprecated as immediate destinations and routing is unified. This is for observability; do not change pipeline logic.

**Acceptance:** Logs appear when deprecated outcomeView values are used. No behavior change.

---

### Prompt 10 — Documentation and cleanup

**Context:** See `docs/CAMPAIGN-PLANNING-SCHEDULING-UNIFICATION-AUDIT.md` and `docs/CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md`.

**Task:** (1) Add a brief "Unified Execution Flow" section to the main project README or docs, referencing the target sequence: Week Plan → Day View → Activity Workspace → Repurpose → Schedule → Dashboard Calendar. (2) Add inline comments in TrendCampaignsTab and RecommendationBlueprintCard noting the routing unification. (3) Remove any dead code paths discovered during implementation (e.g. unused outcomeView branches). (4) Update CAMPAIGN-PLANNING-SAFE-IMPLEMENTATION-PLAN.md with a "Completion Log" section to record which steps were done and when.

**Acceptance:** Docs reflect the unified flow; code is clean; completion log is updated.

---

## Appendix — Quick Reference

| Phase | Output |
|-------|--------|
| 1 | Canonical System Map (6 layers) |
| 2 | Route Flow Diagram |
| 3 | Components to Remove (6 items) |
| 4 | Components to Modify (10 items) |
| 5 | Services Impact (9 services, mostly no change) |
| 6 | Data Flow Diagram |
| 7 | Implementation Sequence (10 steps) |
| 8 | Risk Analysis (8 risks) |
| 9 | Files to Change (11 files) |
| 10 | Implementation Prompts (10 prompts) |

**Recommended execution order:** Prompts 1 → 2 → 3 → 4 → 5 → 6 → 7 (optional) → 8 → 9 → 10.

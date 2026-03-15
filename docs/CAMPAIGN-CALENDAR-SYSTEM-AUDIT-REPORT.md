# Campaign Calendar System Audit Report

**Date:** 2025-03-12  
**Scope:** Database, backend services, frontend UI for campaign planning and calendar  
**Source:** Codebase analysis only — no speculation.

---

## 1. FILES_FOUND

| Category | Path |
|----------|------|
| **Campaign Calendar Page** | `pages/campaign-calendar/[id].tsx` |
| **Campaign Daily Plan Page** | `pages/campaign-daily-plan/[id].tsx` |
| **Activity Workspace Page** | `pages/activity-workspace.tsx` |
| **Campaign Details Page** | `pages/campaign-details/[id].tsx` |
| **Campaign Planner** | `pages/campaign-planner.tsx`, `pages/campaign-planning.tsx` |
| **Calendar Plan Converter** | `components/planner/calendarPlanConverter.ts` |
| **Calendar Planner Step** | `components/planner/CalendarPlannerStep.tsx` |
| **Planning Canvas** | `components/planner/PlanningCanvas.tsx` |
| **Planner Session Store** | `components/planner/plannerSessionStore.ts` |
| **Finalize Section** | `components/planner/FinalizeSection.tsx` |
| **API: Retrieve Plan** | `pages/api/campaigns/retrieve-plan.ts` |
| **API: Daily Plans** | `pages/api/campaigns/daily-plans.ts` |
| **API: Generate Weekly Structure** | `pages/api/campaigns/generate-weekly-structure.ts` |
| **API: Activity Workspace Resolve** | `pages/api/activity-workspace/resolve.ts` |
| **Campaign Blueprint Service** | `backend/services/campaignBlueprintService.ts` |
| **Campaign AI Orchestrator** | `backend/services/campaignAiOrchestrator.ts` |
| **Database: campaigns** | `database/campaign-management-clean-schema.sql`, `database/complete-reset-and-apply.sql` |
| **Database: twelve_week_plan** | `database/twelve_week_plan.sql` |
| **Database: daily_content_plans** | `database/weekly-refinement-daily-plans.sql`, `database/hierarchical-navigation-system.sql` |
| **Database: content_assets** | `database/content-assets.sql` |
| **Database: weekly_content_refinements** | `database/weekly-refinement-daily-plans.sql` |

**Note:** There are **no** tables named `campaign_calendar`, `campaign_activities`, or `activity_workspace`. The calendar is a **computed view** built from blueprint weeks and `daily_content_plans`.

---

## 2. DATABASE_SCHEMA

### 2.1 campaigns

| Attribute | Value |
|-----------|-------|
| **Purpose** | Core campaign metadata; lifecycle and dates |
| **Key columns** | `id`, `user_id`, `company_id`, `name`, `description`, `status`, `current_stage`, `timeframe`, `start_date`, `end_date`, `duration_weeks`, `blueprint_status`, `thread_id`, `created_at`, `updated_at`, `launched_at`, `completed_at` |
| **Relationships** | FK: `user_id` → users; referenced by campaign_goals, content_plans, twelve_week_plan, daily_content_plans, weekly_content_refinements, campaign_versions |
| **Indexes** | `idx_campaigns_user_id`, `idx_campaigns_status`, `idx_campaigns_dates` (start_date, end_date), `idx_campaigns_created_at` |
| **Constraints** | status CHECK, timeframe CHECK |

**Duration:** `start_date`, `end_date`, `duration_weeks` (nullable; pre-planning gate uses duration_weeks).

---

### 2.2 twelve_week_plan

| Attribute | Value |
|-----------|-------|
| **Purpose** | 12-week campaign blueprints from AI and recommendations |
| **Key columns** | `id`, `campaign_id`, `snapshot_hash`, `mode`, `response`, `omnivyre_decision`, `source`, `weeks` (JSONB), `raw_plan_text`, `blueprint` (JSONB), `refined_day`, `platform_content`, `status`, `created_at`, `updated_at` |
| **Relationships** | FK: `campaign_id` → campaigns |
| **Indexes** | `idx_twelve_week_plan_campaign`, `idx_twelve_week_plan_campaign_snapshot`, `idx_twelve_week_plan_created` |
| **Constraints** | none reported |

**Blueprint structure:** `blueprint.weeks[]` contains `week`, `phase_label`, `theme`, `execution_items`, `daily_execution_items`, `distribution_strategy`, etc. Each week has `daily_execution_items[]` with `execution_id`, `platform`, `content_type`, `topic`, `title`, `day`, `writer_content_brief`, `intent`, etc.

---

### 2.3 daily_content_plans

| Attribute | Value |
|-----------|-------|
| **Purpose** | Day-level content plans; persisted view of activities per week/day |
| **Key columns** | `id`, `campaign_id`, `week_number`, `day_of_week`, `date`, `platform`, `content_type`, `title`, `content` (TEXT/JSONB), `scheduled_time`, `status`, `ai_generated`, `source_refinement_id`, `weekly_refinement_id`, `execution_id`, `external_post_id`, plus rich fields (topic, intro_objective, objective, summary, key_points, cta, brand_voice, theme_linkage, format_notes, week_theme, campaign_theme, optimal_posting_time) |
| **Relationships** | FK: `campaign_id` → campaigns; optional `source_refinement_id` → weekly_content_refinements; optional `weekly_refinement_id` |
| **Indexes** | `idx_daily_plans_campaign_week`, `idx_daily_plans_date`, `idx_daily_plans_status`, `idx_daily_content_plans_execution_id` |
| **Constraints** | status CHECK, priority CHECK |

**Activity dates:** `week_number`, `day_of_week`, `date`, `scheduled_time`.

---

### 2.4 weekly_content_refinements

| Attribute | Value |
|-----------|-------|
| **Purpose** | Weekly refinement data (legacy Flow C; alternative to twelve_week_plan) |
| **Key columns** | `id`, `campaign_id`, `week_number`, `theme`, `focus_area`, `original_content`, `finalized_content`, `refinement_status`, `twelve_week_plan_id` |
| **Relationships** | FK: `campaign_id` → campaigns; optional `twelve_week_plan_id` → twelve_week_plan |
| **Indexes** | `idx_weekly_refinements_campaign_week`, `idx_weekly_refinements_status` |
| **Constraints** | UNIQUE(campaign_id, week_number) |

---

### 2.5 content_assets

| Attribute | Value |
|-----------|-------|
| **Purpose** | Content assets by campaign/week (used in execution and collision checks) |
| **Key columns** | `asset_id`, `campaign_id`, `week_number`, `day`, `platform`, `status`, `current_version`, `created_at` |
| **Relationships** | FK: campaign_id (TEXT); referenced by content-reviews, platform-content-variants, promotion-metadata |
| **Indexes** | `idx_content_assets_campaign_week` |
| **Constraints** | none reported |

---

### 2.6 content_plans (legacy)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Legacy content plans; also stores ai_generated_plan for retrieve-plan savedPlan |
| **Key columns** | `id`, `campaign_id`, `day_of_week`, `date`, `platform`, `content_type`, `topic`, `content`, `status`, `ai_generated`, `scheduled_at` |
| **Relationships** | FK: campaign_id → campaigns |
| **Indexes** | `idx_content_plans_campaign_id`, `idx_content_plans_status`, `idx_content_plans_scheduled_at` |

---

### 2.7 Schema Diagram (Campaign Planning Flow)

```
campaigns
  ├── twelve_week_plan (blueprint.weeks[], weeks[])
  │       └── blueprint.weeks[].daily_execution_items[]  (in-memory/JSONB)
  ├── weekly_content_refinements (week_number, theme, …)
  ├── daily_content_plans (week_number, day_of_week, date, platform, content_type, …)
  ├── content_assets (campaign_id, week_number, day)
  └── content_plans (legacy)
```

**How campaign duration is stored:** `campaigns.start_date`, `campaigns.end_date`, `campaigns.duration_weeks`.

**How activity dates are stored:**  
- Blueprint: `weeks[].daily_execution_items[].day` (e.g. "Monday"), `scheduled_time` (ISO or "HH:mm").  
- daily_content_plans: `week_number`, `day_of_week`, `date`, `scheduled_time`.

**Recurrence:** Not supported. Each activity is a one-off per week/day. `recurring_posts` exists for automated content but is separate from campaign calendar.

---

## 3. CALENDAR_DATA_MODEL

### 3.1 Generated vs Stored

- **Primary:** Calendar is **generated dynamically** from:
  1. `retrieve-plan` → `committedPlan.weeks` or `draftPlan.weeks` from `twelve_week_plan`
  2. Each week’s `daily_execution_items`
- **Fallback:** If no `daily_execution_items`, calendar uses `daily_content_plans` (stored rows) via `GET /api/campaigns/daily-plans`.

### 3.2 Per-activity storage

- **Blueprint path:** Activities are **computed** from `weeks[].daily_execution_items` (JSONB; not separate rows).
- **Daily plans path:** Each activity is a **row** in `daily_content_plans`.

### 3.3 Representation

| Concept | Representation |
|---------|-----------------|
| **Campaign** | `campaigns` row; `campaign_id` in twelve_week_plan, daily_content_plans |
| **Week** | `week_number` (1-based) in blueprint weeks and daily_content_plans |
| **Day** | `day` (e.g. "Monday") or `day_of_week`, or `date` in daily_content_plans |
| **Activity** | Item in `daily_execution_items` or row in `daily_content_plans` |
| **Platform** | `platform` (linkedin, x, etc.) |
| **Content type** | `content_type` (post, article, video, etc.) |

### 3.4 Data flow

```
1. User opens /campaign-calendar/[id]
2. Frontend fetches GET /api/campaigns/retrieve-plan?campaignId=...
3. Response: { draftPlan, committedPlan }. weeks = blueprint.weeks
4. For each week: items = week.daily_execution_items
5. If items.length === 0: fallback fetch GET /api/campaigns/daily-plans?campaignId=...
6. Map items/plans → CalendarActivity[] (execution_id, week_number, day, date, time, title, platform, content_type, execution_status, raw_item)
7. Group by date, then by stage (team_note, awareness, education, authority, engagement, conversion)
8. Render day sections with stage groups and activity tiles
```

---

## 4. ACTIVITY_OBJECT_MODEL

### 4.1 Canonical activity entity

The canonical in-memory model is **CalendarActivity** in `pages/campaign-calendar/[id].tsx`:

```typescript
type CalendarActivity = {
  execution_id: string;
  week_number: number;
  day: string;
  date: string;
  time: string;
  title: string;
  platform: string;
  content_type: string;
  execution_status: ExecutionStatus;  // PENDING | SCHEDULED | IN_PROGRESS | FINALIZED
  execution_jobs: Array<{ job_id, platform, status, ready_to_schedule, execution_status }>;
  raw_item: Record<string, unknown>;
  execution_mode?: 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';
};
```

Blueprint `daily_execution_items` and daily-plans rows map to this shape.

### 4.2 Fields present in raw_item / daily plan

- `execution_id`, `campaign_id`, `title`, `topic`, `platform`, `content_type`, `day`, `scheduled_time`
- `stage`, `execution_readiness`, `writer_content_brief`, `intent`, `execution_mode`, `creator_instruction`, `master_content_id`, `platform_variants`, `generated_content`, `team_note`

### 4.3 workspace_id

There is **no** `workspace_id` column. The “workspace” is identified by `activity-workspace-${campaignId}-${execution_id}` stored in sessionStorage.

### 4.4 created_by

Not present in the calendar/activity model. `campaigns.user_id` and `daily_content_plans` source tracking exist, but not per-activity `created_by`.

---

## 5. BACKEND_SERVICES

| File | Functions | Responsibilities | Inputs | Outputs |
|------|-----------|------------------|--------|---------|
| `campaignBlueprintService.ts` | `getUnifiedCampaignBlueprint` | Resolve blueprint from twelve_week_plan → campaign_versions → weekly_content_refinements | campaignId | CampaignBlueprint \| null |
| `retrieve-plan.ts` | handler (GET) | Return savedPlan, draftPlan, committedPlan for planner/calendar | campaignId | { savedPlan, committedPlan, draftPlan } |
| `daily-plans.ts` | handler (GET) | Fetch daily_content_plans, apply distribution, transform to UI shape | campaignId, companyId | normalized daily plans array |
| `generate-weekly-structure.ts` | `generateWeeklyStructure` | Build daily items from blueprint, validate, enrich, insert into daily_content_plans | campaignId, weekNumbers?, distribution_mode?, … | { rowsInserted, weeksProcessed } |
| `activity-workspace/resolve.ts` | handler (GET) | Resolve workspace payload from blueprint by executionId | workspaceKey or campaignId+executionId | { workspaceKey, payload } |
| `campaignAiOrchestrator.ts` | various | Build `resolved_postings`, `daily_execution_items` per week | plan weeks, strategy | weeks with daily_execution_items |

---

## 6. FRONTEND_COMPONENTS

| Component | Responsibility | Data sources | API calls | Props / structure |
|-----------|----------------|---------------|-----------|-------------------|
| **CampaignCalendarPage** (`campaign-calendar/[id].tsx`) | Main calendar view per campaign | retrieve-plan, daily-plans (fallback) | `GET /api/campaigns/retrieve-plan`, `GET /api/campaigns/daily-plans` | router.query.id, week, day; state: activities, currentDate, expandedState |
| **CalendarPlannerStep** | Weekly/daily preview from planner | retrieve-plan (when campaignId) | `GET /api/campaigns/retrieve-plan` | planPreview, calendarPlan, campaignId, onPlanChange |
| **PlanningCanvas** | Week/day structure preview | plannerState.execution_plan.calendar_plan | none | state from planner session |
| **calendarPlanConverter** | API weeks → campaign_structure + calendar_plan | weeks from API | none | `weeksToCalendarPlan(weeks)` |
| **FinalizeSection** | Commit plan, generate structure, redirect to calendar | planner state | planner-finalize (internal) | onFinalize(cid) |

**Activity rendering:** Activities are grouped by date, then by stage. Each day is a section; within each, stage groups show article-style tiles (not a shared `ActivityCard`).

---

## 7. ACTIVITY_TILE_UI_MODEL

### 7.1 Data on a tile

- Execution mode label (AI / Creator / Conditional)
- Title
- Execution status badge (PENDING, SCHEDULED, etc.)
- Time (Clock icon)
- Platform icon + label
- Content type
- Execution jobs (if any)
- “Open Activity Detail” button
- Creator preview (when CREATOR_REQUIRED)

### 7.2 JSX structure (simplified)

```jsx
<article key={activity.execution_id} className={articleClass}>
  <div className="font-medium">{modeLabel}</div>
  {modeExplanation && <div className="text-xs">{modeExplanation}</div>}
  <div className="flex items-start justify-between">
    <h4>{activity.title}</h4>
    <div className="flex items-center gap-2">
      <span>{execDot}</span>
      <span className={getExecutionStatusBadgeClasses(activity.execution_status)}>
        [{activity.execution_status}]
      </span>
      <span><Clock /> {activity.time}</span>
    </div>
  </div>
  <div className="mt-3 flex flex-wrap gap-2">
    <button><PlatformIcon platform={activity.platform} /></button>
    <button>{activity.content_type}</button>
    {activity.execution_jobs.length > 0 && <span>...</span>}
  </div>
  <button onClick={() => openActivityDetail(activity)}>
    <ExternalLink /> Open Activity Detail
  </button>
</article>
```

Colors: mode-based (AI = green, Creator = red, Conditional = yellow); status-based via `getExecutionStatusBackground`.

---

## 8. WORKSPACE_INTEGRATION

### 8.1 Routing

- Calendar: `/campaign-calendar/[id]`
- Activity workspace: `/activity-workspace?workspaceKey=...` (or `?campaignId=...&executionId=...`)

### 8.2 State passing

1. **Click “Open Activity Detail”** → `openActivityDetail(activity)`
2. Build `payload`: `{ campaignId, weekNumber, day, activityId (execution_id), title, topic, description, dailyExecutionItem, schedules }`
3. `workspaceKey = activity-workspace-${campaignId}-${activity.execution_id}`
4. `sessionStorage.setItem(workspaceKey, JSON.stringify(payload))`
5. `window.open(/activity-workspace?workspaceKey=${workspaceKey}, '_blank')`

### 8.3 Activity ID usage

- Primary ID: `execution_id` (from blueprint item or daily plan)
- Workspace key includes it: `activity-workspace-${campaignId}-${execution_id}`

### 8.4 Workspace loading

1. Read `workspaceKey` from URL.
2. Try `sessionStorage.getItem(workspaceKey)`.
3. If empty: `GET /api/activity-workspace/resolve?workspaceKey=...` or `?campaignId=...&executionId=...`.
4. Resolve API finds item in `blueprint.weeks[].daily_execution_items` by `execution_id`, builds payload, returns `{ workspaceKey, payload }`.
5. Store in sessionStorage and render workspace with `payload`.

---

## 9. LIMITATIONS

| Limitation | Evidence |
|------------|----------|
| No recurrence rules | No recurrence fields on campaign or daily plans; each activity is one-off |
| Manual activity creation | New activities created via planner → generate-weekly-structure or blueprint, not inline on calendar |
| No AI calendar generation from calendar | AI planning via ai/plan and planner; calendar only displays |
| No platform frequency logic in calendar | Platform rules live in platform execution validator; calendar does not enforce frequency |
| Weak theme alignment in tiles | Stage inferred from `stage`, `narrative_role`, or content_type fallback; no explicit theme on tile |
| Blueprint vs daily_content_plans divergence | Save from daily plan UI writes to daily_content_plans; blueprint is not updated; two sources of truth |
| ai_generated / execution_owner not surfaced | Stored on daily_content_plans but not mapped into CalendarActivity from daily-plans fallback |

---

## 10. ARCHITECTURE_RISKS

| Risk | Evidence |
|------|----------|
| N+1 on resolve | Resolve API walks blueprint.weeks and items in memory; single blueprint fetch |
| Calendar load inefficiency | Two sequential fetches: retrieve-plan then possibly daily-plans when no daily_execution_items |
| Missing index for execution_id lookups | `idx_daily_content_plans_execution_id` exists; no index on blueprint JSONB `execution_id` |
| Large campaign scalability | Full blueprint loaded per campaign; no pagination for weeks or activities |
| SessionStorage dependency | Workspace requires sessionStorage; direct links need resolve API; lost on new tab without resolve |
| Fallback date calculation | When `scheduled_time` is invalid, date derived from `week_number` and `day`; may not respect `campaign.start_date` in all cases |

---

## APPENDIX: Calendar generation flow (algorithm)

1. **Planner / AI path**
   - User creates plan (planner or ai/plan).
   - `saveStructuredCampaignPlan` / `commitDraftBlueprint` writes to `twelve_week_plan`.
   - Blueprint weeks contain `execution_items` / `daily_execution_items` (from orchestrator or skeleton).

2. **Daily expansion**
   - User triggers “Generate Daily Plans” (campaign details or planner finalize).
   - `generateWeeklyStructure` reads blueprint, builds `DailyPlanItem[]` per week (distribution, platform rules, AI distribution optional).
   - Inserts rows into `daily_content_plans`.

3. **Calendar display**
   - Calendar page calls `retrieve-plan` → `committedPlan.weeks` (or draftPlan).
   - Maps `week.daily_execution_items` → `CalendarActivity[]`.
   - If empty, calls `daily-plans` and maps rows → `CalendarActivity[]`.
   - Groups by date, then by stage; renders sections and tiles.

4. **Activity workspace**
   - Click “Open Activity Detail” → payload to sessionStorage, open `/activity-workspace?workspaceKey=...`.
   - If sessionStorage empty, resolve API finds item in blueprint by execution_id and returns payload.

---

*End of audit report*

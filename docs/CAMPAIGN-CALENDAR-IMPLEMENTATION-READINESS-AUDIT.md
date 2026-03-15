# Campaign Calendar Implementation Readiness Audit

**Date:** 2025-03-12  
**Baseline:** [CAMPAIGN-CALENDAR-REDESIGN-ARCHITECTURE-PROPOSAL.md](./CAMPAIGN-CALENDAR-REDESIGN-ARCHITECTURE-PROPOSAL.md)  
**Goal:** Determine what can be implemented immediately without breaking the current system. Focus on integration points and safe rollout.

---

## 1. DATABASE_READINESS

### 1.1 SAFE_TO_CREATE_TABLES: **yes**

### 1.2 Verification

| Check | Result |
|-------|--------|
| **Naming conflicts** | No conflict. `campaign_activity_engagement_signals` exists but is a separate table for engagement signals; `campaign_activities` (proposed) is distinct. `campaign_activity_rules` is new. |
| **Triggers** | No triggers on `twelve_week_plan` or `daily_content_plans` that fire on insert to unrelated tables. Triggers on `campaigns` (update_updated_at) and `daily_content_plans` (log_daily_plans_deletion) do not affect new tables. New tables have no dependent triggers. |
| **campaign_id type** | `campaigns.id` is UUID. `twelve_week_plan`, `daily_content_plans`, `weekly_content_refinements` use `campaign_id UUID REFERENCES campaigns(id)`. **Compatible.** |
| **users table** | `users(id)` is UUID. `campaign_activity_rules.created_by UUID REFERENCES users(id)` is compatible. `weekly_content_refinements` and others already use `REFERENCES users(id)`. |
| **RLS** | New tables are not referenced by existing RLS policies. Add RLS when introducing the tables; use same pattern as `daily_content_plans` (campaign_id → campaigns → user/company access). |

### 1.3 RISKS

| Risk | Severity | Mitigation |
|------|----------|------------|
| **content_assets uses campaign_id TEXT** | Low | New tables use `campaign_id UUID`; no dependency. `content_assets` is legacy and not part of calendar flow. |
| **Supabase schema drift** | Low | Run migrations in order: `campaign_activity_rules` first (no FK to campaign_activities), then `campaign_activities`. |
| **RLS blocking reads** | Medium | Add policies before first use; test with same company/campaign access patterns as daily_content_plans. |

---

## 2. GENERATOR_INTEGRATION

### 2.1 PRIMARY_TRIGGER_POINT: **runPlannerCommitAndGenerateWeekly** (post generate-weekly-structure)

**Location:** `backend/services/boltPipelineService.ts` — `runPlannerCommitAndGenerateWeekly`  
**Flow:** planner-finalize → saveStructuredCampaignPlan + commitDraftBlueprint → `runPlannerCommitAndGenerateWeekly` → `generateWeeklyStructure` → inserts into `daily_content_plans`

**Rationale:** After `generateWeeklyStructure` completes, the blueprint is committed and `daily_content_plans` rows exist. Adding `blueprintToActivities(campaignId)` immediately after guarantees:
- Blueprint has `daily_execution_items` (from generate-weekly-structure or orchestrator)
- Campaign has `start_date` and `duration_weeks`
- No change to existing generate-weekly-structure logic

**Insertion point:**
```typescript
// In runPlannerCommitAndGenerateWeekly, after await generateWeeklyStructure(...)
await blueprintToActivities(params.campaignId);
```

### 2.2 SECONDARY_TRIGGER_POINTS

| Point | Location | When to trigger |
|-------|----------|-----------------|
| **BOLT generate-weekly-structure stage** | `boltPipelineService.ts` — `executeBoltPipeline` | After generate-weekly-structure stage completes; call `blueprintToActivities(campaignId)` |
| **generate-weekly-structure API** | `pages/api/campaigns/generate-weekly-structure.ts` | When called directly (campaign details "Generate Daily Plans"); add call at end of handler |
| **commit-plan API** | When user commits blueprint without full generate | Only if commit writes `daily_execution_items` to blueprint; then `blueprintToActivities` |
| **Manual rule creation** | New `POST /api/campaigns/activity-rules` | When user adds recurrence rule via UI; call `ActivityGenerator.run(campaignId, [ruleId])` |

**Recommended order:** Implement at `runPlannerCommitAndGenerateWeekly` first (MVP). Add BOLT stage and generate-weekly-structure API in Phase 2.

---

## 3. WORKSPACE_COMPATIBILITY

### 3.1 EXECUTION_ID_COMPATIBLE: **yes**

**Current usage:**
- **Blueprint items:** `execution_id` from `daily_execution_items[]` — format: `wk${week}-exec-${order}` or from orchestrator
- **Daily plans fallback:** `plan.id` (UUID) or `daily-${weekNumber}-${idx}`
- **workspaceKey:** `activity-workspace-${campaignId}-${execution_id}`
- **Resolve API:** Parses `workspaceKey`; expects `campaignId` = 36 chars (UUID), `executionId` = rest. Finds item in `blueprint.weeks[].daily_execution_items` where `item.execution_id === targetExecId`

**campaign_activities compatibility:**
- Store `execution_id` as TEXT; preserve same values when migrating from blueprint (e.g. `wk1-exec-1`, `daily-1-0`)
- Workspace key format unchanged: `activity-workspace-${campaignId}-${execution_id}`
- Resolve API: add fallback — when not found in blueprint, query `campaign_activities WHERE campaign_id = ? AND execution_id = ?` and build payload from row + linked daily_content_plan or raw content JSON

### 3.2 REQUIRED_ADJUSTMENTS

| Adjustment | Location | Change |
|------------|----------|--------|
| **Resolve API fallback** | `pages/api/activity-workspace/resolve.ts` | After blueprint search, if `!found`: query `campaign_activities` by (campaignId, executionId); if row exists, build payload from row + join daily_content_plans by execution_id if needed |
| **Payload shape** | Same | Resolve returns `{ workspaceKey, payload }`. Payload must include `campaignId`, `activityId` (execution_id), `dailyExecutionItem`, `schedules`. For campaign_activities row: map row to dailyExecutionItem shape; schedules from platform_variants or single entry |
| **workspace_id column** | Optional | `campaign_activities.workspace_id` can store `activity-workspace-${campaignId}-${execution_id}` for quick lookup; resolve can use it when workspaceKey is passed |

---

## 4. CALENDAR_API_COMPATIBILITY

### 4.1 Current vs proposed data flow

| Current | Proposed |
|---------|----------|
| `retrieve-plan` → `committedPlan.weeks` or `draftPlan.weeks` | `GET /api/campaigns/activities?campaignId=` → `campaign_activities` rows |
| Map `daily_execution_items` → `CalendarActivity[]` | Map DB rows → `CalendarActivity[]` |
| Fallback: `daily-plans` → map plans → `CalendarActivity[]` | No fallback when using activities source |

### 4.2 REQUIRED_FRONTEND_CHANGES

| File | Change |
|------|--------|
| `pages/campaign-calendar/[id].tsx` | Add branch: if `campaign.calendar_source === 'activities'` (or activities API returns data), call `GET /api/campaigns/activities?campaignId=...&start=...&end=...`; map response to `CalendarActivity[]`; else keep current retrieve-plan + daily-plans flow |
| CalendarActivity mapping | Map `campaign_activities` row → `{ execution_id, week_number, day, date, time, title, platform, content_type, execution_status, execution_jobs, raw_item }`. `raw_item` can be constructed from row + optional link to daily_content_plans content JSON |
| Stage resolution | Use `campaign_activities.stage` when present; else derive from `content_type` (existing `mapDeterministicFallbackStage`) |
| execution_status | Map `campaign_activities.status` → ExecutionStatus: planned → PENDING, content-created/media-ready → IN_PROGRESS, scheduled → SCHEDULED, published/failed → FINALIZED |

### 4.3 API_RESPONSE_SHAPE

```typescript
// GET /api/campaigns/activities?campaignId=&start=&end=
{
  activities: Array<{
    activity_id: string;
    campaign_id: string;
    week_number: number;
    day_of_week: string;
    scheduled_date: string;  // YYYY-MM-DD
    scheduled_time: string | null;  // HH:mm
    platform: string;
    content_type: string;
    topic: string | null;
    title: string | null;
    theme: string | null;
    stage: string | null;
    execution_mode: string;
    status: string;
    execution_id: string;
    source: string;
    created_at: string;
    updated_at: string | null;
    // Optional: content from daily_content_plans when linked
    content?: Record<string, unknown>;
  }>;
}
```

**Calendar frontend mapping:** `activity_id` → not needed for tile; `execution_id` → workspace key. All other fields map 1:1 to `CalendarActivity`.

---

## 5. BLUEPRINT_MIGRATION

### 5.1 MIGRATION_COMPLEXITY: **low**

### 5.2 DATA_TRANSFORMATION_STEPS

| Step | Action |
|------|--------|
| 1 | Load blueprint via `getUnifiedCampaignBlueprint(campaignId)` |
| 2 | Load campaign for `start_date`, `duration_weeks` |
| 3 | For each `week` in `blueprint.weeks`: `items = week.daily_execution_items ?? []` |
| 4 | For each `item`: extract `execution_id`, `platform`, `content_type`, `topic`, `title`, `day`, `scheduled_time`, `stage`, `execution_mode` |
| 5 | Compute `scheduled_date`: from `campaign.start_date` + `week_number` + `day` (DAY_INDEX) |
| 6 | Compute `scheduled_time`: parse item.scheduled_time or default '09:00' |
| 7 | Build row: `{ campaign_id, week_number, day_of_week, scheduled_date, scheduled_time, platform, content_type, topic, title, theme, stage, execution_mode, status: 'planned', execution_id, source: 'blueprint_migration' }` |
| 8 | Upsert into `campaign_activities` (ON CONFLICT execution_id do nothing, or skip if exists) |
| 9 | Store `raw_item` in separate `content` JSONB column or link to daily_content_plans by execution_id when row matches |

**Edge cases:**
- Missing `day`: use `itemIndex % 7` → DAYS[]. Same as calendar page fallback.
- Missing `execution_id`: generate `wk${week}-exec-${index}`.
- Duplicate execution_id: skip or update; prefer idempotent upsert by (campaign_id, execution_id).

---

## 6. AI_INTEGRATION

### 6.1 AI_RULE_EXTRACTION_LOCATION

| Component | Purpose | Integration |
|-----------|---------|-------------|
| **campaignAiOrchestrator** | Produces `execution_items`, `resolved_postings`, `daily_execution_items` with platform, content_type, topic, day | Output is written to blueprint. Recurrence extractor would run **after** orchestrator returns, parsing weeks for patterns. |
| **ai/plan pipeline** | Calls `runCampaignAiPlan`; returns structured plan | Plan is saved via `saveStructuredCampaignPlan` / `commitDraftBlueprint`. Rule extraction would run after commit. |
| **plannerSessionStore** | Holds `posting_frequency: Record<string, number>` | Maps to `posts_per_week` rules. When creating rules from strategy, use `posting_frequency` as input. |
| **RecurrenceExtractor** | NEW service | Input: blueprint weeks. Output: `campaign_activity_rules` rows. Insert after `commitDraftBlueprint`. Trigger: same as blueprintToActivities — after planner finalize or BOLT commit. |

**Recommended:** Phase 3. Implement `RecurrenceExtractor` after MVP. First extract rules from blueprint when pattern is obvious (e.g. same platform+content_type+day every week); else insert one rule per unique (platform, content_type) with `posts_per_week` from strategy.

---

## 7. MVP_IMPLEMENTATION

### 7.1 MVP_IMPLEMENTATION_PLAN

**Scope:** campaign_activities table, migration from blueprint, calendar reading from activities. **No recurrence rules.**

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 1 | Create `campaign_activities` table (no rule_id initially) | 1 file | None |
| 2 | Add `calendar_source` to campaigns (default 'blueprint') | Migration | campaigns table |
| 3 | Implement `blueprintToActivities(campaignId)` in `backend/services/blueprintActivityMigration.ts` | 1 service | getUnifiedCampaignBlueprint |
| 4 | Call `blueprintToActivities` from `runPlannerCommitAndGenerateWeekly` | 1-line add | Task 3 |
| 5 | Create `GET /api/campaigns/activities` | New API route | Task 1 |
| 6 | Calendar page: branch on calendar_source; if 'activities', call activities API | Modify campaign-calendar/[id].tsx | Task 5 |
| 7 | Resolve API: fallback to campaign_activities when blueprint miss | Modify resolve.ts | Task 1 |
| 8 | Migration job: for campaigns with blueprint, run blueprintToActivities; set calendar_source='activities' | Optional batch script | Task 3 |

**Excluded from MVP:** campaign_activity_rules, recurrence engine, AI command interface, RecurrenceExtractor.

**Rollout:** New campaigns get calendar_source='activities' after planner finalize (blueprintToActivities runs). Existing campaigns keep 'blueprint' until migrated. Calendar uses activities API only when calendar_source='activities'.

---

## 8. ROLL_OUT_PLAN

| Phase | Scope | Gate |
|-------|-------|------|
| **Phase 1** | Introduce `campaign_activities` table; add `calendar_source` to campaigns; implement `blueprintToActivities`; call from runPlannerCommitAndGenerateWeekly | Tables exist; no UI change; activities populated for new campaigns |
| **Phase 2** | Calendar reads from activities when calendar_source='activities'; new GET /api/campaigns/activities; resolve API fallback | Feature flag or calendar_source; backward compatible |
| **Phase 3** | Add `campaign_activity_rules`; implement ActivityGenerator; RecurrenceExtractor from blueprint; manual rule creation API | Rules table; generator service |
| **Phase 4** | AI command interface; CampaignAIChat handlers; "Add recurring activity" UI | NL parser or form-based rule creation |

**Phase 1–2 deliverable:** MVP as above. Phase 3–4 extend with recurrence and AI.

---

## 9. RISKS_AND_MITIGATIONS

### 9.1 RISKS

| Risk | Impact | Likelihood | Category |
|------|--------|------------|----------|
| **Data divergence** | Calendar shows different activities than blueprint/daily_content_plans | Medium | Data consistency |
| **Workspace loading failure** | User clicks activity, resolve returns 404 | Low | Workspace |
| **Calendar rendering empty** | Activities API returns [] for migrated campaign | Medium | Frontend |
| **Migration failure** | blueprintToActivities throws; campaign stuck | Low | Migration |
| **Blueprint missing daily_execution_items** | blueprintToActivities has nothing to migrate | Medium | Edge case |
| **RLS blocking** | Activities API returns 403 or empty | Low | Security |

### 9.2 MITIGATIONS

| Risk | Mitigation |
|------|------------|
| Data divergence | Keep blueprint as planning source. campaign_activities is read-only cache for calendar. Writes (content, status) stay in daily_content_plans. Sync blueprintToActivities only on planner finalize / generate-weekly-structure. |
| Workspace loading failure | Resolve fallback to campaign_activities. When row found, build payload from row + daily_content_plans content by execution_id. If no content, return minimal payload (title, platform, content_type) so workspace still opens. |
| Calendar rendering empty | Fallback: when activities API returns [], and calendar_source='activities', re-fetch retrieve-plan + daily-plans (current flow) as safety. Or show "No activities yet" with link to generate daily plans. |
| Migration failure | Wrap blueprintToActivities in try/catch; log error; do not throw. Campaign continues with blueprint source. Add retry or manual "Sync calendar" action. |
| Blueprint missing daily_execution_items | Same as current: calendar falls back to daily-plans. blueprintToActivities no-ops when items empty; campaign stays calendar_source='blueprint'. |
| RLS blocking | Add RLS policies mirroring daily_content_plans (campaign_id → campaigns → user/company). Test with company-scoped access. |

---

## 10. SUMMARY

| Section | Key finding |
|---------|-------------|
| **DATABASE_READINESS** | Tables safe to create; UUID and users compatible; minor RLS setup needed |
| **GENERATOR_INTEGRATION** | Primary: runPlannerCommitAndGenerateWeekly; secondary: BOLT stage, generate-weekly-structure API |
| **WORKSPACE_COMPATIBILITY** | execution_id compatible; resolve API needs fallback to campaign_activities |
| **CALENDAR_API_COMPATIBILITY** | New API + frontend branch; response shape defined; backward compatible |
| **BLUEPRINT_MIGRATION** | Low complexity; straightforward mapping from daily_execution_items |
| **AI_INTEGRATION** | RecurrenceExtractor after commit; plannerSessionStore posting_frequency maps to rules |
| **MVP_IMPLEMENTATION** | 8 tasks; exclude recurrence; focus on table + migration + calendar read |
| **ROLL_OUT_PLAN** | 4 phases; Phase 1–2 = MVP |
| **RISKS_AND_MITIGATIONS** | Data divergence, workspace, empty calendar, migration failure; mitigations documented |

---

*End of implementation readiness audit*

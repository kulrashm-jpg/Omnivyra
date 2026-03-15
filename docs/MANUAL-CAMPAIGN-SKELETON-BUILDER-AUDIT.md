# MANUAL CAMPAIGN SKELETON BUILDER — ARCHITECTURE AUDIT

**Scope:** Manual Campaign Builder only (Dashboard → Create Campaign → Campaign Planner → Generate Skeleton → Adjust Skeleton → Finalize Campaign).  
**Excluded:** Recommended Hub, AI Suggested Campaigns.

---

## MANUAL CAMPAIGN FLOW

```
DashboardPage.tsx
  → onClick={() => window.location.href = '/campaign-planner?mode=direct'}

pages/campaign-planner.tsx
  → CampaignPlannerWithSession
  → PlannerSessionProvider(companyId)
  → PlannerEntryRouter
  → CampaignPlannerInner(context)
  → CampaignPlannerLayout(companyId, campaignId=null, ...)
     → CampaignContextBar, StrategySetupPanel, ExecutionSetupPanel
     → PlanningCanvas, FinalizeSection, AIPlanningAssistantTab

ExecutionSetupPanel.tsx
  → handleSubmit()
  → fetch('/api/campaigns/ai/plan', { preview_mode: true, mode: 'generate_plan', ... })
  → weeksToCalendarPlan(data.plan.weeks)
  → setCampaignStructure(campaign_structure)
  → setCalendarPlan(calendar_plan)

FinalizeSection.tsx
  → handleFinalize()
  → fetch('/api/campaigns/planner-finalize', { companyId, idea_spine, strategy_context, calendar_plan?, ... })
  → window.location.href = `/campaign-calendar/${cid}`

pages/api/campaigns/ai/plan.ts (preview_mode)
  → generatePlanPreview()
  → planPreviewService.generatePlanPreview()

pages/api/campaigns/planner-finalize.ts
  → buildStructuredWeeksFromStrategy(strategy_context)
  → supabase.from('campaigns').insert()
  → supabase.from('campaign_versions').insert()
  → saveStructuredCampaignPlan()
  → commitDraftBlueprint()
  → runPlannerCommitAndGenerateWeekly()
  → generateWeeklyStructure()
  → supabase.from('daily_content_plans').insert()
```

---

## SKELETON GENERATION ENGINE

| Function | File | Purpose | Inputs | Outputs |
|----------|------|---------|--------|---------|
| `generatePlanPreview()` | `backend/services/planPreviewService.ts` | Preview skeleton for planner (no campaignId) | companyId, idea_spine, strategy_context, platform_content_requests, campaign_direction, campaign_type | `{ plan: { weeks } }` |
| `buildDeterministicWeeklySkeleton()` | `backend/services/deterministicWeeklySkeleton.ts` | Deterministic slots from platform_content_requests (when used in plan) | prefilledPlanning: platform_content_requests, content_capacity, available_content, etc. | DeterministicWeeklySkeleton: execution_items, platform_allocation |
| `runCampaignAiPlan()` | `backend/services/campaignAiOrchestrator.ts` | AI plan generation (used when campaignId present) | campaignId, mode, message, collectedPlanningContext, platform_content_requests | plan.weeks, snapshot_hash |
| `buildStructuredWeeksFromStrategy()` | `pages/api/campaigns/planner-finalize.ts` | Rebuild weeks from strategy (used at finalize) | strategy: duration_weeks, platforms, posting_frequency, content_mix, campaign_goal; ideaTitle | weeks[] |

---

## INPUT MODEL

**Expected concept:**
```
campaign_start_date
duration_weeks
content_distribution
```

**Actual structure:**
```
strategy_context: {
  duration_weeks: number
  platforms: string[]
  posting_frequency: Record<string, number>  // per platform
  content_mix: string[]
  campaign_goal: string
  target_audience: string
  planned_start_date: string  // YYYY-MM-DD
}

platform_content_requests: {
  [platform]: { [content_type]: count }
}
// Example: { linkedin: { video: 2, post: 3, carousel: 1 } }
```

---

## PREVIEW VS FINALIZE BEHAVIOR

| Aspect | Generate Skeleton (Preview) | Finalize Campaign |
|--------|-----------------------------|-------------------|
| Uses `calendar_plan` | No (produces it) | No. Received in body, validated only; not used to build weeks |
| Uses `platform_content_requests` | Yes (generatePlanPreview) | No |
| Uses preview skeleton | N/A | No |
| Builds structure via | `generatePlanPreview` → `buildDeterministicWeeklySkeleton` (when platform_content_requests) or AI | `buildStructuredWeeksFromStrategy(strategy_context)` |

**Exact code (planner-finalize.ts):**
```ts
// Line 95: weeks built from strategy only
const weeks = buildStructuredWeeksFromStrategy(strategy_context, ideaTitle);
// bodyCalendarPlan is validated (lines 81–88) but never used to build weeks
```

---

## START DATE HANDLING

**planner-finalize.ts line 96:**
```ts
const startDate = new Date().toISOString().split('T')[0];
```

`strategy_context.planned_start_date` is never used. Start date is always `new Date()` (today).

---

## DATABASE STRUCTURE

**campaigns**
- id, user_id, name, description, status, current_stage, start_date, end_date, duration_weeks, created_at, updated_at, ...

**campaign_versions**
- id, company_id, campaign_id, campaign_snapshot (JSONB), status, version, created_at, ...

**twelve_week_plan**
- id, campaign_id, snapshot_hash, weeks (JSONB), blueprint (JSONB), status, raw_plan_text, omnivyre_decision, created_at, updated_at, ...

**daily_content_plans**
- id, campaign_id, week_number, day_of_week, platform, content (JSONB), topic, objective, ai_generated, status, date, ...

| Stored in | Table | Field |
|-----------|-------|-------|
| weeks | twelve_week_plan | weeks (JSONB) |
| slots | daily_content_plans | rows per campaign_id, week_number, day_of_week |
| content types | twelve_week_plan.weeks[].content_type_mix; daily_content_plans.content | — |
| schedule dates | daily_content_plans | date (or derived from start_date + week/day) |
| campaign start | campaigns | start_date |

---

## DRAG & DROP LOGIC

**Component:** `components/planner/ActivityCardWithControls.tsx` (Move picker, not drag-drop)

**State update:** `updateActivityInPlan({ week_number, day })` → `setCalendarPlan({ ...calendarPlan, activities, days })`  
**Logic:** `handleMoveToDay(targetWeek, targetDay)` calls `updateActivityInPlan({ week_number: targetWeek, day: targetDay })`. `rebuildDaysFromActivities` recomputes `days` from `activities`.

**Database update:** None. Move updates planner session state only. No API call or DB write. Planner finalize ignores `calendar_plan` and rebuilds from `strategy_context`.

**slot_date / week_number:** In-memory `week_number`, `day` updated. No `slot_date`; finalize does not persist moved slots.

---

## PLACEHOLDER SLOT SUPPORT

**Slots with only platform + content_type (no theme, content, AI):** Yes. `execution_items` and `topic_slots` can have `topic: null`; `buildPlaceholderPlanFromSkeleton` in campaignAiOrchestrator uses `weekTopics`, `fallbackThemeSeed`, etc.

**Storage:** `daily_content_plans.content` (JSONB) can hold placeholders. `daily_content_plans` has `ai_generated`, `topic`, `objective`. Placeholder-like content: `contentGenerationPipeline.isPlaceholderLikeContent()` checks for empty or placeholder-like strings. `structuredPlanScheduler` uses `contentPlaceholder` when `generatedContent` is empty.

---

## AI GENERATION TRIGGER

| When | Trigger |
|------|---------|
| During skeleton creation | No |
| During finalize | No. `runPlannerCommitAndGenerateWeekly` → `generateWeeklyStructure` creates `daily_content_plans` with placeholder content; no AI content call |
| Only when user clicks Generate Content | Yes. Activity workspace: `/api/activity-workspace/content`, `/api/ai/generate-content`. Campaign details: `generateContentForDay`, `regenerateContent` via `/api/content/generate-day` |

---

## SHARED COMPONENTS WITH RECOMMENDED HUB

| Type | Shared |
|------|--------|
| APIs | `POST /api/campaigns/ai/plan` (Manual: preview_mode; Recommended: campaignId + generate_plan), `POST /api/campaigns` (Manual: planner-finalize does not use; Recommended: TrendCampaignsTab POST), `PUT /api/campaigns/[id]/source-recommendation` (Recommended only) |
| Services | `campaignAiOrchestrator.runCampaignAiPlan`, `planPreviewService.generatePlanPreview`, `campaignBlueprintAdapter.fromStructuredPlan`, `campaignPlanStore`, `boltPipelineService.runPlannerCommitAndGenerateWeekly`, `generateWeeklyStructure` |
| Database | campaigns, campaign_versions, twelve_week_plan, daily_content_plans |

**Manual-only:** `pages/api/campaigns/planner-finalize.ts`, `ExecutionSetupPanel`, `FinalizeSection` (planner), `PlannerEntryRouter`, `buildStructuredWeeksFromStrategy`.  
**Recommended-only:** `TrendCampaignsTab`, `POST /api/recommendations/[id]/create-campaign`, `recommendationCampaignBuilder`, `PUT source-recommendation`.

---

## ROOT CAUSE

1. **Preview skeleton discarded at finalize:** `planner-finalize` builds weeks with `buildStructuredWeeksFromStrategy(strategy_context)` and ignores `calendar_plan`.
2. **Start date ignored:** `strategy_context.planned_start_date` not used; finalize sets `startDate = new Date().toISOString().split('T')[0]`.
3. **platform_content_requests ignored at finalize:** Used in preview skeleton only; finalize uses `posting_frequency` and `content_mix` from strategy.
4. **Slot move not persisted:** `ActivityCardWithControls.handleMoveToDay` updates in-memory `calendar_plan` only; finalize does not consume it.

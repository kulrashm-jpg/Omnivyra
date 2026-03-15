# CAMPAIGN CREATION SYSTEM — FULL BEHAVIORAL AUDIT

**Audit Type:** Forensic (no fixes applied)  
**Date:** March 14, 2025  
**Objective:** Map current system behavior, architecture, and failure points.

---

## 1. SYSTEM FLOW MAP

### PART 1 — Trace the User Flow

```
Dashboard (components/DashboardPage.tsx)
  → Create Campaign button
    → onClick: window.location.href = '/campaign-planner?mode=direct'

pages/campaigns.tsx
  → Create New Campaign button
    → onClick: window.location.href = '/campaign-planner?mode=direct'

lib/campaign-navigation-logic.ts
  → createCampaign action
    → window.location.href = '/campaign-planner?mode=direct'

pages/campaign-planner.tsx
  → PlannerEntryRouter
    → mode=direct, campaign_id=null
  → CampaignPlannerInner
    → CampaignPlannerLayout
      → CampaignContextBar (idea spine)
      → StrategySetupPanel
      → ExecutionSetupPanel
        → "Generate Skeleton" button
          → handleSubmit()
            → POST /api/campaigns/ai/plan (preview_mode: true)
      → FinalizeSection
        → "Finalize Campaign Plan" button
          → handleFinalize()
            → POST /api/campaigns/planner-finalize
```

### Execution Chain — Generate Skeleton (Preview)

```
ExecutionSetupPanel.tsx / StructureTab.tsx
  → handleSubmit()
    → fetch POST /api/campaigns/ai/plan
      Body: {
        preview_mode: true,
        mode: 'generate_plan',
        companyId,
        idea_spine,
        strategy_context,
        platform_content_requests,
        ...
      }

pages/api/campaigns/ai/plan.ts
  → handler()
    → preview_mode branch (campaignId NOT required)
    → generatePlanPreview()
      OR runCampaignAiPlan() (when not preview)

backend/services/planPreviewService.ts
  → generatePlanPreview()
    → runCampaignAiPlan() (internal)

backend/services/campaignAiOrchestrator.ts
  → runCampaignAiPlan()
    → buildDeterministicWeeklySkeleton() [when platform_content_requests present]
    → generateCampaignPlan() [LLM call]
    → parseAiPlanToWeeks()

Response: { plan: { weeks } } (in-memory only; NO database write in preview mode)
```

### Execution Chain — Finalize Campaign Plan

```
FinalizeSection.tsx
  → handleFinalize()
    → fetch POST /api/campaigns/planner-finalize
      Body: {
        companyId,
        idea_spine,
        strategy_context,
        campaignId: undefined (direct mode),
        calendar_plan: state.execution_plan?.calendar_plan
      }

pages/api/campaigns/planner-finalize.ts
  → handler()
    → buildStructuredWeeksFromStrategy(strategy_context)
      [NOTE: Does NOT use body.calendar_plan from preview!]
    → supabase.from('campaigns').insert() [if new]
    → supabase.from('campaign_versions').insert()
    → saveStructuredCampaignPlan()
    → commitDraftBlueprint()
    → runPlannerCommitAndGenerateWeekly()

backend/db/campaignPlanStore.ts
  → saveStructuredCampaignPlan()
    → supabase.from('twelve_week_plan').insert()
  → commitDraftBlueprint()
    → updates blueprint in campaign store

backend/services/boltPipelineService.ts
  → runPlannerCommitAndGenerateWeekly()
    → generateWeeklyStructure()

pages/api/campaigns/generate-weekly-structure.ts
  → handler (via generateWeeklyStructure service)
    → supabase.from('daily_content_plans').insert()
```

### API Endpoints Involved

| Endpoint | Method | When Called |
|----------|--------|-------------|
| `/api/campaigns/ai/plan` | POST | Generate Skeleton, Generate Preview, AI Copilot |
| `/api/campaigns/planner-finalize` | POST | Finalize Campaign Plan |
| `/api/campaigns/retrieve-plan` | GET | PlanLoader (when campaignId exists) |
| `/api/planner/suggest-campaigns` | POST | Campaign suggestions |
| `/api/planner/generate-themes` | POST | AI Copilot "Generate themes" |

---

## 2. DATA FLOW MAP

### Campaign Input Structure

The system does **not** use a flat `campaign_start_date`, `campaign_duration`, `content_distribution` structure. It uses:

| User Concept | System Field | Location |
|--------------|--------------|----------|
| Start date | `planned_start_date` | strategy_context.planned_start_date |
| Duration | `duration_weeks` | strategy_context.duration_weeks |
| Content mix | `platform_content_requests` | planner state / strategy_context |

### Content Distribution Format

**Format:** Nested object by platform, then content type:

```json
{
  "linkedin": {
    "video": 2,
    "post": 3,
    "carousel": 1
  },
  "x": {
    "post": 2
  }
}
```

**NOT** a flat `{ video: 2, text: 3, carousel: 1 }` — the system expects per-platform breakdown.

### Data Flow: UI → API → Service → Database

```
UI (ExecutionSetupPanel / StructureTab)
  state.platform_content_requests  →  { [platform]: { [content_type]: count } }
  state.execution_plan.strategy_context
    duration_weeks, platforms, posting_frequency, planned_start_date

  → POST /api/campaigns/ai/plan
    preview_mode: true
    strategy_context: { duration_weeks, platforms, posting_frequency, content_mix, planned_start_date }
    platform_content_requests: { linkedin: { video: 2, post: 3 } }

API (plan.ts)
  → generatePlanPreview() or runCampaignAiPlan()
  → Returns plan.weeks (NO DB write in preview)

UI
  weeksToCalendarPlan(weeks)  →  campaign_structure, calendar_plan
  setCampaignStructure(), setCalendarPlan()  [planner session state]

---

FINALIZE:
UI (FinalizeSection)
  idea_spine, strategy_context, calendar_plan (optional)

  → POST /api/campaigns/planner-finalize

API (planner-finalize.ts)
  buildStructuredWeeksFromStrategy(strategy_context)
  [IGNORES calendar_plan from body for week structure]
  → weeks (simple loop 1..duration)
  → campaigns.insert
  → campaign_versions.insert
  → saveStructuredCampaignPlan → twelve_week_plan.insert
  → commitDraftBlueprint
  → runPlannerCommitAndGenerateWeekly
    → generateWeeklyStructure
      → daily_content_plans.insert
```

---

## 3. SKELETON GENERATION LOGIC

### Primary Function

| Property | Value |
|----------|-------|
| **Function name** | `buildDeterministicWeeklySkeleton()` |
| **File location** | `backend/services/deterministicWeeklySkeleton.ts` |
| **Alternative** | `runCampaignAiPlan()` (orchestrator) + `generatePlanPreview()` (planPreviewService) |

### Logic Flow

1. **Input:** `platform_content_requests` (map: platform → content_type → count_per_week)
2. **Parse:** `parsePlatformContentRequests()` → `{ platform, content_type, count_per_week }[]`
3. **Compute:** `total_weekly_content_count`, `platform_postings_total`, `platform_allocation`, `content_type_mix`
4. **Build execution_items:** For each (platform, content_type, count):
   - Create `DeterministicExecutionItem` with `topic_slots[]` (one slot per piece)
   - Each slot: `topic: null`, `intent: { objective, cta_type, ... }`
5. **Return:** `DeterministicWeeklySkeleton` with `execution_items[]`

### How Weeks, Slots, Content Types Are Generated

- **Weeks:** From `duration_weeks` — loop 1 to N.
- **Slots:** One `topic_slot` per requested count in `platform_content_requests`. E.g. `video: 2` → 2 slots.
- **Content types:** From keys in `platform_content_requests` per platform.

### When Deterministic vs AI

- **Deterministic:** Used when `platform_content_requests` is present and validation passes (no override).
- **AI:** Used when no `platform_content_requests` or when AI fills narrative/topics. `generateCampaignPlan()` calls LLM.

### Critical Gap

**planner-finalize does NOT use the preview skeleton.**

- `buildStructuredWeeksFromStrategy()` builds weeks from `strategy_context` only.
- It does a simple loop; no `execution_items`, no `platform_content_requests`-derived slots.
- `body.calendar_plan` is validated but not used to build the stored weeks.
- The "Generate Skeleton" preview is display-only; finalize rebuilds a generic structure.

---

## 4. DATABASE STRUCTURE

### Tables Used for Campaigns

**Note:** There are NO `campaign_weeks` or `campaign_slots` tables. The system uses:

| Table | Purpose | Relationship |
|-------|---------|---------------|
| `campaigns` | Core campaign entity | Parent |
| `campaign_versions` | Company–campaign link, snapshot | campaign_id → campaigns(id) |
| `twelve_week_plan` | Plan/blueprint (weeks in JSONB) | campaign_id → campaigns(id) |
| `daily_content_plans` | Daily slots (rows per week/day/platform) | campaign_id → campaigns(id) |
| `campaign_content` | Legacy content mapping (schema exists) | campaign_id → campaigns(id) |

### campaigns

| Column | Type | Relationship |
|--------|------|--------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | → users(id) |
| name | VARCHAR(255) | |
| description | TEXT | |
| status | VARCHAR(50) | draft, active, planning, etc. |
| current_stage | VARCHAR | planning, twelve_week_plan, execution_ready |
| start_date | DATE | |
| end_date | DATE | |
| duration_weeks | INTEGER | |
| blueprint_status | VARCHAR | |
| ... | | |

### campaign_versions

| Column | Type | Relationship |
|--------|------|--------------|
| id | UUID | PRIMARY KEY |
| company_id | UUID | → companies |
| campaign_id | UUID/TEXT | → campaigns(id) |
| campaign_snapshot | JSONB | { campaign, execution_config, cross_platform_sharing } |
| status | TEXT | |
| version | INTEGER | |

### twelve_week_plan

| Column | Type | Relationship |
|--------|------|--------------|
| id | UUID | PRIMARY KEY |
| campaign_id | UUID | → campaigns(id) ON DELETE CASCADE |
| weeks | JSONB | Array of week objects |
| blueprint | JSONB | CampaignBlueprint |
| snapshot_hash | TEXT | |
| status | TEXT | draft, committed |
| ... | | |

### daily_content_plans

| Column | Type | Relationship |
|--------|------|--------------|
| id | UUID | PRIMARY KEY |
| campaign_id | UUID | → campaigns(id) |
| week_number | INTEGER | |
| day_of_week | TEXT/INTEGER | |
| platform | VARCHAR | |
| content | JSONB | |
| content_type | VARCHAR | |
| topic | TEXT | |
| ai_generated | BOOLEAN | |
| ... | | |

### Insertion Points

| Data | Where Inserted | File |
|------|----------------|------|
| Campaign | `supabase.from('campaigns').insert()` | planner-finalize.ts |
| Campaign version | `supabase.from('campaign_versions').insert()` | planner-finalize.ts |
| Blueprint/weeks | `twelve_week_plan` via `saveStructuredCampaignPlan()` | campaignPlanStore.ts |
| Skeleton slots | `daily_content_plans` | generate-weekly-structure.ts |

---

## 5. ERROR LOCATION

### Test Parameters

```
Start Date: March 20
Duration: 4 weeks
Distribution: Video: 2, Text: 3, Carousel: 1
```

### Expected Request Shape

For a single platform (e.g. LinkedIn):

```json
{
  "platform_content_requests": {
    "linkedin": {
      "video": 2,
      "post": 3,
      "carousel": 1
    }
  },
  "strategy_context": {
    "duration_weeks": 4,
    "platforms": ["linkedin"],
    "posting_frequency": { "linkedin": 6 },
    "planned_start_date": "2025-03-20"
  }
}
```

### Potential Error Sources

1. **PlatformContentMatrix:** If user does not configure matrix, `platform_content_requests` is empty → `strategyFromMatrix` null → "Generate Skeleton" disabled.
2. **Content type keys:** System uses `post`, `video`, `carousel` (lowercase). `text` may map to `post` depending on UI.
3. **planner-finalize:** Uses `buildStructuredWeeksFromStrategy` only; does not receive or persist `platform_content_requests`. Slots written to `daily_content_plans` come from blueprint `execution_items`, which in finalize flow are generic (platform_allocation only).
4. **Capacity validation:** When `platform_content_requests` is present, `validateCapacityVsExpectation` and `buildDeterministicWeeklySkeleton` run. `DeterministicWeeklySkeletonError` thrown if requested > supply.

### To Reproduce Failure

1. Go to `/campaign-planner?mode=direct`
2. Select company
3. Fill Campaign Context (title, description)
4. Set Start date = 2025-03-20, Duration = 4 weeks
5. In Platform Content Matrix, set linkedin: video=2, post=3, carousel=1
6. Click "Generate Skeleton" — preview should work (preview_mode)
7. Click "Finalize Campaign Plan" — campaign created, but stored plan does NOT reflect Video:2, Text:3, Carousel:1 from preview (see GAP 1)

---

## 6. STATE MANAGEMENT AUDIT

### Frontend State (Planner Session)

| State Key | Source | Can Be Undefined/Null |
|-----------|--------|------------------------|
| campaign_design.idea_spine | CampaignContextBar, spine | Yes (empty initially) |
| execution_plan.strategy_context | ExecutionSetupPanel, StrategySetupPanel | Yes |
| platform_content_requests | PlatformContentMatrix | Yes (null/empty) |
| campaign_structure | weeksToCalendarPlan | Yes |
| calendar_plan | weeksToCalendarPlan | Yes |
| strategic_themes | AIPlanningAssistantTab | Yes |
| source_ids | PlannerEntryRouter | Yes |

### State Flow During Creation

1. **Direct mode:** `campaignId` = null from router.
2. **Generate Skeleton:** Sets `campaign_structure`, `calendar_plan` in planner session.
3. **Finalize:** Reads `idea_spine`, `strategy_context`, optionally `calendar_plan`. Does NOT pass `platform_content_requests` to planner-finalize body (planner-finalize does not accept it).
4. **calendar_plan:** Sent in body but planner-finalize does not use it to build weeks; uses `buildStructuredWeeksFromStrategy` only.

### Undefined/Null Risks

- `strategy_context` null → `canFinalize` false, or `buildStructuredWeeksFromStrategy` falls back to defaults.
- `platform_content_requests` empty → "Generate Skeleton" disabled (`strategyFromMatrix` null).
- `companyId` null → "Select a company first" error.

---

## 7. ARCHITECTURAL GAPS

### GAP 1: Preview Skeleton Not Used on Finalize

| Expected | Actual |
|----------|--------|
| Skeleton from "Generate Skeleton" (Video:2, Text:3, Carousel:1) stored and used for campaign | planner-finalize ignores `calendar_plan`; rebuilds weeks from `buildStructuredWeeksFromStrategy` only |

### GAP 2: platform_content_requests Not Passed to Finalize

| Expected | Actual |
|----------|--------|
| Content distribution passed to backend on finalize | planner-finalize does not accept `platform_content_requests`; body has `idea_spine`, `strategy_context`, `calendar_plan` only |

### GAP 3: Deterministic vs Strategy-Only Skeleton

| Expected | Actual |
|----------|--------|
| Deterministic slot structure (execution_items) from platform_content_requests persisted | planner-finalize builds generic weeks (platform_allocation, content_type_mix) from strategy only; no execution_items with topic_slots |

### GAP 4: campaign_start_date Not in strategy_context

| Expected | Actual |
|----------|--------|
| User-selected start date used for campaign and plans | planner-finalize uses `startDate = new Date().toISOString().split('T')[0]` (today), not `strategy_context.planned_start_date` |

**Evidence:** planner-finalize.ts line 96: `const startDate = new Date().toISOString().split('T')[0];` — hardcoded to today.

### GAP 5: Naming Mismatch — content_distribution

| User/audit term | System term |
|-----------------|-------------|
| content_distribution | platform_content_requests |
| Flat { video, text, carousel } | Nested { [platform]: { [content_type]: count } } |

### GAP 6: Skeleton Generation Depends on AI in Some Paths

| Expected | Actual |
|----------|--------|
| Skeleton generation deterministic | When `platform_content_requests` absent, uses LLM (`generateCampaignPlan`). Preview can be AI or deterministic depending on payload. |

### GAP 7: campaign_weeks / campaign_slots Tables

| Expected (audit spec) | Actual |
|----------------------|--------|
| Dedicated campaign_weeks, campaign_slots tables | Weeks in `twelve_week_plan.weeks` (JSONB). Slots in `daily_content_plans` rows. No campaign_weeks or campaign_slots tables. |

---

## 8. SUMMARY

| Section | Key Finding |
|---------|-------------|
| **System flow** | Create Campaign → campaign-planner?mode=direct → ExecutionSetupPanel "Generate Skeleton" (preview) → FinalizeSection "Finalize Campaign Plan" (creates campaign + plan) |
| **Data flow** | `platform_content_requests` + `strategy_context` → ai/plan (preview) → in-memory only. Finalize uses `strategy_context` only, rebuilds weeks. |
| **Skeleton logic** | `buildDeterministicWeeklySkeleton` in deterministicWeeklySkeleton.ts when platform_content_requests present; planner-finalize does not use it. |
| **Database** | campaigns, campaign_versions, twelve_week_plan, daily_content_plans. No campaign_weeks/campaign_slots tables. |
| **Error location** | Start date not passed to finalize (GAP 4). Preview skeleton not persisted (GAP 1). |
| **Root cause** | planner-finalize builds weeks from strategy only; does not consume preview skeleton or platform_content_requests. |
| **Architectural gaps** | Preview/finalize disconnect; start date ignored; platform_content_requests not in finalize; naming/model differences. |

---

*End of forensic audit. No fixes proposed.*

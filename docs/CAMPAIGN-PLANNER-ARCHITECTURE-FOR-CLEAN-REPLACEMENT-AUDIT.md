# Campaign Planner Architecture — Clean Replacement Audit

**Objective:** Analyze the existing campaign planner to determine how to safely replace or refactor it for three campaign types: Text, Creator, Hybrid.  
**Date:** 2025-03-12

---

## 1. Current Planner Architecture

### File Paths

| File | Purpose |
|------|---------|
| `pages/campaign-planner.tsx` | Main page; one-page layout |
| `components/planner/CampaignContextBar.tsx` | Idea/title, audience, description, goal, Refine with AI |
| `components/planner/PlanningCanvas.tsx` | Campaign/Month/Week/Day views; activity cards |
| `components/planner/StrategyAssistantPanel.tsx` | Tabs: Parameters, AI Assistant, Opportunities |
| `components/planner/CampaignParametersTab.tsx` | Start date, duration, platforms, content types, posting frequency |
| `components/planner/AIPlanningAssistantTab.tsx` | Chat + voice; calls `/api/campaigns/ai/plan` |
| `components/planner/FinalizeSection.tsx` | Generate Preview, Finalize Campaign Plan |
| `components/planner/CalendarPlannerStep.tsx` | Legacy step UI (retrieve-plan, finalize); not primary in current layout |
| `components/planner/plannerSessionStore.ts` | React Context + localStorage; session state |
| `components/planner/calendarPlanConverter.ts` | `weeksToCalendarPlan(weeks)` → campaign_structure + calendar_plan |
| `components/planner/PlannerEntryRouter.tsx` | Parses query params; entry modes |

### Component Hierarchy

```
campaign-planner.tsx
├── PlannerEntryRouter
│   └── CampaignPlannerInner
│       ├── PlanLoader (when campaignId: fetch retrieve-plan)
│       ├── CampaignContextBar
│       ├── div (flex)
│       │   ├── PlanningCanvas
│       │   ├── FinalizeSection
│       │   └── StrategyAssistantPanel
│       │       ├── CampaignParametersTab
│       │       ├── AIPlanningAssistantTab
│       │       └── OpportunityInsightsTab
```

### Planner Entry Points

| Entry | Route | Source |
|-------|-------|--------|
| Dashboard / Create Campaign | `/campaign-planner?mode=direct` | DashboardPage, campaigns.tsx |
| Trend Build Blueprint (no campaign) | `/campaign-planner?companyId=X&recommendationId=Y` | TrendCampaignsTab |
| Opportunity | `/campaign-planner?opportunityId=X&companyId=Y` | OpportunityPanel |
| Campaign edit | `/campaign-planner?campaignId=X` | (PlanLoader fetches retrieve-plan) |
| Create campaign | `/create-campaign` → redirect to planner | create-campaign.tsx |

---

## 2. Skeleton Generation Mechanism

### Flows

| Flow | Trigger | API | Output |
|------|---------|-----|--------|
| **CampaignParametersTab** | "Generate Calendar Structure" | `POST /api/campaigns/ai/plan` | weeks → weeksToCalendarPlan → campaign_structure, calendar_plan |
| **AIPlanningAssistantTab** | User message + Send | Same | Same |
| **FinalizeSection** | "Generate Preview" | Same | Same |
| **CalendarPlannerStep** | "Generate Preview" | Same | Same (legacy) |

### Services Used

| Service | File | Role |
|---------|------|------|
| **API handler** | `pages/api/campaigns/ai/plan.ts` | Receives idea_spine, strategy_context; calls runCampaignAiPlan or generatePlanPreview |
| **Orchestrator** | `backend/services/campaignAiOrchestrator.ts` | runCampaignAiPlan: capacity validation, deterministic skeleton (optional), LLM prompt, parseAiPlanToWeeks |
| **Converter** | `components/planner/calendarPlanConverter.ts` | weeksToCalendarPlan: API weeks → campaign_structure (phases) + calendar_plan (weeks, days, activities) |
| **Deterministic** | `backend/services/deterministicWeeklySkeleton.ts` | Used when platform_content_requests present; produces execution_items with day_index |

### Data Model for Skeleton

**Input (strategy_context):**
- `duration_weeks`, `platforms[]`, `posting_frequency{}`, `content_mix[]`, `campaign_goal`, `target_audience`, `planned_start_date`

**Output (plan.weeks):**
- Each week: `week`, `theme`, `phase_label`, `execution_items[]`, `daily_execution_items[]`
- `execution_items`: `execution_id`, `topic`, `topic_slots[]` (platform, content_type, topic)
- `daily_execution_items`: `execution_id`, `platform`, `content_type`, `topic`, `title`, `day`

**platform, content_type, posting_frequency handling:**
- Platforms: from strategy_context.platforms (user-selected; Planner uses PLATFORM_OPTIONS from backend/constants/platforms)
- content_type: from content_mix; per slot in topic_slots
- posting_frequency: per platform in strategy_context; orchestrator builds platform_allocation

### AI vs Deterministic

- **AI path:** LLM generates structured plan text; parsed by `parseAiPlanToWeeks` (campaignPlanParser)
- **Deterministic path:** When `platform_content_requests` present (capacity validation), skeleton built first; topics assigned to slots; LLM may still run for narrative/theme

---

## 3. Calendar Data Model

### Types (plannerSessionStore.ts)

```typescript
interface CalendarPlanActivity {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
  phase?: string;
  objective?: string;
}

interface CalendarPlanDay {
  week_number: number;
  day: string;
  activities: CalendarPlanActivity[];
}

interface CalendarPlan {
  weeks?: unknown[];
  days?: CalendarPlanDay[];
  activities?: CalendarPlanActivity[];
}
```

### Activity Fields (Confirmed)

| Field | Purpose |
|-------|---------|
| `execution_id` | Stable ID for activity workspace |
| `week_number` | Week index |
| `platform` | linkedin, twitter, instagram, etc. |
| `content_type` | post, video, blog, carousel, story, thread, short |
| `title` | Slot title |
| `theme` | Week theme |
| `day` | Monday–Sunday |
| `phase` | Phase label |
| `objective` | Slot objective |

**Not in planner model but in blueprint/ daily_content_plans:**
- `day_index` (1–7)
- `writer_content_brief`
- `intent`
- `execution_mode` (AI / CREATOR / HYBRID)
- `creator_card`
- `master_content_id`
- `platform_variants`

---

## 4. Content Generation System

### Activity Workspace

| File | Purpose |
|------|---------|
| `pages/activity-workspace.tsx` | Main workspace UI; master content, platform variants, scheduling |
| `pages/api/activity-workspace/resolve.ts` | GET: resolve workspace payload from blueprint by executionId |
| `pages/api/activity-workspace/content.ts` | POST: generate_master, generate_variants, refine_variant, improve_variant |

### Master Content

- **API:** `POST /api/activity-workspace/content` with `action: 'generate_master'`
- **Service:** `generateMasterContentFromIntent` (contentGenerationPipeline.ts)
- **Input:** dailyExecutionItem (writer_content_brief, intent, platform, content_type)
- **Output:** master content text

### Platform Variants (Repurposing)

- **API:** Same content.ts with `action: 'generate_variants'`
- **Service:** `buildPlatformVariantsFromMaster` (contentGenerationPipeline.ts)
- **Input:** master_content, writer_content_brief, intent, platform_config
- **Output:** platform_variants (per-platform adapted content)

### writer_content_brief

- Built in campaignAiOrchestrator when merging execution_items
- `buildDeterministicWriterBrief` when slot missing
- Includes: topicTitle, format_requirements, narrativeStyle, etc.
- Stored in blueprint execution_items and daily_content_plans.content

---

## 5. Creator Content Support

### Content Types (CampaignParametersTab)

```typescript
const CONTENT_MIX_OPTIONS = ['post', 'video', 'blog', 'carousel', 'story', 'thread', 'short'];
```

- **post** — text; AI-generated
- **video, reel, short** — creator-dependent
- **carousel** — creator-dependent (images/slides)
- **story** — creator-dependent
- **blog** — can be AI or hybrid

### Existing Support

| Feature | Location | Status |
|---------|----------|--------|
| **creator_card** | daily_content_plans.content, activity-workspace resolve | Present; built in generate-weekly-structure (optional) |
| **buildCreatorInstruction** | backend/services/buildCreatorInstruction.ts | Maps content_type → creator instructions (video, carousel, reel, podcast) |
| **execution_mode** | campaignAiOrchestrator, blueprint | AI / CREATOR / HYBRID inferred from content_type |
| **requires_media** | platform_variants | Flag for creator formats |
| **VoiceNotesComponent** | ContentCreationPanel, DailyPlanningInterface | For voice notes; not planner chat |

### Missing for Full Creator Flow

- **Upload / asset linking** in activity-workspace for creator-provided video/carousel/images
- **Creator-specific activity workspace** (brief + upload link vs AI generation)
- **Explicit campaign_type** in planner (Text / Creator / Hybrid) driving execution_mode
- **webinar, podcast** in CONTENT_MIX (buildCreatorInstruction has them; planner options do not)

---

## 6. Repurposing Engine

### Services

| Service | File | Role |
|---------|------|------|
| **buildPlatformVariantsFromMaster** | contentGenerationPipeline.ts | Master → per-platform variants |
| **repurposeGraphEngine** | backend/services/repurposeGraphEngine.ts | Expands core slot into repurposed formats |
| **weeklyScheduleAllocator** | backend/services/weeklyScheduleAllocator.ts | repurpose_index, repurpose_total for spacing |

### API

- `POST /api/activity-workspace/content` — `action: 'generate_variants'`
- Activity workspace UI: "Repurpose Content" → calls this API
- **Tied to master content:** Yes. Variants generated from master_content + writer_content_brief

### Data Flow

```
master_content (from generate_master)
  → buildPlatformVariantsFromMaster
  → platform_variants[] per platform
  → stored in dailyExecutionItem.platform_variants
```

---

## 7. Campaign Finalization Pipeline

### Flow

```
FinalizeSection.handleFinalize()
  → POST /api/campaigns/planner-finalize
    → buildStructuredWeeksFromStrategy (from strategy_context)
    → Create campaign (if new)
    → fromStructuredPlan → blueprint
    → saveStructuredCampaignPlan
    → commitDraftBlueprint
    → runPlannerCommitAndGenerateWeekly
      → generateWeeklyStructure (boltPipelineService / generate-weekly-structure)
        → Reads twelve_week_plan blueprint
        → Inserts daily_content_plans
    → Update campaigns: current_stage=execution_ready, blueprint_status=ACTIVE
  → Redirect: /campaign-calendar/[campaignId]
```

### Database Writes

| Table | When |
|-------|------|
| **campaigns** | Create or update; start_date, duration_weeks, current_stage, blueprint_status |
| **campaign_versions** | Insert snapshot (new campaign) |
| **twelve_week_plan** | Via saveStructuredCampaignPlan + commitDraftBlueprint |
| **daily_content_plans** | Via generateWeeklyStructure |

### Key Files

- `pages/api/campaigns/planner-finalize.ts`
- `backend/services/boltPipelineService.ts` — runPlannerCommitAndGenerateWeekly
- `pages/api/campaigns/generate-weekly-structure.ts` — generateWeeklyStructure

---

## 8. AI Planner Command Flow

### Current Behavior

- **Free-form plan generation.** AI chat sends natural language `message`; no structured command protocol.
- **API:** POST /api/campaigns/ai/plan with `mode: 'generate_plan'`, `message`, `idea_spine`, `strategy_context`
- **Backend:** runCampaignAiPlan uses message as part of prompt context; LLM returns plan text; parsed to weeks.
- **Response:** `plan.weeks[]` — structured weeks with theme, execution_items, daily_execution_items.
- **Planner update:** weeksToCalendarPlan → setCampaignStructure, setCalendarPlan.

### Structured Commands

- **No.** No explicit "add week", "change platform", "set content_type" commands.
- AI interprets user intent and returns full or partial plan; client replaces calendar_plan with result.

---

## 9. Platform Configuration Support

### Current State

| Source | Scope | Used By Planner? |
|--------|-------|------------------|
| **PLATFORM_OPTIONS** | backend/constants/platforms.ts | Yes — hardcoded list |
| **platform_configurations** (DB) | Global; is_enabled, posting_limits, content_limits | No — planner uses constants |
| **Company platforms** | external_apis, company profile URLs | boltPipelineService (generate); planner does not filter |
| **platformEligibility** | company-configured platforms | campaignAiOrchestrator (optional); planner passes through |

### Verdict

- Planner uses **hardcoded** PLATFORM_OPTIONS (linkedin, twitter, youtube, instagram, blog, etc.).
- **No company-scoped platform filtering** in planner UI.
- BOLT pipeline checks company-configured platforms before generation; planner does not.

---

## 10. Refactor vs Replace Recommendations

### KEEP

| Part | Reason |
|------|--------|
| **plannerSessionStore** | Solid state model; localStorage persist; campaign_design / execution_plan structure reusable |
| **calendarPlanConverter** | Clean conversion; extend for new activity fields (execution_mode, campaign_type) |
| **PlannerEntryRouter** | Entry mode parsing; recommendation/opportunity/campaign routing |
| **FinalizeSection → planner-finalize** | Finalization pipeline is correct; same flow for Text/Creator/Hybrid |
| **runPlannerCommitAndGenerateWeekly** | Shared with BOLT; no change |
| **activity-workspace content API** | generate_master, generate_variants; extend for creator workflows |
| **ChatVoiceButton** | Already in AIPlanningAssistantTab |

### REFACTOR

| Part | Changes Needed |
|------|----------------|
| **CampaignParametersTab** | Add campaign_type selector (Text / Creator / Hybrid); expand content types (webinar, podcast); respect company platforms |
| **PlanningCanvas** | Add execution_mode badge per activity; support creator placeholder (upload link vs AI) |
| **calendarPlanConverter** | Map execution_mode, campaign_type from API weeks; pass through creator_card when present |
| **AIPlanningAssistantTab** | Optionally add structured commands (add_week, change_platform); keep free-form as primary |
| **CampaignContextBar** | Add company context mode, focus modules, campaign type (per gap analysis) |
| **campaignAiOrchestrator** | Ensure execution_mode set per content_type; creator_card in daily layer |

### REPLACE

| Part | Reason |
|------|--------|
| **Campaign type selection** | New: Text / Creator / Hybrid at planner entry; drives skeleton and workspace behavior |
| **Creator activity workspace flow** | New: brief + upload/asset link instead of AI generation for video, carousel, etc. |
| **Platform source in planner** | Replace PLATFORM_OPTIONS with company-enabled platforms (from external_apis or config API) |

### New Components Required

| Component | Purpose |
|-----------|---------|
| **CampaignTypeSelector** | Text / Creator / Hybrid at start of planner |
| **CreatorActivityCard** | Placeholder for creator slot: brief, upload link, status |
| **CompanyPlatformFilter** | Fetch company platforms; filter PLATFORM_OPTIONS in Parameters tab |

---

## Summary: Support for Three Campaign Types

| Type | Skeleton | Content Creation | Repurposing |
|------|----------|------------------|-------------|
| **Text** | ✅ Current | ✅ generate_master → platform variants | ✅ Existing |
| **Creator** | ⚠️ Partial (content_type exists) | ⚠️ creator_card, buildCreatorInstruction; no upload flow | ⚠️ Variants from master; need creator master as source |
| **Hybrid** | ⚠️ Mix of AI + creator slots | ⚠️ execution_mode AI/CREATOR per slot | ✅ Same |

**Gaps for full Creator + Hybrid support:**
1. campaign_type at planner level (Text / Creator / Hybrid)
2. Creator slot workflow: brief → creator uploads → repurpose from creator asset
3. Company platform config in planner
4. execution_mode explicitly set and displayed per activity

# BOLT Strategic Card → Campaign Creation Flow — Audit Report

**Objective:** Audit the existing BOLT implementation used by the Trend Campaign button on Strategic Cards and determine what can be reused for starting campaign creation from the planner.

**Date:** 2025-03-12

---

## 1. Strategic Card Components

### File Paths and Component Names

| Component | File Path | Purpose |
|-----------|-----------|---------|
| **RecommendationBlueprintCard** | `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Renders strategic theme cards; handles Build Campaign Blueprint and BOLT Fast actions |
| **TrendCampaignsTab** | `components/recommendations/tabs/TrendCampaignsTab.tsx` | Main tab that renders cards, generates themes, provides `onBuildCampaignBlueprint` and `onBuildCampaignFast` handlers |
| **OpportunityCard** | `components/opportunities/OpportunityCard.tsx`, `components/OpportunityCard.tsx` | Opportunity cards (different from strategic theme cards) |
| **InsightCard** | `components/engagement/ContentInsightsPanel.tsx` | Local `InsightCard` for content insights (not strategic cards) |

### Button Handler Functions

| Button | Handler Prop | Implementation Location |
|--------|--------------|-------------------------|
| **Build Campaign Blueprint** | `onBuildCampaignBlueprint` | `RecommendationBlueprintCard` line 767, 1046 — `onClick={() => run(onBuildCampaignBlueprint)}` |
| **BOLT Fast / Start this campaign** | `onBuildCampaignFast` | `RecommendationBlueprintCard` line 778, 826, 1057, 1105 — `run(() => onBuildCampaignFast?.(...))` |

Both handlers are passed from **TrendCampaignsTab** (lines 2116–2243 for `onBuildCampaignBlueprint`, 2244+ for `onBuildCampaignFast`).

---

## 2. Trend Campaign Button Flow

### onClick Handler Logic

**When `generatedCampaignId` exists (campaign pre-created at "Generate Strategic Themes"):**
1. `PUT /api/campaigns/{generatedCampaignId}/source-recommendation` with `source_strategic_theme`, `execution_config`
2. `router.push(/campaign-details/{createdCampaignId}?...)` → lands on **campaign-details** (AI Chat page)

**When `generatedCampaignId` is absent:**
1. `router.push(/campaign-planner?companyId=X&recommendationId=Y)` → lands on **campaign-planner**
2. No API call; navigation only.

### Routes Opened

| Scenario | Route | Page |
|----------|-------|------|
| Build Blueprint (pre-created campaign) | `/campaign-details/{id}?companyId=&fromRecommendation=1&recommendationId=` | Campaign Details with AI Chat |
| Build Blueprint (no pre-created campaign) | `/campaign-planner?companyId=&recommendationId=` | Campaign Planner |
| BOLT Fast | POST/PUT + optional plan API + redirect to `campaign-details` or BOLT progress modal | BOLT pipeline or campaign-details |

### API Endpoints Triggered

| Action | Endpoint | When |
|--------|----------|------|
| Save card to campaign | `PUT /api/campaigns/[id]/source-recommendation` | Build Blueprint, existing campaign |
| Create campaign + save card | `POST /api/campaigns` | Build Blueprint, no pre-created campaign (legacy path; **replaced by planner redirect** in clean migration) |
| BOLT Fast | `POST /api/campaigns` or `PUT source-recommendation` with `mode: "fast"` + `POST /api/campaigns/ai/plan` | onBuildCampaignFast |

---

## 3. Campaign Planner Entry Point

### Session State Management

| File | Purpose |
|------|---------|
| `components/planner/plannerSessionStore.ts` | React Context + localStorage; company-scoped key `omnivyra_planner_session_{companyId}` |
| `store/campaignWizardStore.ts` | When `ENABLE_UNIFIED_CAMPAIGN_WIZARD`: mirrors planner state via `hydrateWizardFromPlannerStore` |

### Data Fields Initialized

From `plannerSessionStore`:

- `idea_spine` — title, description, refined_title, refined_description, selected_angle
- `strategy_context` — duration_weeks, platforms, posting_frequency, content_mix, campaign_goal, target_audience, planned_start_date
- `campaign_design` — idea_spine, campaign_brief, company_context_mode, focus_modules
- `execution_plan` — strategy_context, calendar_plan, activity_cards
- `campaign_structure` — phases (label, week_start, week_end, objective, content_focus, cta_focus)
- `calendar_plan` — weeks, days, activities
- `source_ids` — recommendation_id, campaign_id, source_opportunity_id

### Store Structure

- **PlannerSessionProvider** wraps the planner page
- **PlannerEntryRouter** parses URL: `mode`, `recommendationId`, `campaignId`, `opportunityId`, `sourceTheme`, `initialIdea`
- **Entry modes:** `direct` | `turbo` | `recommendation` | `campaign` | `opportunity`

### Gap: Recommendation Prefill

When navigating with **only** `recommendationId` (no `sourceTheme` in URL), `source_theme` is null. The planner does **not** fetch the recommendation by ID to prefill `CampaignContextBar`. `recommendation_context` comes from `context.source_theme`, which is only set when `query.sourceTheme` is present. **Recommendation:** Add a `useEffect` in `campaign-planner` or `CampaignContextBar` to fetch `GET /api/recommendations/[id]` (or equivalent) when `recommendationId` is present and `source_theme` is null.

---

## 4. AI Chat Integration

### Chat Components

| Component | File | Role |
|-----------|------|------|
| **AIPlanningAssistantTab** | `components/planner/AIPlanningAssistantTab.tsx` | Planner AI chat: text + voice input |
| **StrategyAssistantPanel** | `components/planner/StrategyAssistantPanel.tsx` | Hosts Parameters, AI Assistant, Opportunity Insights tabs |
| **CampaignAIChat** | `components/CampaignAIChat.tsx` | Campaign-details AI Chat (different from planner) |

### Chat Input Handler

- **AIPlanningAssistantTab:** `handleSend()` — validates companyId, idea_spine; calls `POST /api/campaigns/ai/plan` with `message`, `idea_spine`, `strategy_context`, `company_context_mode`, `focus_modules`
- On success: `weeksToCalendarPlan(data.plan.weeks)` → `setCampaignStructure` + `setCalendarPlan`

### AI API Endpoint

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/campaigns/ai/plan` | POST | Generates plan; mode `generate_plan`, `preview_mode: true` |

### Planner Update Logic

- Response `data.plan.weeks` → `weeksToCalendarPlan()` → `campaign_structure` + `calendar_plan` in planner session
- Used by: `AIPlanningAssistantTab`, `CampaignParametersTab` (Generate Calendar Structure), `CalendarPlannerStep`

---

## 5. Voice Input Support

### Components

| Component | File | Used By |
|-----------|------|---------|
| **ChatVoiceButton** | `components/ChatVoiceButton.tsx` | AIPlanningAssistantTab, CampaignAIChat, AIChat, GPTAIChat, MultiAIChat, community-ai ChatPanel |
| **VoiceNotesComponent** | `components/VoiceNotesComponent.tsx` | DailyPlanningInterface, ContentCreationPanel, campaign-planning, recommendations |

### Integration in Planner

- **AIPlanningAssistantTab** uses `ChatVoiceButton` with `onTranscription={setMessage}` — transcript populates the text input; user clicks Send to submit
- **VoiceNotesComponent** is for voice notes (record → transcribe → save); not used in planner chat

### Routing to AI Planner Chat

- **ChatVoiceButton** uses browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
- Output is pushed to `onTranscription(text)` → in planner, `setMessage(text)` → same flow as text input
- **Can be reused:** Yes. Voice input is already wired to planner chat.

---

## 6. Skeleton Structure Generation

### Service Files

| File | Purpose |
|------|---------|
| `backend/services/campaignAiOrchestrator.ts` | `runCampaignAiPlan()` — builds prompt, calls LLM, parses plan, produces `execution_items`, `resolved_postings`, `daily_execution_items` |
| `pages/api/campaigns/ai/plan.ts` | API handler; calls `runCampaignAiPlan` with `CampaignAiMode.generate_plan` |
| `components/planner/calendarPlanConverter.ts` | `weeksToCalendarPlan(weeks)` — converts API weeks to `campaign_structure` + `calendar_plan` |
| `backend/services/deterministicWeeklySkeleton.ts` | Builds skeleton from `platform_content_requests` when provided |
| `backend/services/campaignPlanParser.ts` | `parseAiPlanToWeeks()` — parses LLM output into structured weeks |

### Data Model

AI plan output includes:
- `platform` — per slot
- `content_type` — post, video, blog, carousel, etc.
- `day_of_week` — via `day_index` in topic_slots
- `posting_frequency` — from `strategy_context.posting_frequency` (per platform)
- `topics_to_cover` — per week
- `execution_items`, `daily_execution_items` — for generate-weekly-structure

**Verification:** AI responses define platform, content_type, day, posting_frequency via orchestrator output.

---

## 7. Planner Calendar Rendering

### Calendar Components

| Component | File | Role |
|-----------|------|------|
| **PlanningCanvas** | `components/planner/PlanningCanvas.tsx` | Views: Campaign (phases), Month, Week, Day; activity cards from `calendar_plan` |
| **CalendarPlannerStep** | `components/planner/CalendarPlannerStep.tsx` | Legacy step-based planner; finalize button |
| **campaign-calendar** | `pages/campaign-calendar/[id].tsx` | Post-finalize calendar (different from planner) |

### Data Sources

- `state.campaign_structure` — phases for Campaign view
- `state.calendar_plan` — weeks, days, activities for Month/Week/Day views
- `strategy_context.planned_start_date` — for date calculations

### Calendar Capabilities

- **Day-level placeholders:** Yes — `CalendarPlanDay` with `activities: CalendarPlanActivity[]`
- **Platform tags:** Yes — `activity.platform` on each activity
- **Activity types:** Yes — `activity.content_type`, `activity.theme`, `activity.title`

---

## 8. Campaign Finalization Flow

### Files Handling Finalization

| File | Role |
|------|------|
| `pages/api/campaigns/planner-finalize.ts` | POST handler: creates campaign, saves blueprint, runs `runPlannerCommitAndGenerateWeekly`, updates status |
| `components/planner/FinalizeSection.tsx` | Calls `POST /api/campaigns/planner-finalize` with companyId, idea_spine, strategy_context |
| `components/planner/CalendarPlannerStep.tsx` | Legacy step UI; also calls planner-finalize |

### Database Tables

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign row |
| `campaign_versions` | Snapshot (campaign_snapshot) |
| `twelve_week_plan` | Blueprint weeks (via `saveStructuredCampaignPlan` + `commitDraftBlueprint`) |
| `daily_content_plans` | Daily slots (via `runPlannerCommitAndGenerateWeekly` → `generateWeeklyStructure`) |

### Flow

1. User clicks **Finalize Campaign Plan**
2. `POST /api/campaigns/planner-finalize` with companyId, idea_spine, strategy_context
3. Creates campaign (if new), builds weeks from strategy
4. `saveStructuredCampaignPlan` + `commitDraftBlueprint` → `twelve_week_plan`
5. `runPlannerCommitAndGenerateWeekly` → `generateWeeklyStructure` → inserts `daily_content_plans`
6. Updates campaign: `current_stage: 'execution_ready'`, `blueprint_status: 'ACTIVE'`
7. Returns `campaign_id` → client redirects to `/campaign-calendar/{id}`

---

## 9. Reusable Components for New Campaign Entry

| Component | Reusable For | Notes |
|-----------|--------------|-------|
| **RecommendationBlueprintCard** | Card display, button handlers | Pass `onBuildCampaignBlueprint` / `onBuildCampaignFast` |
| **PlannerEntryRouter** | Entry mode, query parsing | Supports recommendation, campaign, opportunity, direct, turbo |
| **CampaignContextBar** | Idea, audience, goal, refine | Accepts `recommendation_context`, `opportunity_context`, `initial_idea` |
| **StrategyAssistantPanel** | Parameters, AI Assistant, Opportunities | Already on campaign-planner |
| **AIPlanningAssistantTab** | AI chat for plan refinement | Voice + text; calls ai/plan |
| **ChatVoiceButton** | Voice input | Reusable; `onTranscription` callback |
| **PlanningCanvas** | Phase + calendar views | Source: plannerSessionStore |
| **FinalizeSection** | Generate Preview, Finalize | Calls planner-finalize |
| **CampaignParametersTab** | Duration, platforms, frequency | Generate Calendar Structure |
| **plannerSessionStore** | Session state | company-scoped, localStorage persist |

---

## 10. Missing Components Required for Skeleton Creation

### Gaps Identified

| Gap | Description | Recommendation |
|-----|-------------|----------------|
| **Recommendation prefetch** | When entering planner with `recommendationId` only, `source_theme` is null; no API fetch to load recommendation | Add fetch in campaign-planner or CampaignContextBar: `GET /api/recommendations/[id]` or recommendations state API; set `recommendation_context` from response |
| **sourceTheme in URL** | Build Blueprint navigates with only `recommendationId`; theme data not passed | Either (a) fetch recommendation by ID on planner load, or (b) pass `sourceTheme` as JSON in URL (large payload risk) |
| **Execution config to planner** | Trend tab has execution_config (audience, frequency, duration, goal); planner does not | Pass execution_config in URL or fetch; or add Execution Configuration section to planner |
| **BOLT Fast from planner** | BOLT Fast runs from card; planner has no "BOLT Fast" equivalent | Reuse BOLT pipeline via planner-finalize or add "Quick Launch" option that invokes same pipeline |
| **Strategic theme persistence** | When from recommendation: save `source_strategic_theme` to campaign on finalize | planner-finalize already creates campaign; add `source_strategic_theme` + `source_recommendation_id` to snapshot when `recommendationId` present |

### Optional Enhancements

- **Company context mode selector** — Full / Focused / No Context / Trend (see CAMPAIGN-PLANNER-MISSING-SECTIONS-GAP-ANALYSIS.md)
- **Campaign type** — Lead gen, Brand awareness, etc. (from Trend tab)
- **Strategic aspect + offerings** — From company profile (Trend tab has these)

---

## Summary: BOLT vs Planner Paths

| Path | Entry | Flow | Exit |
|------|-------|------|------|
| **BOLT (Build Blueprint, pre-created campaign)** | Trend tab card | PUT source-recommendation → campaign-details | AI Chat, regenerate-blueprint |
| **BOLT (Build Blueprint, no campaign)** | Trend tab card | Navigate to campaign-planner | User completes planner → Finalize → campaign-calendar |
| **BOLT Fast** | Trend tab card | POST/PUT + plan API + BOLT pipeline | campaign-details or BOLT modal |
| **Planner (direct)** | Dashboard / Create Campaign | campaign-planner | Finalize → campaign-calendar |
| **Planner (recommendation)** | Build Blueprint (no campaign) | campaign-planner?recommendationId= | Same; **prefill incomplete** without recommendation fetch |

---

## Data Flow Diagram

```
TREND TAB STRATEGIC CARD
        │
        ├─ [Build Campaign Blueprint] ────────────────────────────────────┐
        │   │                                                              │
        │   ├─ generatedCampaignId?                                        │
        │   │   YES → PUT source-recommendation                            │
        │   │        → router.push(/campaign-details/{id})                  │
        │   │        → CampaignAIChat                                       │
        │   │                                                              │
        │   │   NO  → router.push(/campaign-planner?companyId=&recommendationId=)
        │   │        → PlannerEntryRouter                                  │
        │   │        → CampaignContextBar (recommendation_context=null ⚠️)  │
        │   │        → PlanningCanvas + StrategyAssistantPanel              │
        │   │        → FinalizeSection → POST planner-finalize              │
        │   │        → runPlannerCommitAndGenerateWeekly                    │
        │   │        → daily_content_plans                                  │
        │   │        → redirect /campaign-calendar/{id}                    │
        │   │                                                              │
        └─ [BOLT Fast] → POST/PUT + mode:fast → plan API → BOLT pipeline   │
                                                                           │
PLANNER AI ASSISTANT                                                        │
  User text/voice → handleSend → POST /api/campaigns/ai/plan                │
  → runCampaignAiPlan → weeks → weeksToCalendarPlan                         │
  → setCampaignStructure + setCalendarPlan → PlanningCanvas                 │
```

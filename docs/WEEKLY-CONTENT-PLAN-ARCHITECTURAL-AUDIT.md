# Weekly Content Plan — Architectural Audit Report

**Scope:** How weekly content plans are generated, validated, and transformed into activities.  
**Date:** 2025-03-02  
**No code was modified; this is a read-only audit.**

---

## 1. System Entry Points

### 1.1 Weekly plan generation

| Entry point | File(s) | Main function / behavior |
|-------------|---------|---------------------------|
| **AI plan (primary)** | `pages/api/campaigns/ai/plan.ts` | POST handler: loads `campaign_planning_inputs`, builds `deterministicPlanningContext`, calls `runCampaignAiPlan()`. Persists via `saveAiCampaignPlan()`, `saveDraftBlueprint(fromStructuredPlan(result.plan.weeks))`. |
| **Orchestrator** | `backend/services/campaignAiOrchestrator.ts` | `runCampaignAiPlan()` → `runCampaignAiPlanWithPrefill()` → `runWithContext()`. Builds deterministic skeleton when `platform_content_requests` present; merges skeleton `execution_items` into structured weeks; returns `plan.weeks`. |
| **Recommendation → campaign** | `pages/api/recommendations/[id]/create-campaign.ts` | Creates campaign + version, then calls `runCampaignAiPlan({ mode: 'generate_plan', message: ... })` with recommendation context. No direct weekly_plan persistence; plan lives in draft blueprint from orchestrator response. |
| **Blueprint from strategy (Flow A)** | `backend/services/recommendationBlueprintService.ts` | `buildCampaignBlueprint(strategySequence, campaignDurationWeeks)` builds `CampaignBlueprint` from strategy ladder (awareness → education → authority → conversion). Used when campaign is driven by recommendation engine / strategy sequence, not chat. |
| **Commit / expand** | `pages/api/campaigns/[id]/commit-plan.ts`, `pages/api/campaigns/[id]/expand-to-week-plans.ts` | Commit writes to `twelve_week_plan`; expand writes to `weekly_content_refinements` from blueprint. |

**Data models:**  
- **CampaignBlueprint** (`backend/types/CampaignBlueprint.ts`): `campaign_id`, `duration_weeks`, `weeks: CampaignBlueprintWeek[]`.  
- **CampaignBlueprintWeek:** `week_number`, `phase_label`, `primary_objective`, `topics_to_cover`, `platform_allocation`, `content_type_mix`, `execution_items?`, `posting_execution_map?`, `resolved_postings?`, etc.  
- **WeeklyBlueprintEntry** (recommendation flow): `week_number`, `stage`, `stage_objective`, `psychological_goal`, `primary_recommendations`, `supporting_recommendations`, `week_goal`, `topics_to_cover`, `content_mix`, `execution_intent`.

### 1.2 Strategy / theme generation

| Source | File(s) | Notes |
|--------|--------|--------|
| **AI plan prompt** | `backend/services/campaignAiOrchestrator.ts` | LLM generates plan text with week theme, phase_label, topics_to_cover; parsed by `parseAiPlanToWeeks()` in `campaignPlanParser.ts`. |
| **Strategy sequence → blueprint** | `backend/services/recommendationBlueprintService.ts` | `buildCampaignBlueprint()` maps strategy ladder to weeks; themes/topics from `buildWeekTopics()`, `buildWeekGoal()` using recommendation + company problem transformation. |
| **Recommendation context** | Passed as `recommendationContext` into `runCampaignAiPlan()` | Used for alignment (messaging_hooks, campaign_angle, pain_symptoms) when building deterministic `execution_items` intent. |

### 1.3 User questionnaire / planning inputs

| Entry point | File(s) | Main function / data |
|-------------|--------|----------------------|
| **Persistence** | `backend/services/campaignPlanningInputsService.ts` | `getCampaignPlanningInputs(campaignId)`, `saveCampaignPlanningInputs()`. Table: `campaign_planning_inputs`. Fields: `recommendation_snapshot`, `available_content`, `weekly_capacity`, `exclusive_campaigns`, `selected_platforms`, `platform_content_requests`, `planning_stage`, `is_completed`. |
| **Collection (chat)** | `pages/api/campaigns/ai/plan.ts` | Builds `finalCollectedPlanningContext` from DB + `collectedPlanningContext` + extraction from `conversationHistory` (e.g. `extractLatestAnswer('content_capacity')`). Persists to `campaign_planning_inputs` when `shouldPersistPlanningInputs`. |
| **QA state** | `backend/chatGovernance/CampaignPlanningQAState.ts` | `computeCampaignPlanningQAState()` drives “required keys” and next question (e.g. content_capacity, platforms, platform_content_requests). |

**Relevant keys:** `target_audience`, `audience_professional_segment`, `communication_style`, `action_expectation`, `content_depth`, `topic_continuity`, `available_content`, `weekly_capacity` (content capacity), `exclusive_campaigns`, `selected_platforms`, `platform_content_requests`.

### 1.4 Content scheduling

| Entry point | File(s) | Notes |
|-------------|--------|--------|
| **Structured plan → schedule** | `backend/services/structuredPlanScheduler.ts` | `buildAllocationSchedule()` expands `platform_allocation` into day/slot list; used for legacy/snapshot scheduling. |
| **Scheduler payload API** | `pages/api/campaigns/scheduler-payload.ts` | Resolves `getResolvedCampaignPlanContext()`, finds week plan, returns payload for scheduler. |
| **Platform execution plans** | `backend/db/platformExecutionStore.ts` | `savePlatformExecutionPlan()`, `getLatestPlatformExecutionPlan()` — store `plan_json` per company/campaign/week. |
| **Commit weekly plan** | `pages/api/campaigns/commit-weekly-plan.ts` | Updates `weekly_content_refinements` to finalized; optionally inserts generic rows into `daily_content_plans` (simple loop over days × platforms, not topic-aligned). |

### 1.5 Activity / card creation

| Entry point | File(s) | Notes |
|-------------|--------|--------|
| **Daily plan generation** | `pages/api/campaigns/generate-weekly-structure.ts` | For a given week: loads blueprint, builds `DailyPlanItem[]` either from **AI** (`generateAIDailyDistribution`) or from blueprint **execution_items** (deterministic); validates/enriches each item; inserts into `daily_content_plans`. One row per (platform × item) with `content` = JSON of enriched daily item. |
| **Activity workspace resolve** | `pages/api/activity-workspace/resolve.ts` | Resolves activity by `executionId`: finds item in `blueprint.weeks[].execution_items` or `daily_execution_items`; returns workspace payload. So “card” identity for deep link is from blueprint execution items when present. |
| **Daily plan list** | `pages/api/campaigns/daily-plans.ts` | GET: reads `daily_content_plans` by `campaign_id`, maps to UI shape (weekNumber, platform, contentType, title, topic, dailyObject, etc.). |
| **Daily planning UI** | `components/DailyPlanningInterface.tsx` | Loads activities from daily-plans API; maps to `DailyActivity` with `dailyExecutionItem`; commit via `/api/campaigns/commit-daily-plan`, save via `/api/campaigns/save-week-daily-plan`. |

**Data models:**  
- **daily_content_plans:** `campaign_id`, `week_number`, `day_of_week`, `date`, `platform`, `content_type`, `title`, `content` (JSON), `topic`, etc.  
- **DailyPlanItem** (generate-weekly-structure): `dayIndex`, `weekNumber`, `topicTitle`, `topicReference`, `platformTargets`, `contentType`, `dailyObjective`, `writerBrief`, `contentGuidance`, etc.  
- Enriched content stored in `content` includes platform validation, `writer_content_brief`, `intent`, and optional `execution_id` when derived from execution_items path.

---

## 2. Data Flow Map

### 2.1 High-level pipeline

```
Strategic theme / recommendation
        ↓
User inputs (campaign_planning_inputs: platforms, weekly_capacity, platform_content_requests, etc.)
        ↓
Validation (capacity vs expectation; deterministic skeleton capacity check)
        ↓
Weekly plan generator (AI parse or strategy blueprint + optional deterministic execution_items merge)
        ↓
Blueprint storage (twelve_week_plan.blueprint or campaign_snapshot.weekly_plan / weekly_content_refinements)
        ↓
Daily plan expansion (generate-weekly-structure: AI distribution or execution_items → daily_content_plans)
        ↓
Activity cards (daily_content_plans rows + optional blueprint daily_execution_items for resolve)
```

### 2.2 Step-by-step

**Step 1 — Strategic theme**  
- **Inputs:** Recommendation snapshot, company context, strategy ladder (Flow A) or user message + recommendation context (Flow B).  
- **Transform:** Either `buildCampaignBlueprint()` (strategy → weekly_plan) or LLM in orchestrator (prompt → raw plan text).  
- **Output:** Theme per week (phase_label, theme, topics_to_cover).

**Step 2 — User inputs**  
- **Inputs:** Chat conversation, existing `campaign_planning_inputs` row.  
- **Transform:** `getCampaignPlanningInputs()`, extract from history (`detectAskedKey`, `extractLatestAnswer`), normalize capacity (`normalizeCapacityCountsWithBreakdown`).  
- **Output:** `collectedPlanningContext` / `prefilledPlanning` with `platform_content_requests`, `weekly_capacity`, `available_content`, `exclusive_campaigns`, etc.

**Step 3 — Validation**  
- **Capacity vs expectation:** `validateCapacityVsExpectation()` in `capacityExpectationValidator.ts`. Compares `requested_total` (from `platform_content_requests`, cross_platform_sharing-aware) to `supply_total` = `available_content_total + effective_capacity_total` (capacity − exclusive_campaigns). Sets `status: 'invalid'` and `suggested_adjustments` when deficit > 0.  
- **Deterministic skeleton:** `buildDeterministicWeeklySkeleton()` in `deterministicWeeklySkeleton.ts`. Requires non-empty `platform_content_requests`; computes `total_weekly_content_count` and `platform_postings_total`; enforces `total_weekly_content_count <= availableTotal + capacityTotal` unless `override_confirmed`. Throws `DeterministicWeeklySkeletonError` with details on exceed.  
- **Blueprint structural:** `validateCampaignBlueprint()` in `recommendationBlueprintValidationService.ts`. Week count vs duration, stage/momentum progression, recommendation integrity, empty-week fill. No capacity or frequency vs capacity check.

**Step 4 — Weekly plan generator**  
- **Inputs:** Prefilled planning context, optional deterministic skeleton, duration, recommendation context.  
- **Transform:**  
  - LLM generates plan text; `parseAiPlanToWeeks()` → structured weeks (platform_allocation, content_type_mix, topics_to_cover, etc.).  
  - If `hasDeterministicPlanSkeleton`: skeleton’s `execution_items` are merged into each week (topics from AI matched to skeleton slots; intent filled with objective, cta_type, target_audience, recommendation_alignment, etc.); then `resolved_postings` and `daily_execution_items` built from execution_items.  
  - Fallback: `buildPlaceholderPlanFromSkeleton()` when parse/validation fails.  
- **Output:** `structured.weeks` with optional `execution_items`, `resolved_postings`, `daily_execution_items` per week.

**Step 5 — Blueprint storage**  
- **Inputs:** `result.plan.weeks` from orchestrator.  
- **Transform:** `fromStructuredPlan({ weeks, campaign_id })` → `CampaignBlueprint`; `saveDraftBlueprint()`.  
- **Output:** `twelve_week_plan` row (blueprint, weeks). Resolution order: `getUnifiedCampaignBlueprint()` → twelve_week_plan.blueprint → campaign_versions.campaign_snapshot.weekly_plan → weekly_content_refinements.

**Step 6 — Daily plan expansion**  
- **Inputs:** Campaign id, week number, blueprint week, campaign start_date.  
- **Transform:**  
  - If week has `execution_items` with filled `topic_slots`: build `DailyPlanItem[]` from them (spread slots across days, keep intent).  
  - Else: `generateAIDailyDistribution()` (dailyContentDistributionPlanService) returns slots (day_index, short_topic, full_topic, platform, content_type, reasoning); map to `DailyPlanItem[]`.  
  - For each item × platform: validate with `validateDailyItemAgainstPlatformRules`, enrich with `enrichDailyItemWithPlatformRequirements`, then insert row into `daily_content_plans` with `content` = JSON(enriched).  
- **Output:** Rows in `daily_content_plans` for that week.

**Step 7 — Activity cards**  
- **Inputs:** `daily_content_plans` (and optionally blueprint `daily_execution_items` for execution_id lookup).  
- **Transform:** Daily-plans API maps rows to UI shape; DailyPlanningInterface maps to activities with `dailyExecutionItem`. Activity workspace resolve finds by `executionId` in blueprint weeks’ execution_items / daily_execution_items.  
- **Output:** User-visible cards; deep link by execution_id when item exists in blueprint.

---

## 3. Validation Logic Summary

### 3.1 Where it runs

| Validation | Where it runs | Trigger |
|------------|----------------|--------|
| **Capacity vs expectation** | `capacityExpectationValidator.validateCapacityVsExpectation()` | Called in `campaignAiOrchestrator` when `mode === 'generate_plan'`; result attached to `prefilledPlanning.validation_result`. |
| **Deterministic skeleton capacity** | `deterministicWeeklySkeleton.buildDeterministicWeeklySkeleton()` | Called in orchestrator when `platform_content_requests` present and validation not invalid (or override). Throws if requested > available + capacity. |
| **Blueprint structure** | `recommendationBlueprintValidationService.validateCampaignBlueprint()` | Used for recommendation/strategy blueprint path; not in the main AI plan API path. |
| **Platform/content type** | `platformExecutionValidator.validateDailyItemAgainstPlatformRules()` | In generate-weekly-structure when building daily rows. |
| **Daily item intent** | Assertions in generate-weekly-structure | When using execution_items: requires topic_slots with intent (objective, target_audience, cta_type, brief_summary, etc.). |

### 3.2 Assumptions

- **Capacity validator:** Treats `weekly_capacity` and `available_content` as totals; `exclusive_campaigns` reduces effective capacity. Assumes `platform_content_requests` is the single source of “requested” volume; supports cross_platform_sharing (unique content count vs sum of postings).  
- **Deterministic skeleton:** Assumes `platform_content_requests` is required and non-empty; uses `platform_master` and `platform_content_rules` for allowed (platform, content_type). Repurposing: when `cross_platform_sharing` is enabled, unique content count per type is max across platforms; `slot_platforms` built so one “slot” can be assigned to multiple platforms.  
- **Blueprint validator:** No notion of user capacity or posting frequency; only week count, stage order, momentum order, primary/supporting recommendation counts and topic dedup.

### 3.3 What is not validated

- **Frequency vs capacity in blueprint validation:** Recommendation blueprint validation does not check that total posts per week or per platform are within any user-declared capacity.  
- **Platform “demand” vs “capacity” in one place:** Capacity vs expectation works on a single total (requested vs supply). It does not enforce per-platform caps or “desired frequency” vs “capacity” by platform.  
- **Consistency of platform_content_requests with blueprint:** After the plan is generated, the saved blueprint’s `platform_allocation` can come from the AI; there is no strict reconciliation that AI’s allocation matches the initial `platform_content_requests` that passed validation.  
- **Commit-weekly-plan daily creation:** The simple daily plan creation in `commit-weekly-plan` (days × platforms × content types) does not validate against capacity or weekly plan; it’s a generic placeholder grid.

### 3.4 Repurposing awareness

- **Deterministic skeleton:** Explicit: `cross_platform_sharing` and `slot_platforms` (which platforms reuse each slot). Unique content count = max per type across platforms when sharing enabled.  
- **Capacity validator:** `computeUniqueWeeklyTotal(rows, sharingEnabled)` uses same idea: when sharing enabled, sum by unique content type (max per type), not sum of all platform postings.  
- **AI parser (campaignPlanParser):** Schema allows `platform_content_breakdown` with `platforms?: ["facebook","linkedin"]` for “same piece on multiple platforms”.  
- **Daily expansion:** When built from execution_items, one item can have multiple `platformTargets`; generate-weekly-structure creates one row per platform for that item (same topic/intent, multiple rows). So repurposing is represented.

**Potential problems:**  
- If user sets high per-platform frequency without enabling cross_platform_sharing, requested_total can exceed capacity even when “one video, four platforms” would be valid.  
- Override (e.g. “proceed anyway”) allows skipping capacity check; no follow-up check when plan is committed.  
- Recommendation/strategy path (buildCampaignBlueprint) does not run capacity or skeleton validation; weekly_plan from that path is not checked against campaign_planning_inputs.

---

## 4. Weekly Plan Structure Analysis

### 4.1 How a weekly plan is structured

**Canonical (CampaignBlueprintWeek):**  
- `week_number`, `phase_label`, `primary_objective`, `topics_to_cover` (strings), `weeklyContextCapsule`, `topics` (WeeklyTopicWritingBrief[]).  
- `platform_allocation`: Record<platform, number> (posts per platform).  
- `content_type_mix`: string[] (e.g. post, video, article).  
- `cta_type`, `weekly_kpi_focus`.  
- Optional: `platform_content_breakdown`, `platform_topics`, `execution_items`, `posting_execution_map`, `resolved_postings`, `week_extras`.

**Legacy (LegacyWeekPlan / get-weekly-plans response):**  
- `week_number`, `phase` / `theme`, `focus_area`, `key_messaging`, `content_types`, `platform_allocation`, `platform_content_breakdown`, `topics_to_cover`, `execution_items`, `posting_execution_map`, `resolved_postings`.

### 4.2 Master content concept

- **Execution_items (deterministic path):** Each item is a content type + selected_platforms + count_per_week + topic_slots. Each slot has topic + intent (objective, cta_type, target_audience, brief_summary, etc.). So “master content” is the slot (one piece of content) with optional multi-platform distribution via `slot_platforms` / multiple platforms in the item.  
- **AI-only path:** No explicit “master content” entity; only platform_allocation and content_type_mix. platform_content_breakdown in parser can express “same piece” via `platforms: ["facebook","linkedin"]`, but the stored blueprint may not always carry that through from the AI output.

### 4.3 Platform-first vs content-first

- **Stored shape:** Largely platform-first: `platform_allocation` and `platform_content_breakdown` are per platform.  
- **Deterministic path:** Content-first at skeleton level: execution_items are (content_type, count_per_week, topic_slots); then slot_platforms assign which platforms get that slot. So when deterministic skeleton is used, the model is content-first with platform distribution.

### 4.4 How videos are handled

- **Schema:** Video is a content type in `content_type_mix`, `platform_content_breakdown`, and in `platform_content_rules` (e.g. linkedin/video, youtube/video).  
- **No storage of video files:** Confirmed: no service stores video binaries; only references, guidance, and metadata.  
- **Guidance:** Weekly/daily intent, writer brief, topic, platform rules; no explicit “video = guidance only” constant, but implementation only deals with metadata and text.

### 4.5 Activities linked or independent

- **From execution_items:** Activities (daily rows) are tied to a slot (topic + intent); one slot can produce multiple rows (one per platform). So they are linked by shared topic/intent and, when present, by execution_id in blueprint.  
- **From AI distribution only:** Slots from AI daily distribution are independent per slot; no shared execution_id in blueprint unless a later path adds it.  
- **Activity workspace resolve:** Depends on blueprint containing `execution_items` or `daily_execution_items` with stable ids; otherwise resolve by executionId can 404. Daily plan list still shows all rows from `daily_content_plans`.

---

## 5. Activity Card Architecture

### 5.1 Where activity cards are created

- **Creation:** Rows are created in `daily_content_plans` by `pages/api/campaigns/generate-weekly-structure.ts`. Each row = one (day, platform, topic/content type) with `content` = JSON of enriched daily item.  
- **Alternative path:** `commit-weekly-plan` with `commitType === 'finalize'` inserts simple rows (day × platform × content type) with generic title/content; not topic-aligned.

### 5.2 Data included on cards

- From **daily_content_plans**: id, week_number, day_of_week, date, platform, content_type, title, topic, objective, content (JSON). JSON includes: topicTitle, dailyObjective, platform, contentType, writer_content_brief, intent, contentGuidance, validation_notes, etc.  
- From **blueprint** (when resolve used): execution_id, same fields plus narrative_role, progression_step, global_progression_index, master_content, platform_variants, etc.

### 5.3 Global context (audience, goals, theme)

- **Weekly:** `weeklyContextCapsule` (campaignTheme, primaryPainPoint, desiredTransformation, campaignStage, psychologicalGoal, momentum, audienceProfile, weeklyIntent, toneGuidance, successOutcome) exists on blueprint week and can be passed into daily distribution/briefs.  
- **Per-slot:** intent (objective, target_audience, pain_point, outcome_promise, cta_type) and recommendation_alignment.  
- **Daily plan rows:** Stored in `content` JSON; audience/goals/theme appear in writer brief and intent, not in a separate “global” field on the row.

### 5.4 Platform-specific adaptations

- **Validation:** `validateDailyItemAgainstPlatformRules()` and `enrichDailyItemWithPlatformRequirements()` use `platformIntelligenceService` / platform rules (content type, character limits, etc.).  
- **Content generation:** `generateContentForDay()` (contentGenerationService) and scheduler payload use platform; no single “platform-specific marketing metadata” object documented in this audit.  
- **Stored:** Platform is on each daily_content_plans row; platform-specific rules applied at validation/enrichment time.

### 5.5 Direct from weekly plan vs transformation layer

- **With execution_items:** Cards are created via a transformation layer: weekly plan (execution_items + topic_slots) → DailyPlanItem[] (spread across days, one per platform) → validate/enrich → insert.  
- **Without execution_items:** Weekly plan (topics, content_type_mix, platform_allocation) → AI daily distribution (slots) → DailyPlanItem[] → same transformation → insert.  
So all cards go through the same transformation layer (generate-weekly-structure); the difference is whether the “weekly” source is execution_items or AI distribution.

---

## 6. Major Gaps vs Target Model

**Target (required) model:**  
1. Content-first planning  
2. Master content → multiple platform distributions  
3. Capacity vs frequency balancing  
4. Platform-specific marketing requirements  
5. Video = guidance only (no storage)  
6. Clear creator visibility cards  

| # | Requirement | Current state | Gap |
|---|-------------|---------------|-----|
| 1 | Content-first planning | Partially present: deterministic path has execution_items (content type + slots + platforms). AI-only path is allocation/topic-driven, not a single “master content” entity. | AI path and saved blueprint often lack explicit “master content” id and single source of truth for one piece used on N platforms. |
| 2 | Master content → multiple platform distributions | Supported: slot_platforms in skeleton; execution_items with selected_platforms; daily expansion creates one row per platform for same slot. | Not consistently exposed in UI/APIs as “one content piece, N platforms”; schema is per-platform. |
| 3 | Capacity vs frequency balancing | Capacity vs expectation and deterministic skeleton both validate requested vs (available + capacity). Frequency is implicit in platform_content_requests counts. | No explicit “desired frequency per platform” vs “production capacity” comparison in one place; override can bypass; strategy path has no capacity check. |
| 4 | Platform-specific marketing requirements | Platform rules and validation exist; platform_content_breakdown and content type mix are stored. | No single “marketing metadata” (hashtags, summaries, creator instructions) model per platform documented end-to-end; scattered in content JSON and services. |
| 5 | Video = guidance only (no storage) | No video file storage found; video is a content type in rules and plans. | No explicit product rule or constant enforcing “video never stored”; could be documented and enforced in one place. |
| 6 | Clear creator visibility cards | Daily plans and activity workspace provide topic, objective, brief, intent. | Creator-focused “card” (theme, keywords, hashtags, summaries, marketing context, instructions) is not a single first-class shape; it’s embedded in content JSON and writer_content_brief. |

---

## 7. Suggested Refactor Zones (no code changes)

1. **Single capacity/frequency gate**  
   Unify “desired posting frequency” and “content production capacity” in one validation step used by all entry points (AI plan, recommendation create, strategy blueprint), and avoid bypass unless an explicit override with audit.

2. **Content-first and master-content id**  
   Introduce an explicit “master content” or “content piece” id in the model (e.g. per execution_item slot or per “piece” in platform_content_breakdown) and ensure daily rows reference it so “one piece, N platforms” is queryable and visible.

3. **Strategy/recommendation path validation**  
   Run capacity/skeleton-style validation when building or persisting blueprint from recommendationBlueprintService or campaign_snapshot.weekly_plan so strategy-driven plans respect campaign_planning_inputs.

4. **Creator card shape**  
   Define a single “creator card” or “creator brief” type (theme, keywords, hashtags, summary, marketing context, instructions, platform-specific notes) and populate it from weekly + daily intent and platform rules; expose it on activity/daily APIs so UIs can show one consistent card.

5. **Commit-weekly-plan daily creation**  
   Replace or narrow the generic (day × platform × content type) insert in commit-weekly-plan with a call to the same logic as generate-weekly-structure (or a clear “placeholder only” path) so committed weeks don’t create plans that ignore capacity and weekly structure.

6. **Execution_id and activity resolve**  
   Ensure every activity created from generate-weekly-structure has a stable execution_id written into the blueprint (or a stable reference from daily_content_plans to blueprint) so activity-workspace resolve and deep links work for all cards, not only those from blueprint execution_items.

7. **Video and “guidance only”**  
   Document and, if desired, enforce in one place (e.g. content asset or plan service) that video content type is guidance/reference only and never stored as binary.

8. **Repurposing in UI/API**  
   Expose “same content, multiple platforms” in get-weekly-plans and daily-plans responses (e.g. shared_content_id or grouping) so clients can show repurposing clearly without re-deriving from slot_platforms or platform_content_breakdown.

---

**End of report.**

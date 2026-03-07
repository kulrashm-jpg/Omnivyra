# Campaign Planning Pipeline — Architectural Audit

**Date:** 2025-03-07  
**Scope:** AI campaign generation in chat → activity workspace execution and content refinement  
**Method:** Strict implementation-state audit — no code changes, no suggestions unless missing or broken.

---

## 1. Campaign Generation Entry

**Prompt file responsible for campaign generation:**
- No standalone prompt file. Prompt is built in-memory by `buildPromptContext()` in `backend/services/campaignAiOrchestrator.ts` (lines ~2452–3049).
- Uses `WEEKLY_BLUEPRINT_OUTPUT_CONTRACT` and related blocks embedded in the orchestrator.
- Supporting prompts: `backend/prompts/weeklyPlan.prompt.ts` (used for different flow — recommendation/bolt), `backend/prompts/dailyDistribution.prompt.ts` (daily distribution only).

**Service responsible for campaign creation:**
- `backend/services/campaignAiOrchestrator.ts` — `runCampaignAiPlan()` → `runWithContext()` → `generateCampaignPlan()` (aiGateway)
- API entry: `pages/api/campaigns/ai/plan.ts` — POST handler calls `runCampaignAiPlan()`

**Database tables storing campaign plan data:**
- `twelve_week_plan` — stores: `campaign_id`, `snapshot_hash`, `mode`, `response`, `omnivyre_decision`, `source`, `weeks` (JSONB), `raw_plan_text`, `blueprint` (JSONB), `refined_day`, `platform_content`, `status`
- `campaigns` — campaign metadata (name, duration_weeks, start_date, etc.)
- `campaign_versions` — snapshot, execution_config; not updated by AI plan API
- `campaign_resource_projection` — upserted from blueprint (week_number, total_posts, platform_allocation)

**Structure used for campaign / weekly_plan / weekly_activity_cards:**
- **Campaign:** `campaigns` table; blueprint in `twelve_week_plan.blueprint`
- **Weekly plan:** `twelve_week_plan.weeks` (JSONB array) — each week: `week`, `phase_label`, `primary_objective`, `platform_allocation`, `content_type_mix`, `cta_type`, `total_weekly_content_count`, `weekly_kpi_focus`, `theme`, `topics_to_cover`, `platform_content_breakdown`, `platform_topics`, `daily` (legacy), `execution_items` (when skeleton)
- **Weekly activity cards:** Not a separate table. Activities are derived from `weeks[].execution_items`, `weeks[].daily_execution_items`, or `weeks[].resolved_postings`, or from `daily_content_plans` rows

---

## 2. Weekly Plan Structure

**Schema used for weekly activities:**

Weekly structure comes from `parseAiPlanToWeeks()` in `backend/services/campaignPlanParser.ts`. Schema (`weeklyBlueprintSchemaBase`):

- `week` (number)
- `phase_label` (string)
- `primary_objective` (string)
- `platform_allocation` (Record<string, number>)
- `content_type_mix` (string[])
- `cta_type` (enum)
- `total_weekly_content_count` (number)
- `weekly_kpi_focus` (enum)
- `theme` (optional string)
- `topics_to_cover` (optional string[])
- `daily` (optional legacy array)
- `platform_content_breakdown` (optional Record<string, PlatformContentItem[]>)
- `platform_topics` (optional Record<string, string[]>)

**Does weekly activity store:**
- **activity_type:** No. No `activity_type` field in weekly blueprint schema or execution_items.
- **platform_targets:** Yes, via `platform_allocation` (counts per platform) and `platform_content_breakdown` (per-platform content items). Execution_items have `selected_platforms` / `selectedPlatforms`.
- **content_type:** Yes — `content_type_mix` at week level; execution_items have `content_type` / `contentType`.
- **execution_category (AI / Hybrid / Creator):** **Does not exist.** No `execution_category` or equivalent in weekly blueprint, execution_items, or data model.

**Exact fields stored in weekly structure:**
- `week`, `phase_label`, `primary_objective`, `platform_allocation`, `content_type_mix`, `cta_type`, `total_weekly_content_count`, `weekly_kpi_focus`, `theme`, `topics_to_cover`, `platform_content_breakdown`, `platform_topics`, `daily` (legacy), `execution_items`, `resolved_postings`, `daily_execution_items`, `distribution_strategy`, `distribution_reason`, `topics` (with writing briefs), `week_extras`

---

## 3. Weekly → Daily Plan Conversion

**Service file:** `pages/api/campaigns/generate-weekly-structure.ts` (also exports `generateWeeklyStructure` for direct use)

**Function responsible for distribution:** `generateWeeklyStructure()` — core logic inside the loop over `weekNumbers` (lines ~707–1491). No separate named “distribution” function; logic is inline.

**Algorithm used:**
- **Path A (execution_items present):** Deterministic. Uses `spreadEvenlyAcrossDays(count, 7)` to assign day indices: `idx0 = Math.round(((i + 0.5) * days) / n - 0.5)`, then `clamped + 1` (1–7). For STAGGERED: each platform gets a different day via `((baseDayIndex - 1 + pi) % 7) + 1`. For non-STAGGERED: all platforms share the same day.
- **Path B (no execution_items — AI path):** Calls `generateAIDailyDistribution()` from `dailyContentDistributionPlanService`. LLM returns `daily_plan[]` with `day_index` (1–7), `short_topic`, `full_topic`, `content_type`, `platform` (or null), `reasoning`. Prompts enforce spread across the week (“Do NOT assign all slots to Monday”).

**Confirmation:**
- **Distributes across all 7 days:** Yes. `spreadEvenlyAcrossDays` uses days=7. AI prompt instructs: “Use at least 5 different days when you have 5+ slots; … spread across Monday=1 through Sunday=7”.
- **Weighted vs fixed:** Deterministic path uses uniform spread (`(i+0.5)*days/n`). AI path uses LLM output; no explicit weights in algorithm.
- **Monday/Friday clustering:** No. Logic explicitly avoids Monday clustering (“Do NOT assign all slots to Monday”). No Monday/Friday weighting or clustering.

**Actual scheduling logic:**
- `spreadEvenlyAcrossDays()` (lines 752–764) — uniform day indices for N slots
- `buildDayTopics()` (lines 223–263) — topic-to-day mapping via weighted distribution when topics < 7
- AI path: `generateDailyDistributionPlan()` in `dailyContentDistributionPlanService` → LLM with `dailyDistribution.prompt.ts`

---

## 4. Daily Plan Structure

**Fields for each daily activity (daily_content_plans row):**
- `campaign_id`, `week_number`, `day_of_week`, `date`
- `platform`, `content_type`, `title`, `content` (JSON string of enriched object)
- `topic`, `objective`, `intro_objective`, `summary`, `cta`, `brand_voice`, `format_notes`
- `scheduled_time`, `posting_strategy`, `status`, `priority`, `ai_generated`, `target_audience`
- `hashtags`, `mentions`, `media_urls`, `media_types`, `required_resources` (from schema; may be null)
- `source_week_content_id`, `source_refinement_id` (schema allows; generate-weekly-structure does **not** set them)

**Content JSON (enriched) includes:**
- `execution_id`, `platform`, `content_type`, `topic`, `brief_summary`, `target_audience`, `objective`, `cta_type`, `global_progression_index`, `writer_brief`, `master_content_id`, `creator_card`, `validation_notes`, `validation_status`, `execution_jobs`, `planned_platform_targets`, `active_platform_targets`, `platform_variants`, etc.

**Does daily activity include:**
- **platform:** Yes — column + in content JSON
- **content_type:** Yes — column + in content JSON
- **activity_origin (weekly_activity_id):** **No.** No `activity_origin` or `weekly_activity_id` field. `source_refinement_id` / `weekly_refinement_id` exist in DB schema but are **not** populated by generate-weekly-structure.

**Content type determination:**
- **A) Weekly generation:** Partially. Weekly has `content_type_mix` and execution_items with `content_type`. AI path uses `content_type_mix` as `contentTypesAvailable`; AI returns `content_type` per slot.
- **B) Daily plan creation:** Yes. In deterministic path, `content_type` comes from `exec.content_type` (execution_items). In AI path, LLM assigns `content_type` per slot; `pickContentType()` fallback only when mix is empty. Content type is finalized during daily expansion.

---

## 5. Activity Workspace Integration

**Service responsible for activity creation:** No dedicated “activity creation” service. Activities are derived from:
- `lib/planning/unifiedExecutionAdapter.ts` — `blueprintItemToUnifiedExecutionUnit()`, `dailyPlanRowToUnifiedExecutionUnit()` map blueprint/daily plans to `UnifiedExecutionUnit`
- Daily plan page / calendar build `GridActivity` / `CalendarActivity` from `daily_execution_items` or `daily_content_plans`; user click → `openActivityWorkspace(activity)` → payload built client-side

**Activity workspace data structure (payload):**
- `campaignId`, `weekNumber`, `day`, `activityId` (execution_id)
- `title`, `topic`, `description`
- `dailyExecutionItem` — raw item with intent, writer_content_brief, platform_variants, master_content, etc.
- `schedules` — array of `{ id, platform, contentType, date, time, status, title }`
- `repurposing_context` — from `buildRepurposingContext()` (group_id, master_title, platforms, sibling_execution_ids)
- `master_content_document` — from `buildMasterContentDocument()` + variant pipeline

**Does activity workspace store:**
- **platform_targets:** Yes — via `dailyExecutionItem.active_platform_targets`, `planned_platform_targets`, `selected_platforms`, `platform_variants`. Used to build schedule rows.
- **content_types_per_platform:** No dedicated field. `contentTypeOptionsByPlatform` is **hardcoded** in `pages/activity-workspace.tsx` (lines 351–360).
- **repurposing_targets:** Repurposing context comes from `buildRepurposingContext()` (master content groups). Targets for “add platform” are derived from `contentTypeOptionsByPlatform` and `getAddablePlatformsForContentType()` — **hardcoded**, not from stored repurposing_targets.

**Repurposing UI generated dynamically from these values:** **No.** Platform/content options are **hardcoded** in `activity-workspace.tsx`. Schedule rows are built from `platform_variants`, `active_platform_targets`, `planned_platform_targets` — but the list of allowed platform/content combinations is static.

---

## 6. Repurposing Window Logic

**Where allowed platform/content combinations are defined:**
- `pages/activity-workspace.tsx`: `contentTypeOptionsByPlatform` (lines 351–360) — hardcoded map
- `backend/services/repurposeGraphEngine.ts`: `PLATFORM_REPURPOSE_CASCADE`, `REPURPOSE_GRAPH` — used for scheduling/repurpose graph, not for UI dropdowns
- `backend/services/contentGenerationPipeline.ts`: `resolvePlatformTargets()` — uses `active_platform_targets`, `planned_platform_targets`, `selected_platforms` from item; fallback to `platform` + `content_type`

**UI windows generated dynamically or statically:** **Statically.** Platform options and content-type options are hardcoded in `activity-workspace.tsx`.

**System locks selections after daily plan creation:** **No.** User can add/remove platforms and content types in the activity workspace. Selections are not locked.

---

## 7. Language Refinement Engine

**Where generated content is passed through refinement:**
- `backend/services/campaignAiOrchestrator.ts` — `refineLanguageOutput()` on `theme`, `primary_objective`, `topics_to_cover` (card_type: `weekly_plan`) after parse, before save
- `backend/services/contentGenerationPipeline.ts` — `refineLanguageOutput()` on blueprint hook, key_points, cta; on AI master content; on each platform variant (card_type: `master_content`, `platform_variant`)
- `pages/api/activity-workspace/content.ts` — `refineLanguageOutput()` on `improve_variant` and `refine_variant` output (card_type: `platform_variant`, `repurpose_card`)
- `backend/services/strategicThemeEngine.ts` — theme titles (card_type: `strategic_theme`)
- `backend/services/dailyContentDistributionPlanService.ts` — imports `refineLanguageOutput` (usage not traced in this audit; may apply to slot text)
- `backend/services/companyProfileService.ts` — problem transformation answers

**Service responsible:** `backend/services/languageRefinementService.ts` — `refineLanguageOutput()`

**Runs automatically after generation:** **Yes**, where integrated. Orchestrator refines weekly plan text before save. Content pipeline refines master content and variants before return. Activity-workspace API refines on refine/improve actions. Gated by `LANGUAGE_REFINEMENT_ENABLED=true`.

**All textual content through refinement:** **No.** Daily distribution short_topic/full_topic, campaign AI raw plan text before parse, and some other flows are not explicitly refined. Only specific surfaces (weekly plan theme/objective/topics, master content, platform variants, refine/improve actions) are integrated.

---

## 8. Execution Category Support

**Current support for categorizing activities:**
- **Fully AI Executed**
- **Hybrid (AI + Creator)**
- **Creator Dependent**

**Data model:** `execution_category` **does not exist** in campaign blueprint, execution_items, daily plan rows, or UnifiedExecutionUnit.

**Existing related pieces:**
- `platform_rules.creator_dependent` (database) — per content type, not per activity
- `platformIntelligenceService` — “placeholder” for video/audio/podcast
- UI: `execMode === 'AI_AUTOMATED'` shows “Fully AI executable” tooltip on calendar/daily-plan/activity-card — `execMode` derived from content type rules, not from stored execution_category

**UI support:** Partial. Calendar, daily plan, activity card show a dot with tooltip “Fully AI executable” when `execMode === 'AI_AUTOMATED'`. No explicit “Hybrid” or “Creator Dependent” classification in UI. Execution mode is inferred from content type (e.g. platform rules), not from a stored field.

---

## 9. Summary of Gaps

**Missing data structures:**
- `execution_category` (AI / Hybrid / Creator) not in weekly/daily/activity schema
- `activity_origin` / `weekly_activity_id` — daily_content_plans has `source_refinement_id`/`weekly_refinement_id` in schema but generate-weekly-structure does not populate them
- No `content_types_per_platform` stored; activity workspace uses hardcoded map

**Broken scheduling logic:** None identified. Distribution works for both deterministic and AI paths. No Monday/Friday clustering; spread is even or AI-driven.

**Missing execution category classification:** No `execution_category` in data model. UI infers “Fully AI executable” from content type rules only.

**Missing platform/content mapping:** Repurposing and add-platform options are hardcoded in `activity-workspace.tsx`, not derived from blueprint or platform rules.

**Missing refinement integration:** Not all textual content flows through refinement. Daily distribution slot text, raw AI plan text (pre-parse), and some other outputs are not explicitly refined.

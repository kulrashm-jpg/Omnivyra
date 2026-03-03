# Full Daily Plan Execution Flow Audit (Master Audit)

**Status:** Analysis only. No implementation. No code changes.

This document describes the **complete** architecture of how the Daily Plan works end-to-end: creation, placement, distribution, activity workspace, master content, repurposing, and team messaging.

---

## 1️⃣ Daily Plan Creation Flow

### Source chain

| Step | Component | Role |
|------|-----------|------|
| 1 | **Blueprint source** | `getUnifiedCampaignBlueprint(campaignId)` — resolves from: (1) `twelve_week_plan.blueprint` or `.weeks`, (2) `campaign_versions.campaign_snapshot.weekly_plan`, (3) `weekly_content_refinements`. Returns `CampaignBlueprint \| null` with `weeks[]`. |
| 2 | **Execution items origin** | Each blueprint week can have `daily_execution_items` (or `execution_items` / `resolved_postings`). These are **derived server-side** in `campaignAiOrchestrator`: `resolved_postings` are built from topic slots + platform allocation; then `daily_execution_items = resolved_postings.map(normalizeResolvedPostingToDailyItem)`. So execution items come from **weekly enrichment / generate-weekly-structure** (or equivalent) and are stored in the blueprint. |
| 3 | **retrieve-plan** | `GET /api/campaigns/retrieve-plan?campaignId=...` — returns `{ savedPlan, committedPlan, draftPlan }`. `committedPlan.weeks` = normalized blueprint weeks from `getUnifiedCampaignBlueprint` (spread `raw` so `daily_execution_items` are present when stored in blueprint). **No generation** here; read-only. |
| 4 | **get-weekly-plans** | `GET /api/campaigns/get-weekly-plans?campaignId=...` — returns array of week objects (weekNumber, phase, theme, execution_items, posting_execution_map, resolved_postings, distribution_strategy, momentum_adjustments, etc.). **Does not** expose `daily_execution_items` in the response; exposes `execution_items`, `resolved_postings`. Used for weekly cards / themes; **not** the primary source of per-day activities for the daily plan grid. |
| 5 | **daily-plans API** | `GET /api/campaigns/daily-plans?campaignId=...` — reads **`daily_content_plans`** from Supabase (all rows for campaign), joins blueprint for week-level fields (distribution_strategy, momentum_adjustments, etc.), transforms each row to a response shape (id, weekNumber, dayOfWeek, platform, contentType, title, topic, …). Then: **adapter** — each plan → `dailyPlanRowToUnifiedExecutionUnit(plan)`; **distribution** — group by week_number, `applyDistributionForWeek(units, week)`; **apply back** — `applyUnifiedToDailyPlanResponse(plan, distributed[j])`. Returns **normalized plans** (flat array). This is the **legacy/DB path** for “daily plan.” |

### When is the daily plan “created”?

- **Blueprint path:** “Daily plan” is **not** a separate creation step; it is the **view** of blueprint `weeks[].daily_execution_items` (plus optional distribution for day assignment). Creation of those items happens when the **weekly structure** is generated (e.g. generate-weekly-structure, AI orchestrator building `resolved_postings` → `daily_execution_items`).
- **Legacy path:** Rows in **`daily_content_plans`** are created by: (1) **commit-daily-plan** (user saves from UI: activities → daily_content_plans), or (2) other flows that insert into `daily_content_plans` (e.g. legacy 12-week plan generation, populate from AI plan). So “daily plan” in the DB sense = rows in `daily_content_plans`.

### Where distribution strategy is applied

- **Campaign-daily-plan page (blueprint path):** For each week, items → `blueprintItemToUnifiedExecutionUnit` → **`applyDistributionForWeek(units, week)`** → day assigned in-memory; then GridActivity built from distributed units. **Read-time only**; no write.
- **daily-plans API:** After transforming DB rows, plans are grouped by `week_number`; for each week, units = map plans to UnifiedExecutionUnit, **`applyDistributionForWeek(units, week)`** (week = { distribution_strategy, momentum_adjustments }), then apply back to plan objects. So **day assignment** (e.g. dayOfWeek) can be overwritten by distribution when strategy is STAGGERED/ALL_AT_ONCE/AUTO. Again **read-time**; DB unchanged.

### Step-by-step (source → transforms → daily plan)

**Path A — Blueprint (daily plan page / calendar):**

1. Page loads: `retrieve-plan` + `get-weekly-plans` + campaign fetch.
2. `committedPlan.weeks` (or draftPlan.weeks) from retrieve-plan = blueprint weeks (with `daily_execution_items` if present).
3. For each week: `items = week.daily_execution_items` → `units = items.map(blueprintItemToUnifiedExecutionUnit)` → `distributedUnits = applyDistributionForWeek(units, week)` → GridActivity[] (day from unit.day or fallback).
4. Optional: `detectMasterContentGroups(distributedUnits)` (dev log only).
5. Result: **activities** state = list of GridActivity for grid; no DB write.

**Path B — Legacy (daily-plans API):**

1. Supabase: `daily_content_plans` for campaign.
2. Blueprint: `getUnifiedCampaignBlueprint` for week-level metadata (distribution, momentum).
3. Transform: each row → response shape (V2 vs legacy); then **adapter** → UnifiedExecutionUnit; **distribution** per week; apply back.
4. Return flat array of plans (dayOfWeek can be distribution-assigned).

---

## 2️⃣ Activity Definition & Placement

### What is an activity internally?

| Concept | Where | Shape |
|--------|--------|--------|
| **Execution item** | Blueprint week | Raw object in `week.daily_execution_items[]`: execution_id, platform, content_type, topic, title, day?, writer_content_brief, intent, execution_mode, creator_instruction, master_content_id, etc. Produced by campaignAiOrchestrator (normalizeResolvedPostingToDailyItem). |
| **daily_content_plan** | DB table + API | Row: id, campaign_id, week_number, day_of_week, date, platform, content_type, title, content, topic, status, … API returns same plus joined week fields (distribution_strategy, etc.). |
| **UnifiedExecutionUnit** | Adapter (lib/planning) | Normalized shape: execution_id, campaign_id, week_number, day, title, platform, content_type, execution_mode, creator_instruction, source_type (BLUEPRINT_EXECUTION \| DAILY_PLAN_ROW), etc. Used internally for distribution and grouping. |
| **GridActivity** | campaign-daily-plan page | UI shape: id, execution_id, week_number, day, title, platform, content_type, raw_item, planId?, execution_mode?, creator_instruction?. |
| **CalendarActivity** | campaign-calendar page | execution_id, week_number, day, date, time, title, platform, content_type, readiness_label, execution_jobs, raw_item, execution_mode?. |
| **Activity (activity-board)** | components/activity-board/types | id, title, content_type, stage, approval_status, platforms?, execution_id?, campaign_id?, week_number?, day?, execution_mode?, creator_instruction?. |

### Identity rules

- **execution_id:** Stable per logical slot. Blueprint: set in orchestrator (e.g. `wk${week}-exec-${postingOrder}`). Never changed by distribution; only day can change. Legacy row: plan.id or dailyObject.execution_id. Workspace resolve uses **campaignId + execution_id**.
- **Platform:** One platform per execution unit (string). Normalized lowercase (linkedin, instagram, …).
- **Content type:** From item/plan (post, video, reel, …). Normalized lowercase.
- **Color logic:** From **execution_mode** (AI_AUTOMATED / CREATOR_REQUIRED / CONDITIONAL_AI) via `getExecutionModeColorClasses` (indigo / amber / violet). Activity-board also uses **stage** (PLAN, CREATE, REPURPOSE, SCHEDULE, SHARE) and **STAGE_COLORS**.
- **Ownership:** execution_mode = ownership hint; creator_instruction = brief when creator-heavy.

### How activity gets placed on a specific day

- **Explicit day:** When the execution item already has `day` (e.g. set during weekly enrichment or stored in blueprint). Adapter passes it through; distribution **does not override**.
- **Distributed day:** When `day` is missing and `applyDistributionForWeek` runs (STAGGERED / ALL_AT_ONCE / AUTO): STAGGERED spreads Mon–Sun; ALL_AT_ONCE groups by topic and assigns same day per group; AUTO picks strategy from momentum + unit count.
- **Derived day:** Fallback on daily plan page: `unit.day || DAYS[itemIndex % 7]`.
- **Calendar date mapping:** Calendar derives **date** from campaign start_date + (week_number - 1) * 7 + dayIndex(day). So day = weekday name; date = ISO date string for that week/day.

---

## 3️⃣ Daily Plan Visual Structure

### Horizontal (activities / calendar slots)

- **campaign-daily-plan page:** Week × day grid (DAYS = Mon–Sun). Each cell can show multiple **GridActivity** cards (execution_id, title, platform, content_type, execution_mode badge). Color from getExecutionIntelligence (execution_mode). Drag-and-drop between cells; save via save-week-daily-plan.
- **campaign-calendar page:** Calendar month view; activities grouped by **date**; each activity has execution_id, day, date, time, title, platform, content_type, readiness_label, execution_jobs. Filter by execution_mode. Click → activity workspace (same workspaceKey pattern).

### Vertical (messaging / team communications)

- **Activity-board** (ActivityCard, ActivityMessageThread, ActivityMessageComposer): Used in workspace or side panel. **Activity** = card with stage, approval, execution_id, etc. **ActivityMessage** = id, activity_id, user_id, sender_name, **sender_role** (COMPANY_ADMIN, CAMPAIGN_CONTENT_MANAGER, CONTENT_CREATOR, SYSTEM, AI), message_type (COMMENT, UPDATE, APPROVAL, REJECTION, REQUEST_CHANGES, SYSTEM), message_text, created_at.
- **Role color mapping:** `ROLE_ACCENT_CLASSES` in activity-board/types: blue (admin), purple (manager), emerald (creator), gray (system/AI).
- Message structure lives in **components/activity-board/types.ts** (ActivityMessage, SenderRole, MESSAGE_TYPES). Message APIs: not traced in this audit; typically activity-scoped messages (e.g. by activity_id).

---

## 4️⃣ Activity Workspace Flow (Critical)

### When user clicks an activity

**Daily plan page:**

1. **Click** → `openActivityWorkspace(activity)`.
2. Build **payload** client-side: campaignId, weekNumber, day, activityId (execution_id), title, topic, description, dailyExecutionItem (from raw_item + nested writer_content_brief/intent), schedules (same-topic same-day activities as schedule slots), **repurposing_context** (buildRepurposingContext(unitsForContext, activity.execution_id)), **master_content_document** (runVariantGenerationPipeline(buildMasterContentDocument(…))).
3. **workspaceKey** = `activity-workspace-${campaignId}-${activity.execution_id}`.
4. **sessionStorage.setItem(workspaceKey, JSON.stringify(payload))**; **window.open(`/activity-workspace?workspaceKey=...`)**.

**Calendar page:** Same idea: open workspace with execution_id; payload may come from resolve if sessionStorage empty.

### Workspace load (activity-workspace page)

1. Read **workspaceKey** from query (or campaignId + executionId).
2. Try **sessionStorage.getItem(workspaceKey)**. If present → use as payload.
3. If missing → **GET /api/activity-workspace/resolve?workspaceKey=...** (or campaignId + executionId). Resolve returns **{ workspaceKey, payload }**.

### Resolve API (payload creation)

1. **Auth:** companyId resolution; enforceCompanyAccess or checkContentArchitectAccess.
2. **Blueprint:** getUnifiedCampaignBlueprint(campaignId). If no blueprint → 404.
3. **Find item:** Loop blueprint.weeks → week.daily_execution_items (or execution_items) → find item where item.execution_id === targetExecId. **found** = { week, item, weekNumber, day }.
4. **Build payload:** dailyExecutionItem (normalize raw item, add writer_content_brief/intent if missing), title, topic, description, distribution_strategy, planning_adjustment_reason, momentum_adjustments, week_extras.
5. **Repurposing:** weekItems = week.daily_execution_items/execution_items; **units** = weekItems.map(blueprintItemToUnifiedExecutionUnit); **repurposing_context** = buildRepurposingContext(units, targetExecId).
6. **Master doc:** **masterDoc** = buildMasterContentDocument(repurposing_context, targetExecId); **master_content_document** = runVariantGenerationPipeline(masterDoc).
7. Attach repurposing_context and master_content_document to payload when non-null.
8. Return **{ workspaceKey, payload }**.

So: **Data is pulled from blueprint** (week containing execution_id). Execution item is the raw object in that week; workspace payload is shaped by resolve (or client) and includes dailyExecutionItem, repurposing_context, master_content_document.

---

## 5️⃣ Master Content + Repurposing (Existing System)

### Existing implementation (backend)

- **contentGenerationPipeline.ts:** Defines **MasterContentPayload** (id, content, generation_status, decision_trace, etc.) and **PlatformVariantPayload** (platform, content_type, generated_content, generation_status, adaptation_trace, discoverability_meta, media_intent, …). This is the **real AI/adaptation pipeline**: master content generation and per-platform variant generation with formatting, discoverability, media rules. Used by content pipeline / autopilot execution.
- **campaignAiOrchestrator / DailyExecutionItem:** Execution items can carry **master_content** (id, content, generation_status) and **platform_variants[]** (platform, content_type, generated_content, generation_status, adaptation_trace, …). So the **backend** already has a model where one execution item can have master_content and platform_variants for multiple platforms.
- **Platform rules:** platformAlgorithmFormattingRules, platformMediaSearchRules, discoverabilityRules, etc. feed into contentGenerationPipeline.

### Does the current system already generate variants?

- **Yes**, in the **backend content pipeline**: contentGenerationPipeline (and related services) can generate master content and platform-specific variants (with adaptation trace, formatting, media intent). That flow is tied to execution items / scheduled posts and storage (e.g. master_content_id, platform_variants on the item).
- **New planning-layer pieces** (lib/planning): **repurposing_context**, **master_content_document**, **variantGenerationPipeline** are **read-only scaffolds** in the **workspace payload**. They do **not** call GPT or the backend content pipeline; they only build structure (group_id, platforms, sibling_execution_ids, platform_variants with PENDING → GENERATED placeholder). So there are **two** notions of “master content / variants”: (1) **Backend:** real AI generation and storage. (2) **Planning/workspace:** in-memory grouping + placeholder pipeline for UI/flow readiness.

---

## 6️⃣ New Architecture (Recently Added)

| Layer | File | Role in flow |
|-------|------|--------------|
| **UnifiedExecutionUnit** | lib/planning/unifiedExecutionAdapter.ts | Single internal shape for “one activity.” **Blueprint item** → blueprintItemToUnifiedExecutionUnit. **daily_content_plans row** → dailyPlanRowToUnifiedExecutionUnit. Used by distribution, grouping, and (indirectly) workspace. |
| **distributionEngine** | lib/planning/distributionEngine.ts | **applyStaggeredDistribution**, **applyAllAtOnceDistribution**, **resolveDistributionStrategy** (AUTO from momentum + unit count), **applyDistributionForWeek(units, week)**. Called after units are built for a week; assigns **day** when missing. Read-time only. |
| **masterContentGrouping** | lib/planning/masterContentGrouping.ts | **detectMasterContentGroups(units)** — groups by topic (fallback title, execution_id). Returns **MasterContentGroup[]** (group_id, topic_key, title, units, platforms, week_number). Used by repurposing context. |
| **repurposing_context** | lib/planning/repurposingContext.ts | **buildRepurposingContext(units, executionId)** — finds group containing executionId; returns **{ group_id, master_title, platforms, sibling_execution_ids }**. Attached to workspace payload (resolve + daily-plan client). |
| **master_content_document** | lib/planning/masterContentDocument.ts | **buildMasterContentDocument(repurposing_context, currentExecutionId)** — builds **MasterContentDocument** (master_title, source_execution_id, platforms, platform_variants: Record<platform, { execution_id, status, content? }>). Attached to workspace payload. |
| **variantGenerationPipeline** | lib/planning/variantGenerationPipeline.ts | **runVariantGenerationPipeline(doc)** — clones doc, sets each PENDING slot to status GENERATED and placeholder content. Pure; no AI. Result attached as **master_content_document** in payload. |

**Where they sit:**

- **Adapter:** At the boundary between blueprint/daily_content_plans and the rest of the planning layer (daily-plans API, campaign-daily-plan page, resolve).
- **Distribution:** After adapter, before converting units back to GridActivity or to daily plan response (so “day” is set before display).
- **Grouping:** After distribution; used only for repurposing_context (and dev log).
- **Repurposing context + master doc + variant pipeline:** When building the **workspace payload** (resolve API and openActivityWorkspace on daily plan page). So: **Weekly plan → blueprint → execution items → (adapter → distribution) → daily view; on workspace open → same week units → repurposing context → master doc → variant pipeline → payload.**

---

## 7️⃣ Complete Execution Flow Diagram

```
Weekly Plan (Blueprint)
  twelve_week_plan.blueprint.weeks[]  OR  campaign_versions.campaign_snapshot.weekly_plan  OR  weekly_content_refinements
  each week: execution_items / resolved_postings → daily_execution_items (or legacy week shape)
        ↓
  getUnifiedCampaignBlueprint(campaignId)
        ↓
  retrieve-plan → committedPlan.weeks (with daily_execution_items)
        ↓
  [DAILY PLAN PAGE / CALENDAR]
  For each week: items → blueprintItemToUnifiedExecutionUnit → applyDistributionForWeek(units, week)
        ↓
  GridActivity[] / CalendarActivity[]  (day from unit.day)
        ↓
  User clicks activity → openActivityWorkspace(activity)
        ↓
  Build payload: same-week units → buildRepurposingContext → buildMasterContentDocument → runVariantGenerationPipeline
  sessionStorage.setItem(workspaceKey, payload)  AND  window.open(/activity-workspace?workspaceKey=...)
        ↓
  [ACTIVITY WORKSPACE]
  If no sessionStorage → GET /api/activity-workspace/resolve?workspaceKey=...
        ↓
  Resolve: blueprint → find item by execution_id → same repurposing + master doc + variant pipeline → payload
        ↓
  Payload: dailyExecutionItem, repurposing_context?, master_content_document? (with platform_variants GENERATED)
        ↓
  Team collaboration: Activity board (messages, sender_role, stage, approval)
```

**Legacy path (no blueprint execution items):**

```
daily_content_plans (DB)
        ↓
  GET /api/campaigns/daily-plans
  transform → dailyPlanRowToUnifiedExecutionUnit → group by week → applyDistributionForWeek → apply back
        ↓
  Flat list of plans (dayOfWeek possibly distribution-assigned)
        ↓
  campaign-daily-plan page (fallback): dailyPlans.forEach → GridActivity (planId = plan.id, execution_id = plan.id)
  OR  campaign-calendar (fallback): dailyPlans → CalendarActivity[]
        ↓
  Click → workspace: resolve may not find in blueprint (execution_id = plan.id); then 404 unless resolve is extended to look up by daily_content_plans.
```

---

## 8️⃣ Integration Risk Analysis

| Risk | Description |
|------|-------------|
| **Duplicate logic** | Two sources of “daily plan”: blueprint (retrieve-plan → daily_execution_items) vs daily_content_plans (daily-plans API). Adapter unifies shape but **write path** (commit-daily-plan, save-week-daily-plan) only touches **daily_content_plans**. Blueprint is not updated when user drags/drops or saves from daily plan page. So “truth” can diverge. |
| **Multiple master document sources** | (1) **Backend** execution item: master_content, platform_variants (real AI pipeline). (2) **Workspace payload**: master_content_document (planning layer, placeholder pipeline). UI that shows “variants” could be reading from payload.master_content_document or from dailyExecutionItem.platform_variants; if both exist, semantics can conflict. |
| **Parallel repurposing pipelines** | (1) **contentGenerationPipeline** (backend): real generation + adaptation. (2) **variantGenerationPipeline** (lib/planning): placeholder only. Future “generate variants” in workspace could call either; need a single owner to avoid duplicate generation or inconsistent state. |
| **Workspace payload inconsistencies** | Client-built payload (openActivityWorkspace) vs resolve API: both now add repurposing_context and master_content_document. Client uses same-week **activities** (GridActivity) mapped to minimal UnifiedExecutionUnit; resolve uses **blueprint week items** mapped via adapter. If one path has different units (e.g. different week boundary or missing item), repurposing_context can differ (e.g. different sibling list). |
| **Calendar without new layer** | campaign-calendar builds CalendarActivity from blueprint **or** from daily-plans fallback; it does **not** run the adapter or distribution. So calendar day/date can differ from daily plan page if distribution runs only on daily plan page/API for legacy path. For blueprint path, calendar uses item.day directly (no distribution step in calendar code). |

---

## 9️⃣ Recommended Final Architecture

| Recommendation | Rationale |
|----------------|-----------|
| **Single source of truth for “what to show per day”** | Prefer **blueprint** (daily_execution_items) as the authority for content and identity; treat **daily_content_plans** as a **persisted view** or commit target. When user saves from daily plan, either (a) write back to blueprint (e.g. day on items) or (b) treat daily_content_plans as cache and keep blueprint as read source so distribution and grouping stay consistent. |
| **One pipeline for repurposing/variants** | **Backend content pipeline** should own real AI generation and storage. **Planning-layer** master_content_document + variantGenerationPipeline should be the **workspace contract** (structure + placeholder). When “Generate” is added in workspace, call **backend** to fill platform_variants; then merge result into payload or refetch so **master_content_document** in payload reflects backend state (or keep payload as scaffold and have UI read from backend for actual content). |
| **Where AI generation should live** | AI generation (master content + platform adaptation) should live in **backend** (contentGenerationPipeline / orchestrator). Workspace only: (1) shows repurposing_context and master_content_document structure, (2) triggers “generate” API that uses backend pipeline, (3) displays returned content/variants. |
| **Avoid duplicate logic** | (1) **Day assignment:** Only one place should assign day (distribution engine); both daily plan page and daily-plans API already use it. Calendar should use the same data source (retrieve-plan or daily-plans) so it sees the same distributed days. (2) **Grouping:** detectMasterContentGroups in one place; repurposing_context built from it. (3) **Variant slots:** Define once (MasterContentDocument); backend fills content; workspace shows it. |

---

## 🔟 Final Output Summary

1. **Daily plan creation:** Blueprint weeks with daily_execution_items (from orchestrator) or daily_content_plans rows; retrieve-plan and daily-plans API feed the UI; distribution runs at read time on UnifiedExecutionUnit[].
2. **Activity lifecycle:** Execution item (blueprint) or daily_content_plan row → adapter → UnifiedExecutionUnit → optional distribution → GridActivity/CalendarActivity; identity = execution_id; placement = explicit or distributed day.
3. **Daily plan UI:** Week×day grid (daily plan page) or calendar by date (calendar page); activity-board for messages and roles (ROLE_ACCENT_CLASSES, SenderRole).
4. **Workspace resolution:** Click → workspaceKey + payload (client or resolve API); resolve loads blueprint, finds item by execution_id, builds repurposing_context and master_content_document (with variant pipeline), returns payload.
5. **Existing repurposing:** Backend contentGenerationPipeline and execution item master_content/platform_variants; real AI and storage.
6. **New architecture:** Adapter, distribution, grouping, repurposing_context, master_content_document, variantGenerationPipeline sit in read path and workspace payload; no persistence; placeholder generation only.
7. **End-to-end flow:** Weekly plan (blueprint) → retrieve-plan / get-weekly-plans / daily-plans → adapter → distribution → daily view → click → workspace payload (repurposing + master doc + variants) → team collaboration.
8. **Risks:** Two daily sources (blueprint vs DB); two “master/variant” concepts (backend vs payload); calendar not using distribution; payload built in two places (client vs resolve).
9. **Recommended architecture:** Blueprint as content truth; daily_content_plans as commit/cache; single backend pipeline for real generation; workspace payload as structure + trigger; one distribution path for day assignment.

# Planning-to-Execution Flow — Alignment Audit

**Purpose:** Understand how the existing planning-to-execution flow works so refinements can be applied consistently.  
**No redesign. No implementation. No architecture rewrite. Inspection and documentation only.**

**Target direction (context):** Weekly plan as complete execution blueprint; dual-view (system vs user); deterministic weekly → daily; creator placeholders + AI tasks + repurpose; consistent color (eventually responsibility-based).

---

## PHASE 1 — WEEKLY PLAN AUDIT

### Task 1A — Weekly Card Rendering

**Where weekly cards are rendered:**

| Location | File(s) | Component / mechanism | What is shown |
|----------|---------|------------------------|---------------|
| Campaign details (overview) | `pages/campaign-details/[id].tsx` | Inline: week rows in “Weekly Content Plan” section (~2360–2550). Each week is a collapsible card. | Week number; theme; focus area; platform_allocation; topics count; completion %; [+ AI] button. Expanded: phase, focus, platform_content_breakdown, keyMessaging, topics_to_cover or topics with **topic cards** (topicTitle, content type badge, platform, CTA, KPI, writing intent, problem, reader learns, desired action). Topic cards use `getActivityColorClasses(contentType)` for card/badge. Week header uses `getPhaseColor(weekPlan?.phase)`. |
| Campaign planning hierarchical | `pages/campaign-planning-hierarchical.tsx` | Week rows with `WeekPlan`; `getStageColor` / `getStageLabel` for campaign stage. Links to daily plan grid. | Week number, theme; stage badges; expand to week plans; link to daily plan grid. Not the same “weekly card” as campaign-details; more of a stage/plan list. |
| Campaign daily plan page | `pages/campaign-daily-plan/[id].tsx` | Loads `retrieve-plan` → `draftPlan.weeks` or `committedPlan.weeks`; maps `daily_execution_items` to `GridActivity[]`. No dedicated “weekly card” component; data is week×day grid. | Week columns; per cell: activities (title, platform, content_type) as draggable chips. Chips are neutral gray (`border border-gray-200 bg-gray-50`). No content-type or phase color on chips. |
| Get weekly plans API / list | `pages/api/campaigns/get-weekly-plans.ts` | Returns list of weeks (weekNumber, theme, etc.) for dropdowns / labels. | Data only; no card UI. |

**Components involved:**

- **Campaign details:** No shared “WeeklyCard” component. Week rows and topic cards are inline JSX. Topic cards are `<button>` with `getActivityColorClasses(topic?.topicExecution?.contentType).card` and `.badge`.
- **Campaign daily plan:** No weekly “card”; week is a column header; activities are rendered per day cell.
- **Campaign planning hierarchical:** Week represented as row with stage/week info; no reuse of campaign-details week card.

**Data fields displayed on user-facing weekly cards (campaign-details):**

- **Week header:** week number, theme, focus area, platform_allocation (text), topics count, completion percentage, phase (for phase color).
- **Expanded week:** phase, focus, platform_content_breakdown (platform → content type counts), keyMessaging, topics_to_cover (list) or topics (topic cards).
- **Topic card (when topics exist):** topicTitle, contentType (badge + execution detail), platform(s), CTA, KPI, writingIntent, whoAreWeWritingFor, whatProblemAreWeAddressing, whatShouldReaderLearn, desiredAction. Click → `openTopicWorkspaceFromWeeklyCard` (sessionStorage payload → activity-workspace).

---

### Task 1B — Weekly System vs User Data

**Weekly data model:** `CampaignBlueprint`, `CampaignBlueprintWeek` in `backend/types/CampaignBlueprint.ts`.

**Classification:**

| Field / area | Classification | Notes |
|---------------|----------------|--------|
| week_number, phase_label, primary_objective, topics_to_cover, cta_type, weekly_kpi_focus | **USER VIEW** | User-facing labels and focus. |
| platform_allocation, content_type_mix | **MIXED** | User sees counts; system uses for distribution and validation. |
| weeklyContextCapsule (campaignTheme, primaryPainPoint, desiredTransformation, campaignStage, psychologicalGoal, momentum, audienceProfile, weeklyIntent, toneGuidance, successOutcome) | **SYSTEM ONLY** (mostly) | Execution/writing intelligence; some parts surface in “Writing Context” in campaign-details expanded week. |
| topics[] (WeeklyTopicWritingBrief: topicTitle, topicContext, whoAreWeWritingFor, whatProblemAreWeAddressing, etc.) | **MIXED** | Topic titles and intent are user-visible; full TopicContext is execution intelligence. |
| platform_content_breakdown, platform_topics | **SYSTEM ONLY** (or advanced user) | Shown in campaign-details as “Content types by platform.” |
| execution_items, posting_execution_map, resolved_postings | **SYSTEM ONLY** | Not shown on weekly cards; consumed by generate-weekly-structure and daily/calendar. |
| week_extras | **MIXED** | Flexible; may hold distribution_strategy, objectives, etc.; some keys may be shown. |

**Dual-view status:** Weekly does not clearly separate “user view” vs “system view” in the schema. The UI in campaign-details shows a subset (theme, phase, platform allocation, topics, writing context) and hides execution_items / resolved_postings. So the **pattern** is present in what is shown/hidden, but there is no formal split (e.g. `user_display` vs `execution_intelligence`) in the type. Theme cards (recommendation → strategic theme) are a separate flow; weekly plan does not mirror that dual-view structure in its type definition.

---

### Task 1C — Content Type Coverage

**Sources:** `platform_content_requests` (or equivalent) → `deterministicWeeklySkeleton` (`DeterministicExecutionItem`: content_type, platforms, count_per_week, topic_slots); `platformIntelligenceService` (FALLBACK_CONTENT_RULES: video, carousel, post, article, story, reel, etc. per platform); `generate-weekly-structure` `pickContentType(content_type_mix, index)` (video, article, poll, carousel, story, reel, thread, post).

**Table: [Content Type] → [Info present] → [Missing for execution]**

| Content type | Info present in weekly | Missing for execution |
|--------------|------------------------|------------------------|
| **Post** | content_type_mix, execution_items content_type, platform_allocation; platform rules (char limits, etc.) | Format-specific execution (e.g. max words) often defaulted in daily (deriveContentGuidance(null)). |
| **Video** | content_type_mix; skeleton/orchestrator can have video; platform rules (e.g. YouTube video, TikTok video) | Duration, hooks, aspect ratio, structure, “creator-dependent” or placeholder flag not in weekly schema. |
| **Carousel** | content_type_mix; platform supports (e.g. LinkedIn/Instagram carousel); pickContentType maps carousel | Slide count, narrative flow, visual structure not in weekly. |
| **Images** | Platform rules (image, media_format: image for story/feed_post); not first-class in weekly topics | Image sourcing, requirements, placeholders not in weekly. |
| **Article / blog** | content_type_mix; topic briefs; contentTypeGuidance (primaryFormat, maxWordTarget) in WeeklyTopicWritingBrief | Execution path often ignores brief and uses default content guidance (see strategy leaks). |
| **Story / thread / reel** | In pickContentType and platform rules | Same as above; no story- or reel-specific execution metadata in weekly. |

**Execution guidance:** Weekly has `topics[].contentTypeGuidance` and `weeklyContextCapsule` (tone, intent). Daily generation does **not** consistently use them: when building from execution_items, `deriveContentGuidance(null)` is called (default format/words). So execution guidance exists in the model but is **not** wired through to daily.

**Placeholder / creator-owned:** `platformIntelligenceService` has a concept of “placeholder” for video/audio/podcast in one path. No `creator_dependent` or `placeholder` flag on `CampaignBlueprintWeek` or execution_items. Weekly does not explicitly mark “creator-dependent” or “placeholder” slots.

---

## PHASE 2 — WEEKLY → DAILY BREAKDOWN FLOW

### Task 2A — Daily Plan Generation Flow

**Entry point:** `POST /api/campaigns/generate-weekly-structure` (`pages/api/campaigns/generate-weekly-structure.ts`).

**Step-by-step: Weekly → Daily**

1. **Request:** campaignId, week (week number), optional companyId, auto_rebalance, auto_optimize_distribution, enable_campaign_waves, distribution_mode.
2. **Load:** Campaign (start_date); blueprint via `getUnifiedCampaignBlueprint(campaignId)`; weekBlueprint = blueprint.weeks for given week.
3. **Distribution strategy:** Read `(weekBlueprint).distribution_strategy`. If QUICK_LAUNCH → same_day_per_topic; if STAGGERED → staggered; else use request body `distribution_mode` (default staggered). So **decision:** distribution mode can be request-time if not on blueprint.
4. **Topic order:** From weekBlueprint.topics (topicTitle) or topics_to_cover; else phase_label/primary_objective. briefByKey from weekBlueprint.topics for content guidance (used only in some paths).
5. **Execution items vs AI path:**
   - If week has `execution_items` (with topic_slots and intent): **execution_items path.** Day indices from `spreadEvenlyAcrossDays(exec.count_per_week, 7)`; per slot build DailyPlanItem from slot intent; contentGuidance from `deriveContentGuidance(null)` (default); narrativeStyle from writing_angle or hardcoded default. Platform from exec.selected_platforms; day from spread (STAGGERED can offset by platform index). Optional campaign waves: `generatePlatformWaveSchedule` overwrites row date.
   - If no execution_items: **AI path.** Call `generateAIDailyDistribution` (LLM) with week blueprint, campaign mode, distribution mode, content_type_mix. LLM returns day_index, platform, content_type, short_topic, full_topic, reasoning. Map to DailyPlanItem with **hardcoded** intent (General Audience, Learn more, deriveContentGuidance(null)).
6. **Persistence:** Build rows for daily_content_plans (campaign_id, week_number, day_of_week, platform, content JSON, topic, objective, etc., status 'planned', ai_generated: true for AI path; execution path can set ai_generated from item or default). Enriched content object includes master_content_id when present.
7. **Post-processing (if flags):** validateDailyItemAgainstPlatformRules; if invalid and auto_rebalance → reassign content_type to platform-preferred type; if auto_optimize_distribution → analyzeExecutionFeedback + suggestPublishingStrategy and reassign platform (and possibly content type). So **scheduling/distribution decisions** can still occur here.
8. **Campaign waves:** If enable_campaign_waves, dates are shifted by wave service after rows are built.

**Decisions still made during daily generation:**

- Day assignment (unless blueprint had resolved_postings with day and we used them—currently we do not; we always spread).
- Distribution mode (from request when not on blueprint).
- Default platform when item has no platforms (getDefaultPlatformTargets(week)).
- Content guidance (default when not from brief).
- Narrative style (default when no writing_angle).
- Reassignment of content_type (auto_rebalance) and platform/content_type (auto_optimize_distribution).
- Scheduled date (campaign waves).

---

### Task 2B — Distribution Mode Handling

**Where the decision is taken:**

- **Blueprint:** `(weekBlueprint as any).distribution_strategy` in generate-weekly-structure (lines 479–488). Not on canonical `CampaignBlueprintWeek`; may be in week_extras or set by orchestrator.
- **Request body:** `distribution_mode` (e.g. 'staggered' | 'same_day_per_topic') in POST body to generate-weekly-structure; used when blueprint has no distribution_strategy.
- **Planning intelligence:** `backend/services/planningIntelligenceService.ts` — `determineDistributionStrategy(input)` returns QUICK_LAUNCH | STAGGERED | AI_OPTIMIZED from campaign duration, capacity, requested total, platform count, cross_platform_sharing. Not invoked in generate-weekly-structure; strategy is read from blueprint or request.

**Where it is stored:**

- Blueprint: only if orchestrator or another path sets `distribution_strategy` on the week (e.g. week_extras or ad-hoc). Not a first-class field on CampaignBlueprintWeek.
- User input: campaign-details has `distributionMode` state ('staggered' | 'same_day_per_topic') and sends it in requests to generate-weekly-structure (e.g. distribution_mode). So **user can influence** distribution at the time of “Generate” or “Regenerate.”

**Modes:**

- **QUICK_LAUNCH:** same_day_per_topic; one topic can go to multiple platforms same day.
- **STAGGERED:** day offset by platform index; spread across week.
- **AI-driven:** generateAIDailyDistribution uses campaignMode (QUICK_LAUNCH vs STRATEGIC) and distributionMode; LLM proposes day/platform/content_type per slot.

---

### Task 2C — Strategy Leaks Confirmation

(From existing doc `docs/STRATEGY-LEAKS-POST-WEEKLY-BLUEPRINT.md`; summarized.)

| # | Decision | Where | Belongs in weekly? |
|---|----------|-------|---------------------|
| 1 | Full slot definition (day, platform, content_type, topic, intent) when no execution_items | AI path: dailyContentDistributionPlanService + generate-weekly-structure | Yes — weekly should have execution_items so AI path is unnecessary. |
| 2 | Day index per slot | spreadEvenlyAcrossDays in generate-weekly-structure; resolved_postings not used | Yes — store day (or rule) in blueprint. |
| 3 | Distribution strategy / campaign mode | Read from blueprint or request body in generate-weekly-structure | Yes — persist on week. |
| 4 | Default platform when item has no platforms | getDefaultPlatformTargets(week) in generate-weekly-structure | Prefer every slot has platform in blueprint. |
| 5 | Content guidance (format, word target) | deriveContentGuidance(null) in execution_items path | Yes — attach guidance per slot from weekly brief. |
| 6 | Content type when platform rejects (auto_rebalance) | platformExecutionValidator + generate-weekly-structure | Yes — validate at weekly or store fallback. |
| 7 | Platform/content_type reassignment (auto_optimize_distribution) | publishingOptimizationService in generate-weekly-structure | Move decision to weekly/re-plan. |
| 8 | Scheduled date (campaign waves) | campaignWaveService overwrites row date | Yes — apply waves at blueprint or single place; daily persists. |
| 9 | Narrative style fallback | Hardcoded in generate-weekly-structure | Yes — from capsule/brief per slot. |
| 10–12 | (Additional leaks in doc: kpiTarget fallback, etc.) | Same file / related | Yes where strategic. |

---

## PHASE 3 — DAILY PLAN → ACTIVITY WORKSPACE

### Task 3A — Activity Card Creation Flow

**Where activity cards are created from daily plan:**

1. **Campaign calendar** (`pages/campaign-calendar/[id].tsx`): Activities from draftPlan/committedPlan weeks’ `daily_execution_items` or from `GET /api/campaigns/daily-plans`. Each activity is rendered as an **article** (not ActivityCard): title, readiness badge, time, platform, content_type, execution jobs, “Open Activity Detail.” Click → `openActivityDetail(activity)` → build payload (campaignId, weekNumber, day, activityId, title, topic, description, dailyExecutionItem, schedules) → sessionStorage key `activity-workspace-${campaignId}-${execution_id}` → open `/activity-workspace?workspaceKey=...`.

2. **Campaign daily plan** (`pages/campaign-daily-plan/[id].tsx`): Same plan source; `GridActivity` per item. Click activity → `openActivityWorkspace(activity)` → build payload with dailyExecutionItem (from raw_item or derived intent/brief), schedules (from activity or empty) → sessionStorage → open activity-workspace.

3. **Campaign details** (weekly card): Click topic → `openTopicWorkspaceFromWeeklyCard(weekNumber, topic)` → payload with week/topic and dailyExecutionItem derived from topic + week (platformTargets, contentType, ctaType, kpiFocus, etc.) → sessionStorage → activity-workspace.

4. **Activity workspace** (`pages/activity-workspace.tsx`): Loads from sessionStorage (workspaceKey) or `/api/activity-workspace/resolve` (workspaceKey or campaignId+executionId). Resolve API can rebuild payload from campaign blueprint (week’s execution_items or daily_execution_items) and match by execution_id. **No** creation of “ActivityCard” component from activity-board here; workspace is a different UI (schedules, master content, repurpose, refine). Activity **board** (ActivityCard) is used in a pipeline/board context; its data source is typically a different API (e.g. activities by campaign/stage), not the same sessionStorage payload.

**Data flow (daily plan → “card” that opens workspace):**

- **Calendar:** CalendarActivity (execution_id, title, platform, content_type, date, time, readiness_label, raw_item) → openActivityDetail → payload.dailyExecutionItem = raw_item (or enriched with intent/brief), payload.schedules = [{ id, platform, contentType, date, time, status, title }].
- **Daily plan grid:** GridActivity (execution_id, title, platform, content_type, raw_item, planId) → openActivityWorkspace → same shape; schedules built from activity or left empty.
- **Weekly topic:** topic (topicTitle, topicExecution: { platformTargets, contentType, ctaType, kpiFocus }, topicContext) → openTopicWorkspaceFromWeeklyCard → dailyExecutionItem built from topic + week.

**Fields passed into workspace payload:** campaignId, weekNumber, day, activityId, title, topic, description, dailyExecutionItem (full object: platform, content_type, intent, writer_content_brief, etc.), schedules[].

---

### Task 3B — Repurpose Support

**Current handling:**

- **master_content_id:** Present in orchestrator (per-slot ID); in generate-weekly-structure (enriched content, row content); in daily-plans API (returned in transformed plan when present in content JSON); in activity-workspace resolve (master_content_id from raw/dailyExecutionItem). Used to link “one logical piece” across platforms.
- **Activity workspace:** “Repurpose Content” per schedule row; state `repurposingByScheduleId`; calls API to generate repurposed content. UI: “Generate repurposed content first” when no master; “Repurpose Content” button; “No repurposed content yet. Click Repurpose Content.”
- **Linkage:** master_content_id links a daily item to a master content entity; repurpose flows generate platform-specific content from that master. No explicit “source_activity_id” or “repurpose_of” on activity cards; linkage is via master_content_id in the content/execution item.

**Repurpose capability map:**

| Capability | Status | Where |
|------------|--------|--------|
| One logical piece ID across platforms | Yes | master_content_id in slot, enriched content, daily-plans response. |
| Generate repurposed content from master | Yes | Activity workspace + API. |
| Show “this is repurposed from X” on card | No | Cards do not display repurpose linkage. |
| Repurpose workflow (PLAN→CREATE→REPURPOSE) | Partial | Activity board has REPURPOSE stage; data model does not explicitly link card to “repurposed from” execution_id. |

---

### Task 3C — Creator Placeholder Handling

**AI-generated vs creator-dependent:**

- **ai_generated:** Set to true in generate-weekly-structure for AI path rows; set when saving daily plan (e.g. save-daily-plan, commit-daily-plan). Stored on `daily_content_plans` row. **Not** mapped onto CalendarActivity or Activity type; not shown on calendar or activity board cards.
- **Creator-dependent / placeholder:** platformIntelligenceService has a path that treats video/audio/podcast as “placeholder” for selection. No `creator_dependent` or `placeholder` on CampaignBlueprintWeek or execution_items. No explicit “creator placeholder” flag on daily plan rows or activity cards.

**Where signal exists:**

- **ai_generated:** On DB row (daily_content_plans); in content JSON when written. Not exposed to card rendering (campaign-calendar does not read it; activity board Activity type does not have it).
- **Placeholder:** Conceptual in platform rules; not in weekly/daily schema or card props.

**Current support level:** Low. System does not distinguish AI-generated vs creator-dependent on the card; no placeholder state on weekly/daily model for “creator to fill.”

---

## PHASE 4 — COLOR SYSTEM ALIGNMENT

### Task 4A — Locate Color Logic

**All places card colors are assigned:**

| Card type | File(s) | Mechanism |
|-----------|---------|-----------|
| **Weekly (week header)** | `pages/campaign-details/[id].tsx` | `getPhaseColor(weekPlan?.phase)` → gradient (Foundation=blue-cyan, Growth=green-emerald, Consolidation=purple-violet, Sustain=orange-red, default=gray-slate). |
| **Weekly (topic cards)** | `pages/campaign-details/[id].tsx` | `getActivityColorClasses(topic?.topicExecution?.contentType)` → card + badge: video/reel/short=red; blog/article=blue; story/thread=amber; default=emerald. |
| **Daily (daily plan list in campaign-details)** | `pages/campaign-details/[id].tsx` | Same `getActivityColorClasses(p.contentType)` for badge (platform • contentType). |
| **Daily (daily plan grid chips)** | `pages/campaign-daily-plan/[id].tsx` | Neutral gray (border-gray-200 bg-gray-50). No content-type color. |
| **Calendar (campaign)** | `pages/campaign-calendar/[id].tsx` | STAGE_META[stage] (violet/sky/emerald/indigo/amber/rose); getReadinessBadge(readiness_label) (emerald/amber/rose). |
| **Activity board** | `components/activity-board/ActivityCard.tsx`, `ActivityBoard.tsx`, `ActivitySidePanel.tsx` | STAGE_BORDER_CLASSES (blue/purple/orange/teal/green by workflow stage); APPROVAL_PILL_CLASSES / APPROVAL_DOT_CLASSES (amber/emerald/red); content type badge = gray. |
| **Dashboard calendar** | `components/DashboardPage.tsx` | getCalendarStageAppearance(stage): daily_cards=green, content_created=sky, content_scheduled=emerald, content_shared=blue, overdue=red, weekly_planning=white/gray. |
| **Content calendar** | `pages/content-calendar.tsx` | getPlatformColor(post.platform): linkedin/facebook=blue, instagram=pink, twitter=sky, youtube=red, tiktok=gray. |
| **Board indicators** | `components/activity-board/board-indicators.ts`, `BoardIntelligenceIndicators.tsx` | Icon color by indicator (overdue=red, due soon=amber, approval=emerald/red/amber, collaboration=indigo/gray, ownership=gray/amber). |

---

### Task 4B — Current Color Meaning (by card type)

**Weekly (campaign-details):**

- **Phase (week header):** Foundation=blue-cyan, Growth=green-emerald, Consolidation=purple-violet, Sustain=orange-red → **campaign phase.**
- **Topic card:** video/reel/short=red, blog/article=blue, story/thread=amber, default=emerald → **content type.**

**Daily (campaign-details list):** Same as weekly topic → **content type.**

**Daily (campaign-daily-plan grid):** No semantic color; gray → **none.**

**Calendar (campaign-calendar):** Stage bar/header = narrative stage (team_note=violet, awareness=sky, education=emerald, authority=indigo, engagement=amber, conversion=rose). Readiness badge = ready=emerald, missing_media=amber, incomplete=rose. → **Stage + readiness.**

**Activity board:** Left border = workflow stage (PLAN=blue, CREATE=purple, REPURPOSE=orange, SCHEDULE=teal, SHARE=green). Pill/dot = approval (pending/request_changes=amber, approved=emerald, rejected=red). → **Workflow stage + approval.**

**Dashboard calendar:** Badge = campaign execution stage (daily_cards, content_created, content_scheduled, content_shared, overdue, weekly_planning). → **Campaign execution stage.**

**Content calendar:** Chip = platform. → **Platform.**

---

### Task 4C — Consistency Check

**Same meaning, different color:**

- **“Green”:** Dashboard = content_scheduled (emerald); Activity board = SHARE (green); Weekly default topic = emerald; Campaign calendar readiness = ready (emerald). So “green” means different things (execution stage vs workflow stage vs content type default vs readiness).
- **“Blue”:** Weekly phase Foundation (blue-cyan); Weekly topic article (blue); Dashboard content_shared (blue); Activity PLAN (blue). Different semantics.
- **“Amber”:** Weekly topic story/thread (amber); Campaign calendar missing_media (amber); Activity board pending/request_changes (amber); Board indicator due soon / unassigned (amber). Multiple meanings.

**Same color, different meaning:** As above — e.g. emerald/green used for “scheduled,” “share stage,” “default post,” “ready.”

**Cross-surface:**

- Weekly topic cards and daily list in campaign-details use **content type** color (same function getActivityColorClasses).
- Campaign calendar uses **narrative stage + readiness** (no content-type color).
- Activity board uses **workflow stage + approval** (content type badge is gray).
- Dashboard uses **campaign execution stage.**

So: **no single semantic** for a given color across weekly / daily / calendar / activity board. Inconsistencies are expected until a single scheme (e.g. responsibility) is adopted.

---

## PHASE 5 — DATA AVAILABILITY FOR OWNERSHIP MODEL

**Card rendering currently has access to:**

| Field | Weekly cards | Daily (details list) | Daily (grid) | Calendar | Activity board |
|-------|--------------|----------------------|--------------|----------|----------------|
| content_type | Yes (topicExecution.contentType) | Yes (p.contentType) | Yes (activity.content_type) | Yes (activity.content_type) | Yes (activity.content_type) |
| platform | Yes (topicExecution.platformTargets) | Yes (p.platform) | Yes (activity.platform) | Yes (activity.platform) | Yes (activity.platforms) |
| status | Completion %; no per-slot status | Plan status (e.g. completed) | — | readiness_label | approval_status |
| execution_owner | No | No | No | No | owner_id / owner_name (assignment) |
| AI vs creator | No | No (ai_generated on row, not in list item) | No | No (raw_item may have it, not mapped) | No |

**Missing for ownership-based coloring:**

- **execution_owner:** Not on any card model (weekly topic, GridActivity, CalendarActivity, Activity).
- **ai_generated:** On daily_content_plans row and in content; not mapped to CalendarActivity or Activity; not in weekly topic or daily list item.
- **Creator-dependent / placeholder:** Not in schema or card props.

**Safest insertion points (audit only):**

- **Blueprint / execution item:** Add optional `ai_generated?: boolean` and `execution_owner?: string` (or responsibility enum) on execution_items / topic_slots and in enriched daily content so downstream can read them.
- **Calendar activity:** When building CalendarActivity from daily_execution_items or daily-plans, map `ai_generated` and `execution_owner` from item or row so the calendar can pass them to the card.
- **Activity type (board):** Extend `Activity` with optional `ai_generated?: boolean` and `execution_owner?: string`; populate from API that serves the board.
- **Daily plan list (campaign-details):** Ensure daily plan API returns ai_generated (and owner if added); use in getActivityColorClasses or a new responsibility-based color function.

---

## PHASE 6 — FINAL ALIGNMENT REPORT

### A. Weekly → Daily → Activity flow map

```
[Weekly blueprint]
  CampaignBlueprint.weeks[] → CampaignBlueprintWeek
  - execution_items (optional), topics, topics_to_cover, platform_allocation, content_type_mix,
    distribution_strategy (optional), weeklyContextCapsule, week_extras
        │
        ▼
[Generate daily structure]  POST /api/campaigns/generate-weekly-structure
  - If execution_items: spread days, build DailyPlanItem from slot intent → rows
  - Else: generateAIDailyDistribution (LLM) → DailyPlanItem → rows
  - Optional: auto_rebalance, auto_optimize_distribution, campaign waves
  - Write daily_content_plans (content JSON, ai_generated, etc.)
        │
        ▼
[Daily plan consumption]
  - retrieve-plan → draftPlan/committedPlan.weeks[].daily_execution_items (if merged back)
  - GET /api/campaigns/daily-plans → transformed plans (with master_content_id when present)
        │
        ├─► Campaign calendar: CalendarActivity[] → article cards → openActivityDetail → sessionStorage → activity-workspace
        ├─► Campaign daily plan: GridActivity[] → grid chips → openActivityWorkspace → sessionStorage → activity-workspace
        └─► Campaign details: weekly topic cards / daily list → openTopicWorkspaceFromWeeklyCard or daily click → sessionStorage → activity-workspace
        │
        ▼
[Activity workspace]
  - Load from sessionStorage(workspaceKey) or GET /api/activity-workspace/resolve
  - Payload: dailyExecutionItem, schedules; resolve can rebuild from blueprint by execution_id
  - Repurpose, master content, refine (no ActivityCard here; different UI)
```

(Activity board with ActivityCard is a separate pipeline view; its activities may come from another source, not necessarily the same sessionStorage flow.)

---

### B. Dual-view implementation status (system vs user)

- **Weekly:** Schema is single; UI shows a subset (theme, phase, topics, platform allocation, writing context). execution_items / resolved_postings not shown. No formal `user_display` vs `execution_intelligence` split in type.
- **Daily:** Rows and content JSON are system-heavy; list/grid show title, platform, content type, status where available. No explicit “user view” subset.
- **Calendar:** Shows title, platform, content_type, readiness, time; raw_item not surfaced. Partially user-friendly.
- **Activity board:** Activity has title, content_type, stage, approval, owner; no AI/creator or execution_owner. No dual-view schema.

**Conclusion:** Dual-view is only partially implemented (show/hide in UI); no consistent schema or contract for “user view” vs “system view” across weekly/daily/activity.

---

### C. Content type readiness (video / carousel / images)

- **Video:** In content_type_mix and platform rules; supported in skeleton and pickContentType. Missing in weekly: duration, hooks, aspect ratio, creator/placeholder flag.
- **Carousel:** In mix and platform rules. Missing: slide count, narrative flow in weekly.
- **Images:** In platform rules (image, media_format). Missing: sourcing, requirements, placeholders in weekly.
- **Post/article:** Best supported; guidance exists in briefs but often not used in daily (default content guidance).

---

### D. Distribution strategy handling location

- **Decided:** In generate-weekly-structure from (1) weekBlueprint.distribution_strategy, else (2) request body distribution_mode (user), default 'staggered'. planningIntelligenceService can compute strategy but is not called in this API.
- **Stored:** On blueprint only if set by orchestrator or other path (e.g. week_extras); not first-class on CampaignBlueprintWeek. User choice sent per request.

---

### E. Repurpose support status

- **master_content_id:** Exists; links one logical piece across platforms; in orchestrator, generate-weekly-structure, daily-plans API, activity-workspace resolve.
- **Repurpose workflow:** Activity workspace can generate repurposed content from master; no card-level “repurposed from” display.
- **Activity board REPURPOSE stage:** Present; no explicit data link from card to source execution_id.

---

### F. Current color system (full mapping)

| Surface | Color | Meaning | Source |
|---------|-------|--------|--------|
| Weekly header | blue-cyan, green-emerald, purple-violet, orange-red, gray-slate | Phase (Foundation, Growth, Consolidation, Sustain) | getPhaseColor(phase) |
| Weekly topic / daily list | red, blue, amber, emerald | Content type (video/reel/short, article/blog, story/thread, default) | getActivityColorClasses(contentType) |
| Daily grid chips | gray | — | Fixed |
| Calendar | violet, sky, emerald, indigo, amber, rose | Narrative stage (team_note, awareness, education, authority, engagement, conversion) | STAGE_META |
| Calendar | emerald, amber, rose | Readiness (ready, missing_media, incomplete) | getReadinessBadge |
| Activity board | blue, purple, orange, teal, green | Workflow stage (PLAN, CREATE, REPURPOSE, SCHEDULE, SHARE) | STAGE_BORDER_CLASSES |
| Activity board | amber, emerald, red | Approval (pending/request_changes, approved, rejected) | APPROVAL_PILL_CLASSES |
| Dashboard calendar | green, sky, emerald, blue, red, white/gray | Campaign execution stage (daily_cards, content_created, content_scheduled, content_shared, overdue, weekly_planning) | getCalendarStageAppearance |
| Content calendar | blue, pink, sky, red, gray | Platform | getPlatformColor |

---

### G. Color consistency issues

- Same color (e.g. green/emerald, blue, amber) used for different semantics across surfaces (phase vs content type vs stage vs readiness vs approval vs execution stage).
- Content-type color only on weekly topic and campaign-details daily list; calendar and activity board do not use content-type color (calendar = stage/readiness; board = workflow/approval).
- Daily grid has no semantic color. No ownership or AI vs creator color anywhere.

---

### H. Feasibility of ownership-based coloring

- **Feasible** once data exists: add ai_generated and/or execution_owner (or responsibility) to the payloads that build calendar and activity cards; use a single “responsibility” color function (e.g. AI=one hue, creator=another, placeholder=third) for weekly/daily/calendar/board.
- **Blockers:** execution_owner and ai_generated (and placeholder) not on card models; ai_generated not mapped from row to CalendarActivity or Activity. Resolved by insertion points in Phase 5.

---

### I. Safest insertion points for future refinement

1. **Blueprint / execution layer:** Add optional `ai_generated`, `execution_owner` (or `responsibility`), and `placeholder`/creator-dependent on execution_items or topic_slots; ensure weekly enrichment or orchestrator sets them where known.
2. **Daily plan API and mapping:** Return ai_generated (and owner if added) in daily-plans and in retrieve-plan merged daily_execution_items; map into CalendarActivity and into any daily list item.
3. **Activity type and board API:** Add optional fields to Activity; populate from backend so ActivityCard can receive them.
4. **Color function:** Introduce a single responsibility-based color helper (or extend getActivityColorClasses) and use it on weekly topic, daily list, calendar card, and activity board when data is present; keep fallback (e.g. content type or gray) when not.
5. **Distribution strategy:** Persist distribution_strategy on CampaignBlueprintWeek (or week_extras) when planning or enriching; read only from blueprint in generate-weekly-structure so request-body is override only.
6. **Content guidance:** In generate-weekly-structure, pass brief per slot (e.g. from briefByKey) into deriveContentGuidance so daily rows get weekly guidance instead of default.

---

**End of alignment audit.**

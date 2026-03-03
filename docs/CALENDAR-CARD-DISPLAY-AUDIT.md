# Calendar Card Display Logic — Audit (Current Behavior)

**Goal:** Document exactly how activity cards are shown on the calendar, especially color usage, to prepare for an ownership-based color model.  
**No code changes. No UI redesign. Inspection and documentation only.**

---

## TASK 1 — Locate Calendar Card Rendering

### Where calendar cards are rendered

| Location | File(s) | What is rendered |
|----------|---------|-------------------|
| **Campaign calendar (main)** | `pages/campaign-calendar/[id].tsx` | One calendar view per campaign. Activities come from `retrieve-plan` (draftPlan/committedPlan weeks → `daily_execution_items`) or fallback from `daily-plans` API. Activities are grouped by date, then by **stage** (team_note, awareness, education, authority, engagement, conversion). Each day is a section; within it, stage groups with headers and a list of **article**-style cards (not the ActivityCard component). |
| **Dashboard calendar** | `components/DashboardPage.tsx` | Calendar tab: month or week grid. Each cell shows **campaign-level** activities (campaign name + execution stage). Activities are `CalendarActivity[]` with `campaign`, `stage`, `label`, optional `weekNumber`. Cards are small badges (`appearance.badge`) and detail list rows. Not per-execution-item cards. |
| **Content calendar** | `pages/content-calendar.tsx` | Generic content calendar: uses `calendarData.scheduledPosts`. Card color by **platform** via `getPlatformColor(post.platform)`. Simulated data in current implementation. |
| **Activity board (workflow)** | `components/activity-board/ActivityBoard.tsx` + `ActivityCard.tsx` | Pipeline board (PLAN → CREATE → REPURPOSE → SCHEDULE → SHARE). Uses **ActivityCard** for each activity. Cards are in columns by **stage**. Data source: `activities: Activity[]` passed from parent (not tied to campaign-calendar page). |

### Components that build activity cards

| Component | File | Data input | Used on |
|------------|------|------------|--------|
| **ActivityCard** | `components/activity-board/ActivityCard.tsx` | `activity: Activity` (id, title, content_type, stage, approval_status, owner_id, owner_name, platforms, due_date, due_time, execution_id, campaign_id, week_number, day) | Activity board (workflow view); may be used from activity-workspace or other board consumers. |
| **Campaign calendar day cards** | `pages/campaign-calendar/[id].tsx` (inline JSX) | `CalendarActivity` (execution_id, week_number, day, date, time, title, platform, content_type, readiness_label, execution_jobs, raw_item). Grouped by **StageGroup** (stage, title, colorClass, count, items). | Campaign calendar page only. |
| **Dashboard calendar badges** | `components/DashboardPage.tsx` (inline) | `CalendarActivity` (campaign, stage, label, weekNumber?). Stage from `getCampaignExecutionStage(campaign)` (counts + end date). | Dashboard calendar tab. |
| **Content calendar post chips** | `pages/content-calendar.tsx` | `post: { platform, ... }`. Color from `getPlatformColor(post.platform)`. | Content calendar page. |

### Where color or styling decisions are applied

| File | What is styled | Mechanism |
|------|----------------|-----------|
| `pages/campaign-calendar/[id].tsx` | Day section bar (stage strip), stage group header (swatch + pill), readiness badge on each card, card container (white/gray border) | `STAGE_META[stage].colorClass`, `STAGE_META[stage].pillClass`, `getReadinessBadge(readiness_label)`, fixed Tailwind classes. |
| `components/activity-board/ActivityCard.tsx` | Card left border (stage), approval pill and dot, content type badge, action buttons | `STAGE_BORDER_CLASSES[activity.stage]`, `APPROVAL_PILL_CLASSES[activity.approval_status]`, `APPROVAL_DOT_CLASSES`, content type = neutral gray badge. |
| `components/activity-board/ActivityBoard.tsx` | Column headers | `STAGE_HEADER_CLASSES[stage]`. |
| `components/activity-board/ActivitySidePanel.tsx` | Stage badge in panel header | `STAGE_BADGE_CLASSES_PANEL[activity.stage]`. |
| `components/DashboardPage.tsx` | Calendar cell badges and detail list badges | `getCalendarStageAppearance(stage).badge` (and .dot, .label). |
| `pages/content-calendar.tsx` | Post/platform chips | `getPlatformColor(post.platform)`. |
| `components/activity-board/board-indicators.ts` | Indicator icons (overdue, approval, collaboration, ownership) | `BoardIndicatorItem.colorClass` (e.g. text-red-500, text-emerald-600). |
| `components/activity-board/BoardIntelligenceIndicators.tsx` | Renders indicator list with `item.colorClass`. | Same. |
| `components/activity-board/types.ts` | Message sender role accents | `ROLE_ACCENT_CLASSES[SenderRole]` (not card color; message bubbles). |

---

## TASK 2 — Current Color Logic (CRITICAL)

### Campaign calendar (`pages/campaign-calendar/[id].tsx`)

**Stage (narrative/campaign stage)** — drives bar segment, group header, and group swatch:

| Color / class | Meaning | Source logic |
|---------------|--------|--------------|
| **Violet** (`bg-violet-500`, `text-violet-700 bg-violet-100 border-violet-200`) | Stage = **team_note** | `STAGE_META.team_note`. Team notes extracted from raw_item (team_note, teamNote, team_instruction, etc.). |
| **Sky** (`bg-sky-500`, pill sky-100/sky-700) | Stage = **awareness** | `STAGE_META.awareness`. Assigned by `resolveStageForActivity()`: explicit `raw_item.stage` or `execution_readiness.narrative_role`, else `mapDeterministicFallbackStage()` from content_type + readiness. |
| **Emerald** | Stage = **education** | `STAGE_META.education`. Same resolution. |
| **Indigo** | Stage = **authority** | `STAGE_META.authority`. Same resolution. |
| **Amber** | Stage = **engagement** | `STAGE_META.engagement`. Same resolution. |
| **Rose** | Stage = **conversion** | `STAGE_META.conversion`. Same resolution. |

**Readiness (execution readiness)** — badge on each card:

| Color / class | Meaning | Source logic |
|---------------|--------|--------------|
| **Emerald** (`bg-emerald-100 text-emerald-700`) | **Ready to Schedule** | `readiness_label === 'ready'` from `execution_readiness.ready_to_schedule`. |
| **Amber** (`bg-amber-100 text-amber-700`) | **Missing Media** | `readiness_label === 'missing_media'` when blocking_reasons include 'missing_required_media'. |
| **Rose** (`bg-rose-100 text-rose-700`) | **Incomplete** | `readiness_label === 'incomplete'` otherwise. |

**Other:** Card container = white bg, gray border. Platform/content_type = neutral gray pills. “Open Activity Detail” = indigo. No color by content_type or platform on the card itself.

---

### Activity board / ActivityCard (`components/activity-board/`)

**Stage (workflow stage)** — left border only:

| Color | Meaning | Source logic |
|-------|--------|--------------|
| **Blue** (`border-l-blue-500`) | stage = **PLAN** | `STAGE_BORDER_CLASSES.PLAN`. |
| **Purple** | stage = **CREATE** | `STAGE_BORDER_CLASSES.CREATE`. |
| **Orange** | stage = **REPURPOSE** | `STAGE_BORDER_CLASSES.REPURPOSE`. |
| **Teal** | stage = **SCHEDULE** | `STAGE_BORDER_CLASSES.SCHEDULE`. |
| **Green** | stage = **SHARE** | `STAGE_BORDER_CLASSES.SHARE`. |
| **Gray** | unknown stage | `STAGE_BORDER_CLASSES[activity.stage] ?? 'border-l-gray-300'`. |

**Approval status** — pill + dot:

| Color | Meaning | Source logic |
|-------|--------|--------------|
| **Amber** (`bg-amber-100 text-amber-800`, dot amber-500) | pending, request_changes | `APPROVAL_PILL_CLASSES` / `APPROVAL_DOT_CLASSES`. |
| **Emerald** | approved | Same. |
| **Red** | rejected | Same. |
| **Gray** | fallback | When status not in map. |

**Content type badge:** Always **gray** (`bg-gray-100 text-gray-700`). No color by content_type.

**Board indicators (icons):** Overdue = red; near due = amber; attention/blocked = amber; approved = emerald; rejected = red; changes_requested = amber; collaboration (messages) = indigo or gray; ownership unassigned = amber, assigned = gray.

---

### Dashboard calendar (`components/DashboardPage.tsx`)

**Execution stage (campaign-level)** — badge in cell and detail list:

| Color / class | Meaning | Source logic |
|---------------|--------|--------------|
| **Green** (`bg-green-100 text-green-800 border-green-200`) | **daily_cards** | `getCalendarStageAppearance('daily_cards')`. Stage from `getCampaignExecutionStage(campaign)`: dailyPlans > 0, no content ready. |
| **Sky** | **content_created** | contentReadyDailyPlans > 0. |
| **Emerald** (`bg-emerald-600 text-white`) | **content_scheduled** | scheduledPosts > 0. |
| **Blue** (`bg-blue-700 text-white`) | **content_shared** | publishedPosts > 0. |
| **Red** | **overdue** | Campaign end date past and incomplete. |
| **White/gray** | **weekly_planning** | Default: no daily plans yet. |

So **color = campaign execution stage** (weekly_planning → daily_cards → content_created → content_scheduled → content_shared, or overdue).

---

### Content calendar (`pages/content-calendar.tsx`)

| Color | Meaning | Source logic |
|-------|--------|--------------|
| **Blue** (`bg-blue-100 text-blue-700`) | linkedin, facebook | `getPlatformColor(platform)`. |
| **Pink** | instagram | Same. |
| **Sky** | twitter | Same. |
| **Red** | youtube | Same. |
| **Gray** | tiktok, default | Same. |

**Color = platform only.** No content_type or ownership.

---

### Summary: what each color means today

- **Campaign calendar:** Color = **narrative/campaign stage** (team_note, awareness, education, authority, engagement, conversion) and **readiness** (ready / missing_media / incomplete). Not content type, not platform, not AI vs creator.
- **Activity board (ActivityCard):** Color = **workflow stage** (PLAN/CREATE/REPURPOSE/SCHEDULE/SHARE) + **approval status**. Content type is neutral gray.
- **Dashboard calendar:** Color = **campaign execution stage** (weekly_planning, daily_cards, content_created, content_scheduled, content_shared, overdue).
- **Content calendar:** Color = **platform** (linkedin, facebook, instagram, twitter, youtube, tiktok).

**No surface uses color for “AI-generated” vs “creator-dependent” or “placeholder” today.**

---

## TASK 3 — Data Available for Color Decisions

### Campaign calendar (`CalendarActivity` in `campaign-calendar/[id].tsx`)

**Fields available when rendering:**

- `execution_id`, `week_number`, `day`, `date`, `time`
- `title`, `platform`, `content_type`
- `readiness_label`: 'ready' | 'missing_media' | 'incomplete'
- `execution_jobs`: array of { job_id, platform, status, ready_to_schedule }
- `raw_item`: full execution item (e.g. from `daily_execution_items` or daily-plans row)

**From `raw_item` (if present):** Anything on the daily execution item or content JSON, e.g.:

- `stage`, `execution_readiness` (ready_to_schedule, blocking_reasons, narrative_role, etc.)
- `writer_content_brief`, `intent`, `platform`, `content_type`, `topic`, `title`
- `media_status` (if set by pipeline) — not guaranteed on all items
- No `execution_owner` or `ai_generated` on the **CalendarActivity** type; they may exist on the row or inside `raw_item` but are not explicitly mapped

**When data comes from daily-plans API (fallback):** Each plan row has `ai_generated` (boolean) on the row. The calendar maps to `CalendarActivity` and sets `raw_item` to `dailyObject` or `plan`; the row’s `ai_generated` is not copied onto `CalendarActivity`, so it’s available only if the consumer reads it from the plan response (e.g. if we passed plan row into raw_item or a separate field).

**When data comes from retrieve-plan (draftPlan/committedPlan.weeks[].daily_execution_items):** Items are whatever the blueprint stores; typically no `ai_generated` on the item itself. Row-level `ai_generated` exists only for rows written by generate-weekly-structure into `daily_content_plans`.

### Activity board (`Activity` in `activity-board/types.ts`)

**Fields available:**

- `id`, `title`, `content_type`, `stage` (PLAN|CREATE|REPURPOSE|SCHEDULE|SHARE), `approval_status`, `owner_id`, `owner_name`, `platforms`, `due_date`, `due_time`, `metadata`, `approved_by`, `approved_at`, `execution_id`, `campaign_id`, `week_number`, `day`

**Not on Activity type:** `ai_generated`, `execution_owner`, `media_status`, `placeholder`, “creator-dependent” flag. So **ownership/AI vs creator signals are not in the current Activity model** for the board.

### Dashboard calendar

Uses **campaign** + **stageAvailability** (counts). No per-card execution or ownership fields.

### Fields currently available vs missing for ownership-based coloring

| Field / concept | Campaign calendar | Activity board (Activity) | Dashboard calendar |
|-----------------|-------------------|---------------------------|--------------------|
| content_type | ✅ (and in raw_item) | ✅ | N/A (campaign-level) |
| platform | ✅ | ✅ (platforms[]) | N/A |
| status / readiness | ✅ readiness_label; raw_item.execution_readiness | ✅ approval_status | N/A |
| execution_id | ✅ | ✅ | N/A |
| **execution_owner** | ❌ not on type; not in raw_item in code | ❌ | N/A |
| **ai_generated** | ⚠️ on daily_content_plans row when from API; not mapped onto CalendarActivity | ❌ | N/A |
| **media_status / placeholder** | ⚠️ may exist inside raw_item (e.g. from pipeline) | ❌ | N/A |
| **Creator-dependent / placeholder** | ❌ no explicit flag | ❌ | N/A |

So: **ownership and “AI vs creator” are not first-class on card types.** For ownership-based coloring we’d need to (a) define and expose something like `execution_owner` or `responsibility` and (b) ensure `ai_generated` and/or “creator-dependent” (e.g. placeholder, missing_media) are available where cards are rendered (e.g. on CalendarActivity or in raw_item contract).

---

## TASK 4 — Activity Card Information Audit (User View)

What is shown on each card **today**, and a minimal classification.

### Campaign calendar card (per-activity article in `campaign-calendar/[id].tsx`)

| Field / element | Shown | Classification |
|------------------|--------|----------------|
| Title | ✅ (h4) | **Content** |
| Readiness badge | ✅ (Ready to Schedule / Missing Media / Incomplete) | **Execution / status** |
| Time | ✅ (Clock + time) | **Execution** |
| Platform | ✅ (glyph + label, gray pill) | **Distribution** |
| Content type | ✅ (capitalize, gray pill) | **Content** |
| Execution jobs (platform + ready/blocked) | ✅ if present (slate pill) | **Execution** |
| “Open Activity Detail” button | ✅ (indigo) | **Action** |
| Stage | ✅ indirectly (card is under a stage group header; bar and header use stage color) | **Strategy / stage** |

Not shown on card: owner, AI vs creator, campaign name (only in page title), due date (date is in section header).

### Activity board card (`ActivityCard.tsx`)

| Field / element | Shown | Classification |
|------------------|--------|----------------|
| Title | ✅ | **Content** |
| Content type | ✅ (gray badge, labelize) | **Content** |
| Owner name | ✅ (text gray-500) | **Ownership** |
| Approval status | ✅ (pill + dot: pending/approved/rejected/request_changes) | **Status** |
| Due date/time | ✅ if present | **Execution** |
| Board indicators row | ✅ (overdue, due soon, approval, collaboration, ownership) | **Status / ownership / collaboration** |
| Hover: Open, Move, Approve | ✅ | **Actions** |
| Stage | ✅ (left border color only) | **Strategy / stage** |

### Dashboard calendar (cell badge and detail row)

| Field / element | Shown | Classification |
|------------------|--------|----------------|
| Label | ✅ (campaign name or “Week N – campaign name”) | **Campaign** |
| Stage badge | ✅ (color from getCalendarStageAppearance) | **Campaign execution stage** |
| Detail: campaign dates, “View campaign” | ✅ in detail panel | **Campaign / action** |

### Content calendar (post chip / list item)

| Field / element | Shown | Classification |
|------------------|--------|----------------|
| Platform (color chip) | ✅ | **Distribution** |
| Title, content snippet, time, engagement | ✅ in list | **Content / execution** |

---

## Summary Table — Color → Meaning → Source

| Surface | Color | Meaning | Source |
|---------|-------|--------|--------|
| Campaign calendar | Violet | team_note | STAGE_META.team_note |
| Campaign calendar | Sky | awareness | resolveStageForActivity → STAGE_META.awareness |
| Campaign calendar | Emerald | education | STAGE_META.education |
| Campaign calendar | Indigo | authority | STAGE_META.authority |
| Campaign calendar | Amber | engagement | STAGE_META.engagement |
| Campaign calendar | Rose | conversion | STAGE_META.conversion |
| Campaign calendar | Emerald pill | Ready to Schedule | getReadinessBadge('ready') |
| Campaign calendar | Amber pill | Missing Media | getReadinessBadge('missing_media') |
| Campaign calendar | Rose pill | Incomplete | getReadinessBadge('incomplete') |
| Activity board | Blue left border | PLAN | STAGE_BORDER_CLASSES.PLAN |
| Activity board | Purple left border | CREATE | STAGE_BORDER_CLASSES.CREATE |
| Activity board | Orange left border | REPURPOSE | STAGE_BORDER_CLASSES.REPURPOSE |
| Activity board | Teal left border | SCHEDULE | STAGE_BORDER_CLASSES.SCHEDULE |
| Activity board | Green left border | SHARE | STAGE_BORDER_CLASSES.SHARE |
| Activity board | Amber pill/dot | pending / request_changes | APPROVAL_PILL_CLASSES |
| Activity board | Emerald pill/dot | approved | Same |
| Activity board | Red pill/dot | rejected | Same |
| Dashboard calendar | Green | daily_cards | getCalendarStageAppearance |
| Dashboard calendar | Sky | content_created | Same |
| Dashboard calendar | Emerald (solid) | content_scheduled | Same |
| Dashboard calendar | Blue (solid) | content_shared | Same |
| Dashboard calendar | Red | overdue | Same |
| Dashboard calendar | White/gray | weekly_planning | Same |
| Content calendar | Blue/Pink/Sky/Red/Gray | platform | getPlatformColor(platform) |

---

**End of audit.**

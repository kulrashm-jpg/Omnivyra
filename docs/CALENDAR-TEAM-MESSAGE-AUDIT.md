# CALENDAR TEAM MESSAGE AUDIT

**Audit date:** 2025-03-13  
**Goal:** Verify whether the system supports team messages / internal notes on the calendar, with:
- **Scheduled Activities** → horizontal cards
- **Team Messages / Team Notes** → vertical markers

---

## SECTION 1 — TEAM MESSAGE DATA SOURCES

| Table / Model | File Path | Fields | Used In UI (Yes/No) |
|---------------|-----------|--------|--------------------|
| *(none)* | — | — | — |
| **Embedded team_note** | `daily_execution_items` (blueprint) / `daily_content_plans` content JSON | `team_note`, `teamNote`, `team_instruction`, `notes.team` | Yes (campaign-calendar only) |
| **engagement_messages** | `database/engagement_unified_model.sql` | External engagement messages | No (engagement inbox, not calendar) |
| **post_comments** | `database/step10-comment-engagement.sql` | Social post comments | No |
| **direct_messages** | `database/step10-comment-engagement.sql` | Social DMs | No |
| **ai_threads** | `database/campaign-management-clean-schema.sql` | `id`, `campaign_id`, `messages`, `context` | No (AI chat, not calendar messages) |

**Summary:** No dedicated `team_messages`, `campaign_messages`, `team_notes`, `internal_notes`, `calendar_notes`, `team_updates`, `campaign_comments`, or `annotations` tables exist. The only team-related data is `team_note` embedded in activity/plan objects (`raw_item.team_note`, `teamNote`, `team_instruction`, `notes?.team`), extracted at runtime and displayed on the campaign calendar.

---

## SECTION 2 — CALENDAR MESSAGE IMPLEMENTATION

| Component | Supports Messages | Rendering Style | Orientation (Vertical/Horizontal) |
|-----------|--------------------|-----------------|-----------------------------------|
| **components/DashboardPage.tsx** | No | Activity events or campaign-stage badges | Horizontal only |
| **pages/calendar-view.tsx** | Partial (mock) | `reminder` / `task` itemTypes as cards | Horizontal only |
| **pages/content-calendar.tsx** | No | Scheduled posts (mock) | Horizontal only |
| **pages/campaign-calendar/[id].tsx** | Yes (`team_note`) | Article-style cards in stage group | Horizontal |

**Details:**
- **Campaign calendar:** Extracts `team_note` from `raw_item` via `extractTeamNote()`, places in `team_note` stage bucket, renders as horizontal article-style cards (same as awareness, education, etc.). Team notes are **not** vertical markers.
- **Dashboard calendar:** Shows activity events (scheduled_posts) or campaign stages. No team messages, notes, or vertical markers.
- **calendar-view:** Has `itemType: 'reminder' \| 'task'` and QuickAdd UI, but uses mock data only; no persistence, no vertical markers.
- **content-calendar:** Mock scheduled posts only; no messages.

**Vertical markers:** No calendar component renders vertical markers for messages. The `ActivityMessageThread` and `ActivitySidePanel` use a "vertical message thread" for activity comments, but that is in the activity side panel, not on the calendar grid.

---

## SECTION 3 — MESSAGE COLOR MAPPING

| Message Type | Color | Where Defined |
|--------------|-------|----------------|
| **team_note** (campaign calendar) | Violet (`bg-violet-500`, `text-violet-700 bg-violet-100 border-violet-200`) | `pages/campaign-calendar/[id].tsx` — `STAGE_META.team_note` |
| **reminder** (calendar-view mock) | Violet (`bg-violet-500/20 text-violet-200 border-violet-400/30`) | `pages/calendar-view.tsx` — `itemType === 'reminder'` |
| **task** (calendar-view mock) | Orange (`bg-orange-500/20 text-orange-200 border-orange-400/30`) | `pages/calendar-view.tsx` — `itemType === 'task'` |

**Approval request, internal message:** No dedicated types or color mappings found.

---

## SECTION 4 — MESSAGE CREATION FLOW

| Component | File Path | Creates Calendar Message (Yes/No) |
|-----------|-----------|-----------------------------------|
| **QuickAdd (reminder/task)** | `pages/calendar-view.tsx` | No — mock only, not persisted |
| **AddNoteButton** | *(not found)* | — |
| **AddComment** | *(not found)* | — |
| **TeamMessageInput** | *(not found)* | — |
| **CalendarNoteModal** | *(not found)* | — |

**Summary:** No UI exists to create and persist standalone team messages for the calendar. Team notes in the campaign calendar are derived from `team_note` / `team_instruction` fields embedded in AI-generated or manually edited plan content; there is no dedicated creation flow for calendar-specific messages.

---

## SECTION 5 — MESSAGE SCHEMA

**Dedicated message table for calendar:** None.

**Embedded team_note (in plan/activity JSON):**
- Source: `raw_item` on `CalendarActivity` (from `daily_execution_items` or `daily_content_plans`)
- Extracted fields: `team_note`, `teamNote`, `team_instruction`, `teamInstruction`, `notes.team`
- Shape: Free-form text string (first line used for display)

**Expected schema for standalone calendar messages (not present):**

| Field | Expected | Present |
|-------|----------|---------|
| message_id | UUID | No |
| campaign_id | UUID | No |
| date | DATE | No |
| message_text | TEXT | No |
| created_by | UUID | No |
| team_member_id | UUID | No |
| message_type | VARCHAR | No |

---

## SECTION 6 — INTEGRATION READINESS

**Does the current system already support team message events on the calendar?**

### **NO**

**What is missing:**

1. **Data model:** No `team_messages`, `campaign_messages`, or equivalent table for standalone calendar messages.
2. **Vertical markers:** All calendar rendering uses horizontal cards or badges. There is no vertical-marker layout for messages.
3. **Dashboard calendar:** Does not show any team messages or notes; only activity events and campaign stages.
4. **Message creation:** No UI to add team messages or notes to a calendar date.
5. **Message types:** Only `team_note` (embedded in activities) exists; no approval request, reminder, internal message, or other message-type abstraction.
6. **Campaign vs dashboard:** `team_note` appears only on the campaign calendar, embedded in activities and rendered as horizontal cards, not as standalone vertical markers.

---

## SECTION 7 — RECOMMENDED CALENDAR RENDERING MODEL

**Target:**
- **Activities** → horizontal cards
- **Messages** → vertical markers

**Proposed integration (if team messages are added):**

1. **Data model:** Add `calendar_messages` (or `team_calendar_messages`) with `id`, `campaign_id`, `company_id`, `date`, `message_text`, `message_type`, `created_by`, `created_at`.
2. **API:** `GET /api/calendar/activity-events` extended (or new `GET /api/calendar/messages`) to return messages for the visible date range.
3. **Rendering:**
   - **Activities:** Keep horizontal card layout (platform icon, title, repurpose label).
   - **Messages:** Add a vertical strip or marker per date (e.g., thin vertical bar, or small vertical pill) with message count or type icon; expand on click to show message list.
4. **Layout:** Within each day cell:
   - Top/side: vertical marker(s) for messages (e.g., left-edge colored bar, or vertical pill).
   - Main area: horizontal activity cards as today.
5. **Message creation:** Add "Add note" / "Add message" control on day click or in day detail panel; persist to new table and refresh calendar.
6. **Message types and colors:** Map message_type to colors (e.g., note = gray, reminder = violet, approval = amber) analogous to `STAGE_META` / `itemType` handling.

---

## APPENDIX — RELEVANT CODE REFERENCES

| Concept | Location |
|---------|----------|
| `extractTeamNote` | `pages/campaign-calendar/[id].tsx` lines 135–145 |
| `STAGE_META.team_note` | `pages/campaign-calendar/[id].tsx` line 88 |
| `buildStageGroupsForDay` (team_note bucket) | `pages/campaign-calendar/[id].tsx` lines 155–169 |
| ActivityMessageThread (vertical, non-calendar) | `components/activity-board/ActivityMessageThread.tsx` |
| QuickAdd reminder/task | `pages/calendar-view.tsx` lines 64–67, 408–419 |
| Dashboard calendar cells | `components/DashboardPage.tsx` — `getCalendarDayItems`, activity-event / campaign-stage badges |

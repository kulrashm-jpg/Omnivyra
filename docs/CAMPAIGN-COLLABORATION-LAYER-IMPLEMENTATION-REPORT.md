# Campaign Collaboration Layer — Implementation Report

## Overview

Chat system aligned with campaign structure: **Campaign → Day → Activity**. All chats belong to one of these contexts. Features implemented: Activity Chat, Day Chat (calendar), Campaign Chat (APIs only), comment indicators on activities, vertical message markers in calendar, and a floating chat panel.

---

## Files Created

| File | Description |
|------|-------------|
| `database/campaign_collaboration_layer.sql` | Migration: `activity_messages`, `calendar_messages`, `campaign_messages` tables |
| `pages/api/activity/messages.ts` | GET/POST activity messages API |
| `pages/api/activity/message-counts.ts` | GET batch message counts per activity (comment indicators) |
| `pages/api/calendar/messages.ts` | GET/POST calendar (day) messages API |
| `pages/api/calendar/message-counts.ts` | GET message counts per date (vertical markers) |
| `pages/api/campaign/messages.ts` | GET/POST campaign messages API |
| `components/collaboration/FloatingChatPanel.tsx` | Draggable, resizable floating chat panel |

---

## Files Modified

| File | Changes |
|------|---------|
| `components/DashboardPage.tsx` | Added collaboration state, calendar message counts fetch, activity message counts fetch, vertical markers in day cells, activity card layout (platform icon, comment indicator), FloatingChatPanel integration, message load/send effects |
| `components/CompanyContext.tsx` | Exposed `user` in context (for `user.userId` in chat panel) |

---

## Database Tables Added

| Table | Purpose |
|-------|---------|
| `activity_messages` | Messages scoped to a specific activity (`activity_id`, `campaign_id`, `parent_message_id`, `message_text`, `created_by`, `created_at`) |
| `calendar_messages` | Messages scoped to a specific calendar date (`campaign_id`, `message_date`, `parent_message_id`, `message_text`, `created_by`, `created_at`) |
| `campaign_messages` | Messages scoped to a campaign (`campaign_id`, `parent_message_id`, `message_text`, `created_by`, `created_at`) |

---

## APIs Added

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/activity/messages` | GET | List messages for activity (`activityId`, `campaignId`) |
| `/api/activity/messages` | POST | Create message (body: `activityId`, `campaignId`, `message_text`, `parent_message_id?`) |
| `/api/activity/message-counts` | GET | Batch counts per activity (`campaignId`, `activityIds` comma-separated) |
| `/api/calendar/messages` | GET | List messages for date (`campaignId`, `date` YYYY-MM-DD) |
| `/api/calendar/messages` | POST | Create message (body: `campaignId`, `date`, `message_text`, `parent_message_id?`) |
| `/api/calendar/message-counts` | GET | Counts per date (`campaignId` or `campaignIds`, `dates` comma-separated) |
| `/api/campaign/messages` | GET | List messages for campaign (`campaignId`) |
| `/api/campaign/messages` | POST | Create message (body: `campaignId`, `message_text`, `parent_message_id?`) |

---

## UI Components Added

| Component | Description |
|-----------|-------------|
| `FloatingChatPanel` | Draggable, resizable panel; bottom-right default; close button; current user = blue bubble, teammate = gray bubble; threaded display |
| Vertical message marker | Small bar in each calendar day cell when `calendar_messages` exist for that date; click opens Team Chat |
| Comment indicator on activity cards | `💬 N` icon when `activity_messages` count > 0; click opens Activity Discussion panel |
| Updated activity card layout | Platform icon (replacing platform text), Content Type, Topic, Repurpose order, Time/date |

---

## Message Threading

All tables support replies via `parent_message_id`. Roots have `parent_message_id = null`; replies reference the parent. Responses are grouped by parent for threaded display.

---

## Permissions

Only campaign members can post and read messages. Uses existing `requireCampaignAccess` from `backend/services/campaignAccessService.ts`.

---

## Implementation Status

| Feature | Status |
|---------|--------|
| Activity Chat | ✅ API + UI (FloatingChatPanel, comment indicator) |
| Day Chat (calendar) | ✅ API + UI (vertical markers, Team Chat panel) |
| Campaign Chat | ✅ API only (no dedicated UI yet) |
| Comment indicator on activities | ✅ |
| Vertical message markers in calendar | ✅ |
| Floating chat panel | ✅ Draggable, resizable, close button |
| Message colors (blue/gray) | ✅ |
| Activity card layout update | ✅ Platform icon, Content Type, Topic, Repurpose |
| Activity Board integration | ⏳ Uses existing `messageCountByActivity`; needs wiring to new API |

---

## Notes

- **Activity ID** maps to `execution_id` in dashboard calendar events.
- **Campaign calendar page** (`pages/campaign-calendar/[id].tsx`) can reuse `FloatingChatPanel` and activity message-counts API for its own activity cards.
- Day chat uses the first campaign in the filtered list when `calendarCampaignFilter === 'all'`.

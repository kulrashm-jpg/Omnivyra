# Dashboard Calendar Activity-Level Scheduling – Implementation Report

## Summary
Upgraded the dashboard calendar to show **individual scheduled activities** from `scheduled_posts` instead of campaign-stage badges. When no scheduled posts exist, falls back to campaign-stage view.

---

## Files Modified

| File | Changes |
|------|---------|
| `pages/api/calendar/activity-events.ts` | **New** – API endpoint for activity events |
| `components/DashboardPage.tsx` | Activity events state, fetch, rendering, platform colors, click-to-workspace |
| `backend/services/structuredPlanScheduler.ts` | Add `title` to scheduled_posts insert in `scheduleFromDailyPlans` |

---

## New API Created

### `GET /api/calendar/activity-events`

**Purpose:** Return scheduled activity events for dashboard calendar, scoped to visible month.

**Query Parameters:**
- `start` (required): YYYY-MM-DD – start of range
- `end` (required): YYYY-MM-DD – end of range
- `companyId` (required): company scope
- `campaignId` (optional): filter by campaign

**Auth:** `enforceCompanyAccess` – user must have company access.

**Data Source:** `scheduled_posts` filtered by:
- Campaigns linked to company via `campaign_versions`
- `scheduled_for` between start and end
- Status in `['scheduled', 'draft', 'publishing', 'published']`

**Response Format:**
```json
[
  {
    "date": "2025-03-18",
    "platform": "linkedin",
    "title": "AI introduction",
    "repurpose_index": 1,
    "repurpose_total": 3,
    "campaign_id": "...",
    "content_type": "post",
    "scheduled_post_id": "...",
    "execution_id": "..."
  }
]
```

**Title Resolution:**
- `scheduled_posts.title` if set
- Else parsed from `content` (e.g. `Content for "AI introduction"`)
- Else `"Scheduled post"`

---

## Calendar Rendering Changes

### Before
- Each date cell showed **campaign-stage** badges (Weekly Planning, Daily Cards, Content Scheduled, etc.).
- One badge per campaign in date range.

### After
- Each date cell shows **activity events** when `scheduled_posts` exist:
  - Platform icon
  - Platform label — Title (repurpose_index/repurpose_total)
  - Example: `LinkedIn — AI introduction (1/3)`
- Platform color coding: linkedin→blue, facebook→indigo, instagram→pink, youtube→red, twitter/x→black.
- When no activity events for the month, falls back to campaign-stage view (unchanged).

### Detail Panel
- For activity events: platform icon, title, repurpose label, “Open Activity Workspace” button.
- For campaign fallback: label, dates, stage badge, “Open Campaign” button.

---

## Event Click Behavior

- **When `execution_id` exists (repurpose_parent_execution_id):**
  - Opens: `/activity-workspace?campaignId=...&executionId=...`
- **When no `execution_id`:**
  - Opens: `/campaign-calendar/[campaignId]?date=...`

---

## Performance

- Calendar loads only events for the **visible month**.
- Query: `scheduled_for BETWEEN startOfMonth AND endOfMonth`.
- Campaign filter applied when “All Campaigns” is not selected.

---

## Platform Color Mapping

| Platform | Color Classes |
|----------|---------------|
| linkedin | `bg-blue-100 text-blue-700 border-blue-200` |
| facebook | `bg-indigo-100 text-indigo-700 border-indigo-200` |
| instagram | `bg-pink-100 text-pink-700 border-pink-200` |
| youtube | `bg-red-100 text-red-700 border-red-200` |
| twitter/x | `bg-gray-800 text-gray-100 border-gray-700` |
| tiktok | `bg-gray-100 text-gray-700 border-gray-200` |
| pinterest | `bg-rose-100 text-rose-700 border-rose-200` |
| (default) | `bg-gray-100 text-gray-700 border-gray-200` |

---

## Example Event Output

```json
{
  "date": "2025-03-18",
  "platform": "linkedin",
  "title": "AI introduction",
  "repurpose_index": 1,
  "repurpose_total": 3,
  "campaign_id": "abc-123",
  "content_type": "post",
  "scheduled_post_id": "post-uuid",
  "execution_id": "exec-uuid"
}
```

**Rendered as:**
> Mar 18: **LinkedIn — AI introduction (1/3)**

---

## Backward Compatibility

- **Fallback:** If no scheduled posts for the visible month, calendar continues to show campaign-stage badges as before.
- **Existing behavior:** Campaign filters, status filters, daily/weekly modes, and stage availability are unchanged.

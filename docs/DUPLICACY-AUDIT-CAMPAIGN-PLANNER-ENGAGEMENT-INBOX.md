# Duplicacy Audit: Campaign Planner → Engagement Inbox Integration

**Date:** March 12, 2025  
**Purpose:** Check for duplicates and avoid route/component collision between existing engagement system and Campaign Planner integration.

---

## 1. Two Different "Inbox" Concepts

| Concept | Data Source | Used By | API | Response Shape |
|---------|-------------|---------|-----|----------------|
| **A) General Engagement Inbox** | `engagement_threads`, `engagement_messages` | `/engagement` page, InboxDashboard, useEngagementInbox | `GET /api/engagement/inbox` | `{ items: InboxThread[] }` — thread_id, author_name, latest_message, platform, priority_score |
| **B) Campaign Activity Signals** | `campaign_activity_engagement_signals` | Campaign Planner integration, activity-workspace Community tab | Task specifies `GET /api/engagement/inbox` | `{ signals: Signal[] }` — campaign_id, activity_id, author, content, signal_type, engagement_score |

**Conflict:** Both would use the same route `/api/engagement/inbox` but expect different params and return different shapes.

---

## 2. Current State of Codebase

### Existing (General Engagement)

| Item | Status | Location |
|------|--------|----------|
| `engagementInboxService` | ✓ Exists | `backend/services/engagementInboxService.ts` — getPlatformCounts, getThreadsByPlatform, getThreadDetail |
| `useEngagementInbox` hook | ✓ Exists | `hooks/useEngagementInbox.ts` — calls `GET /api/engagement/inbox`, expects `json.items` |
| InboxDashboard | ✓ Exists | `components/engagement/InboxDashboard.tsx` — ThreadList, ThreadView, PlatformTabs |
| `/engagement` page | ✓ Exists | `pages/engagement/index.tsx` — renders InboxDashboard |
| `GET /api/engagement/inbox` | ❌ **EMPTY** | `pages/api/engagement/inbox.ts` — file exists but has no implementation |
| `GET /api/engagement/threads` | ✓ Exists | Returns `threads` from engagement_threads (different shape than inbox items) |

### Task (Campaign Planner Integration)

| Item | Status | Location |
|------|--------|----------|
| `campaign_activity_engagement_signals` table | ❌ Not found | No migration in `database/` |
| `engagementSignalCollector` | ❌ Not found | No `backend/services/engagementSignalCollector.ts` |
| `engagementInsightService` | ❌ Not found | No `backend/services/engagementInsightService.ts` |
| `GET /api/engagement/inbox` (signals) | ⚠️ Would overwrite | Same route as existing inbox |
| `POST /api/campaigns/planner/suggest-update` | ❌ Not found | No `pages/api/campaigns/planner/suggest-update.ts` |
| `pages/engagement-inbox.tsx` | ❌ Not found | Route `/engagement-inbox` in routes.d.ts but no page file |
| Activity-workspace Community tab | ❓ Unknown | `pages/activity-workspace.tsx` — need to verify |
| `daily_content_plans.external_post_id` | ❓ Unknown | Check migrations |
| `updateScheduledPostOnPublish` sync | ❓ Unknown | Check `backend/db/queries.ts` |

---

## 3. Recommended Separation (Avoid Duplicacy)

### API Routes

| Route | Purpose | Params | Response |
|-------|---------|--------|----------|
| `GET /api/engagement/inbox` | **Existing** — thread-based inbox | organization_id, platform, priority, limit | `{ items: InboxThread[] }` |
| `GET /api/engagement/campaign-signals` | **New** — campaign activity signals | companyId, campaignId?, activityId?, platform?, signalType?, dateFrom?, dateTo? | `{ signals: Signal[] }` |

**Do NOT** implement campaign signals under `/api/engagement/inbox`. Use a separate route.

### Pages

| Route | Purpose |
|-------|---------|
| `/engagement` | General Engagement Command Center (InboxDashboard, threads) |
| `/engagement-inbox` or `/campaign-engagement-inbox` | Campaign-specific signals view from task (optional; activity-workspace Community tab may suffice) |

### Services

| Service | Purpose | Table |
|----------|---------|-------|
| `engagementInboxService` | General thread inbox | engagement_threads |
| `engagementSignalCollector` (new) | Collect signals for campaign activities | campaign_activity_engagement_signals |
| `engagementInsightService` (new) | AI insights from signals | engagement_opportunities |

---

## 4. Implementation Checklist (No Duplicacy)

- [ ] **Implement** `GET /api/engagement/inbox` for existing use case (thread items for useEngagementInbox)
- [ ] **Create** `GET /api/engagement/campaign-signals` for campaign signals (do not overwrite inbox)
- [ ] **Create** `campaign_activity_engagement_signals` table migration
- [ ] **Create** `engagementSignalCollector.ts` service
- [ ] **Create** `engagementInsightService.ts` service
- [ ] **Create** `POST /api/campaigns/planner/suggest-update`
- [ ] **Create** `pages/engagement-inbox.tsx` for campaign signals view **OR** rely on activity-workspace Community tab
- [ ] **Add** Community Responses tab to activity-workspace (fetch from `campaign-signals` API, not inbox)
- [ ] **Add** `external_post_id` to daily_content_plans; sync in `updateScheduledPostOnPublish`

---

## 5. Quick Reference — File Links

**SQL migrations (run in Supabase SQL Editor):**
- [database/campaign_activity_engagement_signals.sql](../database/campaign_activity_engagement_signals.sql)
- [database/daily_content_plans_external_post_id.sql](../database/daily_content_plans_external_post_id.sql)

**Implementation report:**
- [`docs/IMPLEMENTATION-REPORT-ENGAGEMENT-INBOX-CAMPAIGN-SIGNALS.md`](IMPLEMENTATION-REPORT-ENGAGEMENT-INBOX-CAMPAIGN-SIGNALS.md)

---

## 6. Summary

**Key rule:** Use **`/api/engagement/campaign-signals`** for campaign activity engagement signals. Keep **`/api/engagement/inbox`** for the existing thread-based inbox used by InboxDashboard and useEngagementInbox.

**Restore:** `pages/api/engagement/inbox.ts` is currently empty and must be implemented to serve thread items; otherwise the Engagement Command Center at `/engagement` will not load inbox data.

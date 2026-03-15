# Implementation Report: Engagement Inbox + Campaign Signals (Duplicate-Safe Architecture)

**Date:** March 12, 2025  
**Objective:** Implement campaign engagement signals without breaking the existing Engagement Inbox. Two inbox systems coexist and remain separate.

---

## 1. FILES CREATED

| File | Purpose |
|------|---------|
| `database/campaign_activity_engagement_signals.sql` | Migration: creates `campaign_activity_engagement_signals` table |
| `database/daily_content_plans_external_post_id.sql` | Migration: adds `external_post_id`, `execution_id`, `scheduled_post_id` to `daily_content_plans` |
| `backend/services/engagementSignalCollector.ts` | Collects signals: `collectLinkedInSignals`, `collectTwitterSignals`, `collectCommunitySignals` |
| `backend/services/engagementInsightService.ts` | AI insights: `detectBuyerIntent`, `detectConversationClusters`, `detectOpportunitySignals`, `storeInsightAsOpportunity` |
| `pages/api/engagement/campaign-signals.ts` | GET API: returns campaign activity signals from `campaign_activity_engagement_signals` |
| `pages/api/campaigns/planner/suggest-update.ts` | POST API: AI-generated planning suggestion from `engagement_opportunities` insight |
| `pages/engagement-inbox.tsx` | Campaign Engagement Inbox page: three-panel (filters, list, detail) |

---

## 2. FILES MODIFIED

| File | Changes |
|------|---------|
| `pages/api/engagement/inbox.ts` | Implemented thread inbox API; returns `{ items: InboxThread[] }` from `engagement_threads`; compatible with `useEngagementInbox` |
| `pages/activity-workspace.tsx` | Added Content \| Community Responses tab; Community tab fetches `/api/engagement/campaign-signals`; Reply, Bookmark, Mark as lead, Export to CRM buttons |
| `backend/db/queries.ts` | `updateScheduledPostOnPublish`: syncs `platform_post_id` to `daily_content_plans.external_post_id` |

---

## 3. DATABASE TABLES CREATED

| Table | Purpose |
|-------|---------|
| `campaign_activity_engagement_signals` | id, campaign_id, activity_id, platform, source_type, source_id, conversation_url, author, content, signal_type, engagement_score, detected_at, created_at, organization_id, raw_payload. Signal types: comment, reply, mention, quote, discussion, buyer_intent_signal |

---

## 4. DATABASE COLUMNS ADDED

| Table | Columns |
|-------|---------|
| `daily_content_plans` | `external_post_id` (TEXT), `execution_id` (TEXT), `scheduled_post_id` (UUID) — idempotent migration |

---

## 5. NEW SERVICES

| Service | Functions |
|---------|-----------|
| `engagementSignalCollector` | `collectLinkedInSignals(activityId)`, `collectTwitterSignals(activityId)`, `collectCommunitySignals(activityId)`; resolves activity via `daily_content_plans` + `scheduled_posts` |
| `engagementInsightService` | `detectBuyerIntent(signals)`, `detectConversationClusters(signals)`, `detectOpportunitySignals(signals)`, `storeInsightAsOpportunity(orgId, insight)` |

---

## 6. NEW APIs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/engagement/inbox` | **SYSTEM 1** — Thread inbox; params: organization_id, companyId, platform, status, priority, dateRange; returns `{ items: InboxThread[] }` |
| GET | `/api/engagement/campaign-signals` | **SYSTEM 2** — Campaign signals; params: companyId, campaignId, activityId, platform, signalType, dateFrom, dateTo; returns `{ signals }` |
| POST | `/api/campaigns/planner/suggest-update` | Body: `{ campaignId, insight_id, companyId? }`; returns `{ suggestion, insight_id, campaignId }` |

---

## 7. UI COMPONENTS CREATED

| Component / Page | Purpose |
|------------------|---------|
| `pages/engagement-inbox.tsx` | Campaign Engagement Inbox: left (campaign, platform, signal type, time range filters), center (signal list), right (detail + Reply, Bookmark, Mark as lead, Export to CRM) |

---

## 8. UI COMPONENTS MODIFIED

| Component | Changes |
|-----------|---------|
| `pages/activity-workspace.tsx` | Tab: Content \| Community Responses; Community Responses fetches from `/api/engagement/campaign-signals` by activityId/campaignId; action buttons |

---

## 9. DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    ENGAGEMENT INBOX + CAMPAIGN SIGNALS (DUPLICATE-SAFE)                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  SYSTEM 1 — General Thread Inbox                    SYSTEM 2 — Campaign Activity Signals
  ───────────────────────────────                     ────────────────────────────────────

  /engagement page                                    /engagement-inbox page
  InboxDashboard                                      activity-workspace Community tab
  useEngagementInbox
        │                                                       │
        │ GET /api/engagement/inbox                             │ GET /api/engagement/campaign-signals
        │ (organization_id, platform, status)                   │ (companyId, campaignId, activityId, …)
        ▼                                                       ▼
  engagement_threads                              campaign_activity_engagement_signals
  engagement_messages                                       ▲
        │                                                   │
        ▼                                                   │ engagementSignalCollector
  { items: InboxThread[] }                                  │ • collectLinkedInSignals
                                                            │ • collectTwitterSignals
                                                            │ • collectCommunitySignals
                                                            │
  daily_content_plans ─────────────────────────────────────┘
  (external_post_id ← scheduled_posts.platform_post_id on publish)
        │
        │ engagementInsightService
        │ • detectBuyerIntent / detectConversationClusters / detectOpportunitySignals
        ▼
  engagement_opportunities ──────────────► POST /api/campaigns/planner/suggest-update
                                                    │
                                                    ▼
                                            AI-generated planning suggestion
```

---

## 10. BACKWARD COMPATIBILITY

| Rule | Status |
|------|--------|
| Existing engagement inbox must not break | ✓ `/api/engagement/inbox` returns `{ items }` for useEngagementInbox |
| useEngagementInbox continues using /api/engagement/inbox | ✓ Same route, same shape |
| Campaign signals use only /api/engagement/campaign-signals | ✓ Separate route |
| Activity workspace works if signals empty | ✓ Empty state shown when no signals |

---

## 11. MIGRATION STEPS

1. Run [`database/campaign_activity_engagement_signals.sql`](../database/campaign_activity_engagement_signals.sql) in Supabase SQL Editor.
2. Run [`database/daily_content_plans_external_post_id.sql`](../database/daily_content_plans_external_post_id.sql) in Supabase SQL Editor.
3. Wire collector: add job/cron that calls `collectLinkedInSignals`, `collectTwitterSignals`, `collectCommunitySignals` for activities with published posts.

# Engagement Command Center — Complete Audit Report

**Date:** March 14, 2025  
**Scope:** Root cause analysis for Internal Server Error, empty conversations, and incorrect platform icons.  
**Type:** AUDIT ONLY — no code modifications.

---

## Executive Summary

| Issue | Root Cause | Severity |
|-------|------------|----------|
| **Internal Server Error** | API returns 500; frontend displays `res.statusText` instead of API error body | High |
| **Conversations not loading** | Data pipeline dependency: ingestion → `engagement_threads`; org_id mismatch; possible missing tables | High |
| **All platform icons shown** | `PlatformTabs` uses hardcoded `PLATFORMS` — no integration-based filtering | Medium |

---

## 1. Root Cause of Internal Server Error

### 1.1 Data Flow (Full Trace)

```
UI: pages/engagement/index.tsx
    └── InboxDashboard (organizationId from CompanyContext.selectedCompanyId)
        ├── useEngagementInbox(organizationId) → GET /api/engagement/inbox
        ├── usePlatformCounts(organizationId)  → GET /api/engagement/platform-counts
        └── useWorkQueue(organizationId)        → GET /api/engagement/work-queue

API: pages/api/engagement/inbox.ts
    ├── enforceCompanyAccess(req, res, companyId)
    │   └── backend/services/userContextService.ts
    │       ├── resolveUserContext(req) → getSupabaseUserFromRequest, user_company_roles
    │       └── getCompanyRoleIncludingInvited (if access denied)
    └── getThreads(...) from backend/services/engagementThreadService.ts
        ├── supabase.from('engagement_threads')...
        ├── computeThreadLeadScoresBatch (engagement_lead_signals, engagement_message_intelligence)
        ├── engagement_thread_classification
        ├── engagement_thread_intelligence
        ├── engagement_messages
        └── engagement_authors
```

### 1.2 Likely Failing Endpoints

- **Primary:** `GET /api/engagement/inbox` (useEngagementInbox drives the main error display)
- **Secondary:** `GET /api/engagement/platform-counts`, `GET /api/engagement/work-queue` (errors not surfaced in UI)

### 1.3 Error Display Bug (Frontend)

**File:** `hooks/useEngagementInbox.ts` (lines 70–71)

```typescript
const res = await fetch(`/api/engagement/inbox?${params.toString()}`, { credentials: 'include' });
if (!res.ok) throw new Error(res.statusText);  // ← Throws "Internal Server Error" (HTTP 500 status text)
const json = await res.json();                 // ← Never reached on 500
if (json.error) throw new Error(json.error);  // ← API error message never used
```

The hook throws on `res.statusText` before reading the response body. A 500 response therefore always surfaces as "Internal Server Error" instead of the actual API error (e.g. missing table or column).

### 1.4 Backend Error Sources (500)

| Source | File | Condition |
|--------|------|-----------|
| **Missing table** | `engagementThreadService`, `leadThreadScoring`, etc. | Any of `engagement_threads`, `engagement_thread_classification`, `engagement_thread_intelligence`, `engagement_messages`, `engagement_authors`, `engagement_lead_signals`, `engagement_message_intelligence`, `engagement_opportunities` not present |
| **Missing column** | `engagement_threads` | `ignored`, `priority_score`, `unread_count` (require `engagement_phase2_extensions.sql`, `engagement_thread_ignored.sql`) |
| **Auth/Supabase** | `userContextService` | `getSupabaseUserFromRequest` or `user_company_roles` query fails |
| **RPC** | `leadThreadScoring` | `schedule_lead_thread_recompute` RPC missing (not used in read path, but other RPCs may exist) |

### 1.5 Test Output Evidence

`test_output.txt` shows repeated:
- `TypeError: (0 , userContextService_1.resolveUserContext) is not a function`
- Stack at `resolveUserContext (backend/services/userContextService.ts:12:59)`

Suggests possible Jest/mock or import issues in tests; runtime behavior may differ.

---

## 2. Why Conversations Are Not Appearing

### 2.1 Data Pipeline

```
scheduled_posts (status=published, platform_post_id not null)
    → engagementPollingProcessor (every ~10 min)
    → engagementIngestionService.ingestComments(post.id)
        → fetchComments (platform APIs)
        → persistComments → post_comments
        → syncToUnifiedEngagement → syncFromPostComments
            → resolveThread → engagement_threads
            → resolveAuthor → engagement_authors
            → insertMessage → engagement_messages
```

### 2.2 Critical Filters

1. **Organization ID**

   - `syncFromPostComments` sets `organization_id` from the campaign:
     - `post.campaign_id` → `getLatestCampaignVersionByCampaignId` → `company_id`
   - If `campaign_id` is null or campaign has no `company_id`, `organization_id` is null.
   - Inbox API: `.eq('organization_id', filters.organization_id)` — threads with null `organization_id` are excluded.

2. **Ingestion Prerequisites**

   - Published posts: `scheduled_posts.status = 'published'` and `platform_post_id` not null.
   - Valid token: `getToken(post.social_account_id)` must return a token.
   - Cron/workers running: `enqueueEngagementPolling()` called from `cron.ts` every 10 minutes; workers must be running.

3. **Source of Truth**

   - Inbox reads from `engagement_threads`, not `post_comments`.
   - `post_comments` is populated by ingestion; `engagement_threads` is populated by `syncFromPostComments`.
   - If sync fails or is skipped, inbox remains empty even if `post_comments` has data.

### 2.3 Possible Causes

| Cause | Description |
|-------|-------------|
| **A. API 500** | Inbox/work-queue/platform-counts APIs fail → no data shown |
| **B. No ingestion** | No published posts, no cron, or workers not running → no threads |
| **C. Wrong `organization_id`** | Threads have null or different `organization_id` than selected company |
| **D. Missing tables** | Required tables or columns missing → queries fail |
| **E. No campaigns** | Ingestion only runs for posts with `campaign_id` → `organization_id` often null |

---

## 3. Why Icons Are Incorrect (All Platforms Shown)

### 3.1 Current Implementation

**File:** `components/engagement/PlatformTabs.tsx` (lines 13–21)

```typescript
const PLATFORMS = [
  { slug: 'all', label: 'All' },
  { slug: 'linkedin', label: 'LinkedIn' },
  { slug: 'twitter', label: 'X' },
  { slug: 'instagram', label: 'Instagram' },
  { slug: 'facebook', label: 'Facebook' },
  { slug: 'youtube', label: 'YouTube' },
  { slug: 'reddit', label: 'Reddit' },
] as const;
```

Platform tabs are hardcoded. There is no use of `company_integrations`, `social_accounts`, or integration status.

### 3.2 Expected Behavior

```text
platforms = company.integrations.filter(status === 'active')
```

Tabs should be driven by configured integrations, not a static list.

### 3.3 Supporting Services

Same hardcoded list appears in:

- `backend/services/engagementInboxService.ts`: `PLATFORMS = ['linkedin','twitter','instagram','facebook','youtube','reddit']`
- `backend/services/engagementWorkQueueService.ts`: same `PLATFORMS`

---

## 4. File Inventory

### 4.1 UI Layer

| File | Role |
|------|------|
| `pages/engagement/index.tsx` | Engagement Command Center page |
| `components/engagement/InboxDashboard.tsx` | Main layout, hooks, error display |
| `components/engagement/PlatformTabs.tsx` | Platform tabs (hardcoded) |
| `components/engagement/ConversationMonitorHeader.tsx` | Metrics (derived from items) |
| `components/engagement/ThreadList.tsx` | Thread list |
| `components/engagement/ThreadView.tsx` | Thread detail |

### 4.2 Hooks

| File | API | Purpose |
|------|-----|---------|
| `hooks/useEngagementInbox.ts` | `/api/engagement/inbox` | Thread items |
| `hooks/usePlatformCounts.ts` | `/api/engagement/platform-counts` | Per-platform counts |
| `hooks/useWorkQueue.ts` | `/api/engagement/work-queue` | Work queue |
| `hooks/useEngagementMessages.ts` | `/api/engagement/messages` | Messages for selected thread |

### 4.3 API Endpoints

| Endpoint | File | Service |
|----------|------|---------|
| `GET /api/engagement/inbox` | `pages/api/engagement/inbox.ts` | `engagementThreadService.getThreads` |
| `GET /api/engagement/platform-counts` | `pages/api/engagement/platform-counts.ts` | `engagementInboxService.getPlatformCounts` |
| `GET /api/engagement/work-queue` | `pages/api/engagement/work-queue.ts` | `engagementWorkQueueService.getDailyWorkQueue` |
| `GET /api/engagement/messages` | `pages/api/engagement/messages.ts` | Messages for thread |

### 4.4 Service Layer

| File | Purpose |
|------|---------|
| `backend/services/engagementThreadService.ts` | Thread listing, joins |
| `backend/services/engagementInboxService.ts` | Platform counts |
| `backend/services/engagementWorkQueueService.ts` | Work queue |
| `backend/services/engagementNormalizationService.ts` | Sync post_comments → engagement model |
| `backend/services/engagementIngestionService.ts` | Fetch + persist comments |
| `backend/services/leadThreadScoring.ts` | Lead scores |
| `backend/services/userContextService.ts` | Auth / access control |

### 4.5 Database Tables

| Table | Purpose |
|-------|---------|
| `engagement_threads` | Thread container (organization_id, ignored, priority_score, unread_count) |
| `engagement_messages` | Messages |
| `engagement_authors` | Authors (platform, platform_user_id) |
| `engagement_thread_classification` | Classification, triage |
| `engagement_thread_intelligence` | Intent, lead_detected, etc. |
| `engagement_lead_signals` | Lead scoring |
| `engagement_message_intelligence` | Message-level intel |
| `engagement_opportunities` | Opportunities |
| `post_comments` | Raw ingested comments |
| `scheduled_posts` | Published posts |
| `social_accounts` | User OAuth accounts |

### 4.6 Migrations (Order)

1. `database/engagement_unified_model.sql`
2. `database/engagement_phase2_extensions.sql` (priority_score, unread_count)
3. `database/engagement_thread_ignored.sql` (ignored)
4. `database/engagement_thread_classification.sql`
5. `database/engagement_thread_intelligence.sql`
6. `database/engagement_message_intelligence.sql`
7. `database/engagement_lead_signals.sql`
8. `database/engagement_opportunities.sql`

---

## 5. Social Platform Configuration Logic

### 5.1 Current Schema

- **social_accounts**: `user_id`, `platform`, `platform_user_id`, `is_active`, tokens
- **user_company_roles**: `user_id`, `company_id`
- No `company_social_integrations` or similar for org-level integrations.

Platform config is effectively user-level via `social_accounts` and `user_company_roles`. The inbox does not use this to decide which platforms to show.

### 5.2 Platform Eligibility

- No central table for “company X has platform Y connected.”
- Connection state is inferred from `social_accounts` + `user_company_roles` (users in company with active accounts).
- Engagement Command Center and PlatformTabs do not query this.

---

## 6. Background Jobs

| Job | Queue | Schedule | Purpose |
|-----|------|---------|---------|
| engagement-polling | `engagement-polling` | ~10 min | Ingest comments from published posts |
| engagement-signal-scheduler | — | cron | Engagement signals |
| lead-thread-recompute | — | worker | Lead scoring |
| conversation-triage | — | 3 min | Triage |
| engagement-opportunity-detection | — | 5 min | Opportunities |
| engagement-digest | — | worker | Digest |

Engagement polling is required for conversations to reach `engagement_threads`.

---

## 7. Empty State Logic

| Metric | Source |
|--------|--------|
| Active Conversations | `items.length` |
| High Priority Threads | `items.filter(t => triage_priority >= 7)` |
| Leads Detected | `items.filter(t => lead_detected \|\| lead_score > 0)` |
| Opportunity Signals | `items.filter(t => opportunity_indicator)` |
| Trending Topics | `trendingTopicsCount` |

All metrics derive from `items` from `useEngagementInbox`. If the inbox API fails or returns no items, all show 0.

---

## 8. Security Risks

| Risk | Description |
|------|-------------|
| Error message leakage | 500 responses include `(err as Error)?.message` in JSON — verify no sensitive data |
| Company access | `enforceCompanyAccess` correctly filters by company |
| Token handling | Tokens in `social_accounts` (encrypted at rest per docs) |

---

## 9. Architectural Gaps

| Gap | Description |
|-----|-------------|
| **Platform filtering** | No query of active integrations; tabs always show all platforms |
| **organization_id** | Depends on campaign→company; no direct company↔integration link |
| **Error UX** | Frontend discards API error body; user only sees "Internal Server Error" |
| **Error visibility** | Platform-counts and work-queue errors are not shown in InboxDashboard |
| **Two credential systems** | `social_accounts` (user) vs `community_ai_platform_tokens` (tenant); engagement uses `social_accounts` |

---

## 10. Recommended Next Steps (Diagnostic Only)

1. **Inspect server logs** when loading `/engagement` to get exact error and stack trace.
2. **Verify tables** exist and match schema: `engagement_threads`, `engagement_messages`, `engagement_authors`, `engagement_thread_classification`, `engagement_thread_intelligence`, `engagement_lead_signals`, `engagement_message_intelligence`, `engagement_opportunities`.
3. **Verify columns** on `engagement_threads`: `ignored`, `priority_score`, `unread_count`.
4. **Inspect inbox API** response (status + body) when it returns 500.
5. **Confirm workers** for `engagement-polling` and cron are running.
6. **Check data** in `engagement_threads` for the selected company (non-null `organization_id`).
7. **Trace ingestion** for a published post: `post_comments` → `syncFromPostComments` → `engagement_threads`.
8. **Confirm platform config** requirements before implementing dynamic tab filtering.

---

## Appendix: Key Code References

| Location | Line(s) | Snippet |
|----------|---------|---------|
| `hooks/useEngagementInbox.ts` | 70–71 | `if (!res.ok) throw new Error(res.statusText)` |
| `components/engagement/PlatformTabs.tsx` | 13–21 | Hardcoded `PLATFORMS` |
| `pages/api/engagement/inbox.ts` | 84–88 | Catch returns 500 with `(err as Error)?.message` |
| `backend/services/engagementThreadService.ts` | 46–56 | Query uses `ignored`, `priority_score`, `unread_count` |
| `backend/services/engagementIngestionService.ts` | 348–399 | `organization_id` from campaign version |
| `backend/services/engagementNormalizationService.ts` | 207–318 | `syncFromPostComments` → `engagement_threads` |

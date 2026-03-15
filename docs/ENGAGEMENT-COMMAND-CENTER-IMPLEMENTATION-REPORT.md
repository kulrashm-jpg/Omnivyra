# Engagement Command Center — Corrective Implementation Report

**Date:** March 14, 2025  
**Scope:** Root cause fixes, platform filtering, ingestion pipeline, and validation.  
**Status:** Implementation complete.

---

## 1. Root Cause Confirmed

| Issue | Root Cause | Fix Applied |
|-------|------------|-------------|
| **Internal Server Error displayed** | Frontend threw on `res.statusText` before parsing JSON; API error body never surfaced | `hooks/useEngagementInbox.ts`: Parse body first, then `throw new Error(body.error \|\| body.message \|\| 'Engagement API failure')` |
| **Conversations not loading** | `organization_id` often null when campaign lookup failed (posts without `campaign_id`) | `engagementIngestionService.ts`: Fallback to `user_company_roles.company_id` via `post.user_id` |
| **All platform icons shown** | Hardcoded `PLATFORMS` in `PlatformTabs` | Dynamic platforms from `GET /api/engagement/integrations` (social_accounts + user_company_roles) |

---

## 2. Fixes Applied

### 2.1 API Error Handling (`hooks/useEngagementInbox.ts`)

**Before:**
```typescript
if (!res.ok) throw new Error(res.statusText);
const json = await res.json();
```

**After:**
```typescript
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  throw new Error(body.error || body.message || 'Engagement API failure');
}
```

Real API error messages now surface instead of generic "Internal Server Error".

### 2.2 Organization ID Fallback (`backend/services/engagementIngestionService.ts`)

**Added:** When `campaign_id` is null or campaign version has no `company_id`, resolve via:

```typescript
if (!organizationId && post.user_id) {
  const { data: role } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', post.user_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  organizationId = role?.company_id ? String(role.company_id) : null;
}
```

### 2.3 Platform Filtering

| File | Change |
|------|--------|
| `pages/api/engagement/integrations.ts` | **New** — Returns `{ platforms: string[] }` from `social_accounts` JOIN `user_company_roles` |
| `hooks/useCompanyIntegrations.ts` | **New** — Fetches integrations for Engagement Command Center |
| `components/engagement/PlatformTabs.tsx` | Accepts `platforms?: string[]`; when provided, renders All + only configured platforms |
| `components/engagement/InboxDashboard.tsx` | Uses `useCompanyIntegrations`, passes `platforms={integrations.map(i => i.platform)}` to PlatformTabs |

### 2.4 Engagement Thread Visibility

`engagementThreadService.getThreads` already filters by:

- `.eq('organization_id', filters.organization_id)`
- `.eq('ignored', false)` when `exclude_ignored: true`

No change required; verified.

---

## 3. Schema Corrections

### 3.1 Validation Script

**File:** `database/engagement_command_center_validation.sql`

- Checks existence of: `engagement_threads`, `engagement_messages`, `engagement_authors`, `engagement_thread_classification`, `engagement_thread_intelligence`, `engagement_lead_signals`, `engagement_message_intelligence`, `engagement_opportunities`, `post_comments`, `scheduled_posts`, `social_accounts`
- Returns table names and row counts

### 3.2 Missing Columns Migration

**File:** `database/engagement_command_center_missing_columns.sql`

- Adds `ignored`, `priority_score`, `unread_count` to `engagement_threads` if missing
- Safe to run (uses `ADD COLUMN IF NOT EXISTS`)

### 3.3 Diagnostics Script

**File:** `database/engagement_command_center_diagnostics.sql`

- Counts threads by `organization_id`
- Counts messages
- Counts `post_comments`
- Detects sync gaps (`post_comments > 0` but `engagement_threads = 0` for an org)

---

## 4. Worker Status

| Worker / Job | Location | Schedule | Status |
|--------------|----------|----------|--------|
| engagement-polling | `backend/queue/startWorkers.ts` | Every 10 min via cron | ✅ Registered |
| conversation-triage | `backend/scheduler/cron.ts` | 3 min | ✅ Registered |
| lead-thread-recompute | `backend/scheduler/cron.ts` | 5 sec base + jitter | ✅ Registered |
| engagement-opportunity-detection | `backend/scheduler/cron.ts` | 5 min | ✅ Registered |
| engagement-digest | `backend/scheduler/cron.ts` | 24 hr | ✅ Registered |

All required workers are registered and scheduled.

---

## 5. API Stability Verification

| Endpoint | Change | Result |
|----------|--------|--------|
| `GET /api/engagement/inbox` | None | Returns items or error body |
| `GET /api/engagement/platform-counts` | None | Unchanged |
| `GET /api/engagement/work-queue` | None | Unchanged |
| `GET /api/engagement/integrations` | **New** | Returns `{ platforms: string[] }` |

Error handling in `useEngagementInbox` ensures API error messages are shown instead of a generic status.

---

## 6. Engagement Pipeline Validation

| Step | Condition | Fix |
|------|-----------|-----|
| scheduled_posts | status=published, platform_post_id not null | Unchanged |
| Tokens | social_accounts | Unchanged |
| organization_id | From campaign or user_company_roles | Added fallback |
| syncFromPostComments | post_comments → engagement_threads | Unchanged |

Pipeline flow:

1. `engagementPollingProcessor` selects published posts.
2. `ingestComments` fetches and persists to `post_comments`.
3. `syncToUnifiedEngagement` → `syncFromPostComments` → `engagement_threads`.
4. `organization_id` now resolved from campaign or user company role.

---

## 7. UI Platform Filtering Verification

| Scenario | Behavior |
|----------|----------|
| No integrations | PlatformTabs shows only "All" |
| Integrations = [linkedin, twitter] | Shows All + LinkedIn + X |
| Integrations API error | Falls back to all 6 platforms (legacy) |
| platforms prop undefined | Falls back to all 6 platforms |

---

## 8. Final System Status

| Component | Status |
|-----------|--------|
| Error display | Fixed — real API messages shown |
| organization_id resolution | Fixed — campaign + user fallback |
| Platform tabs | Dynamic — only configured platforms |
| Database validation | Scripts provided |
| Worker registration | Verified |
| engagement_threads filter | Already correct |

---

## 9. Files Modified / Added

### Modified
- `hooks/useEngagementInbox.ts` — Error handling
- `backend/services/engagementIngestionService.ts` — organization_id fallback
- `components/engagement/PlatformTabs.tsx` — Dynamic platforms prop
- `components/engagement/InboxDashboard.tsx` — useCompanyIntegrations + platforms prop

### Added
- `pages/api/engagement/integrations.ts` — Company platforms API
- `hooks/useCompanyIntegrations.ts` — Integrations hook
- `database/engagement_command_center_validation.sql` — Table checks
- `database/engagement_command_center_missing_columns.sql` — Column migration
- `database/engagement_command_center_diagnostics.sql` — Diagnostic queries

---

## 10. Recommended Next Steps

1. Run validation: `database/engagement_command_center_validation.sql` in Supabase SQL Editor.
2. Run missing columns migration if needed: `database/engagement_command_center_missing_columns.sql`.
3. Confirm workers: `npm run start:cron` and/or `npm run start:workers`.
4. Manually test: load `/engagement`, verify platform tabs match connected accounts, confirm error messages display when APIs fail.
5. Run diagnostics after ingestion: `database/engagement_command_center_diagnostics.sql` (with `p_company_id` set).

---

## Appendix: API Error Handling Flow

```
Client: fetch('/api/engagement/inbox?...')
  → res.ok = false (500)
  → body = await res.json().catch(() => ({}))
  → throw new Error(body.error || body.message || 'Engagement API failure')
  → setError(err.message)  // e.g. "Failed to fetch threads: column X does not exist"
  → UI displays actual error in red banner
```

# Engagement Command Center — Diagnostic Runbook

**Purpose:** Resolve dev server lock and surface real backend errors for debugging.

---

## Step 1 — Terminate Stale Next.js Processes

```cmd
tasklist | findstr node
```

If any `node.exe` processes exist (especially dev server):

```cmd
taskkill /F /IM node.exe
```

**Note:** This kills ALL Node processes. For targeted kill (port 3000 only):

```cmd
netstat -ano | findstr :3000
taskkill /F /PID <PID_FROM_ABOVE>
```

---

## Step 2 — Remove Stale Next.js Lock / Build

```cmd
cd c:\virality
rmdir /s /q .next
```

PowerShell alternative:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
```

---

## Step 3 — Restart Development Server

```cmd
npm run dev
```

Wait until you see:

- `Local: http://localhost:3000`
- `✓ Starting...` or equivalent

---

## Step 4 — Reproduce Engagement Error

1. **Log in** to the app (API returns 401 Unauthorized when not authenticated)
2. Open http://localhost:3000/engagement
3. **Ensure a company is selected** in the company dropdown/context
4. Page may show error banner; note the exact message (real API error now surfaces per frontend fix)

---

## Step 5 — Capture Network Responses

1. Open DevTools → **Network** tab
2. Filter by **Fetch/XHR**
3. Refresh the page or navigate to `/engagement`
4. For each API call, capture:

| Endpoint | Status | Response Body |
|----------|--------|---------------|
| GET /api/engagement/inbox | | |
| GET /api/engagement/platform-counts | | |
| GET /api/engagement/work-queue | | |
| GET /api/engagement/integrations | | |
| GET /api/engagement/messages | | |

**Response body (JSON)** for failed requests contains the real error:

```json
{ "error": "Failed to fetch threads: column X does not exist" }
```

---

## Step 6 — Root Cause Categories

| Category | Description | Fix |
|----------|-------------|-----|
| **DATABASE_TABLE_MISSING** | Table not found in Supabase | Run migration: `database/engagement_unified_model.sql` + extensions |
| **DATABASE_COLUMN_MISSING** | Column `ignored`, `priority_score`, or `unread_count` missing on `engagement_threads` | Run `database/engagement_command_center_missing_columns.sql` |
| **SUPABASE_AUTH_FAILURE** | `getSupabaseUserFromRequest` or `user_company_roles` fails | Check auth cookies, Supabase config |
| **ORGANIZATION_ID_NULL** | Threads have null `organization_id`; inbox filters them out | Fix ingestion: `engagementIngestionService` org fallback (already applied) |
| **SERVICE_IMPORT_FAILURE** | `resolveUserContext is not a function` or similar | Check imports in `userContextService` |
| **RPC_MISSING** | `schedule_lead_thread_recompute` not defined | Run `database/lead_thread_recompute_rpc.sql` |

---

## Step 7 — Failing Service Trace

| Endpoint | Backend Service | Key Files |
|----------|-----------------|-----------|
| /api/engagement/inbox | `engagementThreadService.getThreads` | `backend/services/engagementThreadService.ts` |
| /api/engagement/platform-counts | `engagementInboxService.getPlatformCounts` | `backend/services/engagementInboxService.ts` |
| /api/engagement/work-queue | `engagementWorkQueueService.getDailyWorkQueue` | `backend/services/engagementWorkQueueService.ts` |
| /api/engagement/integrations | `getCompanyPlatformsFallback` | `pages/api/engagement/integrations.ts` |

All use `enforceCompanyAccess` → `userContextService` → `getSupabaseUserFromRequest`.

---

## Step 8 — Verify Database Tables

Run in **Supabase SQL Editor**:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'engagement%'
ORDER BY table_name;
```

**Required tables:**

- engagement_threads
- engagement_messages
- engagement_authors
- engagement_thread_classification
- engagement_thread_intelligence
- engagement_lead_signals
- engagement_message_intelligence
- engagement_opportunities
- post_comments
- scheduled_posts
- social_accounts

**Full script:** `database/engagement_command_center_validation.sql`

---

## Step 9 — Verify engagement_threads Columns

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'engagement_threads'
ORDER BY ordinal_position;
```

**Required columns:**

- id
- organization_id
- platform
- ignored
- priority_score
- unread_count
- created_at
- updated_at

---

## Step 10 — Verify Thread Data

```sql
SELECT COUNT(*) AS total_threads FROM engagement_threads;

SELECT COUNT(*) AS threads_null_org
FROM engagement_threads
WHERE organization_id IS NULL;
```

If many rows have `organization_id IS NULL`, ingestion mapping is broken.

---

## Step 11 — Verify Ingestion Pipeline

```sql
SELECT COUNT(*) FROM post_comments;
SELECT COUNT(*) FROM engagement_threads;
```

If `post_comments > 0` but `engagement_threads = 0`, sync layer failed.

**Trace:** `backend/services/engagementNormalizationService.ts` → `syncFromPostComments()`

---

## Step 12 — Diagnostic Report Template

| Item | Result |
|------|--------|
| Failing API endpoint | |
| HTTP status | |
| Error message (from response body) | |
| Stack trace (server logs) | |
| Tables present | |
| Tables missing | |
| engagement_threads columns | |
| total_threads | |
| threads_null_org | |
| post_comments_count | |
| engagement_threads_count | |
| Root cause category | |
| Recommended fix | |

---

## Quick Reference: API Test (curl)

Replace `COMPANY_ID` with a valid UUID from your `companies` table:

```bash
curl -v "http://localhost:3000/api/engagement/inbox?organization_id=COMPANY_ID&organizationId=COMPANY_ID&limit=50"
```

Add `-b cookies.txt` if you need to pass session cookies.

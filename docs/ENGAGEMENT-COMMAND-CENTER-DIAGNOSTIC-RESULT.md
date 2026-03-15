# Engagement Command Center — Diagnostic Result

**Date:** March 14, 2025  
**Run:** Steps 1–12 execution summary

---

## 1. Exact Failing API Endpoint

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET /api/engagement/inbox | **401 Unauthorized** (unauthenticated) | Requires auth; 500 would occur when authenticated if backend fails |
| GET /api/engagement/platform-counts | Not tested (same auth) | |
| GET /api/engagement/work-queue | Not tested (same auth) | |
| GET /api/engagement/integrations | Not tested (same auth) | |

**Conclusion:** Unauthenticated requests return 401. To capture the real backend error (500), you must:

1. Log in at http://localhost:3000
2. Select a company in the UI
3. Navigate to `/engagement`
4. Open DevTools → Network → inspect failing XHR responses

---

## 2. Error Message Returned by Backend

*Not captured* — 401 returned before backend business logic runs. When authenticated and backend fails, the response body will contain:

```json
{ "error": "Failed to fetch threads: <actual Supabase/table error>" }
```

The frontend (after fixes) now displays this message instead of "Internal Server Error".

---

## 3. Stack Trace

*Not captured* — Server-side stack trace appears in the terminal running `npm run dev` when a 500 occurs. Check that terminal when reproducing with auth.

---

## 4. Database Schema Verification

**SQL script:** `database/engagement_command_center_diagnostics.sql`

Run in **Supabase SQL Editor** to verify:

| Check | Query | Expected |
|-------|-------|----------|
| Tables exist | `information_schema.tables` | 11 tables: engagement_threads, engagement_messages, engagement_authors, engagement_thread_classification, engagement_thread_intelligence, engagement_lead_signals, engagement_message_intelligence, engagement_opportunities, post_comments, scheduled_posts, social_accounts |
| engagement_threads columns | `information_schema.columns` | Must include: organization_id, platform, ignored, priority_score, unread_count |
| Thread count | `SELECT COUNT(*) FROM engagement_threads` | ≥ 0 |
| NULL org_id | `SELECT COUNT(*) FROM engagement_threads WHERE organization_id IS NULL` | If high → ingestion mapping broken |
| post_comments | `SELECT COUNT(*) FROM post_comments` | If > 0 and engagement_threads = 0 → sync failed |

**Migration if columns missing:** `database/engagement_command_center_missing_columns.sql`

---

## 5. Thread Data Status

| Metric | SQL | Interpretation |
|--------|-----|----------------|
| Total threads | `SELECT COUNT(*) FROM engagement_threads` | 0 = no ingestion or sync |
| NULL organization_id | `SELECT COUNT(*) FROM engagement_threads WHERE organization_id IS NULL` | Many = ingestion not setting org |
| By org | `SELECT organization_id, COUNT(*) FROM engagement_threads WHERE organization_id IS NOT NULL GROUP BY 1` | Shows which companies have threads |

---

## 6. Ingestion Pipeline Status

| Step | Condition | Trace |
|------|-----------|-------|
| scheduled_posts | status=published, platform_post_id not null | `engagementPollingProcessor` |
| post_comments | Upserted by `ingestComments` | `engagementIngestionService.ts` |
| engagement_threads | Populated by `syncFromPostComments` | `engagementNormalizationService.ts` |
| organization_id | From campaign or `user_company_roles` | `engagementIngestionService.ts` (fallback added) |

If `post_comments > 0` but `engagement_threads = 0` → `syncFromPostComments` failing or not called.

---

## 7. Identified Root Cause (from Audit)

Based on audit documents, most likely causes:

| Category | Likelihood | Fix |
|----------|------------|-----|
| **DATABASE_TABLE_MISSING** | High | Run `engagement_unified_model.sql` + phase2 + ignored + classification + intelligence + lead_signals + message_intelligence + opportunities |
| **DATABASE_COLUMN_MISSING** | High | Run `engagement_command_center_missing_columns.sql` |
| **SUPABASE_AUTH_FAILURE** | Medium | Check env vars, Supabase URL/key, auth cookies |
| **ORGANIZATION_ID_NULL** | Medium | Fallback added in `engagementIngestionService` |
| **SERVICE_IMPORT_FAILURE** | Low | Jest/test mocks; runtime may differ |

---

## 8. Completed Steps

| Step | Status |
|------|--------|
| 1. Terminate stale Next.js | Dev server was on port 3000; alternative: kill by port |
| 2. Remove .next | Optional for lock; run `rmdir /s /q .next` if needed |
| 3. Restart dev server | Server runs at http://localhost:3000 |
| 4–5. Reproduce & capture | 401 without auth; need logged-in session |
| 8–11. Database verification | SQL scripts provided |
| 12. Diagnostic result | This document |

---

## 9. Next Actions

1. **Run database validation:** Execute `database/engagement_command_center_diagnostics.sql` in Supabase.
2. **Apply migrations if needed:** `database/engagement_command_center_missing_columns.sql`, plus engagement_*.sql migrations in order.
3. **Reproduce with auth:** Log in → select company → open `/engagement` → capture Network response for failing endpoints.
4. **Check server logs:** When 500 occurs, inspect the terminal running `npm run dev` for the stack trace.

---

## 10. Runbook Reference

Full step-by-step procedure: `docs/ENGAGEMENT-COMMAND-CENTER-DIAGNOSTIC-RUNBOOK.md`

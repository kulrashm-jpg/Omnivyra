# Lead Job Final Update Not Persisting — Root Cause Report

**Problem:** Lead jobs log `phase: COMPLETING` and `phase: FINISHED`, but DB shows `status = 'RUNNING'` and `completed_at = null`. Final status update is not persisting.

---

## STEP 1 — Supabase Client Initialization

**Files checked:**
- `backend/db/supabaseClient.ts`
- `backend/services/leadJobProcessor.ts`
- `pages/api/leads/job/create.ts`
- `pages/api/leads/job/[id].ts`

**Finding:**

```36:42:c:\virality\backend\db\supabaseClient.ts
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
```

- **Processor:** Imports `supabase` from `../db/supabaseClient` → uses **SUPABASE_SERVICE_ROLE_KEY**
- **create.ts:** Imports from `../../../../backend/db/supabaseClient` → uses **SUPABASE_SERVICE_ROLE_KEY**
- **[id].ts:** Imports from `../../../../backend/db/supabaseClient` → uses **SUPABASE_SERVICE_ROLE_KEY**

**Conclusion:** All relevant code uses the service role key. **RLS does not block updates** when using service role.

---

## STEP 2 — Final Status Update Code

**File:** `backend/services/leadJobProcessor.ts` (lines 351–383)

**Update block:**
- Uses `.eq('id', jobId)` only (no `company_id`)
- Uses `.select('*', { count: 'exact' })` (diagnostic logging added)
- Logs `updateData`, `updateError`, `updateCount`
- Updates: `status`, `total_found`, `total_qualified`, `confidence_index`, `completed_at`

**Post-update block (lines 372–378):** When `COMPLETED` or `COMPLETED_WITH_WARNINGS`, updates only `progress_stage: 'CLUSTERING'` → does **not** overwrite `status` or `completed_at`.

**Error handling:** `updateError` is logged; no silent swallow.

---

## STEP 3 — Row-Level Security

**SQL to run in Supabase SQL Editor** (see `database/lead_jobs_v1_rls_check.sql`):

```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'lead_jobs_v1';
SELECT * FROM pg_policies WHERE tablename = 'lead_jobs_v1';
```

**Interpretation:**
- `relrowsecurity = true` + no UPDATE policy → anon key updates affect 0 rows
- Because service role is used, RLS is bypassed and this is **unlikely** the cause
- Run the SQL in production to confirm RLS state

---

## STEP 4 — Update Row Count Verification

**Changes applied:**

- Final update now uses `.select('*', { count: 'exact' })` and logs:
  - `updateData`
  - `updateError`
  - `updateCount` (or derived from returned rows)
- Explicit log when `count === 0` or no rows returned

**How to interpret logs:**
- `count = 0` → RLS or filter mismatch
- `count = 1` → update succeeds; check for later overwrites
- `error present` → explicit failure

---

## STEP 5 — Overwrite Check

**Search:** All writes to `lead_jobs_v1`

| Location | Action | Touches `status`? |
|----------|--------|--------------------|
| `leadJobProcessor.ts:86-89` | Set RUNNING at start | Yes |
| `leadJobProcessor.ts:119` | `progress_stage: 'SCANNING'` | No |
| `leadJobProcessor.ts:139` | `progress_stage: 'QUALIFYING'` | No |
| `leadJobProcessor.ts:294-300` | `total_found`, `total_qualified` (per platform) | No |
| `leadJobProcessor.ts:353-364` | **Final update** (status, completed_at) | Yes |
| `leadJobProcessor.ts:373` | `progress_stage: 'CLUSTERING'` | No |
| `leadJobProcessor.ts:385-391` | `status: 'FAILED'` on catch | Yes |
| `create.ts:124-130` | `status: 'FAILED'` on process error | Yes |

No code resets `status` to `RUNNING` after the processor finishes.

---

## STEP 6 — Background Execution Timing

**File:** `pages/api/leads/job/create.ts` (lines 116–132)

```javascript
res.status(201).json({ jobId: job.id, status: job.status });

setImmediate(() => {
  processLeadJobV1(job.id).catch(async (err) => {
    console.error('Lead Job Processor Error:', err);
    await supabase
      .from('lead_jobs_v1')
      .update({ status: 'FAILED', error: ... })
      .eq('id', job.id);
  });
});
```

- Response is sent **before** `setImmediate` runs.
- `processLeadJobV1` runs in a background callback after the response.
- On serverless (e.g. Vercel), once the handler returns and the response is sent, the runtime may freeze or kill the function.
- `setImmediate` runs in the same process; if the platform freezes after the response, the callback may never run or may run only partially.

---

## ROOT CAUSE (Verified from codebase)

### Most probable: serverless function lifecycle

**Evidence:**
1. All updates use the service role key → RLS is not blocking.
2. No code overwrites `status` back to `RUNNING` after the final update.
3. No other update path touches `status` after completion.
4. Processing is started with `setImmediate` **after** the response.
5. On serverless, the function can be frozen/terminated right after the response, so `processLeadJobV1` may never fully complete.

**Why you still see `COMPLETING` / `FINISHED`:**
- If the processor runs at all (e.g. in dev or long-running environments), logs will show these phases.
- In production serverless, if the function is terminated during or right after the final update, logs might show `COMPLETING` while the DB never receives or commits the update.
- Alternatively, `COMPLETING`/`FINISHED` could be from a different run or environment than the job that stays `RUNNING`.

### Secondary check: 0-row update

If logs show `updateCount: 0` or `❌ FINAL UPDATE AFFECTED 0 ROWS`, then the cause is one of:
- RLS (e.g. wrong key in production)
- Wrong `jobId` or filter mismatch

---

## Required Fix

### 1. Move processing off the request lifecycle (recommended)

Do **not** rely on `setImmediate` to run long work after sending the response.

Options:
- Use a job queue (e.g. Supabase Edge Functions + `pg_cron`, Inngest, Trigger.dev, etc.) to run `processLeadJobV1` outside the API handler.
- Use Vercel Background Functions (or equivalent) so processing runs in a separate invocation that is not tied to the HTTP response.

### 2. Or: run processing before the response

- Make the create handler `await processLeadJobV1(job.id)` before `res.status(201)`.
- Only suitable if processing is fast enough for your function timeout.
- For typical lead jobs, this will often exceed serverless limits.

### 3. Validate with the new logging

- Deploy the updated processor and run a job.
- Check logs for `updateData`, `updateError`, and `updateCount`.
- If `updateCount === 0`, run the RLS checks in `database/lead_jobs_v1_rls_check.sql` and fix policies or key usage.
- If `updateCount === 1` but DB still shows `RUNNING`, investigate connection/replica lag or environment differences.

---

## Summary Table

| Check | Result |
|-------|--------|
| Supabase key in processor | `SUPABASE_SERVICE_ROLE_KEY` |
| RLS enabled? | Run `lead_jobs_v1_rls_check.sql` to confirm |
| Policies found? | Run `lead_jobs_v1_rls_check.sql` |
| Final update count | Logged via new diagnostic code |
| Final update error | Logged |
| Root cause | **Serverless lifecycle**: `setImmediate` after response is not reliable for long-running work |
| Required fix | Use a queue or background worker for `processLeadJobV1` |

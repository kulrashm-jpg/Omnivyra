# Market Pulse v2 — Diagnostic Guide

## How to Tell Which Outcome You Got

### 1️⃣ Ran and returned results
- Job status becomes `COMPLETED` or `COMPLETED_WITH_WARNINGS`
- `consolidated_result.global_topics` has topics
- Topics show `narrative_phase`, `momentum_score`, optional `early_advantage`
- Confidence index is > 0
- Regional Intelligence section appears when arbitrage/localized risk exist

### 2️⃣ Ran but empty / null / 0 results
- Job status is `COMPLETED` or `COMPLETED_WITH_WARNINGS`
- `consolidated_result.global_topics` is `[]` or missing
- Confidence index is 0

**Likely causes:**
- `OPENAI_API_KEY` missing → LLM never called, returns `{ topics: [] }`
- LLM returns invalid/malformed JSON → caught, returns `{ topics: [] }`
- LLM returns empty `topics` array
- All regions threw (e.g. DB insert failed) → status `FAILED`, `error: "All regions failed."`

### 3️⃣ Failed with error (500 / timeout / no signals)
- Job stays `RUNNING` forever (processor threw before final update)
- API returns 500 on create or GET
- `error` field set (e.g. `"All regions failed."`)

**Likely causes:**

| Cause | Symptom | Fix |
|-------|---------|-----|
| Migration not run | Insert fails: `column "velocity_score" does not exist` | Run `database/market_pulse_v2.sql` in Supabase |
| Migration not run | Update fails: `column "region_divergence_score" does not exist` | Same |
| `OPENAI_API_KEY` missing | All regions empty, `COMPLETED` with 0 topics | Set in `.env.local` |
| LLM timeout / rate limit | Some regions `error: true`, partial results | Retry, check OpenAI status |
| Supabase connection | 500 on create or timeout | Check `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Auth / access | 401/403 on API | Log in, ensure company access |

---

## Quick Test

1. Run migration:
   ```sql
   -- In Supabase SQL Editor, run contents of database/market_pulse_v2.sql
   ```

2. Check env:
   ```
   OPENAI_API_KEY=sk-...
   ```

3. Run Market Pulse from UI (Recommendations → Market Pulse → Run)
   - Or POST `/api/market-pulse/job/create` with `{ companyId, regions: ["GLOBAL"] }`

4. Poll GET `/api/market-pulse/job/[jobId]` until status ≠ PENDING/RUNNING

5. Interpret:
   - `status: COMPLETED`, `global_topics.length > 0` → 1️⃣ Success
   - `status: COMPLETED`, `global_topics: []` → 2️⃣ Empty
   - `status: RUNNING` for >2 min, or 500 → 3️⃣ Failure

---

## Why it might NOT fail (even without migration)

If you haven't run the migration but the job "works":
- Supabase may have been migrated earlier, or
- You're testing against a different DB that already has the columns.

To confirm: check `market_pulse_items_v1` has `velocity_score`, `momentum_score`, `narrative_phase` columns.

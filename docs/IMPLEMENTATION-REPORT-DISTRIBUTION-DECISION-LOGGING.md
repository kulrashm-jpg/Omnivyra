# Distribution Decision Logging (Phase 1) — Implementation Report

## 1️⃣ DB Schema

**`database/campaign_distribution_decisions.sql`**

- **Table:** `campaign_distribution_decisions` (append-only; no updates).
- **Columns:**
  - `id` — UUID primary key, default `gen_random_uuid()`
  - `campaign_id` — UUID not null
  - `week_number` — INTEGER not null
  - `resolved_strategy` — TEXT not null (`STAGGERED` | `ALL_AT_ONCE`)
  - `auto_detected` — BOOLEAN not null default false
  - `quality_override` — BOOLEAN not null default false
  - `slot_optimization_applied` — BOOLEAN not null default false
  - `created_at` — TIMESTAMPTZ not null default now()
- **Index:** `idx_distribution_campaign_week` on `(campaign_id, week_number)`.
- No foreign keys in v1.

**Apply:** Run the SQL in Supabase to create the table.

---

## 2️⃣ Logger Utility

**`lib/intelligence/distributionDecisionLogger.ts`**

- **`logDistributionDecision(params)`** — async, never throws.
- **Params:** `campaign_id`, `week_number`, `resolved_strategy`, `auto_detected`, `quality_override`, `slot_optimization_applied`.
- **Server-only:** Returns immediately if `typeof window !== 'undefined'`.
- **Supabase:** Dynamic `import('../../backend/db/supabaseClient')`; insert into `campaign_distribution_decisions`.
- **Dedup:** Before insert, checks for existing row for same `(campaign_id, week_number)` with `created_at` within last 24h; skips insert if found.
- **Errors:** Entire body in try/catch; on failure (e.g. missing table) no throw.
- **Dev:** `console.log('[DistributionDecisionLogged]', params)` only after a successful insert (not when skipped).

---

## 3️⃣ API Integration Point

**`pages/api/campaigns/daily-plans.ts`** (server path only)

- In the `byWeek.forEach` loop, after building `units` and `week`:
  - Calls `applyDistributionForWeek(units, week, memoryProfile)` and receives `{ units, meta }`.
  - Uses `result.units` as `distributed` and for `applyUnifiedToDailyPlanResponse` (unchanged).
  - Calls `void logDistributionDecision({ campaign_id: access.campaignId, week_number, ...result.meta })` once per week.
- **No logging** from the campaign-daily-plan page (frontend); only from this API.

**Distribution engine changes (meta only, no behavior change):**

- **`resolveDistributionStrategy`** now returns `{ strategy, qualityOverride }` so we know when quality signal influenced the result.
- **`applyDistributionForWeek`** now returns `{ units, meta }` where `meta` has `resolvedStrategy`, `auto_detected`, `quality_override`, `slot_optimization_applied`.
- **campaign-daily-plan page** updated to use `result.units`; no logger call.

---

## 4️⃣ Summary API Changes

**`pages/api/intelligence/summary.ts`**

- After building the profile, queries `campaign_distribution_decisions` for the campaign (select `resolved_strategy`, `slot_optimization_applied`).
- **distribution_strategy_counts:** Counts rows by `resolved_strategy` (STAGGERED, ALL_AT_ONCE).
- **slot_optimization_applied_count:** Count of rows where `slot_optimization_applied === true`.
- Query wrapped in try/catch; on error (e.g. table missing), counts stay 0.
- **strategist_trigger_counts** unchanged (v1: all zeros).

---

## 5️⃣ Duplicate Prevention Logic

- In the logger, before insert: select one row for `(campaign_id, week_number)` with `created_at >= now() - 24 hours`.
- If a row exists → skip insert and return (no dev log).
- Ensures at most one decision per campaign/week per 24h when the daily-plans API is called repeatedly.

---

## 6️⃣ Edge Cases

- **Table missing:** Logger insert fails, caught silently; summary API query fails, caught, counts remain 0. No crash.
- **Insert fails (e.g. permission):** Logger catches, no throw; distribution and API response unchanged.
- **Frontend never logs:** Logger is only invoked from daily-plans API; campaign-daily-plan page does not call it.
- **Explicit strategy / HIGH momentum:** Unchanged; meta still records `auto_detected: false` when strategy was explicit.
- **Determinism:** Distribution logic unchanged; only return shape extended with meta. Execution IDs and day assignment unchanged.

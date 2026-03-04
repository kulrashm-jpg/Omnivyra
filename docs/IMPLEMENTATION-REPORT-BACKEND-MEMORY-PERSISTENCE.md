# Backend Memory Persistence Layer (Phase 1) — Implementation Report

## 1️⃣ DB Schema Added

**File:** `database/campaign_strategic_memory.sql`

- **Table:** `campaign_strategic_memory`
- **Columns:**
  - `id` — UUID primary key, default `gen_random_uuid()`
  - `campaign_id` — UUID not null
  - `action` — TEXT not null (`IMPROVE_CTA` | `IMPROVE_HOOK` | `ADD_DISCOVERABILITY`)
  - `platform` — TEXT null
  - `accepted` — BOOLEAN not null
  - `confidence_score` — INTEGER null (optional future use)
  - `created_at` — TIMESTAMPTZ not null, default `now()`
- **Index:** `idx_campaign_strategic_memory_campaign_id` on `(campaign_id)`
- No foreign key in v1 (per spec).

**Apply:** Run the SQL in Supabase (migration or SQL editor) to create the table.

---

## 2️⃣ API Route Created

**File:** `pages/api/intelligence/strategic-memory.ts`

| Method | Behavior |
|--------|----------|
| **POST** | Body: `campaign_id`, `execution_id?`, `platform?`, `action`, `accepted`, `confidence_score?`. Validates campaign via `requireCampaignAccess`, inserts one row into `campaign_strategic_memory`, returns `{ success: true }`. No aggregation. |
| **GET** | Query: `campaignId`. Validates campaign via `requireCampaignAccess`, fetches all rows for that campaign, maps to events + confidence history, calls `buildStrategicMemoryProfile(events, confidenceHistory)`, returns `StrategicMemoryProfile`. |

- **Dev logging:** `console.log('[StrategicMemoryAPI]', { campaignId, totalRows })` (development only).
- **Aggregation:** Reuses `buildStrategicMemoryProfile` from `lib/intelligence/strategicMemory.ts` (server-side).

---

## 3️⃣ Frontend Changes

**File:** `pages/activity-workspace.tsx`

- **Removed:** Imports and usage of `getStoredFeedbackEvents`, `buildStrategicMemoryProfile`, `appendFeedbackEvent` from strategic memory.
- **Profile load:** `useEffect` when `payload?.campaignId` is set now fetches profile via `GET /api/intelligence/strategic-memory?campaignId=...` and calls `setStrategicMemoryProfile(profile)`. No localStorage.
- **Apply Suggestion:** On success, `POST /api/intelligence/strategic-memory` with `{ campaign_id, execution_id?, platform, action, accepted: true }`, then refetches profile via GET and updates `strategicMemoryProfile`.
- **Auto Apply Improvements:** After all POSTs (one per suggestion), single GET to refetch profile and update state.
- **State type:** `strategicMemoryProfile` is typed as `{ campaign_id, action_acceptance_rate, platform_confidence_average, total_events } | null`.
- **Safety:** POST failure does not block UI; refetch is best-effort. No localStorage usage for strategic memory.

---

## 4️⃣ Distribution Engine Integration

- **campaign-daily-plan page (`pages/campaign-daily-plan/[id].tsx`):**
  - Removed dependency on `getStoredFeedbackEvents` and `buildStrategicMemoryProfile`.
  - Inside `loadData`, when `id` is present, fetches profile with `GET /api/intelligence/strategic-memory?campaignId=<id>` (using `fetchWithAuth`).
  - Passes the fetched `memoryProfile` into `applyDistributionForWeek(units, week, memoryProfile)`.

- **daily-plans API (`pages/api/campaigns/daily-plans.ts`):**
  - After `requireCampaignAccess`, fetches rows from `campaign_strategic_memory` for `access.campaignId`.
  - Builds `memoryProfile` via `buildStrategicMemoryProfile(events, confidenceHistory)` (same shape as GET handler).
  - Passes `memoryProfile` into `applyDistributionForWeek(units, week, memoryProfile)` instead of `null`.

Explicit `distribution_strategy` and HIGH momentum rules are unchanged and still take precedence in `resolveDistributionStrategy`.

---

## 5️⃣ Before vs After Behavior

| Aspect | Before | After |
|--------|--------|--------|
| **Storage** | Strategic memory events in `localStorage` only. | Events stored in Supabase `campaign_strategic_memory`. |
| **Profile source (workspace)** | Built from `getStoredFeedbackEvents()` filtered by campaign. | Fetched from `GET /api/intelligence/strategic-memory?campaignId=...`. |
| **Profile source (daily-plan page)** | Built from localStorage filtered by campaign. | Fetched from same GET API. |
| **Profile source (daily-plans API)** | Always `null` (no memory). | Fetched from DB for the campaign; passed into distribution. |
| **Feedback on Apply / Auto-apply** | `appendFeedbackEvent` to localStorage, then rebuild profile from localStorage. | POST to `/api/intelligence/strategic-memory`, then GET to refresh profile. |
| **Distribution (AUTO)** | Only client-side memory on daily-plan page; API used `null`. | Both page and API use backend profile when rows exist; otherwise empty profile, same as before. |

---

## 6️⃣ Edge Cases

- **No memory rows:** GET returns profile with `total_events: 0`, empty `action_acceptance_rate` (zeros), empty `platform_confidence_average`. Distribution and suggestions behave as before (no bias).
- **POST failure (network/auth):** UI still shows “Variant improved” / “Auto improvements applied”; profile is not updated until next successful GET (e.g. next workspace load or next action). Non-blocking.
- **GET failure on workspace load:** `strategicMemoryProfile` stays `null`; suggestion ranking and distribution fall back to no-memory behavior.
- **Campaign access:** POST and GET both use `requireCampaignAccess`; invalid or unauthorized campaign returns 400/401/403.
- **Invalid action:** POST requires `action` in `IMPROVE_CTA` | `IMPROVE_HOOK` | `ADD_DISCOVERABILITY`; otherwise 400.
- **Existing safety:** Explicit `distribution_strategy` and HIGH momentum still override AUTO; no behavior change to those paths.

---

## Files Touched

| File | Change |
|------|--------|
| `database/campaign_strategic_memory.sql` | **Created** — table + index. |
| `pages/api/intelligence/strategic-memory.ts` | **Created** — POST (append event), GET (aggregate profile). |
| `pages/activity-workspace.tsx` | **Modified** — load profile from API; POST then GET on Apply/Auto-apply; no localStorage. |
| `pages/campaign-daily-plan/[id].tsx` | **Modified** — fetch profile from API in `loadData`; pass into `applyDistributionForWeek`. |
| `pages/api/campaigns/daily-plans.ts` | **Modified** — fetch memory rows, build profile, pass into `applyDistributionForWeek`. |

`lib/intelligence/strategicMemory.ts` is unchanged; `buildStrategicMemoryProfile` is reused by the API and daily-plans. `getStoredFeedbackEvents` and `appendFeedbackEvent` remain in the module but are no longer used by the workspace or daily-plan page.

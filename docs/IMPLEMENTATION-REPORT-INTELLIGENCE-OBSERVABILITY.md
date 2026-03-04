# Intelligence Observability (Phase 1) — Implementation Report

## 1️⃣ API Created

**`pages/api/intelligence/summary.ts`**

- **Method:** GET only.
- **Query:** `campaignId` (required).
- **Auth:** `requireCampaignAccess(req, res, campaignId)` — same as strategic-memory API.
- **Response:** `CampaignIntelligenceSummary`:
  - `campaign_id`
  - `total_feedback_events` (row count from `campaign_strategic_memory`)
  - `action_acceptance_rate` (IMPROVE_CTA, IMPROVE_HOOK, ADD_DISCOVERABILITY)
  - `platform_confidence_average`
  - `strategist_trigger_counts`: `{ NONE, SUGGEST, AUTO_ELIGIBLE }` — v1 all zeros
  - `distribution_strategy_counts`: `{ STAGGERED, ALL_AT_ONCE }` — v1 all zeros
  - `slot_optimization_applied_count` — v1 zero
  - `active_generation_bias`: `{ cta_bias, discoverability_bias, hook_softening_bias }` from `getActiveGenerationBiasFlags(profile)`
- **Dev logging:** `console.log('[CampaignIntelligenceSummary]', summary)` in development.
- **Read-only:** No writes; no mutation of intelligence or profile.

---

## 2️⃣ Data Aggregation Logic

- **Source:** `campaign_strategic_memory` for the campaign (same as strategic-memory GET).
- **Profile:** `buildStrategicMemoryProfile(events, confidenceHistory)` with events and confidence history derived from rows.
- **Rates:** `action_acceptance_rate` and `platform_confidence_average` come from the profile; keys normalized for response.
- **Bias flags:** `getActiveGenerationBiasFlags(profile)` in `lib/intelligence/generationBias.ts` — same thresholds as `deriveGenerationBias` (CTA > 0.7, Discoverability > 0.7, Hook < 0.3).
- **v1 placeholders:** Trigger counts, distribution strategy counts, and slot optimization count are 0 until optional logging/counter sources exist.

---

## 3️⃣ UI Page Added

**`pages/campaign-intelligence/[id].tsx`**

- **Route:** `/campaign-intelligence/[id]` (e.g. `/campaign-intelligence/abc-123`).
- **Data:** Single GET to `/api/intelligence/summary?campaignId=<id>` on load; credentials included.
- **States:** Loading, error, and summary; no charts or heavy libs.

---

## 4️⃣ Sections Implemented

| Section                | Content                                                                 | Visual rules |
|------------------------|-------------------------------------------------------------------------|--------------|
| **1. Platform Confidence** | One row per platform: name, confidence value, level (High / Medium / Weak). | 80+ → green, 60–80 → amber, &lt;60 → red. |
| **2. Strategist Acceptance** | Total feedback events + IMPROVE_CTA, IMPROVE_HOOK, ADD_DISCOVERABILITY as percentages. | Plain list. |
| **3. Strategy Decisions** | STAGGERED and ALL_AT_ONCE with “X weeks” counts (v1: 0).                | Plain list. |
| **4. Slot Optimization**  | “Slot priority adjustments applied: N times” (v1: 0).                   | Single line. |
| **5. Generation Bias**    | CTA Bias, Discoverability Bias, Hook Softening — ON/OFF from summary.   | ON = green, OFF = muted. |

- **Header:** Back button, “Campaign Intelligence” title with icon.
- **Layout:** Max-width container, stacked card-style sections, no filters or charts.

---

## 5️⃣ Before vs After (System Behavior Unchanged)

- **Before:** No dedicated read-only view of campaign intelligence; memory and bias were used only inside pipeline and distribution.
- **After:** One GET API and one page that expose the same underlying data (strategic memory + derived profile and bias flags). No logic changes: no new adaptive rules, no schema changes, no writes. Summary does not feed back into distribution, generation, or slot logic.

---

## 6️⃣ Edge Cases

- **No campaignId:** API returns 400; page does not request.
- **No access:** API returns 401/403 via `requireCampaignAccess`.
- **No rows:** Profile has `total_events: 0`, empty rates and platform averages; UI shows “No platform confidence data yet” and zeros where applicable.
- **API failure:** Page shows error message; no retry or mutation.
- **Missing profile fields:** `action_acceptance_rate` and `platform_confidence_average` default to empty; bias flags false. No crash.

---

## Files Touched

| File | Change |
|------|--------|
| `lib/intelligence/generationBias.ts` | **Modified** — Added `ActiveGenerationBiasFlags` and `getActiveGenerationBiasFlags(profile)` for observability. |
| `pages/api/intelligence/summary.ts` | **Created** — GET summary API and `CampaignIntelligenceSummary` type. |
| `pages/campaign-intelligence/[id].tsx` | **Created** — Campaign Intelligence panel with five sections. |

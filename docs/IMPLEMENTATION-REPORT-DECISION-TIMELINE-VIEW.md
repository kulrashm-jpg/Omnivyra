# Decision Timeline View (Phase 1) — Implementation Report

## 1️⃣ API Created

**`pages/api/intelligence/decision-timeline.ts`**

- **Method:** GET only.
- **Query:** `campaignId` (required).
- **Auth:** `requireCampaignAccess(req, res, campaignId)`.
- **Response:** `DecisionTimelineResponse`:
  - `campaign_id`
  - `total_weeks_logged` (length of decisions array)
  - `decisions`: array of `DistributionDecisionTimelineItem` (week_number, resolved_strategy, auto_detected, quality_override, slot_optimization_applied, created_at).
- **Dev log:** `console.log('[DecisionTimeline]', { campaignId, count })` in development.

---

## 2️⃣ DB Query Logic

- **Table:** `campaign_distribution_decisions`.
- **Select:** `week_number`, `resolved_strategy`, `auto_detected`, `quality_override`, `slot_optimization_applied`, `created_at`.
- **Filter:** `campaign_id = access.campaignId`.
- **Order:** `week_number ASC`.
- **Error handling:** Query wrapped in try/catch; on table missing or query failure, `decisions` remains empty; response still returns 200 with `decisions: []`.

---

## 3️⃣ UI Section Added

**`pages/campaign-intelligence/[id].tsx`**

- **State:** `const [timeline, setTimeline] = useState<TimelineItem[]>([])`.
- **Data load:** On page load (when `id` is set), fetches summary and decision-timeline in parallel. Timeline fetch failure is non-fatal: on catch, timeline is set to `[]`.
- **Section 6 — Decision Timeline:** Card titled "Decision Timeline" (Clock icon). For each item:
  - **Week N** (heading)
  - Strategy: STAGGERED (indigo badge) or ALL_AT_ONCE (amber badge)
  - AUTO: Yes (blue dot + "Yes") or No (muted)
  - Quality Override: Yes (violet badge) or No (muted)
  - Slot Optimization: Yes (emerald badge) or No (muted)
  - Date: formatted via `toLocaleString()` from `created_at`.
- **Empty state:** "No distribution decisions logged yet." when `timeline.length === 0`.

---

## 4️⃣ Example Timeline Output

**API response (200):**

```json
{
  "campaign_id": "abc-123",
  "total_weeks_logged": 2,
  "decisions": [
    {
      "week_number": 1,
      "resolved_strategy": "STAGGERED",
      "auto_detected": true,
      "quality_override": true,
      "slot_optimization_applied": false,
      "created_at": "2025-03-03T12:00:00.000Z"
    },
    {
      "week_number": 2,
      "resolved_strategy": "ALL_AT_ONCE",
      "auto_detected": false,
      "quality_override": false,
      "slot_optimization_applied": false,
      "created_at": "2025-03-03T12:01:00.000Z"
    }
  ]
}
```

**UI:** Two cards: "Week 1" and "Week 2" with the badges and date as specified.

---

## 5️⃣ Edge Cases

- **No campaignId:** API returns 400.
- **No access:** API returns 401/403 via requireCampaignAccess.
- **Table missing:** Query throws; caught; API returns 200 with `decisions: []`.
- **No rows:** API returns 200 with `decisions: []`; UI shows "No distribution decisions logged yet."
- **Timeline API fails on page:** Timeline fetch caught; `timeline` set to `[]`; summary still shown; timeline section shows empty state.
- **Invalid resolved_strategy in DB:** Normalized to STAGGERED or ALL_AT_ONCE (non-matching values treated as STAGGERED).

---

## 6️⃣ Behavior Confirmation (No Logic Changes)

- **Distribution:** No changes to distribution or logging logic.
- **Generation:** No changes to generation or bias logic.
- **No new adaptive rules:** Timeline is read-only projection from existing `campaign_distribution_decisions` data.
- **No DB writes:** Timeline API and UI only read; no mutations.
- **Single lightweight GET:** One select, no aggregation, no joins; timeline fetch failure does not block summary.

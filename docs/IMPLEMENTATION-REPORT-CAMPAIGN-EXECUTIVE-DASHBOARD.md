# Implementation Report: Campaign Executive Dashboard (Content Performance Only)

**Status:** Implementation only. No refactor, no schema changes, no modification to existing analytics pages. UI-only projection over allowed APIs.

---

## 1️⃣ Page Created

- **Path:** `pages/campaign-health/[id].tsx` (renamed from campaign-executive; see rename report).
- **Route:** `/campaign-health/[id]` (e.g. `/campaign-health/550e8400-e29b-41d4-a716-446655440000`)
- **Scope:** Campaign-scoped (single campaign by `id`). Content performance and strategic health only; no Community AI metrics (reply latency, moderation, sentiment, AI reply approval, conversation stats).

---

## 2️⃣ APIs Used

Only the following three APIs are called; no other API calls are made.

| API | When | Purpose |
|-----|------|--------|
| **GET /api/executive/campaign-health?campaignId=** | On mount (when `id` is set) | Campaign health summary: performance_health, engagement/reach trends, 7-day totals (engagement, comments), stability_level, strategist_acceptance_rate, auto_distribution_ratio, slot_optimization_applied_count, volatility_score, alerts. |
| **GET /api/intelligence/summary?campaignId=** | On mount (parallel with health) | Intelligence summary: total_feedback_events, action_acceptance_rate (IMPROVE_CTA, IMPROVE_HOOK, ADD_DISCOVERABILITY), active_generation_bias. Used in Enterprise view only. |
| **GET /api/intelligence/decision-timeline?campaignId=** | On mount (parallel with health) | Decision timeline and stability: stability.strategy_switches (and stability_level, volatility_score). Used in Enterprise view for execution intelligence. |

- All three are fetched in parallel once when the page loads. **Mode toggle (Creator / Enterprise) does not trigger any additional API calls**; it only switches which sections are rendered.

---

## 3️⃣ Creator Mode Sections

Default mode: **Creator View**. Rendered in order:

1. **Campaign Health Hero**  
   Large card showing:
   - `performance_health` (GROWING / STABLE / DECLINING) with icon (TrendingUp / TrendingDown / Minus).
   - Color: GROWING → green (emerald), STABLE → amber, DECLINING → red.
   - Subtext: “Engagement trend X% · Reach Y%” using `engagement_trend_percent` and `reach_trend_percent` (formatted with + for positive). Nulls shown as “—”.

2. **Weekly Activity Snapshot**  
   Two cards side by side:
   - **Total engagement (last 7 days):** `total_engagement_last_7_days`; line below: “Up” / “Down” / “Same as” previous week (from comparison with `total_engagement_previous_7_days`).
   - **Comments (last 7 days):** `total_comments_last_7_days`; same “Up” / “Down” / “Same as” vs `total_comments_previous_7_days`.  
   No percentages or marketing jargon.

3. **Alerts**  
   - If `health.alerts.length > 0`: box titled “Needs Attention” with bullet list of alert messages.
   - If no alerts: “No immediate risks detected.” with checkmark styling.

4. **Strategy Stability (Light)**  
   - `stability_level` (STABLE / MODERATE / VOLATILE) with color (emerald / amber / red).
   - `strategist_acceptance_rate` displayed as a percentage (e.g. 65%).  
   No volatility number in Creator view.

---

## 4️⃣ Enterprise Mode Additions

When **Enterprise View** is selected, the page shows everything in Creator view **plus**:

5. **Execution Intelligence Detail**  
   Grid of four cards:
   - Volatility score (`health.volatility_score`)
   - Strategy switch count (`timeline.stability.strategy_switches`)
   - Auto distribution ratio (`health.auto_distribution_ratio` as % or “—”)
   - Slot optimization applied count (`health.slot_optimization_applied_count`)

6. **AI Suggestion Behavior**  
   From `intelligenceSummary` (intelligence/summary API):
   - Total feedback events
   - Acceptance rate per action: IMPROVE_CTA, IMPROVE_HOOK, ADD_DISCOVERABILITY (as %)
   - Active generation bias: CTA, Discoverability, Hook softening (ON or “—”)

7. **Navigation Links**  
   Three buttons/links:
   - **View Detailed Analytics** → `/analytics?campaignId=${id}`
   - **View Campaign Intelligence** → `/campaign-intelligence/${id}`
   - **View Governance** → `/campaign-details/${id}`

---

## 5️⃣ Edge Case Handling

- **Missing `id`:** Renders “No campaign selected.” (no API calls).
- **Loading:** Single loading state while all three APIs are in flight; spinner and “Loading campaign health…”.
- **Health API failure:** Error state with message “Unable to load dashboard” and the error text; “Go back” button. Creator content is not rendered (health is required).
- **Intelligence or timeline API failure:** No error shown for those; Creator view still renders using health only. Enterprise view still renders; missing intelligence/timeline fields show “—” or empty.
- **Null/undefined fields:** Displayed as “—” (e.g. trend percent, acceptance rate, auto distribution ratio when null).
- **Empty alerts:** “No immediate risks detected.” with checkmark.

---

## 6️⃣ Navigation Flow

- **In-app:** “Back” in header calls `router.back()`.
- **Enterprise view only:**  
  - View Detailed Analytics → `/analytics?campaignId=${id}`  
  - View Campaign Intelligence → `/campaign-intelligence/${id}`  
  - View Governance → `/campaign-details/${id}`  

No navigation to Community AI executive or moderation/reply dashboards; this page is content performance and strategic health only.

---

## Design and Constraints

- **Tailwind only;** no chart libraries; no heavy tables.
- **Max-width container** (max-w-4xl) for main content.
- **Card-based layout** with rounded borders and light shadow.
- **No client-side metric computation:** all numbers come from the three APIs; only formatting (e.g. `toLocaleString()`, “—”, “Up”/“Down”/“Same as”) is done in the UI.
- **Does not:** duplicate the main analytics page, replace campaign-intelligence, mix in Community AI metrics, compute metrics client-side, or join tables. It is a read-only projection over the three allowed APIs.

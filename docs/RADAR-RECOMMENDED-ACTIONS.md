# Campaign Radar — Recommended Actions (AI Action Prioritization)

Rule-based "Top 3" manager action suggestions at the top of Radar View. Suggestions only; no workflow automation.

---

## 1. Recommendation ranking logic

**Priority order (first match wins; dedupe by activity; take top 3):**

1. **Overdue** — activity is past due → action "Address overdue", reason "Overdue"
2. **Blocked** — approval_status is request_changes → "Unblock", "Blocked - changes requested"
3. **Waiting approvals** — approval_status is pending → "Review", "Waiting approval"
4. **Unassigned** — no owner_id/owner_name → "Assign", "Unassigned"
5. **Approved but not moved** — approval_status is approved and stage ≠ SHARE → "Move to next stage", "Approved but not moved"

**Implementation:** `getRecommendedActions(health: CampaignHealth, activities: Activity[], limit?: number)` in `lib/campaign-health-engine.ts`. Uses existing `health.attentionItems` for 1–4 (already ordered by ATTENTION_PRIORITY), then scans activities for approved-but-not-in-last-stage for 5. Each activity appears at most once (highest-priority reason). Returns up to `limit` (default 3).

---

## 2. UI component structure

**Placement:** Top of Radar View, above Health Summary Cards.

**Section:** "Recommended Actions" (heading + lightbulb icon).

**Per action (card):**
- Activity title (truncate if needed)
- Action label + reason (e.g. "Review — Waiting approval")
- Button: [Open Activity]

**Behavior:** Clicking [Open Activity] calls `onSelectActivity(activityId)` → opens activity side panel. No automatic changes.

**When empty:** Section is hidden when there are no recommendations.

---

## 3. Integration with radar health engine

- **Input:** Same `CampaignHealth` and `activities` already passed to ManagerRadarView.
- **Computation:** `getRecommendedActions(health, activities, 3)` in a `useMemo` inside ManagerRadarView.
- **No new API.** Recommendations are derived from existing health + activities; no ML or external service.

---

## 4. Constraints

- Recommendations are suggestions only.
- No workflow automation; user must open activity and act.
- Rule-based only (no ML in this implementation).

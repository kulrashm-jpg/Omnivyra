# IMPLEMENTATION REPORT — STRATEGIC MEMORY GRAPH FOUNDATION

## 1. Files Modified

- **Created:** `backend/services/strategicMemoryService.ts`
- **Created:** `pages/api/community-ai/strategic-memory.ts`
- **Created:** `database/strategic_memory_snapshots.sql`
- **Created:** `docs/IMPLEMENTATION-REPORT-STRATEGIC-MEMORY-GRAPH-FOUNDATION.md`

## 2. Snapshot Data Structure

- **Row:** One record per snapshot with `campaign_id`, `week_index`, `metrics_summary`, `insights_summary`, `created_at`.
- **metrics_summary (JSON):** `avg_comments_per_post`, `total_comments`, `high_priority_actions`, `intelligence_level` (LOW | MEDIUM | HIGH). Sourced from latest strategic feedback and weekly strategy intelligence.
- **insights_summary (JSON):** `strategic_insights` (string[]), `awareness_level` (LOW | MEDIUM | HIGH). Sourced from weekly strategy intelligence and strategy awareness.
- **week_index:** Matches blueprint week: set to the maximum `week_number` in the campaign blueprint when generating, or 1 if no blueprint.

## 3. Trend Logic

- **Input:** Last 3 snapshots for the campaign (ordered by `created_at` asc for trend, i.e. oldest first after loading desc then reversing).
- **Deltas:** `comments_delta` = change in `total_comments` from first to last snapshot; `priority_pressure_delta` = change in `high_priority_actions`; `intelligence_shift` = ordinal difference (LOW=0, MEDIUM=1, HIGH=2) from first to last.
- **Trend rules (deterministic):**  
  - **IMPROVING:** Comments increased in two consecutive periods (snapshots[1] > snapshots[0] and snapshots[2] > snapshots[1]).  
  - **DECLINING:** Comments decreased in two consecutive periods (snapshots[1] < snapshots[0] and snapshots[2] < snapshots[1]).  
  - **STABLE:** Otherwise. If fewer than 2 snapshots, trend is STABLE with summary "Insufficient snapshots for trend."
- **Summary:** Short strings describing trend and optional deltas (e.g. "Comments increased over the last two periods.", "Comments delta: +N", "Priority pressure delta: +M", "Intelligence shift: +K").

## 4. Storage Strategy

- **Table:** `strategic_memory_snapshots` (new, minimal). No FKs or extra columns. Index on `(campaign_id, created_at DESC)` for current snapshot and last N queries.
- **Reuse check:** Existing `campaign_memory_snapshots` is company-scoped and stores generic `memory_json`; it is not campaign+week indexed and does not hold metrics_summary/insights_summary. So a dedicated table was added.
- **Write path:** Only via `generateStrategicMemorySnapshot(campaign_id)`, which is invoked only when the API is called with `?generate=1` (manual/safe trigger). No automatic runs on publish or elsewhere.

## 5. Data Flow After Change

```text
Manual trigger: GET .../strategic-memory?campaign_id=…&generate=1
  → generateStrategicMemorySnapshot(campaign_id)
       → getLatestStrategicFeedback, getWeeklyStrategyIntelligence, getStrategyAwareness, getUnifiedCampaignBlueprint
       → week_index = max(blueprint.weeks.week_number) or 1
       → INSERT strategic_memory_snapshots (metrics_summary, insights_summary, week_index)

GET .../strategic-memory?campaign_id=…
  → getCurrentStrategicMemorySnapshot(campaign_id)  → latest row by created_at
  → getStrategicMemoryTrend(campaign_id)            → last 3 rows, compute trend + summary
  → response: { current_snapshot, trend }
```

## 6. Safety Guarantees

- **Snapshot generation:** Manual or safe-call only; no auto-run on every publish or on any background job.
- **No planner integration:** No calls from campaignAiOrchestrator or planning flows.
- **No awareness or strategy mutation:** Only reads from strategic feedback, weekly strategy intelligence, and strategy awareness; no writes to those layers.
- **No schema impact on existing tables:** New table only; no alters to campaigns, refinements, or activity_feed.
- **Read-only by default:** GET without `generate=1` only reads current_snapshot and trend.

## 7. Verification Notes

- **Snapshot storage:** Each generated snapshot has `campaign_id`, `week_index` (aligned to blueprint), `metrics_summary` (avg_comments_per_post, total_comments, high_priority_actions, intelligence_level), and `insights_summary` (strategic_insights, awareness_level).
- **Trend:** With at least 2 snapshots, IMPROVING/DECLINING/STABLE is derived from consecutive comment changes; summary array includes trend description and optional deltas. With &lt; 2 snapshots, trend is STABLE and summary explains insufficient data.
- **No interference:** Service only reads from strategicFeedbackService, weeklyStrategyIntelligenceService, strategyAwarenessService, and campaignBlueprintService; writes only to `strategic_memory_snapshots`. No changes to previous intelligence or awareness behavior.

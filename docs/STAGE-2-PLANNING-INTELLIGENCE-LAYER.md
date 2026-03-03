# Stage 2 — Planning Intelligence Layer

## Overview

The Planning Intelligence Layer decides **distribution strategy** per campaign from context (duration, capacity, platforms, demand, cross-platform reuse). No UI changes; strategy is applied in the orchestrator and in weekly/daily generation.

---

## 1. Decision matrix

| Condition | Result |
|-----------|--------|
| `campaignDurationWeeks <= 1` | **QUICK_LAUNCH** |
| `postingDemand / max(weeklyCapacity, 1) > 2.5` (high demand vs capacity) | **QUICK_LAUNCH** |
| `crossPlatformReuse && platformCount >= 2` and duration 2–12 weeks and demand ratio ≤ 2.5 | **STAGGERED** |
| `platformCount >= 2` and duration 2–12 weeks (moderate timeframe) | **STAGGERED** |
| Otherwise | **AI_OPTIMIZED** (default) |

Evaluation order: QUICK_LAUNCH rules first, then STAGGERED, then default AI_OPTIMIZED.

---

## 2. Where strategy is stored

- **Computed in:** `backend/services/campaignAiOrchestrator.ts` in `runCampaignAiPlanWithPrefill`, after planning context is ready, via `determineDistributionStrategy()` from `backend/services/planningIntelligenceService.ts`.
- **Attached to plan:** In `runWithContext`, before returning the result, each week in `structured.weeks` gets `distribution_strategy: ctx.distributionStrategy ?? 'AI_OPTIMIZED'`.
- **Persisted:** The structured plan (including `weeks[].distribution_strategy`) is saved via `saveStructuredCampaignPlan` / draft blueprint, so it appears in the committed blueprint.
- **Read at daily generation:** `pages/api/campaigns/generate-weekly-structure.ts` reads `weekBlueprint.distribution_strategy` and maps it to `campaignMode` and `distributionMode` when calling `generateAIDailyDistribution()`:
  - **QUICK_LAUNCH** → `campaignMode: 'QUICK_LAUNCH'`, `distributionMode: 'same_day_per_topic'`
  - **STAGGERED** → `campaignMode: 'STRATEGIC'`, `distributionMode: 'staggered'`
  - **AI_OPTIMIZED** or missing → `campaignMode: 'STRATEGIC'`, `distributionMode: 'staggered'` (existing default; behavior unchanged when strategy is absent).

---

## 3. Example week JSON

```json
{
  "week_number": 2,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness of the new product line",
  "topics": [
    { "topicTitle": "Problem we solve", "briefSummary": "..." },
    { "topicTitle": "Customer success story", "briefSummary": "..." }
  ],
  "topics_to_cover": ["Problem we solve", "Customer success story"],
  "content_type_mix": ["post", "video"],
  "execution_items": [],
  "distribution_strategy": "STAGGERED"
}
```

When `distribution_strategy` is missing, downstream behavior is unchanged and defaults to **AI_OPTIMIZED** (STRATEGIC + staggered in the daily distribution service).

# Phase 5 — Content Distribution Intelligence Engine — Implementation Report

**Date:** 2025-03-07  
**Phase:** 5 — Review engine for weekly plan improvement opportunities  
**Constraint:** Does NOT modify the plan; only produces distribution insights.

---

## 1. Objective

Create an engine that evaluates the weekly activity plan and detects issues related to:

- Excessive posting frequency  
- Content type imbalance  
- Platform concentration  
- Publishing saturation  
- Repurpose spacing problems  

---

## 2. Service Created

**File:** `backend/services/contentDistributionIntelligence.ts` (re-exports)  
**Shared lib:** `lib/planning/contentDistributionIntelligence.ts`

**Main function:** `analyzeWeeklyDistribution(weekPlan): DistributionInsight[]`

Returns empty array if no issues detected.

---

## 3. Insight Structure

```ts
{
  type: string;           // e.g. "frequency_risk", "content_type_imbalance"
  severity: "info" | "warning";
  message: string;
  recommendation?: string;
}
```

---

## 4. Rule Engine Implemented

| Rule | Threshold | Example insight |
|------|-----------|-----------------|
| **Platform frequency** | LinkedIn >5, Twitter >10, Blog (content type) >3/week | "LinkedIn posting frequency is high (6 posts/week). Consider reducing to 3–5 per week." |
| **Content type imbalance** | Posts >80% of activities | "Your plan relies heavily on short-form posts. Consider adding long-form or carousel content." |
| **Platform concentration** | Single platform >80% of outputs | "Your campaign is concentrated on one platform. Consider diversifying." |
| **Publishing intensity** | Total >15 outputs/week | "Total weekly outputs (18) may be high. Consider reducing to 15 or fewer per week." |
| **Repurpose cluster** | Same-topic items on adjacent days | "Topic A has items on adjacent days (A1 and A2). Consider spacing repurposed content by at least one day." |

---

## 5. Integration Points

1. **After schedule edit** — `pages/api/campaigns/apply-weekly-plan-edits.ts`  
   - Runs `analyzeWeeklyDistribution(week)` after applying edits  
   - Attaches `distribution_insights` to week before save  
   - Persisted via `saveDraftBlueprint` / `updateToEditedCommitted`

2. **After schedule generated** — `backend/services/campaignAiOrchestrator.ts`  
   - Runs `analyzeWeeklyDistribution(w)` on each week after `assignWeeklySchedule`  
   - Attaches `distribution_insights` to each week in the plan

3. **Blueprint persistence** — `distribution_insights` added to:
   - `CampaignBlueprintWeek` (optional field)
   - `weeksForDbFromBlueprint` in campaignPlanStore
   - `fromStructuredPlan` in campaignBlueprintAdapter

4. **Client display** — Campaign daily plan page:
   - Uses `distribution_insights` from week when present
   - Falls back to `analyzeWeeklyDistribution(weekData)` when absent (e.g. legacy plans)
   - Passes insights to `WeeklyActivityBoard`

---

## 6. UI Banner

**Component:** `components/weekly-board/WeeklyActivityBoard.tsx`

When `distributionInsights.length > 0` and `onImprovePlan` is set:

- Banner: **"Plan improvements available"**
- Shows first insight message plus "(+N more)" if additional insights
- **"Improve Plan"** button — same handler as existing Improve Plan (opens AI chat)

---

## 7. Files Created / Modified

| File | Change |
|------|--------|
| `lib/planning/contentDistributionIntelligence.ts` | **New** — Shared analysis logic |
| `backend/services/contentDistributionIntelligence.ts` | **New** — Re-exports from lib |
| `backend/types/CampaignBlueprint.ts` | **Modified** — Added `distribution_insights` |
| `backend/services/campaignBlueprintAdapter.ts` | **Modified** — Pass `distribution_insights` |
| `backend/db/campaignPlanStore.ts` | **Modified** — Persist `distribution_insights` |
| `pages/api/campaigns/apply-weekly-plan-edits.ts` | **Modified** — Attach insights after edit |
| `backend/services/campaignAiOrchestrator.ts` | **Modified** — Attach insights after schedule |
| `components/weekly-board/WeeklyActivityBoard.tsx` | **Modified** — Banner + `distributionInsights` prop |
| `pages/campaign-daily-plan/[id].tsx` | **Modified** — Pass insights to board |

---

## 8. Confirmation Checklist

1. **Service created** — `contentDistributionIntelligence.ts` (lib + backend re-export)  
2. **Rule engine implemented** — 5 rules: frequency, imbalance, concentration, intensity, repurpose cluster  
3. **Insight structure defined** — `{ type, severity, message, recommendation? }`  
4. **Integration point added** — After generation (orchestrator) and after edit (API)  
5. **UI banner trigger implemented** — "Plan improvements available" + Improve Plan button  

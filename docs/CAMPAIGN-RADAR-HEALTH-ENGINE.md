# Campaign Radar — Reusable Health Engine

Campaign-level health signals as a **reusable service** (no UI in engine). Designed to power Campaign Radar and future company-wide Super Radar.

---

## 1. Service structure

```
lib/campaign-health-engine.ts
├── Types (engine output only)
│   ├── CampaignHealth
│   ├── StageHealthSummaryItem
│   ├── AttentionItem, AttentionReason
│   └── ComputeCampaignHealthOptions
├── Pure aggregation
│   └── computeCampaignHealth(activities, options?) → CampaignHealth
├── Campaign-scoped API
│   └── getCampaignHealth(campaignId, fetchActivities?, options?) → Promise<CampaignHealth>
└── Future (TODO)
    └── getCompanyHealth(companyId) — not implemented
```

**CampaignHealth** returned by the engine:

- `totalActivities`
- `overdueCount`
- `blockedCount`
- `pendingApprovalCount`
- `unassignedCount`
- `scheduledCount`
- `stageHealthSummary`: `{ stage, count, overdueCount, blockedCount, hasIssues }[]`
- `attentionItems`: `{ activityId, activity, reason, priority }[]` (ordered by signal priority)

**No UI logic** inside the engine. Dependencies: `Activity` and stage list from activity-board types; `isOverdue`, `isBlocked` from board-indicators.

---

## 2. Data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Data source (campaign-scoped)                                             │
│   • UI: activities from layout state (filtered by campaign/filters)      │
│   • Future API: getActivitiesByCampaign(campaignId)                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Health engine                                                             │
│   • computeCampaignHealth(activities, { now? }) → CampaignHealth         │
│   • getCampaignHealth(campaignId, fetchActivities?) → Promise<CampaignHealth> │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Campaign Radar View (UI)                                                  │
│   • Receives health: CampaignHealth, activities: Activity[]               │
│   • Renders: summary cards, stage radar, attention feed                   │
│   • Click item → onSelectActivity(id) → open side panel                 │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Layout (EnterpriseExecutionLayout):** Holds `activities` (and filters). Computes `campaignHealth = computeCampaignHealth(filteredActivities)` and passes `health` + `activities` to `ManagerRadarView`. No assumption that only one campaign exists; filtering by campaign is the caller’s responsibility before calling the engine.
- **Alternative:** Call `getCampaignHealth(campaignId, async (id) => fetchActivitiesForCampaign(id))` (e.g. from an API) and pass the returned `CampaignHealth` to the view.

---

## 3. UI integration steps

1. **Use the engine in the layout**  
   Import `computeCampaignHealth` from `lib/campaign-health-engine`. For the current campaign’s activities (e.g. `filteredActivities`), call `computeCampaignHealth(filteredActivities)` (optionally with `{ now }`). Store result in state or derive with `useMemo`.

2. **Pass engine output into the radar view**  
   `ManagerRadarView` props: `health: CampaignHealth`, `activities: Activity[]`, `selectedActivityId`, `onSelectActivity`. The view only renders from `health`; `activities` is used to resolve “first activity per stage” for stage-chip click targets.

3. **Async path (e.g. API)**  
   When activities come from the server, use `getCampaignHealth(campaignId, fetchActivities)` where `fetchActivities(campaignId)` returns `Promise<Activity[]>`. Use the returned `CampaignHealth` in the same way as above.

4. **Campaign scoping**  
   Ensure the activities list passed to `computeCampaignHealth` or to `fetchActivities` is for a single campaign. The engine does not filter by campaignId; the caller is responsible for scope.

---

## 4. Future: Super Radar extension notes

- **getCompanyHealth(companyId)** (TODO in engine):  
  - Input: `companyId`.  
  - Resolve campaign IDs for that company.  
  - For each campaign, call `getCampaignHealth(campaignId, fetchActivities)`.  
  - Aggregate counts (e.g. sum of `totalActivities`, `overdueCount`, etc.) and optionally keep a per-campaign breakdown or sampled `attentionItems`.  
  - Return a `CompanyHealth` shape (to be defined). Do not implement Super Radar UI in this step.

- **Reusability:** The same `computeCampaignHealth` and `getCampaignHealth` are used for:  
  - Current Campaign Radar (one campaign, activities from state or API).  
  - Future company view: call `getCampaignHealth` per campaign and then aggregate for `getCompanyHealth`.

- **No assumptions:** The engine never assumes “only one campaign.” Callers pass campaign-scoped activity lists or use `getCampaignHealth(campaignId, …)` per campaign.

# Campaign Creation Clean Migration — Implementation Report

**Module:** Campaign Creation Clean Migration  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## Executive Summary

Legacy campaign creation routes have been consolidated. The canonical campaign creation entry is now **`/campaign-planner`**. Legacy routes redirect to the planner and no longer create campaigns directly.

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `pages/create-campaign.tsx` | Removed all form logic. Now redirects via `router.replace('/campaign-planner?mode=direct')` with optional `companyId` preserved. No campaign creation logic remains. |
| `pages/campaign-planning.tsx` | When `mode=create` or when `campaignId` is missing: redirect to `/campaign-planner?mode=direct`. Edit mode preserved when `campaignId` exists. Create mode disabled. |
| `components/DashboardPage.tsx` | All four Create Campaign buttons updated from `/create-campaign` to `/campaign-planner?mode=direct`. |
| `pages/campaigns.tsx` | Both Create Campaign buttons updated from `/create-campaign` to `/campaign-planner?mode=direct`. |
| `lib/campaign-navigation-logic.ts` | `CampaignListButtons.createCampaign.action` and `Routes.createCampaign` updated to `/campaign-planner?mode=direct`. |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | When `generatedCampaignId` absent, Build Campaign Blueprint now navigates to `/campaign-planner?companyId=X&recommendationId=Y` instead of `POST /api/campaigns`. When `generatedCampaignId` present, unchanged flow (PUT source-recommendation → redirect to campaign-details). BOLT option preserved. |

---

## FILES_REDIRECTED

| route | redirect_target |
|-------|-----------------|
| `/create-campaign` | `/campaign-planner?mode=direct` (with `companyId` if present) |
| `/create-campaign?companyId=XYZ` | `/campaign-planner?mode=direct&companyId=XYZ` |
| `/campaign-planning?mode=create` | `/campaign-planner?mode=direct` |
| `/campaign-planning` (no campaignId) | `/campaign-planner?mode=direct` |

---

## FILES_REMOVED_LOGIC

| file | logic_removed |
|------|---------------|
| `pages/create-campaign.tsx` | Entire campaign creation form; name, timeframe, startDate, endDate, goals, submit handler, validation. Replaced with redirect-only page. |
| `pages/campaign-planning.tsx` | `mode=create` handling — no longer loads empty form or allows new campaign creation; redirects instead. |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | Inline `fetch('/api/campaigns', { method: 'POST' })` fallback in Build Campaign Blueprint when `generatedCampaignId` absent. Replaced with `router.push('/campaign-planner?...')`. |

---

## API_UNCHANGED_VERIFIED

| endpoint | status |
|----------|--------|
| `POST /api/campaigns` | Unchanged. Remains the single canonical creation API. Used by: create-campaign-from-group, recommendations/[id]/create-campaign, opportunityService.promoteToCampaign, BOLT pipeline, TrendCampaignsTab "Generate Strategic Themes" flow. |
| `POST /api/recommendations/[id]/create-campaign` | Preserved (Section 6). |
| `POST /api/recommendations/create-campaign-from-group` | Preserved (Section 6). |

---

## ROUTE_TESTS

| url | result |
|-----|--------|
| `/campaign-planner?mode=direct` | Planner loads in direct mode. |
| `/campaign-planner?mode=turbo` | Planner loads in turbo mode. |
| `/campaign-planner?recommendationId=XYZ` | Planner loads in recommendation mode with `recommendation_id`. |
| `/campaign-planner?campaignId=XYZ` | Planner loads in campaign mode with `campaign_id`. |
| `/campaign-planner?campaignId=XYZ&sourceOpportunityId=ABC` | Planner loads in campaign/opportunity context. |
| `/create-campaign` | Redirects to `/campaign-planner?mode=direct`. |
| `/campaign-planning?mode=create` | Redirects to `/campaign-planner?mode=direct`. |

---

## UI ENTRY POINTS

| entry point | verified |
|-------------|----------|
| Dashboard Create Campaign (4 buttons) | All point to `/campaign-planner?mode=direct`. |
| Campaign list Create Campaign (2 buttons) | Both point to `/campaign-planner?mode=direct`. |
| Recommendation Build Campaign Blueprint | When no pre-created campaign: navigates to `/campaign-planner?companyId=X&recommendationId=Y`. BOLT option preserved. |

---

## SPECIAL FLOWS PRESERVED (Section 6)

Not modified:

- `recommendations/[id]/create-campaign` — API and flow intact
- `create-campaign-from-group` — API and flow intact
- `opportunityService.promoteToCampaign` — service intact
- BOLT pipeline — intact
- TrendCampaignsTab "Generate Strategic Themes" → `POST /api/campaigns` (creates placeholder campaign for Build flow) — retained

---

## COMPILATION_STATUS

| field | value |
|-------|-------|
| status | FAILED (pre-existing errors; migration changes do not introduce new errors) |
| errors | `responsePolicyEngine.ts(103)`: mixed `??` and `\|\|` without parentheses; `ConversationView.tsx(82,86,93)`: missing `useCallback` import; `PlannerEntryRouter.tsx(53)`: `string[]` to `Record<string,unknown>` cast. |
| warnings | None from migration changes. |

**Note:** These errors predate the campaign creation clean migration. Migration scope was limited to entry logic; no changes were made to responsePolicyEngine, ConversationView, or PlannerEntryRouter.

---

## CONSTRAINTS OBSERVED

- Database schema: not modified
- AI orchestration logic: not modified
- BOLT pipeline: not modified
- Scheduler: not modified
- Scope: only campaign creation entry logic cleaned up

---

## Appendix: Planner entry modes

`PlannerEntryRouter` supports:

- `mode=direct` — blank slate creation
- `mode=turbo` — accelerated flow
- `recommendationId=XYZ` — recommendation-backed creation
- `campaignId=XYZ` — edit existing campaign
- `campaignId=XYZ&sourceOpportunityId=ABC` — campaign with opportunity context

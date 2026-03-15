# Campaign Intelligence — Context-Aware Health Evaluation Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Context-Aware Health Evaluation  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Extended `evaluateCampaignHealth` input with `company_context_mode`, `focus_modules`, `company_profile`. Added `CampaignHealthInput` interface. full_company_context: evaluates against company profile (audience, goals, platform alignment). focused_context: adds suggestion referencing selected focus_modules. Added `category` to `HealthSuggestion` (narrative, content_mix, cadence, audience, company_alignment, focus_coverage, general). |
| `pages/api/campaigns/health.ts` | Accepts `company_context_mode`, `focus_modules`, `companyId`. When `company_context_mode=full_company_context` and `companyId` provided, fetches company profile via `getProfile`. Passes full input to `evaluateCampaignHealth`. |
| `components/planner/CampaignHealthPanel.tsx` | Added `companyId` prop; passes `company_context_mode`, `focus_modules`, `companyId` to API. Updated `HealthSuggestion` to include `category`; displays category badge when present. |
| `pages/campaign-planner.tsx` | Passes `companyId` to `CampaignHealthPanel`. |

---

## CONTEXT_HEALTH_TEST

| item | value |
|------|-------|
| **input** | `campaign_design`, `execution_plan`, `company_context_mode` (full_company_context \| focused_context \| no_company_context), `focus_modules` (string[]), `companyId` (optional) |
| **result** | `CampaignHealthReport` with suggestions including `message`, `severity`, `category`. full_company_context + profile: company_alignment suggestions (audience, goals, platforms). focused_context + focus_modules: focus_coverage suggestion. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |

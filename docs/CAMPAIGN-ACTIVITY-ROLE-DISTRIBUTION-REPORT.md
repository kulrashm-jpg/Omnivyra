# Campaign Intelligence — Activity Role Distribution Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Activity Role Distribution  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `ActivityRole` type (awareness, education, authority, engagement, conversion). `classifyActivityRole()` maps activity to role via content_type/title/theme keywords. `computeRoleDistribution()` returns counts and percentages per role. `evaluateRoleBalance()` scores 0–100. `ROLE_DOMINANCE_THRESHOLD` (55%). Suggestions when role missing or exceeds threshold. Added `role_distribution`, `role_balance_score` to `CampaignHealthReport`. |
| `components/planner/CampaignHealthPanel.tsx` | Added `role_balance_score` to report; new ScoreBar "Role Balance". |
| `backend/jobs/campaignHealthEvaluationJob.ts` | Included `role_balance_score` in confidence average and scores. |

---

## ROLE_ANALYSIS_TEST

| item | value |
|------|-------|
| **input** | Activities array with content_type, title, theme. |
| **result** | `classifyActivityRole` → awareness \| education \| authority \| engagement \| conversion. `computeRoleDistribution` → by_role counts, percentages. Missing role → "Add {role} activities to balance the funnel." Role >55% → "Consider rebalancing across funnel roles." role_balance_score when 4+ roles and no dominance. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |

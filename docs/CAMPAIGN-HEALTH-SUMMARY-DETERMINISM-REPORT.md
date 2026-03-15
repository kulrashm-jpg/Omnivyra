# Campaign Intelligence — Health Summary Determinism Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Summary Determinism  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | `health_summary` uses fixed priority: narrative → role_distribution → execution_cadence → platform_distribution → metadata. Top 3 issue categories selected. Added `top_issue_categories: string[]`. Added `health_score`: average of 8 main scores (narrative, content_mix, cadence, audience, execution_cadence, platform, role_balance, metadata_completeness). Added `analysis_warnings: string[]` (activity sampling, high low-confidence ratio). |

---

## HEALTH_SUMMARY_TEST

| item | value |
|------|-------|
| **input** | Campaign with narrative &lt; 60, role_distribution issues, execution_cadence &lt; 50. |
| **top_issue_categories** | `['narrative', 'role_distribution', 'execution_cadence']` (fixed priority order, top 3 with issues). |
| **health_score** | Rounded average of narrative_score, content_mix_score, cadence_score, audience_alignment_score, execution_cadence_score, platform_distribution_score, role_balance_score, metadata_completeness_score. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |

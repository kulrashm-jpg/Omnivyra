# Language Refinement — Remaining Bypass Fix Implementation Report

**Date:** 2025-03-07

---

## 1 — Files Modified

- pages/api/campaigns/retrieve-plan.ts
- pages/api/campaigns/weekly-refinement.ts
- pages/api/content/list.ts
- pages/api/intelligence/competitive.ts
- pages/api/intelligence/summary.ts

---

## 2 — Code Locations

| File | Line | Function | Refinement Call Location |
|------|------|----------|---------------------------|
| pages/api/campaigns/retrieve-plan.ts | 4 | — | import refineUserFacingResponse |
| pages/api/campaigns/retrieve-plan.ts | 128-130 | handler | refineUserFacingResponse(responseData) before res.json |
| pages/api/campaigns/weekly-refinement.ts | 3 | — | import refineUserFacingResponse |
| pages/api/campaigns/weekly-refinement.ts | 73-82 | getWeeklyRefinement | refineUserFacingResponse(data) before res.json |
| pages/api/campaigns/weekly-refinement.ts | 99-108 | getRefinementStatus | refineUserFacingResponse(data) before res.json |
| pages/api/campaigns/weekly-refinement.ts | 135-144 | getDailyPlans | refineUserFacingResponse(data) before res.json |
| pages/api/content/list.ts | 5 | — | import refineUserFacingResponse |
| pages/api/content/list.ts | 52-54 | handler | refineUserFacingResponse(assets) before res.json |
| pages/api/intelligence/competitive.ts | 4 | — | import refineUserFacingResponse |
| pages/api/intelligence/competitive.ts | 23-24 | handler | refineUserFacingResponse(competitive_signals) before res.json |
| pages/api/intelligence/summary.ts | 4 | — | import refineUserFacingResponse |
| pages/api/intelligence/summary.ts | 106-107 | handler | refineUserFacingResponse(summary) before res.json |

---

## 3 — Endpoints Now Protected

- GET /api/campaigns/retrieve-plan
- GET /api/campaigns/weekly-refinement?action=weekly-refinement
- GET /api/campaigns/weekly-refinement?action=refinement-status
- GET /api/campaigns/weekly-refinement?action=daily-plans
- GET /api/content/list
- GET /api/intelligence/competitive
- GET /api/intelligence/summary

---

## 4 — Remaining Bypass Paths

Other intelligence and content endpoints (e.g. opportunities, themes, market-pulse, feedback, outcomes, simulation, playbooks, recommendations, correlations, learning, metrics, execution/run, execution/status, execution/metrics) may return user-visible text. These were not in the original Phase 4 bypass list and were not modified. No audit was performed to confirm whether they require refinement.

---

## 5 — Build Status

| Check | Status |
|-------|--------|
| TypeScript compile | Pre-existing errors in CampaignAIChat.tsx, company-plan-duration-limit.ts, recommendations/generate.ts, super-admin.tsx; modified files pass |
| Server start | Not verified |
| API routes load | Not verified |

# Mutation Governance Readiness Report

Mutation governance: SAFE
Mutation hard enforcement: PASSING
Critical mutation findings: 0
Uncontrolled mutation propagation: 0
Repository mutation ownership: AUTHORITATIVE for hard-enforced critical paths

High residual mutation findings: 475
High residual categories:
- runtime-mutation-outside-repository: 475

Top high residual mutation files:
1. pages/api/onboarding/setup-company.ts: 14
2. pages/api/auth/sync-supabase-user.ts: 11
3. pages/api/super-admin/users.ts: 11
4. pages/api/extension/events/dms.ts: 8
5. pages/api/recommendations/generate.ts: 8
6. backend/jobs/dailyIntelligenceScheduler.ts: 7
7. pages/api/company/users.ts: 7
8. pages/api/extension/events/comments.ts: 7
9. pages/api/onboarding/complete.ts: 7
10. pages/api/admin/delete-campaign.ts: 6
11. pages/api/campaigns/create-12week-plan.ts: 6
12. pages/api/campaigns/planner-finalize.ts: 6
13. pages/api/external-apis/access.ts: 6
14. pages/api/super-admin/free-credits/requests.ts: 6
15. pages/api/campaigns/pending/[id]/approve.ts: 5
16. pages/api/company/users/reinvite.ts: 5
17. pages/api/internal/process-reminders.ts: 5
18. pages/api/super-admin/companies.ts: 5
19. backend/jobs/weeklyPricingAnalysisJob.ts: 4
20. backend/workers/leadThreadRecomputeWorker.ts: 4
21. pages/api/admin/blog/series/[id].ts: 4
22. pages/api/admin/pricing/update.ts: 4
23. pages/api/campaigns/proposals/convert.ts: 4
24. pages/api/campaigns/weekly-refinement.ts: 4
25. pages/api/campaigns/[id].ts: 4

Hidden persistence ownership leakage: high residual API/job/service mutation debt remains.
Queue-owned persistence: present in high residual findings where pathClass is queue-job.
Scheduler-owned persistence: present in high residual findings where scheduler/job files write directly.
Blocking critical mutation leakage: none detected.

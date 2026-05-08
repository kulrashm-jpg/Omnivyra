# Mutation Governance Engine Report

Mutation governance engine: SEMANTIC

## Implemented
- AST mutation scanner for insert/update/upsert/delete.
- Repository/db path ownership classification.
- Repository facade awareness for ownedDbTable/from chain table extraction.
- DTO/shared payload mutation detection through assignment targets.
- Scheduler/queue/auth/session mutation classification through path and target.

## Counts
- mutation records: 1160
- runtime critical mutations: 0
- payload mutations: 2688
- critical payload mutations: 0

## Top Runtime Mutation Files
- pages/api/onboarding/setup-company.ts: 14
- pages/api/auth/sync-supabase-user.ts: 11
- pages/api/super-admin/users.ts: 11
- pages/api/extension/events/dms.ts: 8
- pages/api/recommendations/generate.ts: 8
- backend/jobs/dailyIntelligenceScheduler.ts: 7
- pages/api/company/users.ts: 7
- pages/api/extension/events/comments.ts: 7
- pages/api/onboarding/complete.ts: 7
- pages/api/admin/delete-campaign.ts: 6
- pages/api/campaigns/create-12week-plan.ts: 6
- pages/api/campaigns/planner-finalize.ts: 6
- pages/api/external-apis/access.ts: 6
- pages/api/super-admin/free-credits/requests.ts: 6
- pages/api/campaigns/pending/[id]/approve.ts: 5
- pages/api/company/users/reinvite.ts: 5
- pages/api/internal/process-reminders.ts: 5
- pages/api/super-admin/companies.ts: 5
- backend/jobs/weeklyPricingAnalysisJob.ts: 4
- backend/workers/leadThreadRecomputeWorker.ts: 4
- pages/api/admin/blog/series/[id].ts: 4
- pages/api/admin/pricing/update.ts: 4
- pages/api/campaigns/proposals/convert.ts: 4
- pages/api/campaigns/weekly-refinement.ts: 4
- pages/api/campaigns/[id].ts: 4
- pages/api/company/blog/series/[id].ts: 4
- pages/api/engagement/backfill-self-signals.ts: 4
- pages/api/engagement/reply.ts: 4
- pages/api/extension/commands.ts: 4
- pages/api/external-apis/requests/[id].ts: 4

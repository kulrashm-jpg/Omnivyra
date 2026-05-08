# Final Unsafe Propagation Verdict

Unsafe propagation engine:
PARTIAL

DTO trust boundaries:
PARTIAL

Repository output trust:
PARTIAL

Queue/scheduler trust boundaries:
PARTIAL

Authority trust typing:
PARTIAL

Critical unsafe propagation findings: 0

High unsafe propagation findings: 72716

Remaining dangerous unsafe surfaces: 72716

Unsafe propagation hard enforcement:
PASSING

Semantic trust regression:
NONE

Mutation governance regression:
NONE

Final unsafe propagation status:
PARTIAL

## Exact Unsafe Propagation Regions Eliminated
- Critical transitive unsafe propagation findings: 3454 -> 0.
- Semantic hard enforcement critical findings: 3454 -> 0.

## Exact Remaining Dangerous Unsafe Regions
- High-only transitive unsafe propagation findings: 72716.
- Critical unsafe source debt not currently enforced as critical propagation: 2358.

## Exact Remaining High-Only Unsafe Regions
- backend/services/structuredPlanScheduler.ts: 586
- pages/api/campaigns/generate-weekly-structure.ts: 402
- components/recommendations/hooks/useTrendCampaigns.ts: 381
- pages/api/campaigns/ai/plan.ts: 369
- components/recommendations/tabs/useTrendCampaignsCore.tsx: 365
- backend/scheduler/cron.ts: 345
- pages/api/activity-workspace/content.ts: 339
- backend/tests/integration/recommendation_engine.test.ts: 336
- components/WeekCard.tsx: 336
- pages/campaign-details/WeeklyContentSection.tsx: 335
- components/hooks/useDashboardState.tsx: 324
- backend/services/boltPipelineService.ts: 310
- hooks/useDailyPlanning.tsx: 299
- components/planner/hooks/useDailyPlan.ts: 293
- backend/services/recommendationEngine/engine.ts: 288
- hooks/useCampaignDetailsHandlers.tsx: 284
- lib/blog/runTemplateBlogGeneration.ts: 282
- backend/services/campaignIntelligenceService.ts: 269
- pages/api/analytics/system-state.ts: 262
- pages/campaign-daily-plan/[id].tsx: 254
- hooks/useCampaignCalendar.tsx: 252
- pages/api/intelligence/snapshot.ts: 245
- backend/services/executionEngines/creatorExecutionEngine.ts: 244
- backend/tests/integration/governance_projection.test.ts: 244
- hooks/useRecommendationsState.tsx: 242
- components/campaign-ai/reviewActivityHelpers.ts: 232
- hooks/useContentArchitect.tsx: 229
- backend/tests/integration/governance_snapshot.test.ts: 228
- backend/tests/integration/unified_content_generation.test.ts: 227
- pages/api/super-admin/users.ts: 226
- backend/services/contentGeneration/blueprintGenerator.ts: 223
- backend/services/recommendationEngine/scoringHelpers.ts: 215
- backend/tests/integration/governance_analytics.test.ts: 215
- backend/tests/unit/snapshotReportService.test.ts: 209
- pages/api/campaigns/planner-finalize.ts: 208
- lib/recommendationStrategicCard.ts: 204
- backend/services/boltScheduleBlockProcessor.ts: 200
- backend/services/companyProfileService.ts: 200
- hooks/useCampaignPlanningState.tsx: 200
- hooks/useSocialPlatforms.tsx: 197
- hooks/useCampaignDetailsCore.tsx: 193
- backend/tests/integration/governance_performance_guard.test.ts: 187
- backend/tests/unit/contentGenerationPipeline.test.ts: 185
- pages/api/onboarding/setup-company.ts: 182
- hooks/useCommunityActions.tsx: 181
- pages/api/extension/events/dms.ts: 181
- pages/api/auth/sync-supabase-user.ts: 180
- pages/api/external-apis/access.ts: 179
- components/super-admin/tabs/ApiCatalogSection.tsx: 178
- architecture-migration/quarantine/pages-api-campaigns-weekly-structure-helpers.ts: 177
- backend/services/reportCompetitorIntelligenceService.ts: 177
- pages/api/campaigns/index.ts: 177
- pages/api/campaigns/weekly-structure-helpers.ts: 177
- pages/api/engagement/inbox.ts: 174
- components/campaign-ai/useCampaignAiPlanningCatalog.ts: 173
- pages/community-ai/forecast.tsx: 173
- backend/tests/integration/campaign_execution_state_machine.test.ts: 172
- backend/tests/integration/governance_audit_job.test.ts: 171
- pages/api/reports/reportComposedMapper.ts: 171
- backend/scripts/finalIntelligencePipelineValidation.ts: 168
- components/recommendations/tabs/TrendCampaignsRecommendationCards.tsx: 168
- backend/tests/integration/governance_ledger.test.ts: 167
- pages/super-admin/free-credits.tsx: 166
- backend/services/companyTrendRelevanceEngine.ts: 165
- backend/tests/integration/user_lifecycle_management.test.ts: 164
- backend/tests/integration/governance_ui_layer.test.ts: 162
- backend/services/campaignPromptBuilder.ts: 160
- backend/services/dailyContentDistributionPlanService.ts: 160
- backend/tests/integration/campaign_preplanning_gate.test.ts: 160
- pages/api/engagement/reply.ts: 160
- backend/services/contentGeneration/platformVariantGenerator.ts: 159
- pages/api/reports/automation-activity.ts: 159
- backend/tests/integration/governance_lockdown.test.ts: 157
- pages/api/company/users.ts: 157
- lib/blog/runEditorialBlogGeneration.ts: 156
- backend/tests/integration/campaign_finalization_guard.test.ts: 155
- backend/tests/integration/community_ai_auto_rules_export.test.ts: 155
- backend/services/campaignPlanParser.ts: 153
- pages/api/activity-workspace/schedule.ts: 153
- pages/api/campaigns/[id]/momentum-amplifier.ts: 153

## Exact Regression Findings
- Semantic trust regression: NONE.
- Mutation governance regression: NONE.
- Runtime cycles: 0.
- Typecheck: passing.

## Exact Blockers Before Oversized-Runtime Phase
- High unsafe propagation findings remain.
- Source-level any/unknown debt remains across DTOs, repositories, queue payloads, and UI/runtime helpers.
- Ownership-risk audit still reports critical unsafe leaks outside this semantic propagation hard gate.

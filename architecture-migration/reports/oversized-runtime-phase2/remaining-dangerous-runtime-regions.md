# Remaining Dangerous Runtime Regions

Dangerous oversized runtime regions: 59
Mixed orchestration/persistence regions: 22
Mixed queue/scheduler/mutation regions: 16
Mixed authority/execution regions: 41

Remaining regions:
1. backend/services/structuredPlanScheduler.ts (2206 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
2. backend/services/companyProfileService.ts (2198 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
3. backend/scheduler/cron.ts (1316 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
4. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
5. pages/api/campaigns/generate-weekly-structure.ts (1245 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
6. lib/content/longFormPlanningEngine.ts (1024 LOC, P1, score 9)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
7. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
8. lib/blog/blogGenerationEngine.ts (1543 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
9. lib/blog/runTemplateBlogGeneration.ts (1472 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
10. backend/services/reportCompetitorIntelligenceService.ts (1241 LOC, P0, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
11. backend/services/recommendationEngine/engine.ts (1129 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
12. pages/api/intelligence/snapshot.ts (1106 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
13. backend/services/unifiedContentGenerationEngine.ts (871 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
14. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
15. pages/api/extension/events/dms.ts (716 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
16. backend/services/intentExecutionService.ts (709 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
17. backend/services/campaignPlanParser.ts (566 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
18. pages/api/recommendations/detected-opportunities.ts (513 LOC, P1, score 8)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
19. backend/services/export/reportHtmlSections.ts (1495 LOC, P0, score 7)
   ownership: orchestration, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
20. backend/services/aiGateway.ts (1192 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
21. lib/content/cardToContentBridge.ts (995 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
22. lib/blog/promptAssembler.ts (967 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
23. lib/content/companyContextBlock.ts (849 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
24. backend/services/prioritizationService.ts (808 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
25. backend/services/strategicThemeEngine.ts (808 LOC, P1, score 7)
   ownership: orchestration, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
26. lib/blog/regenerationExecutor.ts (713 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
27. pages/api/activity-workspace/content.ts (699 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
28. backend/services/dailyContentDistributionPlanService.ts (678 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
29. pages/api/campaigns/planner-finalize.ts (674 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
30. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
31. lib/blog/blogRunnerHelpers.ts (627 LOC, P1, score 7)
   ownership: orchestration, persistence, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
32. backend/services/engagementAiAssistantService.ts (618 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
33. backend/services/recommendationEngine/engineHelpers.ts (612 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
34. lib/content/contentDepthAndInsightEngine.ts (612 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
35. pages/api/engagement/inbox.ts (589 LOC, P1, score 7)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
36. lib/content/longFormQualityEngine.ts (576 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
37. lib/blog/runStandardBlogGeneration.ts (568 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
38. pages/api/auth/sync-supabase-user.ts (972 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
39. backend/services/executionEngines/creatorExecutionEngine.ts (920 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
40. backend/services/contentGeneration/platformVariantGenerator.ts (911 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
41. pages/api/super-admin/users.ts (861 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
42. backend/services/HorizonConstraintEvaluator.ts (804 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
43. backend/services/platformIntelligenceService.ts (802 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
44. pages/api/analytics/system-state.ts (682 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
45. backend/jobs/dailyIntelligenceScheduler.ts (679 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
46. backend/services/reportCardService.ts (671 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
47. backend/services/contentGeneration/blueprintGenerator.ts (606 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
48. backend/services/reportInputResolver.ts (561 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
49. backend/services/executionPlannerService.ts (558 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, queueCoordination, scoring
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=false
50. lib/blog/runTutorialBlogGeneration.ts (550 LOC, P1, score 6)
   ownership: orchestration, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
51. backend/services/behaviorAnalyticsService.ts (505 LOC, P1, score 6)
   ownership: persistence, validation, mapping, rendering, queueCoordination, authority
   dangerous: orchestration/persistence=false, queue/mutation=true, authority/execution=false
52. backend/services/export/reportHtmlSnapshotMasterDocument.ts (911 LOC, P1, score 5)
   ownership: orchestration, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
53. backend/services/ga4IngestionService.ts (730 LOC, P1, score 5)
   ownership: orchestration, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
54. lib/blog/runEditorialBlogGeneration.ts (584 LOC, P1, score 5)
   ownership: orchestration, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
55. backend/services/engagementIngestionService.ts (583 LOC, P1, score 5)
   ownership: orchestration, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
56. pages/api/reports/automation-activity.ts (560 LOC, P1, score 5)
   ownership: orchestration, persistence, mapping, rendering, scoring
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
57. backend/services/ingestionScheduler.ts (522 LOC, P1, score 5)
   ownership: orchestration, persistence, validation, mapping, rendering
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=false
58. backend/services/domainRecordService.ts (514 LOC, P1, score 5)
   ownership: orchestration, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
59. backend/services/performanceReportService.ts (511 LOC, P1, score 5)
   ownership: orchestration, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true

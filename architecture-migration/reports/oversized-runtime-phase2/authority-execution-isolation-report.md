# Authority/Execution Isolation Report

Completed isolation:
- Oversized ownership detection no longer treats generic company-domain data as authority ownership.
- Authority/execution co-location now requires concrete authority surfaces such as capability, principal, auth context, session, role, permission, authorization, trusted principal, or user-context resolution.

Remaining mixed authority/execution regions: 41

Remaining top blockers:
1. backend/services/structuredPlanScheduler.ts (2206 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
2. backend/services/companyProfileService.ts (2198 LOC, P0, score 10)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
3. backend/services/campaignIntelligenceService.ts (1300 LOC, P0, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
4. lib/content/longFormPlanningEngine.ts (1024 LOC, P1, score 9)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
5. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
6. lib/blog/blogGenerationEngine.ts (1543 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
7. lib/blog/runTemplateBlogGeneration.ts (1472 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
8. backend/services/unifiedContentGenerationEngine.ts (871 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
9. pages/api/campaigns/ai/plan.ts (830 LOC, P1, score 8)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
10. backend/services/intentExecutionService.ts (709 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
11. backend/services/campaignPlanParser.ts (566 LOC, P1, score 8)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
12. backend/services/export/reportHtmlSections.ts (1495 LOC, P0, score 7)
   ownership: orchestration, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
13. backend/services/aiGateway.ts (1192 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
14. lib/content/cardToContentBridge.ts (995 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
15. lib/blog/promptAssembler.ts (967 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true

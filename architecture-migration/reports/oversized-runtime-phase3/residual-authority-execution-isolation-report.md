# Residual Authority/Execution Isolation Report

Completed isolation:
- Authority ownership detection no longer treats generic role/session domain vocabulary as authority ownership.
- Authority/execution overlap now requires explicit authority surfaces: capability, principal, auth context, permission, authorize/authenticate, user-context resolution, trusted principal, or named authority services.

Remaining mixed authority/execution regions: 12

Remaining top blockers:
1. pages/api/engagement/reply.ts (878 LOC, P1, score 9)
   ownership: orchestration, persistence, validation, mapping, rendering, queueCoordination, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=true, authority/execution=true
2. lib/blog/blogGenerationEngine.ts (1543 LOC, P0, score 8)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
3. backend/services/aiGateway.ts (1192 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
4. lib/content/cardToContentBridge.ts (995 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
5. lib/blog/promptAssembler.ts (967 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
6. lib/content/companyContextBlock.ts (849 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, scoring, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
7. backend/services/prioritizationService.ts (808 LOC, P1, score 7)
   ownership: orchestration, validation, mapping, rendering, queueCoordination, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
8. pages/api/external-apis/index.ts (673 LOC, P1, score 7)
   ownership: orchestration, persistence, validation, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
9. backend/services/export/reportHtmlSections.ts (1495 LOC, P0, score 6)
   ownership: orchestration, mapping, rendering, scoring, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
10. backend/services/executionEngines/creatorExecutionEngine.ts (920 LOC, P1, score 6)
   ownership: orchestration, validation, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=false, queue/mutation=false, authority/execution=true
11. pages/api/super-admin/users.ts (861 LOC, P1, score 6)
   ownership: orchestration, persistence, validation, mapping, rendering, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true
12. pages/api/analytics/system-state.ts (682 LOC, P1, score 6)
   ownership: orchestration, persistence, mapping, rendering, promptConstruction, authority
   dangerous: orchestration/persistence=true, queue/mutation=false, authority/execution=true

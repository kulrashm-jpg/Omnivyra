import { getDecisionReportView, type DecisionReportView } from './decisionReportService';
import { listDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { assertDecisionArray, assertDecisionReportView } from './decisionRuntimeGuardService';

const DEFAULT_LIMIT = 100;

export async function getDecisionIntelligenceForCompany(
  companyId: string,
  options?: { reportTier?: 'snapshot' | 'growth' | 'deep'; sourceService?: string }
): Promise<DecisionReportView> {
  const report = await getDecisionReportView({
    companyId,
    reportTier: options?.reportTier ?? 'growth',
    sourceService: options?.sourceService,
  });

  return assertDecisionReportView('intelligenceOrchestrationService.getDecisionIntelligenceForCompany', report);
}

export async function getOpportunityDecisionsForCompany(
  companyId: string,
  options?: { limit?: number }
): Promise<PersistedDecisionObject[]> {
  const decisions = await listDecisionObjects({
    viewName: 'growth_view',
    companyId,
    sourceService: 'opportunityDetectionService',
    status: ['open'],
    limit: options?.limit ?? DEFAULT_LIMIT,
  });

  return assertDecisionArray('intelligenceOrchestrationService.getOpportunityDecisionsForCompany', decisions);
}

export async function getRecommendationDecisionsForCompany(
  companyId: string,
  options?: { limit?: number }
): Promise<PersistedDecisionObject[]> {
  const decisions = await listDecisionObjects({
    viewName: 'growth_view',
    companyId,
    status: ['open'],
    limit: options?.limit ?? DEFAULT_LIMIT,
  });

  return assertDecisionArray('intelligenceOrchestrationService.getRecommendationDecisionsForCompany', decisions);
}

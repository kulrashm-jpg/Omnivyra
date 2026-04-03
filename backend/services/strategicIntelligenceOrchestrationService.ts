import { listDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { getDecisionReportView, type DecisionReportView } from './decisionReportService';
import { assertDecisionArray, assertDecisionReportView } from './decisionRuntimeGuardService';

const DEFAULT_LIMIT = 100;

export async function getStrategicThemesForCompany(
  companyId: string,
  options?: { limit?: number }
): Promise<{ decisions: PersistedDecisionObject[] }> {
  const decisions = await listDecisionObjects({
    viewName: 'growth_view',
    companyId,
    sourceService: 'strategicInsightService',
    status: ['open'],
    limit: options?.limit ?? DEFAULT_LIMIT,
  });

  return {
    decisions: assertDecisionArray('strategicIntelligenceOrchestrationService.getStrategicThemesForCompany', decisions),
  };
}

export async function getMarketPulseForCompany(
  companyId: string
): Promise<{ report_view: DecisionReportView }> {
  const report = await getDecisionReportView({
    companyId,
    reportTier: 'growth',
    sourceService: 'strategicInsightService',
  });

  return {
    report_view: assertDecisionReportView('strategicIntelligenceOrchestrationService.getMarketPulseForCompany', report),
  };
}

export async function getCompetitiveIntelligenceForCompany(
  companyId: string
): Promise<{ decisions: PersistedDecisionObject[] }> {
  const decisions = await listDecisionObjects({
    viewName: 'growth_view',
    companyId,
    sourceService: 'strategicInsightService',
    status: ['open'],
    limit: DEFAULT_LIMIT,
  });

  return {
    decisions: assertDecisionArray('strategicIntelligenceOrchestrationService.getCompetitiveIntelligenceForCompany', decisions),
  };
}

export async function getPlaybooksForCompany(
  companyId: string
): Promise<{ report_view: DecisionReportView }> {
  const report = await getDecisionReportView({
    companyId,
    reportTier: 'growth',
  });

  return {
    report_view: assertDecisionReportView('strategicIntelligenceOrchestrationService.getPlaybooksForCompany', report),
  };
}

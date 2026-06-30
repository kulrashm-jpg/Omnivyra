/**
 * Revenue Operations (RevOps) plugin (Phase 29). The operational bridge across marketing →
 * lead → sales → customer → revenue. Reuses the existing journey / attribution / cohort /
 * conversion / lead-stats reads + the domain scorer, and composes through the platform
 * engines via the registry. Contributes only provide() + impactConfig + entityLabel.
 */
import { getCustomerJourneyIntelligence } from '../leadIntelligence/customerJourneyRepository';
import { getAttributionAggregation } from '../leadIntelligence/attributionRepository';
import { getCohortFunnelIntelligence } from '../leadIntelligence/cohortFunnelRepository';
import { getMarketingConversionPrediction } from '../leadIntelligence/conversionPredictionRepository';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreRevenueOperations } from './revenueOperationsEngine';
import { REVOPS_IMPACT_CONFIG, REVOPS_LOW_EFFORT, REVOPS_HIGH_EFFORT, type RevOpsDimension } from './revenueOperationsImpactConfig';

export type RevenueOperationsSnapshot = PluginSnapshot<RevOpsDimension>;

export const revenueOperationsPlugin: IntelligencePlugin<RevOpsDimension> = {
  id: 'revenue_operations',
  displayName: 'Revenue Operations',
  domain: 'revenue_operations',
  entityLabel: 'Revenue operations',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['revenue', 'command-center', 'executive'],
  impactConfig: REVOPS_IMPACT_CONFIG,
  lowEffortKeys: REVOPS_LOW_EFFORT,
  highEffortKeys: REVOPS_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [journey, attribution, cohort, conversion, leadStats] = await Promise.all([
      getCustomerJourneyIntelligence(companyId).catch(() => null),
      getAttributionAggregation(companyId).catch(() => null),
      getCohortFunnelIntelligence(companyId).catch(() => null),
      getMarketingConversionPrediction(companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
    ]);
    const r = scoreRevenueOperations({ journey, attribution, cohort, conversion, leadStats });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(revenueOperationsPlugin);

export async function buildRevenueOperationsSnapshot(companyId: string, nowMs = Date.now()): Promise<RevenueOperationsSnapshot> {
  return composePluginSnapshot(revenueOperationsPlugin, companyId, nowMs);
}
export async function getRevenueOperationsPresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(revenueOperationsPlugin, companyId));
}
export async function getRevenueOperationsHtml(companyId: string): Promise<string> {
  return renderPluginHtml(revenueOperationsPlugin, companyId);
}

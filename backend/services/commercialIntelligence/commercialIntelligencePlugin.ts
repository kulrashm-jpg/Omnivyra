/**
 * Commercial / Revenue Intelligence plugin (Phase 23). Reuses the existing lead-intelligence
 * commercial signals (cohort funnel, conversion prediction, customer journey, attribution
 * aggregation, lead stats) + the domain scorer, and registers as a platform plugin. All
 * generic intelligence belongs to Platform Intelligence (composed by the registry).
 * Auto-discovery (Phase 21E) surfaces it in every report with zero report edits.
 */
import { getCohortFunnelIntelligence } from '../leadIntelligence/cohortFunnelRepository';
import { getMarketingConversionPrediction } from '../leadIntelligence/conversionPredictionRepository';
import { getCustomerJourneyIntelligence } from '../leadIntelligence/customerJourneyRepository';
import { getAttributionAggregation } from '../leadIntelligence/attributionRepository';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreCommercialIntelligence } from './commercialIntelligenceEngine';
import { COMMERCIAL_IMPACT_CONFIG, COMMERCIAL_LOW_EFFORT, COMMERCIAL_HIGH_EFFORT, type CommercialDimension } from './commercialImpactConfig';

export type CommercialIntelligenceSnapshot = PluginSnapshot<CommercialDimension>;

export const commercialIntelligencePlugin: IntelligencePlugin<CommercialDimension> = {
  id: 'commercial_intelligence',
  displayName: 'Commercial & Revenue Intelligence',
  domain: 'commercial',
  entityLabel: 'Commercial & Revenue',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['revenue', 'command-center', 'growth-intelligence'],
  impactConfig: COMMERCIAL_IMPACT_CONFIG,
  lowEffortKeys: COMMERCIAL_LOW_EFFORT,
  highEffortKeys: COMMERCIAL_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [cohort, conversion, journey, attribution, leadStats] = await Promise.all([
      getCohortFunnelIntelligence(companyId).catch(() => null),
      getMarketingConversionPrediction(companyId).catch(() => null),
      getCustomerJourneyIntelligence(companyId).catch(() => null),
      getAttributionAggregation(companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
    ]);
    const r = scoreCommercialIntelligence({ cohort, conversion, journey, attribution, leadStats });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(commercialIntelligencePlugin);

export async function buildCommercialIntelligenceSnapshot(companyId: string, nowMs = Date.now()): Promise<CommercialIntelligenceSnapshot> {
  return composePluginSnapshot(commercialIntelligencePlugin, companyId, nowMs);
}
export async function getCommercialIntelligencePresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(commercialIntelligencePlugin, companyId));
}
export async function getCommercialIntelligenceHtml(companyId: string): Promise<string> {
  return renderPluginHtml(commercialIntelligencePlugin, companyId);
}

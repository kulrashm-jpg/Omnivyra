/**
 * Marketing & Growth Intelligence plugin (Phase 22). The first complete business domain on
 * the Platform Intelligence Framework. It REUSES existing engine reads (growth summary, lead
 * stats, website snapshot, activation readiness) + the domain scorer, and registers as a
 * platform plugin. Executive summary, business impact, recommendations, roadmap, confidence,
 * freshness, presentation and rendering all belong to Platform Intelligence (composed by the
 * registry). Auto-discovery (Phase 21E) surfaces it in every report with zero report edits.
 */
import { supabase } from '../../db/supabaseClient';
import { getGrowthIntelligenceSummary } from '../growthIntelligence/growthIntelligenceService';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { getWebsiteSnapshot } from '../websiteIntelligence/websiteIntelligenceRepository';
import { buildActivationReadiness } from '../activationReadinessService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreMarketingGrowth } from './marketingGrowthEngine';
import { MG_IMPACT_CONFIG, MG_LOW_EFFORT, MG_HIGH_EFFORT, type MGDimension } from './marketingGrowthImpactConfig';

export type MarketingGrowthSnapshot = PluginSnapshot<MGDimension>;

export const marketingGrowthPlugin: IntelligencePlugin<MGDimension> = {
  id: 'marketing_growth',
  displayName: 'Marketing & Growth Intelligence',
  domain: 'marketing_growth',
  entityLabel: 'Marketing & Growth',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['marketing', 'growth-intelligence', 'command-center'],
  impactConfig: MG_IMPACT_CONFIG,
  lowEffortKeys: MG_LOW_EFFORT,
  highEffortKeys: MG_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [growth, leadStats, website, readiness] = await Promise.all([
      getGrowthIntelligenceSummary(supabase, companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
      getWebsiteSnapshot(companyId).catch(() => null),
      buildActivationReadiness(companyId).catch(() => null),
    ]);
    const r = scoreMarketingGrowth({ growth, leadStats, website, readiness });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(marketingGrowthPlugin);

/** Convenience accessors (the registry owns composition). */
export async function buildMarketingGrowthSnapshot(companyId: string, nowMs = Date.now()): Promise<MarketingGrowthSnapshot> {
  return composePluginSnapshot(marketingGrowthPlugin, companyId, nowMs);
}
export async function getMarketingGrowthPresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(marketingGrowthPlugin, companyId));
}
export async function getMarketingGrowthHtml(companyId: string): Promise<string> {
  return renderPluginHtml(marketingGrowthPlugin, companyId);
}

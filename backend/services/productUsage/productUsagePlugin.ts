/**
 * Product & Usage Intelligence plugin (Phase 34, Platform Plugin #11). Reuses existing reads
 * (activation readiness, growth summary, lead stats) + the domain scorer, and composes
 * through the platform engines via the registry. Contributes only provide() + impactConfig +
 * entityLabel. Auto-discovery (Phase 21E) surfaces it in every report with zero report edits;
 * registered BEFORE decision/unified so they auto-consume it.
 */
import { supabase } from '../../db/supabaseClient';
import { buildActivationReadiness } from '../activationReadinessService';
import { getGrowthIntelligenceSummary } from '../growthIntelligence/growthIntelligenceService';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreProductUsage } from './productUsageEngine';
import { PRODUCT_IMPACT_CONFIG, PRODUCT_LOW_EFFORT, PRODUCT_HIGH_EFFORT, type ProductDimension } from './productUsageImpactConfig';

export type ProductUsageSnapshot = PluginSnapshot<ProductDimension>;

export const productUsagePlugin: IntelligencePlugin<ProductDimension> = {
  id: 'product_usage',
  displayName: 'Product & Usage Intelligence',
  domain: 'product_usage',
  entityLabel: 'Product & usage',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['product', 'command-center', 'executive'],
  impactConfig: PRODUCT_IMPACT_CONFIG,
  lowEffortKeys: PRODUCT_LOW_EFFORT,
  highEffortKeys: PRODUCT_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [readiness, growth, leadStats] = await Promise.all([
      buildActivationReadiness(companyId).catch(() => null),
      getGrowthIntelligenceSummary(supabase, companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
    ]);
    const r = scoreProductUsage({ readiness, growth, leadStats });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(productUsagePlugin);

export async function buildProductUsageSnapshot(companyId: string, nowMs = Date.now()): Promise<ProductUsageSnapshot> {
  return composePluginSnapshot(productUsagePlugin, companyId, nowMs);
}
export async function getProductUsagePresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(productUsagePlugin, companyId));
}
export async function getProductUsageHtml(companyId: string): Promise<string> {
  return renderPluginHtml(productUsagePlugin, companyId);
}

/**
 * Predictive Intelligence plugin (Phase 36, Platform Plugin #13). Reuses existing reads
 * (conversion prediction, growth summary, cohort funnel, lead stats, activation readiness) +
 * the deterministic domain scorer, and composes through the platform engines via the registry.
 * Contributes only provide() + impactConfig + entityLabel. Registered BEFORE unified/decision
 * so both auto-consume it; auto-discovery surfaces it in every report with zero report edits.
 */
import { supabase } from '../../db/supabaseClient';
import { getMarketingConversionPrediction } from '../leadIntelligence/conversionPredictionRepository';
import { getGrowthIntelligenceSummary } from '../growthIntelligence/growthIntelligenceService';
import { getCohortFunnelIntelligence } from '../leadIntelligence/cohortFunnelRepository';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { buildActivationReadiness } from '../activationReadinessService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scorePredictiveIntelligence } from './predictiveIntelligenceEngine';
import { PREDICTIVE_IMPACT_CONFIG, PREDICTIVE_LOW_EFFORT, PREDICTIVE_HIGH_EFFORT, type PredictiveDimension } from './predictiveImpactConfig';

export type PredictiveSnapshot = PluginSnapshot<PredictiveDimension>;

export const predictiveIntelligencePlugin: IntelligencePlugin<PredictiveDimension> = {
  id: 'predictive_intelligence',
  displayName: 'Predictive Intelligence',
  domain: 'predictive',
  entityLabel: 'Business trajectory',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['executive', 'command-center', 'growth-intelligence'],
  impactConfig: PREDICTIVE_IMPACT_CONFIG,
  lowEffortKeys: PREDICTIVE_LOW_EFFORT,
  highEffortKeys: PREDICTIVE_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [conversion, growth, cohort, leadStats, readiness] = await Promise.all([
      getMarketingConversionPrediction(companyId).catch(() => null),
      getGrowthIntelligenceSummary(supabase, companyId).catch(() => null),
      getCohortFunnelIntelligence(companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
      buildActivationReadiness(companyId).catch(() => null),
    ]);
    const r = scorePredictiveIntelligence({ conversion, growth, cohort, leadStats, readiness });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(predictiveIntelligencePlugin);

export async function buildPredictiveSnapshot(companyId: string, nowMs = Date.now()): Promise<PredictiveSnapshot> {
  return composePluginSnapshot(predictiveIntelligencePlugin, companyId, nowMs);
}
export async function getPredictivePresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(predictiveIntelligencePlugin, companyId));
}
export async function getPredictiveHtml(companyId: string): Promise<string> {
  return renderPluginHtml(predictiveIntelligencePlugin, companyId);
}

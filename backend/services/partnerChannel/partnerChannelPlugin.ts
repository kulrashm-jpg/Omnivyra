/**
 * Partner & Channel Intelligence plugin (Phase 35, Platform Plugin #12). Reuses existing reads
 * (attribution aggregation, lead stats, cohort funnel, journey) + the domain scorer, and
 * composes through the platform engines via the registry. Contributes only provide() +
 * impactConfig + entityLabel. Registered BEFORE unified/decision so both auto-consume it;
 * auto-discovery surfaces it in every report with zero report edits.
 */
import { getAttributionAggregation } from '../leadIntelligence/attributionRepository';
import { getLeadStats } from '../leadIntelligence/leadIntelligenceReadService';
import { getCohortFunnelIntelligence } from '../leadIntelligence/cohortFunnelRepository';
import { getCustomerJourneyIntelligence } from '../leadIntelligence/customerJourneyRepository';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreChannelIntelligence } from './partnerChannelEngine';
import { CHANNEL_IMPACT_CONFIG, CHANNEL_LOW_EFFORT, CHANNEL_HIGH_EFFORT, type ChannelDimension } from './partnerChannelImpactConfig';

export type PartnerChannelSnapshot = PluginSnapshot<ChannelDimension>;

export const partnerChannelPlugin: IntelligencePlugin<ChannelDimension> = {
  id: 'partner_channel',
  displayName: 'Partner & Channel Intelligence',
  domain: 'partner_channel',
  entityLabel: 'Partner & channel',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['channels', 'command-center', 'executive'],
  impactConfig: CHANNEL_IMPACT_CONFIG,
  lowEffortKeys: CHANNEL_LOW_EFFORT,
  highEffortKeys: CHANNEL_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [attribution, leadStats, cohort, journey] = await Promise.all([
      getAttributionAggregation(companyId).catch(() => null),
      getLeadStats({ companyId }).catch(() => null),
      getCohortFunnelIntelligence(companyId).catch(() => null),
      getCustomerJourneyIntelligence(companyId).catch(() => null),
    ]);
    const r = scoreChannelIntelligence({ attribution, leadStats, cohort, journey });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(partnerChannelPlugin);

export async function buildPartnerChannelSnapshot(companyId: string, nowMs = Date.now()): Promise<PartnerChannelSnapshot> {
  return composePluginSnapshot(partnerChannelPlugin, companyId, nowMs);
}
export async function getPartnerChannelPresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(partnerChannelPlugin, companyId));
}
export async function getPartnerChannelHtml(companyId: string): Promise<string> {
  return renderPluginHtml(partnerChannelPlugin, companyId);
}

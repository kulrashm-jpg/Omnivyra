/**
 * Customer Intelligence plugin (Phase 28). Post-conversion customer domain on the Platform
 * Intelligence Framework. Reuses the existing cohort-funnel read (closed-won customers +
 * revenue) and the community sentiment signal (advocacy); composes everything through the
 * platform engines via the registry. Contributes only provide() + impactConfig + entityLabel.
 */
import { supabase } from '../../db/supabaseClient';
import { getCohortFunnelIntelligence } from '../leadIntelligence/cohortFunnelRepository';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginSnapshot } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { scoreCustomerIntelligence } from './customerIntelligenceEngine';
import { CUSTOMER_IMPACT_CONFIG, CUSTOMER_LOW_EFFORT, CUSTOMER_HIGH_EFFORT, type CustomerDimension } from './customerImpactConfig';

export type CustomerIntelligenceSnapshot = PluginSnapshot<CustomerDimension>;

async function loadCommunitySentiment(companyId: string, nowMs: number): Promise<{ total: number; positive: number; negative: number; neutral: number } | null> {
  try {
    const since = new Date(nowMs - 90 * 24 * 3_600_000).toISOString();
    const { data } = await supabase.from('community_ai_actions').select('sentiment').eq('company_id', companyId).gte('created_at', since).limit(2000);
    if (!data || data.length === 0) return null;
    let positive = 0, negative = 0, neutral = 0;
    for (const r of data as Array<{ sentiment?: string | null }>) {
      const s = String(r.sentiment ?? '').toLowerCase();
      if (s === 'positive') positive++; else if (s === 'negative') negative++; else neutral++;
    }
    return { total: data.length, positive, negative, neutral };
  } catch {
    return null;
  }
}

export const customerIntelligencePlugin: IntelligencePlugin<CustomerDimension> = {
  id: 'customer_intelligence',
  displayName: 'Customer Intelligence',
  domain: 'customer',
  entityLabel: 'Customer base',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['customer-success', 'command-center', 'executive'],
  impactConfig: CUSTOMER_IMPACT_CONFIG,
  lowEffortKeys: CUSTOMER_LOW_EFFORT,
  highEffortKeys: CUSTOMER_HIGH_EFFORT,
  async provide({ companyId, nowMs }): Promise<PluginData> {
    const [cohort, community] = await Promise.all([
      getCohortFunnelIntelligence(companyId).catch(() => null),
      loadCommunitySentiment(companyId, nowMs),
    ]);
    const r = scoreCustomerIntelligence({ cohort, community, lastUpdated: cohort?.generatedAt ?? null });
    return { modules: r.modules, recommendationInputs: r.recommendationInputs, score: r.score, lastUpdated: r.lastUpdated };
  },
};

registerPlugin(customerIntelligencePlugin);

export async function buildCustomerIntelligenceSnapshot(companyId: string, nowMs = Date.now()): Promise<CustomerIntelligenceSnapshot> {
  return composePluginSnapshot(customerIntelligencePlugin, companyId, nowMs);
}
export async function getCustomerIntelligencePresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(customerIntelligencePlugin, companyId));
}
export async function getCustomerIntelligenceHtml(companyId: string): Promise<string> {
  return renderPluginHtml(customerIntelligencePlugin, companyId);
}

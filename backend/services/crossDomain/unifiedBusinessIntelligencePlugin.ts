/**
 * Unified Business Intelligence plugin (Phase 30). The autonomous orchestration layer:
 * consumes ONLY the Platform Registry (composes every domain plugin EXCEPT itself and the
 * decision plugin, to avoid recursion), runs cross-domain correlation + business health /
 * risk / opportunity / execution / optimizer, and exposes them as platform modules + raw
 * strategic recommendations. Registered BEFORE decision so Decision auto-consumes it with no
 * Decision edits. Owns no generic intelligence — composition only.
 */
import { registerPlugin, getPlugins, composePluginSnapshot, composePluginSnapshotMemoized, createCompositionContext, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginModule, type PluginSnapshot, type CompositionContext } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';
import { buildUnifiedBusinessIntelligence, type UnifiedBusinessIntelligence } from './crossDomainCorrelationEngine';
import { UNIFIED_IMPACT_CONFIG, UNIFIED_LOW_EFFORT, UNIFIED_HIGH_EFFORT, type UnifiedDimension } from './unifiedImpactConfig';

const PLUGIN_ID = 'unified_business_intelligence';
const EXCLUDE = new Set([PLUGIN_ID, 'decision_intelligence']);

async function composeDomains(companyId: string, nowMs: number, ctx?: CompositionContext): Promise<PluginSnapshot[]> {
  const others = getPlugins().filter((p) => !EXCLUDE.has(p.id));
  const snaps = await Promise.all(others.map((p) => composePluginSnapshotMemoized(p, companyId, nowMs, ctx).catch(() => null)));
  return snaps.filter((s): s is PluginSnapshot => s != null);
}

/** Orchestration read surface (registry-only). */
export async function buildUnifiedBusinessSnapshot(companyId: string, nowMs = Date.now()): Promise<UnifiedBusinessIntelligence> {
  return buildUnifiedBusinessIntelligence(await composeDomains(companyId, nowMs, createCompositionContext()), new Date(nowMs).toISOString());
}

const statusToModule = (s: string): PluginModule['status'] => (s === 'healthy' ? 'ready' : s === 'warning' ? 'partial' : 'unavailable');

export const unifiedBusinessIntelligencePlugin: IntelligencePlugin<UnifiedDimension> = {
  id: PLUGIN_ID,
  displayName: 'Unified Business Intelligence',
  domain: 'unified',
  entityLabel: 'Business',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['executive', 'command-center'],
  impactConfig: UNIFIED_IMPACT_CONFIG,
  lowEffortKeys: UNIFIED_LOW_EFFORT,
  highEffortKeys: UNIFIED_HIGH_EFFORT,
  async provide({ companyId, nowMs, ctx }): Promise<PluginData> {
    const u = buildUnifiedBusinessIntelligence(await composeDomains(companyId, nowMs, ctx), new Date(nowMs).toISOString());
    const hm = (key: string, label: string, c: { score: number | null; status: string; explanation: string }): PluginModule =>
      ({ key, label, source: 'crossDomainCorrelationEngine', score: c.score, status: statusToModule(c.status), available: c.score != null, findings: [c.explanation], lastUpdated: u.generatedAt });
    const modules: PluginModule[] = [
      hm('business_health', 'Overall Business Health', u.health.business),
      hm('digital_health', 'Digital Health', u.health.digital),
      hm('marketing_health', 'Marketing Health', u.health.marketing),
      hm('commercial_health', 'Commercial Health', u.health.commercial),
      hm('customer_health', 'Customer Health', u.health.customer),
      hm('revenue_health', 'Revenue Health', u.health.revenue),
      hm('operational_health', 'Operational Health', u.health.operational),
      hm('growth_health', 'Growth Health', u.health.growth),
      hm('organizational_health', 'Organizational Health', u.health.organizational),
      { key: 'strategic_risk', label: 'Strategic Risk (inverse)', source: 'crossDomainCorrelationEngine', score: 100 - (u.risks.find((r) => r.id === 'strategic')?.risk ?? 50), status: statusToModule((u.risks.find((r) => r.id === 'strategic')?.risk ?? 50) < 40 ? 'healthy' : (u.risks.find((r) => r.id === 'strategic')?.risk ?? 50) < 60 ? 'warning' : 'disconnected'), available: true, findings: [`Root cause: ${u.risks.find((r) => r.id === 'strategic')?.rootCause ?? '—'}`], lastUpdated: u.generatedAt },
      { key: 'maturity', label: 'Business Maturity', source: 'crossDomainCorrelationEngine', score: u.maturity.overall * 20, status: statusToModule(u.maturity.overall >= 4 ? 'healthy' : u.maturity.overall >= 3 ? 'warning' : 'disconnected'), available: true, findings: [`Level ${u.maturity.overall}/5`], lastUpdated: u.generatedAt },
      { key: 'optimizer_focus', label: 'Optimizer Focus', source: 'crossDomainCorrelationEngine', score: null, status: 'partial', available: false, findings: [`Weakest: ${u.optimizer.weakest ?? '—'}`, `Bottleneck: ${u.optimizer.bottleneck ?? 'none'}`, `Strongest: ${u.optimizer.strongest ?? '—'}`], lastUpdated: u.generatedAt },
    ];

    // STRATEGIC cross-domain recommendations only (domain recs stay in their plugins).
    const inputs: RawRecommendationInput[] = [];
    const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => inputs.push({ key, text, source: 'unifiedBusinessIntelligence', module, impactLevel, confidence });
    if (u.optimizer.weakest) rec('optimize_weakest_domain', `Optimise the weakest domain (${u.optimizer.weakest}) — it caps overall business health.`, 'business_health', 'high', 0.85);
    if (u.optimizer.bottleneck) rec('resolve_bottleneck', `Resolve the cross-domain bottleneck originating at ${u.optimizer.bottleneck}.`, 'operational_health', 'high', 0.8);
    if (u.optimizer.largestOpportunity) rec('pursue_largest_opportunity', `Pursue the largest opportunity: ${u.optimizer.largestOpportunity}.`, 'optimizer_focus', 'medium', 0.8);
    if ((u.risks.find((r) => r.id === 'strategic')?.risk ?? 0) >= 60) rec('reduce_strategic_risk', 'Reduce strategic risk by strengthening the weakest upstream domains.', 'strategic_risk', 'high', 0.8);

    return { modules, recommendationInputs: inputs, score: u.health.business.score ?? 0, lastUpdated: u.generatedAt, overall: u.health.business.status };
  },
};

registerPlugin(unifiedBusinessIntelligencePlugin);

export async function getUnifiedBusinessPresentation(companyId: string): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshot(unifiedBusinessIntelligencePlugin, companyId, Date.now(), createCompositionContext()));
}
export async function getUnifiedBusinessHtml(companyId: string): Promise<string> {
  return renderPluginHtml(unifiedBusinessIntelligencePlugin, companyId, Date.now(), createCompositionContext());
}

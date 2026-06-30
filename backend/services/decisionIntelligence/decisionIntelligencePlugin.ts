/**
 * Decision Intelligence plugin (Phase 24). The strategic brain registered as a Platform
 * plugin. Its provide() consumes ONLY the Platform Registry — it composes every OTHER
 * registered plugin's snapshot and aggregates them; it never calls a domain repository.
 * It emits only STRATEGIC cross-cutting recommendations (focus/unblock/sequence); domain
 * recommendations remain owned by their own plugins, so nothing is duplicated globally.
 */
import { registerPlugin, getPlugins, composePluginSnapshotMemoized, createCompositionContext, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginModule, type PluginSnapshot, type CompositionContext } from '../platformIntelligence/registry';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { aggregateDecision, type DecisionIntelligence } from './decisionIntelligenceEngine';
import { DECISION_IMPACT_CONFIG, DECISION_LOW_EFFORT, DECISION_HIGH_EFFORT, type DecisionDimension } from './decisionImpactConfig';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

const PLUGIN_ID = 'decision_intelligence';

/** Compose every registered plugin EXCEPT this one — the only data source (registry-driven). */
async function composeOthers(companyId: string, nowMs: number, ctx?: CompositionContext): Promise<PluginSnapshot[]> {
  const others = getPlugins().filter((p) => p.id !== PLUGIN_ID);
  const snaps = await Promise.all(others.map((p) => composePluginSnapshotMemoized(p, companyId, nowMs, ctx).catch(() => null)));
  return snaps.filter((s): s is PluginSnapshot => s != null);
}

/** Strategic-brain read surface (consumes only the registry). */
export async function buildDecisionIntelligence(companyId: string, nowMs = Date.now(), ctx: CompositionContext = createCompositionContext()): Promise<DecisionIntelligence> {
  return aggregateDecision(await composeOthers(companyId, nowMs, ctx), new Date(nowMs).toISOString());
}

const statusToModuleStatus = (s: string): PluginModule['status'] => (s === 'healthy' ? 'ready' : s === 'warning' ? 'partial' : 'unavailable');

export const decisionIntelligencePlugin: IntelligencePlugin<DecisionDimension> = {
  id: PLUGIN_ID,
  displayName: 'Decision Intelligence',
  domain: 'decision',
  entityLabel: 'Executive decision',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['executive', 'command-center'],
  impactConfig: DECISION_IMPACT_CONFIG,
  lowEffortKeys: DECISION_LOW_EFFORT,
  highEffortKeys: DECISION_HIGH_EFFORT,
  async provide({ companyId, nowMs, ctx }): Promise<PluginData> {
    const snaps = await composeOthers(companyId, nowMs, ctx);
    const d = aggregateDecision(snaps, new Date(nowMs).toISOString());
    const hm = (key: string, label: string, c: { score: number | null; status: string }): PluginModule =>
      ({ key, label, source: 'decisionIntelligence', score: c.score, status: statusToModuleStatus(c.status), available: c.score != null, findings: [`${label}: ${c.score ?? 'Unknown'}`], lastUpdated: d.generatedAt });
    const modules: PluginModule[] = [
      hm('business_health', 'Overall Business Health', d.health.business),
      hm('digital_health', 'Digital Health', d.health.digital),
      hm('marketing_health', 'Marketing Health', d.health.marketing),
      hm('sales_health', 'Sales Health', d.health.sales),
      hm('revenue_health', 'Revenue Health', d.health.revenue),
      hm('operational_health', 'Operational Health', d.health.operational),
      hm('readiness', 'Overall Readiness', d.health.readiness),
      { key: 'execution', label: 'Execution Score', source: 'decisionIntelligence', score: d.scores.execution, status: statusToModuleStatus(d.scores.execution >= 75 ? 'healthy' : d.scores.execution >= 45 ? 'warning' : 'disconnected'), available: true, findings: [`Execution ${d.scores.execution}`], lastUpdated: d.generatedAt },
      { key: 'maturity', label: 'Business Maturity', source: 'decisionIntelligence', score: d.maturity.overall * 20, status: statusToModuleStatus(d.maturity.overall >= 4 ? 'healthy' : d.maturity.overall >= 3 ? 'warning' : 'disconnected'), available: true, findings: [`Level ${d.maturity.overall}/5`], lastUpdated: d.generatedAt },
    ];

    // STRATEGIC recommendations only (not copies of domain recs — those stay in their plugins).
    const inputs: RawRecommendationInput[] = [];
    const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => inputs.push({ key, text, source: 'decisionIntelligence', module, impactLevel, confidence });
    const weakest = [...d.domains].sort((a, b) => a.score - b.score)[0];
    if (weakest) rec('focus_weakest_domain', `Prioritise ${weakest.displayName} — the weakest domain at ${weakest.score}/100.`, 'business_health', 'high', 0.85);
    const blocked = d.dependencyGraph.find((n) => n.dependsOn.some((dep) => (d.domains.find((x) => x.id.includes(dep) || x.id === dep)?.score ?? 100) < 50));
    if (blocked) rec('unblock_prerequisite', `Strengthen prerequisites (${blocked.dependsOn.join(', ')}) to unlock ${blocked.node}.`, 'sales_health', 'high', 0.8);
    if (d.opportunities.length) rec('pursue_quick_wins', `Execute ${d.opportunities.length} cross-domain quick wins for fast value.`, 'execution', 'medium', 0.8);
    if (d.maturity.overall < 3) rec('advance_maturity', 'Advance overall business maturity by activating core capabilities across domains.', 'maturity', 'medium', 0.8);

    return { modules, recommendationInputs: inputs, score: d.scores.executiveDecision, lastUpdated: d.generatedAt, overall: d.health.business.status };
  },
};

registerPlugin(decisionIntelligencePlugin);

export async function getDecisionIntelligencePresentation(companyId: string, nowMs = Date.now(), ctx: CompositionContext = createCompositionContext()): Promise<IntelligencePresentationModel> {
  return toPresentationModel(await composePluginSnapshotMemoized(decisionIntelligencePlugin, companyId, nowMs, ctx));
}
export async function getDecisionIntelligenceHtml(companyId: string, nowMs = Date.now(), ctx: CompositionContext = createCompositionContext()): Promise<string> {
  return renderPluginHtml(decisionIntelligencePlugin, companyId, nowMs, ctx);
}

/**
 * Lead Intelligence plugin (Phase 21C → 21D). Consumer #2, now expressed as a Platform
 * Intelligence PLUGIN: it READS the existing lead engines (getLeadStats + activation
 * readiness) and emits modules + raw recommendation inputs; the registry composes the
 * snapshot through the platform engines. No generic intelligence lives here.
 */
import { getLeadStats } from './leadIntelligenceReadService';
import { buildActivationReadiness } from '../activationReadinessService';
import { registerPlugin, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin, type PluginData, type PluginModule, type PluginSnapshot } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';
import type { HealthState } from '../platformIntelligence/executiveSummary';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';
import { LEAD_IMPACT_CONFIG, LEAD_LOW_EFFORT, LEAD_HIGH_EFFORT, type LeadImpactDimension } from './leadImpactConfig';

type D = LeadImpactDimension;
export type LeadIntelligenceSnapshot = PluginSnapshot<D> & { companyId: string; generatedAt: string };

const statusFromScore = (s: number | null): 'ready' | 'partial' | 'unavailable' => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export const leadPlugin: IntelligencePlugin<D> = {
  id: 'lead',
  displayName: 'Lead Intelligence',
  domain: 'lead',
  entityLabel: 'Lead pipeline',
  supportedReports: ['snapshot', 'performance', 'growth'],
  supportedDashboards: ['lead-intelligence'],
  impactConfig: LEAD_IMPACT_CONFIG,
  lowEffortKeys: LEAD_LOW_EFFORT,
  highEffortKeys: LEAD_HIGH_EFFORT,
  async provide({ companyId }): Promise<PluginData> {
    const [stats, readiness] = await Promise.all([
      getLeadStats({ companyId }).catch(() => ({ total: 0, bySource: {}, byStatus: {}, intentBands: { high: 0, medium: 0, low: 0 }, withIdentity: 0, withCampaign: 0 })),
      buildActivationReadiness(companyId).catch(() => null as any),
    ]);
    const total = Number(stats.total ?? 0);
    const bands = stats.intentBands ?? { high: 0, medium: 0, low: 0 };
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const leadsReady = !!readiness?.checks?.find((c: any) => c.id === 'leads')?.done;
    const updatedAt = readiness?.generatedAt ?? null;

    const modules: PluginModule[] = [
      { key: 'buying_intent', label: 'Buying Intent', source: 'buyingIntent', score: total > 0 ? Math.round((bands.high * 100 + bands.medium * 50 + bands.low * 20) / total) : null, status: 'unavailable', available: total > 0, findings: total > 0 ? [`${bands.high} high-intent of ${total} leads`] : ['No leads captured yet'], lastUpdated: updatedAt },
      { key: 'identity', label: 'Identity Resolution', source: 'customerIdentityRepository', score: total > 0 ? pct(Number(stats.withIdentity ?? 0)) : null, status: 'unavailable', available: total > 0, findings: [`${stats.withIdentity ?? 0}/${total} identity-resolved`], lastUpdated: updatedAt },
      { key: 'attribution', label: 'Attribution', source: 'attributionRepository', score: total > 0 ? pct(Number(stats.withCampaign ?? 0)) : null, status: 'unavailable', available: total > 0, findings: [`${stats.withCampaign ?? 0}/${total} campaign-attributed`], lastUpdated: updatedAt },
      { key: 'pipeline', label: 'Pipeline', source: 'leadIntelligenceReadService', score: total > 0 ? Math.min(100, total * 4) : 0, status: 'partial', available: true, findings: [`${total} leads in pipeline`], lastUpdated: updatedAt },
      { key: 'lead_readiness', label: 'Lead Readiness', source: 'activationReadinessService', score: leadsReady ? 100 : 50, status: leadsReady ? 'ready' : 'partial', available: true, findings: [leadsReady ? 'Lead capture active' : 'Lead capture not configured'], lastUpdated: updatedAt },
    ];
    for (const m of modules) if (m.key !== 'lead_readiness' && m.key !== 'pipeline') m.status = statusFromScore(m.score);

    const inputs: RawRecommendationInput[] = [];
    const push = (key: string, text: string, source: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => inputs.push({ key, text, source, module, impactLevel, confidence });
    if (total === 0) push('no_opportunity', 'Capture leads — the pipeline is empty.', 'leadIntelligenceReadService', 'pipeline', 'high', 0.9);
    if (total > 0 && bands.high / total < 0.2) push('low_buying_intent', 'Nurture leads toward higher buying intent.', 'buyingIntent', 'buying_intent', 'medium', 0.8);
    if (total > 0 && Number(stats.withIdentity ?? 0) / total < 0.5) push('no_engagement', 'Enrich lead identity and engagement signals.', 'customerIdentityRepository', 'identity', 'medium', 0.75);
    if (total > 0 && Number(stats.withCampaign ?? 0) / total < 0.5) push('no_follow_up', 'Strengthen campaign attribution and follow-up.', 'attributionRepository', 'attribution', 'medium', 0.75);
    for (const c of (readiness?.checks ?? [])) if (!c.done) push(c.id ?? 'readiness', c.nextActionLabel ?? '', 'activationReadinessService', 'lead_readiness', 'high', 0.9);

    const scored = modules.map((m) => m.score).filter((s): s is number => s != null);
    const composite = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
    const overall: HealthState = total === 0 ? 'disconnected' : composite >= 75 && leadsReady ? 'healthy' : 'warning';
    return { modules, recommendationInputs: inputs, score: composite, lastUpdated: updatedAt, overall };
  },
};

registerPlugin(leadPlugin);

export async function buildLeadIntelligenceSnapshot(companyId: string, nowMs = Date.now()): Promise<LeadIntelligenceSnapshot> {
  const snap = await composePluginSnapshot(leadPlugin, companyId, nowMs);
  return { ...snap, companyId, generatedAt: new Date(nowMs).toISOString() };
}

/** Phase I — delegates to the platform presentation adapter (no Lead-specific model). */
export function buildLeadPresentationModel(snapshot: LeadIntelligenceSnapshot): IntelligencePresentationModel {
  return toPresentationModel(snapshot);
}

/** Phase J — fail-open report projection for the report composers. */
export async function getLeadReportSafe(companyId: string): Promise<LeadIntelligenceSnapshot | null> {
  try { return await buildLeadIntelligenceSnapshot(companyId); } catch { return null; }
}

/** Phase I — render Lead Intelligence through the platform HTML renderer. */
export async function getLeadIntelligenceHtml(companyId: string): Promise<string> {
  return renderPluginHtml(leadPlugin, companyId);
}
